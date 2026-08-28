'use client';
// PWA runtime (Phase 13, design 46): service-worker registration + the
// "Install CLUTCHNEX" prompt (beforeinstallprompt on Chrome/Android, A2HS
// instructions on iOS Safari). Dismissals are remembered for 14 days.
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';

const DISMISS_KEY = 'cn_install_dismissed_at';
const DISMISS_DAYS = 14;

export function SwRegister() {
  useEffect(() => {
    // Production only: caching dev assets breaks hot reload.
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    const register = () => navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);
  return null;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Browser facts are read straight from the environment, never mirrored into
 *  state inside an effect (which would cascade renders on every mount). */
const noopSubscribe = () => () => {};

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [appInstalled, setAppInstalled] = useState(false);
  const [dismissedNow, setDismissedNow] = useState(false);
  const promptInFlight = useRef(false);

  const standalone = useSyncExternalStore(noopSubscribe, isStandalone, () => false);
  const isIos = useSyncExternalStore(
    noopSubscribe,
    () => /iphone|ipad|ipod/i.test(window.navigator.userAgent),
    () => false,
  );
  const recentlyDismissed = useSyncExternalStore(
    noopSubscribe,
    () => Date.now() - Number(localStorage.getItem(DISMISS_KEY) ?? 0) < DISMISS_DAYS * 86_400_000,
    () => true, // hidden until the browser has been read
  );

  const installed = standalone || appInstalled;
  const dismissed = recentlyDismissed || dismissedNow;

  useEffect(() => {
    if (standalone) return;

    const onPrompt = (e: Event) => {
      // Capture the native prompt for our custom button. The event is stored,
      // never dropped: the button only appears while a prompt is available.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setAppInstalled(true);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [standalone]);

  /**
   * Show the stored prompt exactly once. The native event can only be
   * prompted a single time, so afterwards the stored event is cleared —
   * re-clicking can never throw an InvalidStateError.
   */
  async function runPrompt(): Promise<boolean> {
    if (!deferred || promptInFlight.current) return false;
    promptInFlight.current = true;
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      setDeferred(null);
      return choice.outcome === 'accepted';
    } catch {
      setDeferred(null);
      return false;
    } finally {
      promptInFlight.current = false;
    }
  }

  return { deferred, installed, dismissed, isIos, setDismissed: setDismissedNow, runPrompt };
}

export function InstallBanner() {
  const { deferred, installed, dismissed, isIos, setDismissed, runPrompt } = useInstallPrompt();
  const [visible, setVisible] = useState(false);

  // Give the page a beat before sliding the banner in.
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 2500);
    return () => clearTimeout(t);
  }, []);

  if (installed || dismissed || (!deferred && !isIos) || !visible) return null;

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setDismissed(true);
  }

  async function install() {
    if (!deferred) return;
    const accepted = await runPrompt();
    if (accepted) dismiss();
  }

  return (
    <div
      role="dialog"
      aria-label="Install CLUTCHNEX"
      className="fixed inset-x-3 bottom-20 z-40 lg:inset-x-auto lg:bottom-6 lg:right-6 lg:w-80"
    >
      <div className="glass rounded-card p-4 shadow-2xl">
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="absolute right-3 top-3 rounded-input p-1 text-fg-3 transition hover:text-fg"
        >
          <X size={14} />
        </button>
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-input bg-gradient-to-br from-accent to-accent-strong font-display text-lg font-bold text-white shadow-[0_0_20px_rgba(139,92,246,0.55)]">
            C
          </span>
          <div className="min-w-0">
            <p className="font-display text-sm font-bold text-fg">Install CLUTCHNEX</p>
            {isIos ? (
              <p className="mt-1 text-[11px] leading-relaxed text-fg-3">
                Tap <Share size={11} className="inline" /> <b>Share</b> → <b>Add to Home Screen</b> for the
                full-screen app.
              </p>
            ) : (
              <p className="mt-1 text-[11px] leading-relaxed text-fg-3">
                Full-screen app · offline support · quicker matches.
              </p>
            )}
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          {isIos ? (
            <button
              onClick={dismiss}
              className="flex-1 rounded-input bg-accent py-2 text-xs font-bold text-white"
            >
              Got it
            </button>
          ) : (
            <>
              <button
                onClick={install}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-input bg-accent py-2 text-xs font-bold text-white transition hover:bg-accent-strong"
              >
                <Smartphone size={13} /> Install CLUTCHNEX
              </button>
              <button
                onClick={dismiss}
                className="rounded-input border border-line px-3 py-2 text-xs font-semibold text-fg-3 transition hover:text-fg-2"
              >
                Not now
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Design v2 §PWA install — the reusable "INSTALL CLUTCHNEX" button used in the
 * hero and the install section. CLUTCHNEX is a web app / PWA: this never links
 * to an app store, it triggers the browser install prompt (Chromium) or shows
 * Add-to-Home-Screen instructions (iOS Safari / unsupported browsers).
 */
export function InstallButton({
  variant = 'ghost',
  label = 'Install CLUTCHNEX',
  className = '',
}: {
  variant?: 'primary' | 'ghost';
  label?: string;
  className?: string;
}) {
  const { deferred, installed, isIos, runPrompt } = useInstallPrompt();
  const [howTo, setHowTo] = useState(false);

  const base =
    'inline-flex items-center justify-center gap-2 rounded-input px-6 py-3.5 text-sm font-bold uppercase tracking-wide transition';
  const skin =
    variant === 'primary'
      ? 'bg-accent text-white shadow-[0_0_28px_rgba(139,92,246,0.45)] hover:bg-accent-strong'
      : 'border border-line bg-white/[3%] text-fg hover:border-accent/40 hover:text-accent';

  async function onClick() {
    if (deferred) {
      // runPrompt clears the stored event afterwards — safe against
      // double-clicks and repeated prompt() calls.
      await runPrompt();
      return;
    }
    setHowTo(true);
  }

  if (installed) {
    return (
      <span className={`${base} border border-success/30 bg-success/10 text-success ${className}`}>
        <Smartphone size={16} /> App installed
      </span>
    );
  }

  return (
    <>
      <button type="button" onClick={onClick} className={`${base} ${skin} ${className}`}>
        <Download size={16} /> {label}
      </button>

      {howTo && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Add CLUTCHNEX to your home screen"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
          onClick={() => setHowTo(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass w-full max-w-md rounded-card p-6 shadow-2xl motion-safe:animate-fade-up"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-input bg-gradient-to-br from-accent to-accent-strong font-display text-lg font-bold text-white shadow-[0_0_20px_rgba(139,92,246,0.55)]">
                C
              </span>
              <div>
                <p className="font-display text-base font-bold text-fg">Install the web app</p>
                <p className="mt-1 text-xs leading-relaxed text-fg-3">
                  CLUTCHNEX is a web application (PWA) — install it straight from your browser. It is
                  not distributed on Google Play or the Apple App Store.
                </p>
              </div>
            </div>

            <ol className="mt-4 space-y-2 text-sm text-fg-2">
              {isIos ? (
                <>
                  <li className="flex gap-2">
                    <b className="text-accent">1.</b> Tap <Share size={14} className="inline" /> <b>Share</b> in Safari.
                  </li>
                  <li className="flex gap-2"><b className="text-accent">2.</b> Choose <b>Add to Home Screen</b>.</li>
                  <li className="flex gap-2"><b className="text-accent">3.</b> Confirm <b>Add</b> — CLUTCHNEX opens full screen.</li>
                </>
              ) : (
                <>
                  <li className="flex gap-2"><b className="text-accent">1.</b> Open your browser menu (⋮).</li>
                  <li className="flex gap-2"><b className="text-accent">2.</b> Choose <b>Install app</b> or <b>Add to Home screen</b>.</li>
                  <li className="flex gap-2"><b className="text-accent">3.</b> Confirm — CLUTCHNEX launches like a native app.</li>
                </>
              )}
            </ol>

            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setHowTo(false)}
                className="flex-1 rounded-input bg-accent py-2.5 text-xs font-bold uppercase tracking-wide text-white transition hover:bg-accent-strong"
              >
                Got it
              </button>
              <button
                onClick={() => setHowTo(false)}
                className="rounded-input border border-line px-4 py-2.5 text-xs font-semibold text-fg-3 transition hover:text-fg-2"
              >
                Continue in Browser
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
