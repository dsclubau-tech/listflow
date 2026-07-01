"use client";

import { useEffect, useState } from "react";

interface TimedActionProgressOptions {
  initialPercent?: number;
  maxWaitingPercent?: number;
  stepPercent?: number;
  intervalMs?: number;
}

export function useTimedActionProgress(
  active: boolean,
  {
    initialPercent = 8,
    maxWaitingPercent = 92,
    stepPercent = 7,
    intervalMs = 800,
  }: TimedActionProgressOptions = {},
) {
  const [state, setState] = useState({ active: false, percent: 0 });

  useEffect(() => {
    const resetTimeout = window.setTimeout(() => {
      setState({ active, percent: active ? initialPercent : 0 });
    }, 0);

    if (!active) {
      return () => window.clearTimeout(resetTimeout);
    }

    const intervalId = window.setInterval(() => {
      setState((current) => {
        if (!current.active) {
          return current;
        }

        const currentPercent = current.percent;

        if (currentPercent >= maxWaitingPercent) {
          return current;
        }

        const nextStep = Math.max(
          1,
          Math.round(stepPercent * (1 - currentPercent / 120)),
        );

        return {
          active: true,
          percent: Math.min(maxWaitingPercent, currentPercent + nextStep),
        };
      });
    }, intervalMs);

    return () => {
      window.clearTimeout(resetTimeout);
      window.clearInterval(intervalId);
    };
  }, [active, initialPercent, intervalMs, maxWaitingPercent, stepPercent]);

  if (!active) {
    return 0;
  }

  return state.active ? state.percent : initialPercent;
}
