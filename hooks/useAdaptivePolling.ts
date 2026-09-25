"use client";

import { useCallback, useEffect, useRef } from "react";

const ACTIVE_INTERVAL_MS = 2_000;
const IDLE_INTERVAL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 15_000;

type Options = {
  resourceKey: string;
  active: boolean;
  poll: (signal: AbortSignal) => Promise<void>;
  immediateOnMount?: boolean;
};

/** One cancellable request per resource, with a fresh check on return to the tab. */
export function useAdaptivePolling({
  resourceKey,
  active,
  poll,
  immediateOnMount = false,
}: Options): () => void {
  const pollRef = useRef(poll);
  pollRef.current = poll;
  const triggerRef = useRef<() => void>(() => {});

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let rerun = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    const interval = active ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS;

    function clearTimer() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    }

    function schedule(delay: number) {
      clearTimer();
      if (!disposed && document.visibilityState === "visible") {
        timer = setTimeout(run, delay);
      }
    }

    async function run() {
      if (disposed || document.visibilityState === "hidden" || !navigator.onLine) return;
      if (inFlight) {
        rerun = true;
        return;
      }
      clearTimer();
      inFlight = true;
      controller = new AbortController();
      const requestController = controller;
      const timeout = setTimeout(() => requestController.abort(), REQUEST_TIMEOUT_MS);
      try {
        await pollRef.current(requestController.signal);
      } catch {
        // Keep the last successful value and retry on the next interval.
      } finally {
        clearTimeout(timeout);
        inFlight = false;
        controller = null;
        if (rerun) {
          rerun = false;
          schedule(0);
        } else {
          schedule(interval);
        }
      }
    }

    function requestNow() {
      if (disposed || document.visibilityState === "hidden" || !navigator.onLine) return;
      if (inFlight) rerun = true;
      else schedule(0);
    }

    function onVisibilityChange() {
      if (document.visibilityState === "hidden") {
        clearTimer();
        controller?.abort();
      } else {
        requestNow();
      }
    }

    triggerRef.current = requestNow;
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", requestNow);
    if (immediateOnMount) requestNow();
    else schedule(interval);

    return () => {
      disposed = true;
      clearTimer();
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", requestNow);
      if (triggerRef.current === requestNow) triggerRef.current = () => {};
    };
  }, [resourceKey, active, immediateOnMount]);

  return useCallback(() => triggerRef.current(), []);
}
