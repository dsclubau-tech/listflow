import { parse } from "dotenv";
import { PRICE_CHECK_OPTIMIZATION_NAMES } from "./price-check-optimizations";

export function configurePostcodeReuseEnvironment(
  text: string,
  storeId: string,
  mode: "baseline" | "enable" | "disable",
) {
  if (!storeId.trim() || /[\s,]/.test(storeId)) throw new Error("Use one database store ID.");
  const environment = parse(text);
  const list = (value: string | undefined) => [...new Set((value ?? "").split(",").map(v => v.trim()).filter(Boolean))];
  const features = list(environment.LISTFLOW_PRICE_CHECK_OPTIMIZATIONS);
  if (features.some(name => !(PRICE_CHECK_OPTIMIZATION_NAMES as readonly string[]).includes(name))) {
    throw new Error("Unknown existing optimization; configuration was not changed.");
  }
  const stores = list(environment.LISTFLOW_PRICE_CHECK_OPTIMIZATION_STORE_IDS);
  const reuseStores = environment.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_STORE_IDS === undefined
    ? (features.includes("delivery-state") ? [...stores] : [])
    : list(environment.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_STORE_IDS);
  const updates: Record<string, string> = { LISTFLOW_PRICE_CHECK_TIMING_ENABLED: "true" };
  if (mode === "enable") {
    if (!features.includes("delivery-state")) features.push("delivery-state");
    if (!stores.includes(storeId)) stores.push(storeId);
    if (!reuseStores.includes(storeId)) reuseStores.push(storeId);
    updates.LISTFLOW_PRICE_CHECK_OPTIMIZATIONS = features.join(",");
    updates.LISTFLOW_PRICE_CHECK_OPTIMIZATION_STORE_IDS = stores.join(",");
    updates.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_STORE_IDS = reuseStores.join(",");
  } else if (mode === "disable") {
    const remaining = reuseStores.filter(id => id !== storeId);
    updates.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_STORE_IDS = remaining.join(",");
    if (remaining.length === 0) {
      updates.LISTFLOW_PRICE_CHECK_OPTIMIZATIONS = features.filter(name => name !== "delivery-state").join(",");
    }
  }
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  let next = text;
  for (const [name, value] of Object.entries(updates)) {
    const line = `${name}="${value}"`;
    const pattern = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${name}[ \\t]*=[^\\r\\n]*`, "gm");
    if (pattern.test(next)) next = next.replace(pattern, line);
    else next += `${next && !next.endsWith("\n") ? newline : ""}${line}${newline}`;
  }
  return { text: next, updates };
}