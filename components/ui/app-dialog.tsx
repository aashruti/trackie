"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

type DialogTone = "default" | "danger";

export type ConfirmDialogOptions = {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
};

export type PromptDialogOptions = {
  title: string;
  description?: string;
  label: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  multiline?: boolean;
};

export type AlertDialogOptions = {
  title: string;
  description: string;
  buttonLabel?: string;
  tone?: DialogTone;
};

type DialogRequest =
  | {
      id: number;
      kind: "confirm";
      options: ConfirmDialogOptions;
      resolve: (value: boolean) => void;
    }
  | {
      id: number;
      kind: "prompt";
      options: PromptDialogOptions;
      resolve: (value: string | null) => void;
    }
  | {
      id: number;
      kind: "alert";
      options: AlertDialogOptions;
      resolve: () => void;
    };

type AppDialogApi = {
  confirmAction: (options: ConfirmDialogOptions) => Promise<boolean>;
  promptForText: (options: PromptDialogOptions) => Promise<string | null>;
  showAlert: (options: AlertDialogOptions) => Promise<void>;
};

const AppDialogContext = createContext<AppDialogApi | null>(null);

function settleAsCancelled(request: DialogRequest) {
  if (request.kind === "confirm") request.resolve(false);
  else if (request.kind === "prompt") request.resolve(null);
  else request.resolve();
}

export function AppDialogProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<DialogRequest | null>(null);
  const activeRef = useRef<DialogRequest | null>(null);
  const queueRef = useRef<DialogRequest[]>([]);
  const nextIdRef = useRef(1);

  const enqueue = useCallback((request: DialogRequest) => {
    if (activeRef.current) {
      queueRef.current.push(request);
      return;
    }
    activeRef.current = request;
    setActive(request);
  }, []);

  const finish = useCallback((value?: boolean | string | null) => {
    const request = activeRef.current;
    if (!request) return;

    if (request.kind === "confirm") request.resolve(value === true);
    else if (request.kind === "prompt") request.resolve(typeof value === "string" ? value : null);
    else request.resolve();

    const next = queueRef.current.shift() ?? null;
    activeRef.current = next;
    setActive(next);
  }, []);

  const confirmAction = useCallback(
    (options: ConfirmDialogOptions) =>
      new Promise<boolean>((resolve) => {
        enqueue({ id: nextIdRef.current++, kind: "confirm", options, resolve });
      }),
    [enqueue],
  );

  const promptForText = useCallback(
    (options: PromptDialogOptions) =>
      new Promise<string | null>((resolve) => {
        enqueue({ id: nextIdRef.current++, kind: "prompt", options, resolve });
      }),
    [enqueue],
  );

  const showAlert = useCallback(
    (options: AlertDialogOptions) =>
      new Promise<void>((resolve) => {
        enqueue({ id: nextIdRef.current++, kind: "alert", options, resolve });
      }),
    [enqueue],
  );

  useEffect(
    () => () => {
      if (activeRef.current) settleAsCancelled(activeRef.current);
      queueRef.current.forEach(settleAsCancelled);
      activeRef.current = null;
      queueRef.current = [];
    },
    [],
  );

  const api = useMemo(
    () => ({ confirmAction, promptForText, showAlert }),
    [confirmAction, promptForText, showAlert],
  );

  return (
    <AppDialogContext.Provider value={api}>
      {children}
      {active && <DialogPanel key={active.id} request={active} onFinish={finish} />}
    </AppDialogContext.Provider>
  );
}

export function useAppDialog(): AppDialogApi {
  const context = useContext(AppDialogContext);
  if (!context) throw new Error("useAppDialog must be used inside AppDialogProvider.");
  return context;
}

function DialogPanel({
  request,
  onFinish,
}: {
  request: DialogRequest;
  onFinish: (value?: boolean | string | null) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const [promptValue, setPromptValue] = useState(
    request.kind === "prompt" ? request.options.initialValue ?? "" : "",
  );

  const close = useCallback(() => {
    if (request.kind === "confirm") onFinish(false);
    else if (request.kind === "prompt") onFinish(null);
    else onFinish();
  }, [onFinish, request.kind]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusId = window.requestAnimationFrame(() => {
      if (request.kind === "prompt") inputRef.current?.focus();
      else primaryRef.current?.focus();
    });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusId);
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [close, request.kind]);

  const options = request.options;
  const tone = "tone" in options ? options.tone ?? "default" : "default";
  const descriptionId = options.description ? `app-dialog-description-${request.id}` : undefined;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (request.kind === "prompt") onFinish(promptValue.trim());
    else if (request.kind === "confirm") onFinish(true);
    else onFinish();
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`app-dialog-title-${request.id}`}
        aria-describedby={descriptionId}
        className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-surface shadow-2xl outline-none"
      >
        <form onSubmit={submit}>
          <div className="flex items-start gap-3 px-5 pb-3 pt-5">
            <div
              aria-hidden
              className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full border text-base font-bold ${
                tone === "danger"
                  ? "border-[var(--negative-border)] bg-[var(--negative-subtle)] text-[var(--negative-text)]"
                  : "border-[var(--primary-border)] bg-[var(--primary-subtle)] text-[var(--primary-text)]"
              }`}
            >
              {tone === "danger" ? "!" : "T"}
            </div>
            <div className="min-w-0 flex-1">
              <h2
                id={`app-dialog-title-${request.id}`}
                className="text-base font-bold tracking-tight text-text-primary"
              >
                {options.title}
              </h2>
              {options.description && (
                <p
                  id={descriptionId}
                  className="mt-1 text-sm leading-relaxed text-text-secondary"
                >
                  {options.description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close dialog"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-xl leading-none text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
            >
              ×
            </button>
          </div>

          {request.kind === "prompt" && (
            <div className="px-5 pb-4">
              <label
                htmlFor={`app-dialog-input-${request.id}`}
                className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-text-muted"
              >
                {request.options.label}
              </label>
              {request.options.multiline ? (
                <textarea
                  ref={inputRef as React.RefObject<HTMLTextAreaElement | null>}
                  id={`app-dialog-input-${request.id}`}
                  value={promptValue}
                  onChange={(event) => setPromptValue(event.target.value)}
                  placeholder={request.options.placeholder}
                  rows={4}
                  className="w-full resize-y rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-[var(--primary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--primary-subtle)]"
                />
              ) : (
                <input
                  ref={inputRef as React.RefObject<HTMLInputElement | null>}
                  id={`app-dialog-input-${request.id}`}
                  value={promptValue}
                  onChange={(event) => setPromptValue(event.target.value)}
                  placeholder={request.options.placeholder}
                  className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-[var(--primary)] focus:outline-none focus:ring-[3px] focus:ring-[var(--primary-subtle)]"
                />
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-border-subtle bg-surface-sunken px-5 py-3.5">
            {request.kind !== "alert" && (
              <button
                type="button"
                onClick={close}
                className="rounded-md border border-border-strong bg-surface px-3.5 py-2 text-sm font-semibold text-text-secondary transition-colors hover:bg-surface-hover"
              >
                {request.options.cancelLabel ?? "Cancel"}
              </button>
            )}
            <button
              ref={primaryRef}
              type="submit"
              className={`rounded-md px-3.5 py-2 text-sm font-semibold transition-colors ${
                tone === "danger"
                  ? "bg-[var(--negative)] text-white hover:brightness-95"
                  : "bg-[var(--primary)] text-[var(--primary-fg)] hover:bg-[var(--primary-hover)]"
              }`}
            >
              {request.kind === "confirm"
                ? request.options.confirmLabel ?? "Confirm"
                : request.kind === "prompt"
                  ? request.options.confirmLabel ?? "Save"
                  : request.options.buttonLabel ?? "Got it"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
