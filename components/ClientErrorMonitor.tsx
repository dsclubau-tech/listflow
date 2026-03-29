"use client";

import { useEffect, useEffectEvent } from "react";
import { reportClientError } from "@/lib/client-logger";

export default function ClientErrorMonitor() {
  const emitError = useEffectEvent(
    (context: string, message: string, error?: unknown, data?: unknown) => {
      void reportClientError(context, message, error, data, {
        tags: ["global"],
      });
    },
  );

  useEffect(() => {
    function handleWindowError(event: ErrorEvent) {
      emitError(
        "window/error",
        event.message || "Unhandled window error",
        event.error ?? event.message,
        {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
      );
    }

    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      const reason = event.reason;
      const message =
        reason instanceof Error ? reason.message : "Unhandled promise rejection";

      emitError("window/unhandledrejection", message, reason, {
        reasonType: typeof reason,
      });
    }

    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  return null;
}
