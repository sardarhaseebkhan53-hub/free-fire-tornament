'use client';
// =============================================================================
// Shared dialog accessibility behaviour.
//
// Every modal in the app previously rendered as a fixed overlay with an
// `onClick` handler and nothing else. That left three real accessibility
// defects, all of them WCAG failures:
//
//   1. Escape did not close the dialog (WCAG 2.1.2 — No Keyboard Trap).
//   2. Tab moved focus into the page BEHIND the overlay, so keyboard and
//      screen-reader users could operate controls they could not see.
//   3. Closing the dialog dropped focus onto <body>, losing the user's place.
//
// `useDialog` fixes all three in one place, and additionally locks background
// scrolling so mobile Safari does not scroll the page under the sheet.
//
// `useDialogCloseGuard` exists for the one click this file does NOT own: the
// BACKDROP. On touch devices the tap that OPENS a dialog synthesizes a `click`
// a few frames later at the same coordinates — which now hit the freshly
// mounted backdrop. Without a guard that click closes the dialog immediately
// (the classic "overlay flashes open and instantly disappears" bug on mobile).
// The guard ignores calls inside the first 300ms of the dialog's life; the
// ✕ button and Escape bypass it and close immediately.
// =============================================================================
import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

/** How long after mount a backdrop click is assumed to be the opening tap. */
const OPEN_TAP_GUARD_MS = 300;

export function useDialog<T extends HTMLElement = HTMLDivElement>(
  onClose: () => void,
): React.RefObject<T | null> {
  const ref = useRef<T>(null);
  // Keep the latest onClose without re-registering the key listeners on every
  // render. Written in an effect (never during render) so React can bail out
  // of renders safely.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = ref.current;

    // Move focus into the dialog: the first control, or the dialog itself.
    const focusables = () => Array.from(node?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      .filter((el) => el.offsetParent !== null || el === document.activeElement);
    (focusables()[0] ?? node)?.focus?.();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !node) return;
      // Focus trap — wrap around at both ends.
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !node.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      // Return focus to whatever opened the dialog.
      previouslyFocused?.focus?.();
    };
  }, []);

  return ref;
}

/**
 * A close handler for the dialog's BACKDROP. `close` swallows the opening
 * tap's synthesized click (see header comment); `closeNow` never waits.
 */
export function useDialogCloseGuard(onClose: () => void): { close: () => void; closeNow: () => void } {
  const mountedAt = useRef(0);
  useEffect(() => {
    mountedAt.current = Date.now();
  }, []);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  return {
    close: () => {
      if (Date.now() - mountedAt.current < OPEN_TAP_GUARD_MS) return;
      closeRef.current();
    },
    closeNow: () => closeRef.current(),
  };
}
