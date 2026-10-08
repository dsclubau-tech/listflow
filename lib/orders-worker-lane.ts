export type OrdersWorkerStore = { id: string; ownerUserId: string | null };
export type OrdersLaneDependencies = {
  getStores: () => Promise<OrdersWorkerStore[]>;
  isEligible: (store: OrdersWorkerStore) => Promise<boolean>;
  sync: (storeId: string) => Promise<unknown>;
  paused: () => boolean;
  reportError: (error: unknown, storeId?: string) => void;
};

/** A separate single-flight lane whose drain is awaited before pool reset/shutdown. */
export function createOrdersWorkerLane(deps: OrdersLaneDependencies) {
  let pending: Promise<void> | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  function tick(): Promise<void> {
    if (stopped || deps.paused()) return pending ?? Promise.resolve();
    if (!pending) {
      pending = (async () => {
        const stores = await deps.getStores();
        await Promise.all(stores.map(async store => {
          try {
            if (await deps.isEligible(store)) await deps.sync(store.id);
          } catch (error) { deps.reportError(error, store.id); }
        }));
      })().catch(error => deps.reportError(error)).finally(() => { pending = null; });
    }
    return pending;
  }
  return {
    tick,
    start() {
      if (timer || stopped) return;
      timer = setInterval(() => { void tick(); }, 30_000);
      timer.unref?.();
      void tick();
    },
    async drain() { await pending; },
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
      await pending;
    },
  };
}

export async function isOrdersStoreEntitled(
  store: OrdersWorkerStore,
  deps: {
    getEntitlement: (ownerUserId: string) => Promise<{ status: string; allowedStores: number }>;
    getRankedStores: (ownerUserId: string) => Promise<Array<{ id: string }>>;
  },
) {
  if (!store.ownerUserId) return true;
  const entitlement = await deps.getEntitlement(store.ownerUserId);
  if (entitlement.status !== "ACTIVE" || entitlement.allowedStores <= 0) return false;
  const stores = await deps.getRankedStores(store.ownerUserId);
  const rank = stores.findIndex(candidate => candidate.id === store.id) + 1;
  return rank > 0 && rank <= entitlement.allowedStores;
}
