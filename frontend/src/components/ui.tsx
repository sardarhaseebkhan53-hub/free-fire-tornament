// Core UI primitives — every page uses these (design system §Components).
import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

export function Badge({
  tone = 'neutral',
  children,
  live = false,
}: {
  tone?: 'neutral' | 'accent' | 'success' | 'reward' | 'danger' | 'warning' | 'info';
  children: ReactNode;
  live?: boolean;
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-white/5 text-fg-2 border-line',
    accent: 'bg-accent/15 text-accent border-accent/30',
    success: 'bg-success/15 text-success border-success/30',
    reward: 'bg-reward/15 text-reward border-reward/30',
    danger: 'bg-danger/15 text-danger border-danger/30',
    warning: 'bg-warning/15 text-warning border-warning/30',
    info: 'bg-info/15 text-info border-info/30',
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${tones[tone]}`}
    >
      {live && <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse-dot" />}
      {children}
    </span>
  );
}

export function SectionHeading({
  kicker,
  title,
  sub,
  action,
}: {
  kicker?: string;
  title: string;
  sub?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        {kicker && (
          <p className="mb-1 text-xs font-semibold tracking-[0.2em] uppercase text-accent">{kicker}</p>
        )}
        <h2 className="font-display text-2xl font-bold text-fg sm:text-3xl">{title}</h2>
        {sub && <p className="mt-2 max-w-2xl text-sm text-fg-2">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="glass card-hover rounded-card px-5 py-4">
      <p className={`tabular font-display text-2xl font-bold sm:text-3xl ${accent ? 'text-accent' : 'text-fg'}`}>
        {value}
      </p>
      <p className="mt-1 text-xs font-medium tracking-wide uppercase text-fg-3">{label}</p>
    </div>
  );
}

export function EmptyState({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="glass rounded-card px-6 py-14 text-center">
      <span
        aria-hidden
        className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-accent/25 bg-accent/10 text-accent"
      >
        <Inbox size={20} />
      </span>
      <p className="font-display text-lg font-semibold text-fg">{title}</p>
      {sub && <p className="mx-auto mt-2 max-w-md text-sm text-fg-2">{sub}</p>}
    </div>
  );
}

/** Skeleton block — placeholder that holds layout while data loads. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}

/** Card-shaped skeleton for grid/list loading states (prevents layout jump). */
export function CardSkeleton() {
  return (
    <div className="glass rounded-card p-5">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="mt-3 h-3 w-1/3" />
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
      <Skeleton className="mt-4 h-9 w-full" />
    </div>
  );
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name.slice(0, 2).toUpperCase();
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      className="inline-flex shrink-0 items-center justify-center rounded-full border border-accent/30 bg-accent/15 font-bold text-accent"
    >
      {initials}
    </span>
  );
}
