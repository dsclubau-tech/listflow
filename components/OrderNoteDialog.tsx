"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { OrderRow, OrderNoteSaveResult } from "@/types/order";

export default function OrderNoteDialog({ row, onSave, onClose }: {
  row: OrderRow;
  onSave: (internalNote: string) => Promise<OrderNoteSaveResult>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const savingRef = useRef(false);
  const [draft, setDraft] = useState(row.internalNote ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    field.current?.focus();
    return () => {
      element.close();
      opener?.focus({ preventScroll: true });
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not save the order note.");
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <dialog ref={dialog} aria-labelledby="order-note-heading" aria-describedby="order-note-description"
      onKeyDown={event => {
        if (event.key !== "Tab") return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("textarea:not([disabled]), button:not([disabled])"));
        const first = controls[0], last = controls.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }}
      onCancel={event => { event.preventDefault(); if (!savingRef.current) onClose(); }}
      className="m-auto w-[calc(100%-2rem)] max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border-0 bg-white p-6 text-gray-900 shadow-2xl backdrop:bg-black/40">
      <form onSubmit={event => void submit(event)} aria-busy={saving}>
        <h2 id="order-note-heading" className="text-lg font-semibold">Order note</h2>
        <p className="mt-1 break-words text-sm text-gray-600">eBay order: {row.ebayOrderId}</p>
        <p id="order-note-description" className="mt-2 text-sm text-gray-500">This internal note applies to every item in this eBay order.</p>
        <label htmlFor="order-note-text" className="mt-5 block text-sm font-medium text-gray-700">Internal note</label>
        <textarea ref={field} id="order-note-text" value={draft} disabled={saving}
          onChange={event => setDraft(event.target.value)} rows={6} placeholder="Add an internal note"
          className="mt-2 w-full resize-y rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:opacity-60" />
        {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={saving} onClick={onClose}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={saving}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {saving ? "Saving..." : "Save note"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
