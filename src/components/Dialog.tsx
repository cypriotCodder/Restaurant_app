"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

// One modal for every staff and customer surface.
//
// The app had seven hand-rolled overlays, none of which trapped focus, closed
// on Escape, or returned focus to what opened them — so a keyboard or
// screen-reader user could tab straight out of the settle dialog into the
// order cards underneath it. Native confirm()/alert() were used for the rest,
// which look nothing like the app and cannot be styled or translated.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps Tab inside `ref`, closes on Escape, and hands focus back to whatever
 * had it when the dialog opened.
 */
export function useFocusTrap(ref: React.RefObject<HTMLElement | null>, onClose?: () => void) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = root.querySelector<HTMLElement>("[data-autofocus]") ?? root.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? root).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onClose) {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [ref, onClose]);
}

export default function Dialog({
  title,
  children,
  onClose,
  busy = false,
  width = "max-w-md",
  align = "center",
}: {
  title: ReactNode;
  children: ReactNode;
  /** Escape and the backdrop call this; omit to make the dialog blocking. */
  onClose?: () => void;
  /** While true the backdrop and Escape do nothing, so a save cannot be abandoned mid-flight. */
  busy?: boolean;
  width?: string;
  /** "start" for tall forms that may scroll; "center" for short prompts. */
  align?: "center" | "start";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = busy ? undefined : onClose;
  useFocusTrap(ref, close);

  return (
    <div
      className={`fixed inset-0 z-40 flex justify-center overflow-y-auto p-4 ${
        align === "start" ? "items-start" : "items-center"
      }`}
    >
      <button
        type="button"
        className="fixed inset-0 bg-black/50"
        onClick={close}
        aria-label="Kapat / Close"
        tabIndex={-1}
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`relative bg-white p-5 w-full ${width} ${align === "start" ? "my-8" : "max-h-[85vh] overflow-auto"} outline-none`}
        style={{ border: "2px solid var(--color-text)" }}
      >
        <h2 id={titleId} className="wordmark text-lg mb-3">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

/**
 * A yes/no question. Replaces window.confirm(): styled, bilingual, and the
 * destructive choice is visibly the destructive one.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel = "Onayla / Confirm",
  cancelLabel = "Vazgeç / Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: ReactNode;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog title={title} onClose={onCancel} busy={busy} width="max-w-sm">
      {body && <div className="text-sm mb-4">{body}</div>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} disabled={busy} className="btn btn-secondary">
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className={`btn ${danger ? "btn-danger" : "btn-primary"}`}
          data-autofocus
        >
          {busy ? "..." : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
