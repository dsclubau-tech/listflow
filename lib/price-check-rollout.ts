import { parse } from "dotenv";
import {
  PRICE_CHECK_OPTIMIZATION_NAMES,
  resolvePriceCheckOptimizationConfig,
} from "./price-check-optimizations";

export const POSTCODE_REUSE_COMMANDS = ["baseline", "enable", "disable", "all", "off"] as const;
export type PostcodeReuseCommand = (typeof POSTCODE_REUSE_COMMANDS)[number];

export function configurePostcodeReuseEnvironment(
  text: string,
  storeId: string | undefined,
  mode: PostcodeReuseCommand,
) {
  if (!(POSTCODE_REUSE_COMMANDS as readonly string[]).includes(mode)) throw new Error("Unknown postcode reuse command.");
  if ((mode === "enable" || mode === "disable") && !storeId) throw new Error("Use one database store ID.");
  if (storeId !== undefined && !/^[a-zA-Z0-9_-]+$/.test(storeId)) throw new Error("Use one database store ID.");
  const environment = parse(text);
  const list = (value: string | undefined) => [...new Set((value ?? "").split(",").map(v => v.trim()).filter(Boolean))];
  const features = list(environment.LISTFLOW_PRICE_CHECK_OPTIMIZATIONS);
  if (features.some(name => !(PRICE_CHECK_OPTIMIZATION_NAMES as readonly string[]).includes(name))) {
    throw new Error("Unknown existing optimization; configuration was not changed.");
  }
  const currentMode = resolvePriceCheckOptimizationConfig(storeId, environment).deliveryStateMode;
  if (currentMode === null && mode !== "all" && mode !== "off") {
    throw new Error("Invalid existing postcode reuse mode; configuration was not changed.");
  }
  const stores = list(environment.LISTFLOW_PRICE_CHECK_OPTIMIZATION_STORE_IDS);
  const reuseStores = environment.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_STORE_IDS === undefined
    ? (features.includes("delivery-state") ? [...stores] : [])
    : list(environment.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_STORE_IDS);
  const excluded = list(environment.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_DISABLED_STORE_IDS);
  const updates: Record<string, string> = { LISTFLOW_PRICE_CHECK_TIMING_ENABLED: "true" };
  if (mode === "all") {
    if (!features.includes("delivery-state")) features.push("delivery-state");
    updates.LISTFLOW_PRICE_CHECK_OPTIMIZATIONS = features.join(",");
    updates.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE = "all";
  } else if (mode === "off") {
    updates.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE = "off";
  } else if (mode === "enable") {
    if (!features.includes("delivery-state")) features.push("delivery-state");
    updates.LISTFLOW_PRICE_CHECK_OPTIMIZATIONS = features.join(",");
    updates.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_DISABLED_STORE_IDS = excluded.filter(id => id !== storeId).join(",");
    if (currentMode !== "all") {
      if (!stores.includes(storeId!)) stores.push(storeId!);
      if (!reuseStores.includes(storeId!)) reuseStores.push(storeId!);
      updates.LISTFLOW_PRICE_CHECK_OPTIMIZATION_STORE_IDS = stores.join(",");
      updates.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_STORE_IDS = reuseStores.join(",");
      if (currentMode === "off") updates.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_MODE = "allowlist";
    }
  } else if (mode === "disable") {
    if (!excluded.includes(storeId!)) excluded.push(storeId!);
    updates.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_DISABLED_STORE_IDS = excluded.join(",");
    if (currentMode !== "all") {
      const remaining = reuseStores.filter(id => id !== storeId);
      updates.LISTFLOW_PRICE_CHECK_DELIVERY_STATE_STORE_IDS = remaining.join(",");
      if (remaining.length === 0) updates.LISTFLOW_PRICE_CHECK_OPTIMIZATIONS = features.filter(name => name !== "delivery-state").join(",");
    }
  }
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  let next = text;
  for (const [name, value] of Object.entries(updates)) {
    const line = `${name}="${value}"`;
    const pattern = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${name}[ \\t]*=[^\\r\\n]*`, "gm");
    if (pattern.test(next)) next = next.replace(pattern, () => line);
    else next += `${next && !next.endsWith("\n") ? newline : ""}${line}${newline}`;
  }
  const effective = resolvePriceCheckOptimizationConfig(storeId ?? "configuration-validation", parse(next));
  if (effective.deliveryStateMode === null || effective.unknown.length > 0) {
    throw new Error("The resulting postcode reuse configuration is invalid.");
  }
  return { text: next, updates };
}
