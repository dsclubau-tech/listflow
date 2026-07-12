export function reuseOrCreateClient<T>(existing: T | undefined, create: () => T) {
  return existing ?? create();
}
