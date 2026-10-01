// Dependency-free so diagnostics still work when node_modules needs repair.
const sensitiveKey = /password|passcode|secret|token|authorization|cookie|credential|api[_-]?key|cert|(?:database|direct)[_-]?url|ebay[_-]?(?:app|dev)[_-]?id/i;
const replacement = '[REDACTED]';

/** @param {Record<string, string | undefined>} environment */
export function createLogRedactor(environment = {}) {
  const secrets = new Set();
  for (const [key, value] of Object.entries(environment)) {
    if (!sensitiveKey.test(key) || !value || value.length < 4) continue;
    secrets.add(value);
    secrets.add(encodeURIComponent(value));
    for (const line of value.split(/\r?\n/)) {
      if (line.length >= 12) secrets.add(line);
    }
    try {
      const url = new URL(value);
      if (url.password) {
        secrets.add(url.password);
        secrets.add(decodeURIComponent(url.password));
      }
    } catch { /* Most secrets are not URLs. */ }
  }
  const ordered = [...secrets].filter(value => value.length >= 4).sort((a, b) => b.length - a.length);
  /** @param {string} text */
  return function redact(text) {
    let result = text;
    for (const value of ordered) result = result.split(value).join(replacement);
    return result
      .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, replacement)
      .replace(/\b(?:postgres(?:ql)?|https?|redis(?:s)?):\/\/[^\s"'<>]*@/gi, match => `${match.split('://')[0]}://${replacement}@`)
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_=.%~-]+/gi, `$1 ${replacement}`)
      .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, replacement)
      .replace(/([?&](?:[^=&#\s]*(?:token|secret|password|signature|api[_-]?key)[^=&#\s]*)=)[^&#\s"']+/gi, `$1${replacement}`)
      .replace(/(<(?:\w+:)?(?:eBayAuthToken|Password|Token|Secret|Authorization)>)[\s\S]*?(<\/[^>]+>)/gi, `$1${replacement}$2`)
      .replace(/("[^"\r\n]*(?:password|secret|token|authorization|cookie|credential|api[_-]?key|database[_-]?url|direct[_-]?url)[^"\r\n]*"\s*:\s*)"(?:\\.|[^"\\])*"/gi, `$1"${replacement}"`)
      .replace(/\b((?:[A-Z_]*(?:PASSWORD|SECRET|TOKEN|DATABASE_URL|DIRECT_URL|API_KEY)[A-Z_]*|Authorization|Cookie|Set-Cookie)\s*[:=]\s*)[^\r\n]+/gi, `$1${replacement}`);
  };
}

/** Redact all strings, including messages and error stacks, before persistence.
 * @param {unknown} value
 * @param {(text: string) => string} redact
 * @returns {unknown}
 */
export function redactLogValue(value, redact) {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(item => redactLogValue(item, redact));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key, sensitiveKey.test(key) || /^(rawXml|requestBody|responseBody|headers)$/i.test(key)
        ? replacement : redactLogValue(item, redact),
    ]));
  }
  return value;
}
