/** Only used to group responses; write endpoints resolve ownership from the stored line. */
export function orderGroupKey(identity: { storeId: string; accountKey: string; ebayOrderId: string }) {
  return JSON.stringify([identity.storeId, identity.accountKey, identity.ebayOrderId]);
}

export function parseOrderNoteEdit(body: unknown): { internalNote: string | null } {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid order note update");
  const input = body as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || !Object.hasOwn(input, "internalNote")) {
    throw new Error("Only the internal order note can be edited");
  }
  if (input.internalNote !== null && typeof input.internalNote !== "string") {
    throw new Error("Internal note must be a string or null");
  }
  return { internalNote: typeof input.internalNote === "string" ? input.internalNote.trim() || null : null };
}
