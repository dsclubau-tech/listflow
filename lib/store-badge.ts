const STORE_BADGE_CLASSES = [
  "bg-blue-100 text-blue-800",
  "bg-violet-100 text-violet-800",
  "bg-emerald-100 text-emerald-800",
  "bg-orange-100 text-orange-800",
  "bg-cyan-100 text-cyan-800",
] as const;

function hashStoreKey(value: string) {
  let hash = 0;

  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return hash;
}

export function getStoreBadgeClass(storeId: string, storeName: string) {
  const key = storeId.trim() || storeName.trim();
  if (!key) return "bg-gray-100 text-gray-800";

  return STORE_BADGE_CLASSES[hashStoreKey(key) % STORE_BADGE_CLASSES.length];
}
