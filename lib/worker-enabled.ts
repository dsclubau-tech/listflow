const FALSE_VALUES = new Set(["0", "false", "no", "off"]);

export function isWorkerEnabled(value = process.env.LISTFLOW_WORKER_ENABLED) {
  return !FALSE_VALUES.has(value?.trim().toLowerCase() ?? "");
}
