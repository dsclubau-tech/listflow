/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useRef, useState } from "react";
import OrderNoteDialog from "@/components/OrderNoteDialog";
import OrderRowActions from "@/components/OrderRowActions";
import AsinLink from "@/components/AsinLink";
import { useAdaptivePolling } from "@/hooks/useAdaptivePolling";
import { ORDER_STATUSES, ORDER_STATUS_LABELS, type OrdersPageData, type OrderStatus, type OrderRow, type OrderNoteSaveResult } from "@/types/order";

const STATUS_STYLES: Record<OrderStatus, string> = {
  PENDING: "border-amber-200 bg-amber-100 text-amber-800",
  ORDERED: "border-blue-200 bg-blue-100 text-blue-800",
  SHIPPED: "border-indigo-200 bg-indigo-100 text-indigo-800",
  DELIVERED: "border-green-200 bg-green-100 text-green-800",
  CANCELED: "border-red-200 bg-red-100 text-red-800",
};

function money(value: number | null, currency: string) {
  if (value === null) return "N/A";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(value);
}

export default function OrdersPageClient({ initialData }: { initialData: OrdersPageData }) {
  const [data, setData] = useState(initialData);
  const [notingOrder, setNotingOrder] = useState<OrderRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<Record<string, { text: string; error: boolean }>>({});
  const edits = useRef(0);
  const pendingIds = useRef(new Set<string>());
  const requestId = useRef(0);

  const readPage = useCallback(async (page: number, pageSize: number, signal?: AbortSignal) => {
    const version = edits.current;
    const serial = ++requestId.current;
    const response = await fetch("/api/orders?page=" + page + "&pageSize=" + pageSize, { cache: "no-store", signal });
    if (!response.ok) throw new Error("Orders could not be refreshed. Your saved orders are still shown.");
    const next = await response.json() as OrdersPageData;
    if (serial !== requestId.current || signal?.aborted || version !== edits.current ||
        pendingIds.current.size > 0 || next.storeId !== initialData.storeId) return false;
    setData(next);
    setLoadError(null);
    return true;
  }, [initialData.storeId]);

  const poll = useCallback(async (signal: AbortSignal) => {
    if (pendingIds.current.size > 0 || loading) return;
    try { await readPage(data.page, data.pageSize, signal); }
    catch (error) { if (!signal.aborted) setLoadError(error instanceof Error ? error.message : "Orders could not be refreshed."); }
  }, [data.page, data.pageSize, loading, readPage]);
  const requestRefresh = useAdaptivePolling({
    resourceKey: "orders:" + initialData.storeId + ":" + data.page + ":" + data.pageSize,
    active: false, poll,
  });

  async function changePage(page: number, pageSize = data.pageSize) {
    setLoading(true);
    try {
      if (await readPage(page, pageSize)) {
        const url = new URL(window.location.href);
        url.searchParams.set("page", String(page));
        url.searchParams.set("pageSize", String(pageSize));
        window.history.replaceState(null, "", url);
      }
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Orders could not be loaded.");
    } finally { setLoading(false); }
  }

  async function save(id: string, edit: { status?: OrderStatus; estimatedArrival?: string | null }) {
    if (pendingIds.current.has(id)) return;
    edits.current++;
    pendingIds.current.add(id);
    setPending(current => ({ ...current, [id]: true }));
    setFeedback(current => ({ ...current, [id]: { text: "Saving...", error: false } }));
    try {
      const response = await fetch("/api/orders/" + encodeURIComponent(id), {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(edit),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not save the order.");
      setData(current => ({ ...current, rows: current.rows.map(row => row.id === id ? { ...row, ...edit } : row) }));
      setFeedback(current => ({ ...current, [id]: { text: "Saved", error: false } }));
    } catch (error) {
      setFeedback(current => ({ ...current, [id]: { text: error instanceof Error ? error.message : "Could not save the order.", error: true } }));
    } finally {
      edits.current++;
      pendingIds.current.delete(id);
      setPending(current => ({ ...current, [id]: false }));
      requestRefresh();
    }
  }

  async function saveNote(row: OrderRow, internalNote: string): Promise<OrderNoteSaveResult> {
    const key = "note:" + row.orderGroupKey;
    if (pendingIds.current.has(key)) throw new Error("This order note is already saving.");
    edits.current++;
    pendingIds.current.add(key);
    try {
      const response = await fetch("/api/orders/" + encodeURIComponent(row.id) + "/note", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ internalNote }),
      });
      const body = await response.json() as OrderNoteSaveResult & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not save the order note.");
      if (body.orderGroupKey !== row.orderGroupKey) throw new Error("The active store changed. Reload Orders before saving.");
      setData(current => ({ ...current, rows: current.rows.map(line => line.orderGroupKey === body.orderGroupKey
        ? { ...line, internalNote: body.internalNote } : line) }));
      return body;
    } finally {
      edits.current++;
      pendingIds.current.delete(key);
      requestRefresh();
    }
  }

  const pages = Math.max(1, Math.ceil(data.totalCount / data.pageSize));
  const disabled = loading || Object.values(pending).some(Boolean);
  return (
    <section className="w-full space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Orders <span className="font-medium text-gray-500">({data.totalCount})</span></h1>
          <p className="mt-1 text-sm text-gray-500">New eBay orders sync automatically every 5 minutes.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          Rows
          <select aria-label="Rows per page" value={data.pageSize} disabled={disabled}
            onChange={event => void changePage(1, Number(event.target.value))}
            className="rounded-md border border-gray-300 bg-white px-2.5 py-2 text-sm text-gray-900 focus:ring-2 focus:ring-orange-500/20">
            {[10, 20, 50, 100, 200].map(size => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
      </div>
      {data.sync.error && <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{data.sync.error}</p>}
      {loadError && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{loadError}</p>}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm" aria-busy={loading}>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[1050px] text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              {["Image", "Title", "Price", "Profit", "Item ID and link", "Order status", "Estimated arrival"].map(label =>
                <th key={label} scope="col" className="px-4 py-4">{label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {data.rows.map(row => (
              <tr key={row.id} className="align-middle hover:bg-gray-50/60">
                <td className="w-24 px-4 py-4">
                  <OrderImage source={row.image} title={row.title} />
                </td>
                <td className="max-w-[280px] px-4 py-4">
                  <div className="line-clamp-2 font-medium text-gray-800" title={row.title}>{row.title}</div>
                  <p className="mt-1 text-xs text-gray-500">Quantity: {row.quantity}</p>
                  {!row.matched && <p className="mt-1 text-xs text-amber-700">No matching Listflow product</p>}
                </td>
                <td className="whitespace-nowrap px-4 py-4 tabular-nums">
                  <div><span className="mr-2 inline-block w-8 text-[10px] font-semibold text-gray-500">BUY</span>{money(row.buyTotal, row.buyCurrency)}</div>
                  <div className="mt-1"><span className="mr-2 inline-block w-8 text-[10px] font-semibold text-gray-500">SELL</span>{money(row.sellTotal, row.currency)}</div>
                </td>
                <td className="whitespace-nowrap px-4 py-4 font-medium tabular-nums">
                  <span title={row.profit === null && row.currency !== row.buyCurrency ? "Buy and sell currencies differ" : undefined}
                    className={row.profit === null ? "text-gray-400" : row.profit < 0 ? "text-red-600" : "text-green-600"}>
                    {money(row.profit, row.currency)}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-4 text-xs">
                  <div><span className="mr-2 inline-block w-8 text-[10px] font-semibold text-gray-500">BUY</span><AsinLink asin={row.buyItemId} fallback="N/A" /></div>
                  <div className="mt-1.5"><span className="mr-2 inline-block w-8 text-[10px] font-semibold text-gray-500">SELL</span>
                    {row.ebayItemId ? <a href={"https://www.ebay.com.au/itm/" + encodeURIComponent(row.ebayItemId)} target="_blank" rel="noopener noreferrer"
                      className="font-mono text-blue-600 hover:underline">{row.ebayItemId}</a> : "N/A"}
                  </div>
                </td>
                <td className="px-4 py-4">
                  <select aria-label={"Order status for " + row.title} value={row.status} disabled={pending[row.id]}
                    onChange={event => void save(row.id, { status: event.target.value as OrderStatus })}
                    className={"w-36 rounded-md border px-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:opacity-60 " + STATUS_STYLES[row.status]}>
                    {ORDER_STATUSES.map(status => <option key={status} value={status}>{ORDER_STATUS_LABELS[status]}</option>)}
                  </select>
                  {feedback[row.id] && <p role={feedback[row.id].error ? "alert" : "status"}
                    className={"mt-1 max-w-44 text-xs " + (feedback[row.id].error ? "text-red-600" : "text-gray-500")}>{feedback[row.id].text}</p>}
                </td>
                <td className="px-4 py-4">
                  <div className="flex items-center gap-2">
                  <input type="date" aria-label={"Estimated arrival for " + row.title} value={row.estimatedArrival ?? ""} disabled={pending[row.id]}
                    onChange={event => void save(row.id, { estimatedArrival: event.target.value || null })}
                    className="w-36 rounded-md border border-gray-300 bg-white px-2 py-2 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:opacity-60" />
                  <OrderRowActions row={row} onNote={() => setNotingOrder(row)} />
                  </div>
                </td>
              </tr>
            ))}

          </tbody>
        </table>
        </div>
        {data.rows.length === 0 && <div className="px-5 py-16 text-center">
          <p className="font-medium text-gray-800">No orders yet</p>
          <p className="mt-2 text-sm text-gray-500">{data.sync.activatedAt
            ? "New eBay orders will appear here automatically."
            : "Automatic syncing starts when your eBay connection and background worker are ready."}</p>
        </div>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-500">
        <p>{data.totalCount === 0 ? "0 orders" : "Showing " + ((data.page - 1) * data.pageSize + 1) + "-" + Math.min(data.totalCount, data.page * data.pageSize) + " of " + data.totalCount}</p>
        <div className="flex items-center gap-3">
          <button type="button" disabled={disabled || data.page <= 1} onClick={() => void changePage(data.page - 1)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-700 disabled:opacity-40">Previous</button>
          <span>Page {data.page} of {pages}</span>
          <button type="button" disabled={disabled || data.page >= pages} onClick={() => void changePage(data.page + 1)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-700 disabled:opacity-40">Next</button>
        </div>
      </div>
      {notingOrder && <OrderNoteDialog row={notingOrder} onSave={note => saveNote(notingOrder, note)} onClose={() => setNotingOrder(null)} />}
    </section>
  );
}

function OrderImage({ source, title }: { source: string | null; title: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (source && source !== failed) return <img src={source} alt={title} loading="lazy" className="h-14 w-14 rounded-lg object-contain" onError={() => setFailed(source)} />;
  return <div aria-label="No product image" className="flex h-14 w-14 items-center justify-center rounded-lg bg-gray-100 text-gray-400">
    <svg aria-hidden="true" className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth="1.5" d="M4 4h16v16H4zM4 16l5-5 4 4 3-3 4 4M8 8h.01" /></svg>
  </div>;
}
