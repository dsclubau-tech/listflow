"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { ProductSelectionSummary } from "@/types/product-selection";
import type { SerializedProductRow } from "@/types/product-row";
import { mergeSelectionProducts } from "@/lib/product-selection";
type SelectionProduct = SerializedProductRow | ProductSelectionSummary;

export function useProductSelection(storeId: string, query: string, products: SerializedProductRow[]) {
  const scope = JSON.stringify([storeId, query]);
  const [selection, setSelection] = useState({ scope, ids: [] as string[] });
  const [cachedPages, setCachedPages] = useState({ scope, products: products as SelectionProduct[] });
  const [complete, setComplete] = useState<{ scope: string; products: ProductSelectionSummary[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<{ scope: string; controller: AbortController; promise: Promise<ProductSelectionSummary[]> } | null>(null);
  const generation = useRef(0);
  const activeScope = useRef(scope);
  const selectedIds = selection.scope === scope ? selection.ids : [];
  const cancelRequest = useCallback(() => {
    generation.current++;
    request.current?.controller.abort();
    request.current = null;
  }, []);
  const setSelectedIds: Dispatch<SetStateAction<string[]>> = useCallback(update => {
    if (activeScope.current !== scope) return;
    if (Array.isArray(update) && update.length === 0) {
      cancelRequest();
      setLoading(false);
    }
    setSelection(previous => {
      if (previous.scope !== scope) return previous;
      const current = previous.ids;
      const next = typeof update === "function" ? update(current) : update;
      return { scope, ids: Array.from(new Set(next)) };
    });
  }, [scope, cancelRequest]);
  useEffect(() => {
    activeScope.current = scope;
    cancelRequest();
    setSelection({ scope, ids: [] });
    setComplete(null);
    setError(null);
    setLoading(false);
    return cancelRequest;
  }, [scope, cancelRequest]);
  useEffect(() => {
    setCachedPages(previous => ({
      scope, products: mergeSelectionProducts(previous.scope === scope ? previous.products : [], products),
    }));
  }, [scope, products]);
  const allProducts = complete?.scope === scope ? complete.products : null;
  const selectionProducts = useMemo(() => mergeSelectionProducts<SelectionProduct>(
    allProducts ?? [], cachedPages.scope === scope ? cachedPages.products : [], products,
  ), [cachedPages, scope, allProducts, products]);
  const knownIds = useMemo(() => new Set(selectionProducts.map(product => product.id)), [selectionProducts]);
  const ready = !loading && selectedIds.every(id => knownIds.has(id));
  const loadAll = useCallback((): Promise<ProductSelectionSummary[]> => {
    if (activeScope.current !== scope) return Promise.reject(new DOMException("Selection scope changed", "AbortError"));
    if (request.current?.scope === scope) return request.current.promise;
    const controller = new AbortController();
    const version = ++generation.current;
    setLoading(true);
    setError(null);
    const promise = (async () => {
      try {
        const response = await fetch("/api/products/selection" + (query ? "?" + query : ""), {
          cache: "no-store", signal: controller.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (controller.signal.aborted || generation.current !== version) throw new DOMException("Selection request canceled", "AbortError");
        if (!response.ok || !Array.isArray(body.products)) throw new Error(body.error || "Unable to load the complete selection.");
        const rows = body.products as ProductSelectionSummary[];
        if (rows.some(product => product.storeId !== storeId)) throw new Error("Selection belongs to a different store.");
        setComplete({ scope, products: rows });
        return rows;
      } catch (failure) {
        if (generation.current === version && !controller.signal.aborted) {
          setError(failure instanceof Error ? failure.message : "Unable to load the complete selection.");
        }
        throw failure;
      } finally {
        if (generation.current === version) { request.current = null; setLoading(false); }
      }
    })();
    request.current = { scope, controller, promise };
    return promise;
  }, [query, scope, storeId]);
  useEffect(() => {
    if (selectedIds.length > 0 && !allProducts && !loading && !error) void loadAll().catch(() => {});
  }, [selectedIds.length, allProducts, loading, error, loadAll]);
  return { selectedIds, setSelectedIds, selectionProducts, allProducts, loading, error, ready, loadAll };
}
