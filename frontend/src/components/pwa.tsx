'use client';
// PWA runtime (Phase 13, design 46): service-worker registration + the
// "Install CLUTCHNEX" prompt (beforeinstallprompt on Chrome/Android, A2HS
// instructions on iOS Safari). Dismissals are remembered for 14 days.
import { useEffect, useState } from 'react';
import { Share, Smartphone, X } from 'lucide-react';

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

function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [dismissed, setDismissed] = useState(true); // start hidden; eligibility check below
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) {
      setInstalled(true);
      return;
    }

    const ios = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
    setIsIos(ios);

    const recentlyDismissed =
      Date.now() - Number(localStorage.getItem(DISMISS_KEY) ?? 0) < DISMISS_DAYS * 86_400_000;
    if (!recentlyDismissed) setDismissed(false);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  return { deferred, installed, dismissed, isIos, setDismissed };
}

export function InstallBanner() {
  const { deferred, installed, dismissed, isIos, setDismissed } = useInstallPrompt();
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
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === 'accepted') dismiss();
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
                <Smartphone size={13} /> Install App
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
