"use client";

import { useId, useRef, useState, type CSSProperties } from "react";
import type { OrderRow } from "@/types/order";

export default function OrderRowActions({ row, onNote }: { row: OrderRow; onNote: () => void }) {
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  function positionMenu() {
    const rect = trigger.current!.getBoundingClientRect();
    const height = row.matchedProductId ? 60 : 96;
    setPosition({
      left: Math.max(8, Math.min(rect.right - 224, window.innerWidth - 232)),
      top: rect.bottom + height + 8 <= window.innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - height - 4),
    });
  }
  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={onNote}
        aria-label={(row.internalNote ? "Edit" : "Add") + " order note for " + row.title}
        title={row.internalNote ? "Edit order note: " + row.internalNote : "Add order note"}
        className={"flex h-8 w-8 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 " +
          (row.internalNote ? "bg-amber-100 text-amber-700 hover:bg-amber-200" : "text-gray-400 hover:bg-gray-100 hover:text-gray-700")}>
        <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M5 3h14v12l-6 6H5zM13 21v-6h6M8 7h8M8 11h6" />
        </svg>
      </button>
      <button ref={trigger} type="button" popoverTarget={menuId} aria-haspopup="menu" aria-expanded={open}
        aria-label={"More options for " + row.title} title="More options" onClick={positionMenu}
        onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault(); positionMenu(); menu.current?.showPopover();
            menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
          }
        }}
        className="flex h-8 w-7 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400">
        <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" />
        </svg>
      </button>
      <div ref={menu} id={menuId} popover="auto" role="menu" aria-label={"Order options for " + row.title}
        style={position} onToggle={event => setOpen(event.newState === "open")}
        onKeyDown={event => {
          if (event.key === "Escape") {
            event.preventDefault(); menu.current?.hidePopover(); trigger.current?.focus();
          } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault(); menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
          }
        }}
        className="fixed m-0 w-56 max-w-[calc(100vw-1rem)] rounded-lg border border-gray-200 bg-white p-1.5 text-sm text-gray-700 shadow-xl">
        {row.matchedProductId ? (
          <a role="menuitem" href={"/products?productId=" + encodeURIComponent(row.matchedProductId)} target="_blank" rel="noopener noreferrer"
            onClick={() => menu.current?.hidePopover()}
            className="flex items-center gap-2 rounded-md px-3 py-2 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none">
            <ProductIcon />Edit Product
          </a>
        ) : (
          <>
            <button type="button" role="menuitem" aria-disabled="true"
              className="flex w-full cursor-not-allowed items-center gap-2 rounded-md px-3 py-2 text-gray-400">
              <ProductIcon />Edit Product
            </button>
            <p className="px-3 pb-2 text-xs text-gray-500">No matching Listflow product.</p>
          </>
        )}
      </div>
    </div>
  );
}

function ProductIcon() {
  return <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
    <path d="m12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9M7.5 5.5l9 5" />
  </svg>;
}
