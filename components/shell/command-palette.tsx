"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { SearchHit, SearchResults } from "@/lib/dal/search";

type GroupKey = "accounts" | "oems" | "invoices";
const GROUPS: { key: GroupKey; title: string }[] = [
  { key: "accounts", title: "Universities & accounts" },
  { key: "oems", title: "OEMs" },
  { key: "invoices", title: "Bills" },
];

function SearchIcon({ className = "" }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Flattened, in-render-order list of hits — the target of arrow/enter nav.
  const flat = useMemo<SearchHit[]>(
    () => (results ? GROUPS.flatMap((g) => results[g.key]) : []),
    [results],
  );

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setResults(null);
    setActive(0);
  }, []);

  const go = useCallback(
    (hit: SearchHit | undefined) => {
      if (!hit) return;
      close();
      router.push(hit.href);
    },
    [close, router],
  );

  // Global ⌘K / Ctrl+K to open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus the input whenever the palette opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Debounced search. Aborts the in-flight request when the query changes or the
  // palette closes, so a slow response can't overwrite a newer one. Empty-query
  // clearing lives in the input handler, not here, so the effect never sets state
  // synchronously. Prior results stay visible until the next ones arrive.
  useEffect(() => {
    const term = q.trim();
    if (!open || !term) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
        .then((res) => {
          if (!res.ok) throw new Error(String(res.status));
          return res.json() as Promise<SearchResults>;
        })
        .then((data) => {
          setResults(data);
          setActive(0);
          setLoading(false);
        })
        .catch((err: Error) => {
          if (err.name === "AbortError") return;
          setResults({ accounts: [], oems: [], invoices: [], truncated: { accounts: false, oems: false, invoices: false } });
          setLoading(false);
        });
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, open]);

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(flat.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(flat[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  const hasResults = flat.length > 0;
  const showEmpty = !loading && results !== null && !hasResults && q.trim() !== "";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        className="flex w-full max-w-xl items-center gap-2 rounded-lg border border-border bg-surface-sunken px-3 py-2 text-sm text-text-muted transition-colors hover:border-border-strong hover:text-text-secondary"
      >
        <SearchIcon className="shrink-0" />
        <span className="flex-1 truncate text-left">Search universities, invoices, OEMs…</span>
        <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 text-[10px]">⌘K</kbd>
      </button>

      {/* Portalled to <body>: the topbar's `backdrop-blur` establishes a
          containing block, which would otherwise trap this fixed overlay inside
          the 64px header instead of covering the viewport. */}
      {open &&
        createPortal(
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[14vh] backdrop-blur-sm"
          onMouseDown={close}
          role="dialog"
          aria-modal="true"
          aria-label="Search"
        >
          <div
            className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-border-subtle px-4">
              <SearchIcon className="shrink-0 text-text-muted" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => {
                  const v = e.target.value;
                  setQ(v);
                  if (!v.trim()) {
                    setResults(null);
                    setLoading(false);
                  }
                }}
                onKeyDown={onInputKey}
                placeholder="Search universities, invoices, OEMs…"
                aria-label="Search query"
                autoComplete="off"
                spellCheck={false}
                className="flex-1 bg-transparent py-3.5 text-sm text-text-primary outline-none placeholder:text-text-muted"
              />
              <kbd className="rounded border border-border bg-surface-sunken px-1.5 py-0.5 text-[10px] text-text-muted">Esc</kbd>
            </div>

            <div className="max-h-[60vh] overflow-y-auto py-2">
              {loading && !hasResults && (
                <p className="px-4 py-6 text-center text-sm text-text-muted">Searching…</p>
              )}
              {showEmpty && (
                <p className="px-4 py-6 text-center text-sm text-text-muted">
                  No matches for “{q.trim()}”.
                </p>
              )}
              {!q.trim() && (
                <p className="px-4 py-6 text-center text-sm text-text-muted">
                  Search universities, OEMs, and bills.
                </p>
              )}

              {hasResults &&
                (() => {
                  let idx = -1;
                  return GROUPS.map((g) => {
                    const hits = results![g.key];
                    if (hits.length === 0) return null;
                    return (
                      <div key={g.key} className="mb-1">
                        <div className="px-4 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                          {g.title}
                        </div>
                        {hits.map((hit) => {
                          idx += 1;
                          const i = idx;
                          const isActive = i === active;
                          return (
                            <button
                              key={`${g.key}-${hit.id}`}
                              type="button"
                              onMouseEnter={() => setActive(i)}
                              onClick={() => go(hit)}
                              className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${
                                isActive ? "bg-[var(--surface-hover)]" : ""
                              }`}
                            >
                              <span className="flex-1 truncate text-text-primary">{hit.label}</span>
                              {hit.sublabel && (
                                <span className="shrink-0 truncate text-xs text-text-muted">{hit.sublabel}</span>
                              )}
                            </button>
                          );
                        })}
                        {results!.truncated[g.key] && (
                          <div className="px-4 py-1.5 text-[11px] text-text-muted">
                            More matches — keep typing to narrow.
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
