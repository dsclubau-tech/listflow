import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createLogRedactor, redactLogValue } from '../lib/worker-log-redaction.mjs';

const MAX_FILES = 60;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const allowedLog = /^(?:(?:worker-[a-z0-9-]+|events-[a-z0-9_-]+|listflow|local-workers-supervisor(?:\.(?:out|err))?|setup-worker|update-worker)\.log)(?:\.[1-3])?$/i;

function errorCode(error) {
  return /^[A-Z0-9_]+$/.test(error?.code || '') ? error.code : 'READ_FAILED';
}
function regularFile(file) {
  try { const stat = fs.lstatSync(file); return stat.isFile() && !stat.isSymbolicLink(); }
  catch { return false; }
}
function readTail(file, maxBytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(Math.min(size, maxBytes));
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, start);
    let text = buffer.subarray(0, bytes).toString('utf8');
    // Partial lines can contain the tail of a credential. Never export them.
    if (start > 0) {
      const boundary = text.indexOf('\n');
      text = boundary < 0 ? '' : text.slice(boundary + 1);
    }
    const lastNewline = text.lastIndexOf('\n');
    text = lastNewline < 0 ? '' : text.slice(0, lastNewline + 1);
    return { text, bytes, originalBytes: size, truncated: start > 0 };
  } finally { fs.closeSync(fd); }
}

/** No network, database queries, npm, or worker startup. */
export function collectWorkerDiagnostics(root) {
  root = path.resolve(root);
  const warnings = [];
  const secretEnvironment = { ...process.env };
  let configured = {};
  let environmentIndex = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!/^\.env(?:\.[\w.-]+)?$/.test(entry.name)) continue;
    if (entry.isSymbolicLink()) throw new Error('Linked environment files cannot be safely collected.');
    if (!entry.isFile()) continue;
    try {
      const file = path.join(root, entry.name);
      if (fs.statSync(file).size > 1024 * 1024) throw new Error('oversized env');
      const values = parseEnv(fs.readFileSync(file, 'utf8'));
      if (entry.name === '.env') configured = values;
      for (const [key, value] of Object.entries(values)) secretEnvironment[`${key}_${environmentIndex}`] = value;
      environmentIndex++;
    } catch {
      throw new Error('Cannot safely read environment configuration for redaction. Fix file access and retry.');
    }
  }
  if (!environmentIndex) warnings.push('No environment file found; only generic credential patterns and process environment could be masked.');
  const redact = createLogRedactor(secretEnvironment);
  const logs = [];
  const incidents = [];
  const directory = path.join(root, 'logs');
  let candidates = [];
  if (fs.existsSync(directory)) {
    if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('The logs directory must not be a link.');
    candidates = fs.readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isFile() && !entry.isSymbolicLink() && allowedLog.test(entry.name))
      .map(entry => ({ name: entry.name, file: path.join(directory, entry.name) }));
    candidates.sort((a, b) => {
      const rank = item => /\.log$/.test(item.name) ? 0 : 1;
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });
  }
  let remaining = MAX_TOTAL_BYTES;
  for (const candidate of candidates.slice(0, MAX_FILES)) {
    if (remaining <= 0) break;
    try {
      const tail = readTail(candidate.file, Math.min(remaining, MAX_FILE_BYTES));
      remaining -= tail.bytes;
      const content = redact(tail.text).split('\n').map(line => {
        try { return JSON.stringify(redactLogValue(JSON.parse(line), redact)); }
        catch { return line; }
      }).join('\n');
      logs.push({ file: candidate.name, originalBytes: tail.originalBytes, truncated: tail.truncated, content });
      const fileIncidents = [];
      for (const line of content.split('\n')) {
        if (/"level":"(?:ERROR|CRITICAL|WARN)"|"event":"(?:supervisor-fatal|worker-exited|worker-process-error|worker-restart-scheduled|worker-log-write-failed)"|\b(?:error|failed|exception|ENOSPC|EACCES|ENOMEM|ECONNRESET|ETIMEDOUT)\b/i.test(line)) {
          const timestamp = line.match(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z/)?.[0] || null;
          fileIncidents.push({ file: candidate.name, timestamp, line: line.slice(0, 8000) });
          if (fileIncidents.length > 20) fileIncidents.shift();
        }
      }
      incidents.push(...fileIncidents);
    } catch (error) { warnings.push(`${candidate.name}: ${errorCode(error)}; file may have rotated during collection.`); }
  }
  if (candidates.length > logs.length) warnings.push('Some files were omitted due to collection limits or read failures.');
  let revision = 'unknown';
  try {
    revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (!/^[a-f0-9]{40,64}$/.test(revision)) revision = 'unknown';
  } catch { /* Portable installs may not have Git. */ }
  const readJson = relative => {
    const file = path.join(root, relative);
    if (!regularFile(file)) return {};
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
  };
  const pkg = readJson('package.json');
  const lock = readJson('package-lock.json');
  /** @type {Record<string, {installed: string | null, locked: string | null}>} */
  const dependencyVersions = {};
  for (const name of ['tsx', 'playwright', 'prisma', '@prisma/client', 'pg']) {
    dependencyVersions[name] = { installed: readJson(`node_modules/${name}/package.json`).version || null, locked: lock.packages?.[`node_modules/${name}`]?.version || null };
  }
  let freeDiskMB = null;
  try { const stat = fs.statfsSync(root); freeDiskMB = Math.round(stat.bavail * stat.bsize / 1048576); } catch { /* Optional. */ }
  /** @type {Record<string, string>} */
  const configuration = {};
  for (const key of ['DATABASE_URL', 'LISTFLOW_DEPLOYED_DATABASE_URL', 'MIGRATION_SOURCE_DATABASE_URL', 'EBAY_APP_ID', 'EBAY_DEV_ID', 'EBAY_CERT_ID', 'EBAY_STORE1_TOKEN', 'EBAY_STORE2_TOKEN', 'EBAY_STORE3_TOKEN', 'AA_ENTITLEMENT_BEARER_TOKEN', 'LISTFLOW_PUBLIC_IMAGE_BASE_URL']) {
    configuration[key] = configured[key]?.trim() ? 'present' : 'absent';
  }
  const locks = [];
  if (fs.existsSync(directory)) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink() || !/^(?:local-[a-z0-9-]+\.worker|local-workers\.supervisor)\.lock$/i.test(entry.name)) continue;
      try {
        const file = path.join(directory, entry.name);
        if (fs.statSync(file).size > 100) continue;
        const raw = fs.readFileSync(file, 'utf8').trim();
        const pid = /^\d{1,10}$/.test(raw) ? Number(raw) : null;
        let processAlive = false;
        if (pid && pid > 0) { try { process.kill(pid, 0); processAlive = true; } catch { /* No process visible. */ } }
        locks.push({ file: entry.name, pid, processAlive });
      } catch { warnings.push(`${entry.name}: could not inspect lock.`); }
    }
  }
  const report = {
    format: 'listflow-worker-diagnostics-v1',
    collectedAt: new Date().toISOString(),
    machineId: createHash('sha256').update(os.hostname()).digest('hex').slice(0, 12),
    runtime: { node: process.version, platform: process.platform, osRelease: os.release(), architecture: process.arch, cpuCount: os.cpus().length, totalMemoryMB: Math.round(os.totalmem() / 1048576), freeMemoryMB: Math.round(os.freemem() / 1048576), freeDiskMB, systemUptimeSeconds: Math.round(os.uptime()) },
    release: { revision, packageVersion: pkg.version, dependencyVersions },
    localProcesses: locks,
    notes: ['Local snapshot only; no database or eBay requests were made.', 'Process IDs may be reused; a live PID alone does not prove worker health.', 'Known credentials and common credential patterns are masked. Review before sharing; store, job, product IDs and operational data may remain.', 'Logs are bounded tails, not a complete history. Timestamps are UTC.'],
    warnings,
    recentIncidents: incidents.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || '')).slice(0, 200),
    logs,
    configurationPresence: configuration,
  };
  const safeReport = /** @type {typeof report} */ (redactLogValue(report, redact));
  // Presence flags contain no values and must survive sensitive-key masking.
  safeReport.configurationPresence = configuration;
  return safeReport;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const report = collectWorkerDiagnostics(root);
    const outputDirectory = path.join(root, 'diagnostics');
    if (fs.existsSync(outputDirectory) && fs.lstatSync(outputDirectory).isSymbolicLink()) throw new Error('Diagnostics directory must not be a link.');
    fs.mkdirSync(outputDirectory, { recursive: true });
    const name = `ListFlow-Diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}.json`;
    const file = path.join(outputDirectory, name);
    fs.writeFileSync(file, JSON.stringify(report, null, 2), { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`${file}\n`);
  } catch (error) {
    process.stderr.write(`Diagnostic collection failed (${errorCode(error)}). Check Node.js and access to the ListFlow folder.\n`);
    process.exitCode = 1;
  }
}
