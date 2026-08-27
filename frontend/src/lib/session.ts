'use client';
// Client session helpers.
//
// The access token lives in localStorage, which is an *external store* as far
// as React is concerned — so it is read through useSyncExternalStore rather
// than being copied into state inside an effect. That keeps server render,
// hydration and later updates consistent, and avoids cascading renders.
import { useSyncExternalStore } from 'react';

export const ACCESS_TOKEN_KEY = 'cn_access';

/** Notifies every hook in the tab that the stored session changed. */
export function notifySessionChange(): void {
  window.dispatchEvent(new Event('storage'));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
}

/**
 * `true` / `false` once the browser has been read, `null` on the server and
 * during hydration (i.e. "not known yet" — render a loading state).
 */
export function useHasSession(): boolean | null {
  return useSyncExternalStore(
    subscribe,
    () => Boolean(localStorage.getItem(ACCESS_TOKEN_KEY)),
    () => null,
  );
}

/**
 * Kicks off an async load *after* the effect has committed.
 *
 * Loaders update state, and calling them synchronously inside an effect body
 * triggers a cascading render in the commit phase. Deferring by one microtask
 * is behaviourally identical for a network call and keeps the commit clean.
 */
export function deferLoad(load: () => void | Promise<unknown>): void {
  void Promise.resolve().then(load);
}
