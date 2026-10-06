"use client";
import type { InventoryJobError } from "@/lib/ebay-inventory-job-results";

import { useCallback, useEffect, useRef, useState } from "react";

export type BulkEditJob = {
  id: string;
  storeId: string;
  type: string;
  status: "QUEUED" | "RUNNING" | "CANCELLING" | "CANCELLED" | "COMPLETED" | "FAILED";
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  errors: InventoryJobError[];
  errorMessage?: string | null;
  updatedAt?: string;
  completedAt: string | null;
  queuePosition?: number | null;
};

export type BulkEditSkipped = { productId: string; title: string; reason: string };
type TrackedJob = { job: BulkEditJob; skipped: BulkEditSkipped[] };
const STORAGE_PREFIX = "listflow:bulk-edit-job:";

export function isActiveBulkEditJob(job: BulkEditJob | null) {
  return job?.status === "QUEUED" || job?.status === "RUNNING" || job?.status === "CANCELLING";
}

export function isTerminalBulkEditJob(job: BulkEditJob | null) {
  return job?.status === "COMPLETED" || job?.status === "FAILED" || job?.status === "CANCELLED";
}

function completionKey(job: BulkEditJob) {
  return `${job.storeId}:${job.id}:${job.completedAt ?? job.updatedAt ?? job.status}`;
}

function saveReference(storeId: string, jobId: string | null, skipped?: BulkEditSkipped[]) {
  try {
    if (jobId) {
      window.localStorage.setItem(`${STORAGE_PREFIX}${storeId}`, jobId);
      if (skipped) window.localStorage.setItem(`${STORAGE_PREFIX}${storeId}:skipped`, JSON.stringify({ jobId, skipped }));
    } else {
      window.localStorage.removeItem(`${STORAGE_PREFIX}${storeId}`);
      window.localStorage.removeItem(`${STORAGE_PREFIX}${storeId}:skipped`);
    }
  } catch {
    // Browser storage is optional; the job still exists on the server.
  }
}

function restoreSkipped(storeId: string, jobId: string): BulkEditSkipped[] {
  try {
    const saved = JSON.parse(window.localStorage.getItem(`${STORAGE_PREFIX}${storeId}:skipped`) ?? "null");
    if (saved?.jobId !== jobId || !Array.isArray(saved.skipped)) return [];
    return saved.skipped.filter((item: BulkEditSkipped) => item && typeof item.productId === "string" && typeof item.title === "string" && typeof item.reason === "string");
  } catch { return []; }
}

export function useBulkEditJob(
  storeId: string | null,
  onCompleted: (job: BulkEditJob) => void,
) {
  const [tracked, setTracked] = useState<TrackedJob | null>(null);
  const [preview, setPreview] = useState<{ storeId: string; jobId: string; expiresAt: number } | null>(null);
  const [workerOnline, setWorkerOnline] = useState<boolean | null>(null);
  const [pollingInterrupted, setPollingInterrupted] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const generation = useRef(0);
  const notified = useRef(new Set<string>());
  const liveJobs = useRef(new Set<string>());
  const lastSuccessfulPoll = useRef(Date.now());
  const job = tracked?.job.storeId === storeId ? tracked.job : null;
  const skipped = job ? tracked?.skipped ?? [] : [];

  useEffect(() => {
    const controller = new AbortController();
    const requestGeneration = ++generation.current;
    setTracked(null);
    setPreview(null);
    setWorkerOnline(null);
    setPollingInterrupted(false);
    let savedJobId: string | null = null;
    try { savedJobId = storeId ? window.localStorage.getItem(`${STORAGE_PREFIX}${storeId}`) : null; } catch { /* Optional storage. */ }
    if (!storeId || !savedJobId) {
      setRestoring(false);
      return () => controller.abort();
    }
    setRestoring(true);
    void fetch(`/api/products/bulk-edit/jobs/${encodeURIComponent(savedJobId)}`, {
      cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
    }).then(async response => {
      const data = await response.json().catch(() => ({})) as { job?: BulkEditJob };
      if (controller.signal.aborted || generation.current !== requestGeneration) return;
      if (response.ok && data.job?.storeId === storeId && data.job.type === "BULK_EDIT_REVISE") {
        if (isTerminalBulkEditJob(data.job)) notified.current.add(completionKey(data.job));
        else liveJobs.current.add(`${storeId}:${data.job.id}`);
        lastSuccessfulPoll.current = Date.now();
        setTracked({ job: data.job, skipped: restoreSkipped(storeId, data.job.id) });
      } else if (response.status === 404 || response.status === 403 || response.status === 401 || response.ok) {
        saveReference(storeId, null);
      } else {
        setPollingInterrupted(true);
      }
    }).catch(() => {
      if (!controller.signal.aborted && generation.current === requestGeneration) setPollingInterrupted(true);
    }).finally(() => {
      if (!controller.signal.aborted && generation.current === requestGeneration) setRestoring(false);
    });
    return () => controller.abort();
  }, [storeId]);

  const trackJob = useCallback((next: BulkEditJob, nextSkipped?: BulkEditSkipped[]) => {
    if (!storeId || next.storeId !== storeId || next.type !== "BULK_EDIT_REVISE") return false;
    generation.current += 1;
    setRestoring(false);
    liveJobs.current.add(`${storeId}:${next.id}`);
    lastSuccessfulPoll.current = Date.now();
    setPollingInterrupted(false);
    setTracked(current => ({ job: next, skipped: nextSkipped ?? (current?.job.id === next.id ? current.skipped : []) }));
    saveReference(storeId, next.id, nextSkipped);
    setPreview(isActiveBulkEditJob(next) ? { storeId, jobId: next.id, expiresAt: Date.now() + 5_000 } : null);
    return true;
  }, [storeId]);

  const hidePreview = useCallback(() => setPreview(null), []);
  useEffect(() => {
    window.addEventListener("pagehide", hidePreview);
    return () => window.removeEventListener("pagehide", hidePreview);
  }, [hidePreview]);
  useEffect(() => {
    if (!preview) return;
    const timer = window.setTimeout(hidePreview, Math.max(0, preview.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [hidePreview, preview]);
  const previewVisible = Boolean(preview && preview.storeId === storeId && preview.jobId === job?.id && isActiveBulkEditJob(job));

  const jobId = job?.id;
  const active = isActiveBulkEditJob(job);
  useEffect(() => {
    if (!storeId || !jobId || !active) return;
    const controller = new AbortController();
    const requestGeneration = generation.current;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]);
      try {
        const [response, workerResponse] = await Promise.all([
          fetch(`/api/products/bulk-edit/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store", signal }),
          fetch("/api/worker/status", { cache: "no-store", signal }).catch(() => null),
        ]);
        const data = await response.json().catch(() => ({})) as { job?: BulkEditJob };
        if (controller.signal.aborted || generation.current !== requestGeneration) return;
        if (!response.ok || !data.job || data.job.storeId !== storeId || data.job.id !== jobId) throw new Error("Progress unavailable");
        lastSuccessfulPoll.current = Date.now();
        setPollingInterrupted(false);
        setTracked(current => current?.job.id === jobId ? { ...current, job: data.job! } : current);
        if (workerResponse?.ok) {
          const data = await workerResponse.json().catch(() => ({})) as { workers?: Array<{ online?: boolean; capabilities?: string[] }> };
          if (!controller.signal.aborted && generation.current === requestGeneration) {
            setWorkerOnline(data.workers?.some(worker => worker.online && worker.capabilities?.includes("durable-bulk-edit-v1")) === true);
          }
        }
      } catch {
        if (!controller.signal.aborted && generation.current === requestGeneration && Date.now() - lastSuccessfulPoll.current >= 15_000) setPollingInterrupted(true);
      } finally { polling = false; }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 2000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [active, jobId, storeId]);

  useEffect(() => {
    if (!job || !isTerminalBulkEditJob(job) || !liveJobs.current.has(`${job.storeId}:${job.id}`)) return;
    const key = completionKey(job);
    if (notified.current.has(key)) return;
    notified.current.add(key);
    setPreview(null);
    onCompleted(job);
  }, [job, onCompleted]);

  const dismiss = useCallback(() => {
    if (!storeId || !job || !isTerminalBulkEditJob(job)) return;
    generation.current += 1;
    setTracked(null);
    saveReference(storeId, null);
  }, [job, storeId]);

  return { job, skipped, workerOnline, pollingInterrupted, restoring, trackJob, dismiss, previewVisible, hidePreview };
}

export type BulkEditJobController = ReturnType<typeof useBulkEditJob>;
