'use client';
// Admin UI kit — KPI cards, data table shell, status pills, charts (hand-rolled
// SVG, no chart dependency), modal and small helpers. Design language of 26-40.
import { useEffect, useMemo, useState } from 'react';
import { deferLoad } from '@/lib/session';

export function Kpi({
  label, value, sub, tone = 'accent', icon,
}: {
  label: string; value: string | number; sub?: React.ReactNode;
  tone?: 'accent' | 'success' | 'danger' | 'reward' | 'info' | 'warning'; icon?: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    accent: 'bg-accent/15 text-accent',
    success: 'bg-success/15 text-success',
    danger: 'bg-danger/15 text-danger',
    reward: 'bg-reward/15 text-reward',
    info: 'bg-info/15 text-info',
    warning: 'bg-warning/15 text-warning',
  };
  return (
    <div className="glass rounded-card p-4">
      <div className="flex items-center gap-3">
        {icon && <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-input ${tones[tone]}`}>{icon}</span>}
        <p className="truncate text-[11px] font-bold uppercase tracking-wide text-fg-3">{label}</p>
      </div>
      <p className="tabular mt-2 font-display text-2xl font-bold text-fg">{value}</p>
      {sub && <div className="mt-1 text-[11px]">{sub}</div>}
    </div>
  );
}

export function Delta({ up, value }: { up: boolean; value: string }) {
  return (
    <span className={up ? 'text-success' : 'text-danger'}>
      {up ? '↑' : '↓'} {value}
    </span>
  );
}

export function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="glass overflow-x-auto rounded-card">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-line text-[11px] uppercase tracking-wide text-fg-3">
            {head.map((h) => <th key={h} className="whitespace-nowrap px-4 py-3 font-semibold">{h}</th>)}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Tr({ children }: { children: React.ReactNode }) {
  return <tr className="border-b border-line/60 transition last:border-0 hover:bg-white/[2%]">{children}</tr>;
}

export function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>;
}

const PILL: Record<string, string> = {
  ACTIVE: 'bg-success/15 text-success border-success/30',
  APPROVED: 'bg-success/15 text-success border-success/30',
  PAID: 'bg-success/15 text-success border-success/30',
  PUBLISHED: 'bg-success/15 text-success border-success/30',
  CREDITED: 'bg-success/15 text-success border-success/30',
  VERIFIED: 'bg-success/15 text-success border-success/30',
  RESOLVED: 'bg-success/15 text-success border-success/30',
  PENDING: 'bg-warning/15 text-warning border-warning/30',
  UNDER_REVIEW: 'bg-warning/15 text-warning border-warning/30',
  WAITING_USER: 'bg-warning/15 text-warning border-warning/30',
  DRAFT: 'bg-white/5 text-fg-2 border-line',
  SCHEDULED: 'bg-white/5 text-fg-2 border-line',
  OPEN: 'bg-info/15 text-info border-info/30',
  IN_PROGRESS: 'bg-info/15 text-info border-info/30',
  APPROVED_WD: 'bg-info/15 text-info border-info/30',
  PROCESSING: 'bg-info/15 text-info border-info/30',
  LIVE: 'bg-danger/15 text-danger border-danger/30',
  REJECTED: 'bg-danger/15 text-danger border-danger/30',
  BANNED: 'bg-danger/15 text-danger border-danger/30',
  SUSPENDED: 'bg-danger/15 text-danger border-danger/30',
  CANCELLED: 'bg-white/5 text-fg-3 border-line',
  CLOSED: 'bg-white/5 text-fg-3 border-line',
  COMPLETED: 'bg-white/5 text-fg-2 border-line',
  REGISTRATION_OPEN: 'bg-success/15 text-success border-success/30',
};

export function Pill({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-pill border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${PILL[status] ?? PILL.DRAFT}`}>
      {label ?? status.replace(/_/g, ' ')}
    </span>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className={`max-h-[88vh] w-full overflow-y-auto rounded-[20px] border border-line bg-surface p-6 shadow-2xl ${wide ? 'max-w-2xl' : 'max-w-md'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg font-bold text-fg">{title}</h2>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-xs text-fg-3">
      <p>Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</p>
      <div className="flex items-center gap-1.5">
        <button onClick={() => onPage(page - 1)} disabled={page <= 1} className="rounded-input border border-line px-2.5 py-1 disabled:opacity-40">‹</button>
        <span className="px-1 font-bold text-fg-2">{page} / {pages}</span>
        <button onClick={() => onPage(page + 1)} disabled={page >= pages} className="rounded-input border border-line px-2.5 py-1 disabled:opacity-40">›</button>
      </div>
    </div>
  );
}

// --- Charts (SVG, no deps) ---------------------------------------------------

export function AreaChart({ series, height = 180 }: { series: Array<{ day: string | Date; value: number }>; height?: number }) {
  const path = useMemo(() => {
    if (series.length < 2) return null;
    const max = Math.max(...series.map((s) => s.value), 1);
    const w = 600;
    const pts = series.map((s, i) => [(i / (series.length - 1)) * w, height - 24 - (s.value / max) * (height - 40)] as const);
    const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    return { d, area: `${d} L${w},${height - 24} L0,${height - 24} Z`, pts };
  }, [series, height]);
  if (!path) return <p className="py-10 text-center text-xs text-fg-3">Not enough data yet.</p>;
  return (
    <svg viewBox={`0 0 600 ${height}`} className="w-full" role="img" aria-label="Trend chart">
      <defs>
        <linearGradient id="area-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1="0" x2="600" y1={height * f} y2={height * f} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
      ))}
      <path d={path.area} fill="url(#area-fill)" />
      <path d={path.d} fill="none" stroke="#8B5CF6" strokeWidth="2" strokeLinejoin="round" />
      {path.pts.filter((_, i) => i % Math.ceil(series.length / 12) === 0).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2.2" fill="#8B5CF6" />
      ))}
    </svg>
  );
}

/** Multi-series line chart (e.g. collection vs prizes vs net) with legend. */
export function MultiLineChart({
  series, labels, height = 210,
}: {
  series: Array<Array<{ x: string | Date; value: number }>>;
  labels: Array<{ label: string; color: string }>;
  height?: number;
}) {
  const ready = series.every((s) => s.length >= 2) && series.length === labels.length;
  const paths = useMemo(() => {
    if (!ready) return null;
    const w = 600;
    const max = Math.max(1, ...series.flat().map((p) => p.value));
    const zeroY = height - 24;
    return series.map((line) => {
      const pts = line.map((p, i) => [
        (i / (line.length - 1)) * w,
        zeroY - (p.value / max) * (height - 40),
      ] as const);
      const d = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
      return { d, pts };
    });
  }, [series, height, ready]);

  if (!paths) return <p className="py-10 text-center text-xs text-fg-3">Not enough data yet.</p>;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
        {labels.map((l) => (
          <span key={l.label} className="flex items-center gap-2 text-xs font-medium text-fg-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
            {l.label}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 600 ${height}`} className="w-full" role="img" aria-label="Financial trend chart">
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2="600" y1={height * f} y2={height * f} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        ))}
        <line x1="0" x2="600" y1={height - 24} y2={height - 24} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
        {paths.map((p, i) => (
          <g key={labels[i].label}>
            <path d={p.d} fill="none" stroke={labels[i].color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {p.pts.filter((_, j) => series[i].length < 16 || j % Math.ceil(series[i].length / 12) === 0).map(([x, y], j) => (
              <circle key={j} cx={x} cy={y} r="2.2" fill={labels[i].color} />
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
}

export function BarChart({ series, height = 180 }: { series: Array<{ day: string | Date; value: number }>; height?: number }) {
  const max = Math.max(...series.map((s) => s.value), 1);
  return (
    <svg viewBox={`0 0 600 ${height}`} className="w-full" role="img" aria-label="Registrations chart">
      {series.map((s, i) => {
        const bw = 600 / series.length - 3;
        const h = (s.value / max) * (height - 36);
        return <rect key={i} x={(i * 600) / series.length + 1.5} y={height - 24 - h} width={Math.max(2, bw)} height={Math.max(1, h)} rx="2" fill="#8B5CF6" opacity="0.8" />;
      })}
    </svg>
  );
}

export function Donut({ parts, label }: { parts: Array<{ label: string; value: number; color: string }>; total: number; label: string }) {
  const sum = parts.reduce((t, p) => t + p.value, 0) || 1;
  // Pre-compute each arc's start offset so nothing is mutated during render.
  const arcs = parts.reduce<Array<{ label: string; color: string; frac: number; offset: number }>>(
    (acc, p) => {
      const prev = acc[acc.length - 1];
      const offset = prev ? prev.offset + prev.frac : 0;
      return [...acc, { label: p.label, color: p.color, frac: p.value / sum, offset }];
    },
    [],
  );
  const r = 54;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 140 140" className="h-36 w-36 shrink-0 -rotate-90" role="img" aria-label={`${label} donut chart`}>
        <circle cx="70" cy="70" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="16" />
        {arcs.map((a) => (
          <circle key={a.label} cx="70" cy="70" r={r} fill="none" stroke={a.color} strokeWidth="16"
            strokeDasharray={`${a.frac * c} ${c}`} strokeDashoffset={-a.offset * c} strokeLinecap="butt" />
        ))}
        <text x="70" y="70" textAnchor="middle" dominantBaseline="central" className="rotate-90" transform="rotate(90 70 70)" fill="#F4F6FB" fontSize="11" fontWeight="700">
          {label}
        </text>
      </svg>
      <div className="flex flex-col gap-2 text-xs">
        {parts.map((p) => (
          <div key={p.label} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
            <span className="text-fg-2">{p.label}</span>
            <span className="tabular ml-auto pl-4 font-bold text-fg">PKR {Math.round(p.value).toLocaleString('en-PK')}</span>
            <span className="w-10 text-right text-fg-3">{Math.round((p.value / sum) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Authenticated image loader — fetches an authed endpoint and object-URLs it. */
export function AuthedImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let revoke: string | null = null;
    const token = localStorage.getItem('cn_access');
    fetch(src, { headers: { authorization: `Bearer ${token ?? ''}` } })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        revoke = URL.createObjectURL(b);
        setUrl(revoke);
      })
      .catch(() => setFailed(true));
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [src]);
  if (failed) return <div className={`flex items-center justify-center rounded-card border border-line text-xs text-fg-3 ${className ?? ''}`}>No screenshot</div>;
  if (!url) return <div className={`animate-pulse rounded-card bg-white/[4%] ${className ?? ''}`} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} className={className} />;
}

export function useAdminList<T>(path: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    deferLoad(() => {
      setLoading(true);
      return fetch(`/api/backend${path}`, { headers: { authorization: `Bearer ${localStorage.getItem('cn_access') ?? ''}` } })
        .then((r) => r.json())
        .then((j) => setData(j.success ? j.data : null))
        .catch(() => setData(null))
        .finally(() => setLoading(false));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, loading, setData };
}
