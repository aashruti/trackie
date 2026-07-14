"use client";

import { useEffect, useRef, useState } from "react";

interface Option {
  id: string | number;
  name: string;
}

interface ComboboxProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  className?: string;
}

/**
 * Searchable combobox for long option lists (accounts, assignees).
 * Renders a button trigger + floating dropdown with an inline search input.
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Select…",
  emptyLabel,
  className = "",
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  const selected = value
    ? options.find((o) => String(o.id) === value)
    : null;

  const filtered =
    query.trim() === ""
      ? options
      : options.filter((o) =>
          o.name.toLowerCase().includes(query.toLowerCase()),
        );

  // If there's an emptyLabel (e.g. "Internal", "Unassigned"), prepend it.
  const allItems: { id: string; name: string }[] = emptyLabel
    ? [{ id: "", name: emptyLabel }, ...filtered.map((o) => ({ id: String(o.id), name: o.name }))]
    : filtered.map((o) => ({ id: String(o.id), name: o.name }));

  function openDropdown() {
    setOpen(true);
    setQuery("");
    setActiveIdx(0);
    requestAnimationFrame(() => searchRef.current?.focus());
  }

  function close() {
    setOpen(false);
    setQuery("");
  }

  function select(id: string) {
    onChange(id);
    close();
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) close();
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  function onKeyDown(e: React.KeyboardEvent) {
    // stopPropagation: Escape must only close the dropdown, not bubble up to a
    // host dialog's document-level Escape listener (which would discard the form).
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, allItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (allItems[activeIdx]) select(allItems[activeIdx].id);
    }
  }

  // Reset active index when filtered list changes
  useEffect(() => { setActiveIdx(0); }, [query]);

  // Scroll active item into view
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open]);

  const triggerCls = [
    "mt-1 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm outline-none",
    "focus:ring-2 focus:ring-[var(--ring)] flex items-center justify-between gap-2 text-left",
    value ? "text-text-primary" : "text-text-muted",
    className,
  ].join(" ");

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={openDropdown}
        className={triggerCls}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">
          {selected?.name ?? emptyLabel ?? placeholder}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-text-muted"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
          {/* Search input */}
          <div className="border-b border-border px-2 py-1.5">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search…"
              className="w-full rounded-md bg-surface-sunken px-2 py-1.5 text-sm text-text-primary outline-none placeholder:text-text-muted"
            />
          </div>

          {/* Options list */}
          <ul
            ref={listRef}
            role="listbox"
            className="max-h-52 overflow-y-auto py-1"
          >
            {allItems.length === 0 ? (
              <li className="px-3 py-2 text-sm text-text-muted">No results</li>
            ) : (
              allItems.map((item, idx) => (
                <li
                  key={item.id || "__empty__"}
                  role="option"
                  aria-selected={value === item.id}
                  onMouseDown={(e) => { e.preventDefault(); select(item.id); }}
                  onMouseEnter={() => setActiveIdx(idx)}
                  className={[
                    "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm",
                    idx === activeIdx ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]" : "text-text-primary hover:bg-surface-hover",
                  ].join(" ")}
                >
                  <span className="w-4 shrink-0 text-center text-xs">
                    {value === item.id ? "✓" : ""}
                  </span>
                  {item.name}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
