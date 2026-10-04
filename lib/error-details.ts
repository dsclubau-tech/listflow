export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringProperty(value: unknown, key: string): string | undefined {
  if (!isObjectRecord(value)) return undefined;
  try {
    const property = value[key];
    return typeof property === "string" ? property : undefined;
  } catch {
    // Error-like objects can have accessors that throw while being inspected.
    return undefined;
  }
}

export function getErrorDetails(error: unknown): { message: string; code?: string } {
  const message = typeof error === "string" ? error : readStringProperty(error, "message");
  return {
    message: message?.trim() ? message : "Unknown error",
    code: readStringProperty(error, "code"),
  };
}
