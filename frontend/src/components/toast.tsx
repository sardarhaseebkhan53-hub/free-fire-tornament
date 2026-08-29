'use client';
// =============================================================================
// Toast system — consistent success / error / info feedback across the app.
//
//   const { toast } = useToast();
//   toast({ title: 'Copied', description: 'Join code copied to clipboard.', tone: 'success' });
//
// Container: top-center on phones (thumb-reachable), bottom-right on desktop.
// Auto-dismiss (4s, hover pauses), manual dismiss, aria-live for screen
// readers, reduced-motion friendly (CSS class handles timing).
// =============================================================================
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';

type Tone = 'success' | 'error' | 'info';

interface ToastInput {
  title: string;
  description?: string;
  tone?: Tone;
  duration?: number; // ms; default 4000
}

interface ToastItem extends Required<Pick<ToastInput, 'title' | 'tone'>> {
  id: number;
  description?: string;
}

const ToastCtx = createContext<{ toast: (t: ToastInput) => void } | null>(null);

let nextId = 1;

const TONE_STYLES: Record<Tone, { icon: typeof Info; ring: string; iconColor: string }> = {
  success: { icon: CheckCircle2, ring: 'border-success/40', iconColor: 'text-success' },
  error: { icon: XCircle, ring: 'border-danger/40', iconColor: 'text-danger' },
  info: { icon: Info, ring: 'border-accent/40', iconColor: 'text-accent' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const tmr = timers.current.get(id);
    if (tmr) clearTimeout(tmr);
    timers.current.delete(id);
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      const id = nextId++;
      const item: ToastItem = {
        id,
        title: input.title,
        description: input.description,
        tone: input.tone ?? 'info',
      };
      setItems((prev) => [...prev.slice(-3), item]); // max 4 visible
      const t = setTimeout(() => dismiss(id), input.duration ?? 4000);
      timers.current.set(id, t);
    },
    [dismiss],
  );

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      {/* Viewport — fixed, above nav (z-70), safe for the bottom nav on phones */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 top-3 z-[70] flex flex-col items-center gap-2 px-3 sm:inset-x-auto sm:right-4 sm:top-4 sm:items-end"
      >
        {items.map((t) => {
          const s = TONE_STYLES[t.tone];
          const Icon = s.icon;
          return (
            <div
              key={t.id}
              role="status"
              className={`toast-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card border ${s.ring} bg-elevated/95 px-4 py-3 shadow-[0_16px_44px_-12px_rgba(0,0,0,0.7),0_0_20px_-6px_rgba(139,92,246,0.25)] backdrop-blur-xl`}
              onMouseEnter={() => {
                const tmr = timers.current.get(t.id);
                if (tmr) clearTimeout(tmr);
              }}
              onMouseLeave={() => { timers.current.set(t.id, setTimeout(() => dismiss(t.id), 1500)); }}
            >
              <Icon size={19} className={`mt-0.5 shrink-0 ${s.iconColor}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-fg">{t.title}</p>
                {t.description && <p className="mt-0.5 text-xs leading-relaxed text-fg-2">{t.description}</p>}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="touch-target -mr-1 -mt-1 shrink-0 rounded-full p-1.5 text-fg-3 transition hover:bg-white/5 hover:text-fg"
              >
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
