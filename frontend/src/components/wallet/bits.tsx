'use client';
// Wallet building blocks shared by the five payment screens (design 14-17, 22).
import { useState } from 'react';
import {
  ArrowDownLeft, ArrowUpRight, BadgeCheck, Banknote, Coins, Copy, Check,
  Gift, Landmark, RefreshCcw, Smartphone, Trophy, Wallet as WalletIcon,
} from 'lucide-react';

export type Method = 'JAZZCASH' | 'EASYPAISA' | 'BANK_TRANSFER' | 'NAYAPAY' | 'SADAPAY';

export const METHOD_LABEL: Record<Method, string> = {
  JAZZCASH: 'JazzCash',
  EASYPAISA: 'EasyPaisa',
  BANK_TRANSFER: 'Bank Transfer',
  NAYAPAY: 'NayaPay',
  SADAPAY: 'SadaPay',
};

/** Brand chip — colour block + wordmark, like the payment cards in design 15/22. */
export function MethodBrand({ method, size = 40 }: { method: Method; size?: number }) {
  const small = size < 40;
  if (method === 'JAZZCASH') {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-input bg-[#E10E0E] font-display italic tracking-tight text-white"
        style={{ width: size, height: size, fontSize: small ? 9 : 11 }}
      >
        JazzCash
      </span>
    );
  }
  if (method === 'EASYPAISA') {
    return (
      <span
        className="flex shrink-0 flex-col items-center justify-center rounded-input bg-[#0ABF5B] leading-none text-white"
        style={{ width: size, height: size, fontSize: small ? 8 : 10 }}
      >
        <span className="font-display font-bold italic">easy</span>
        <span className="font-display font-bold">paisa</span>
      </span>
    );
  }
  if (method === 'NAYAPAY') {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-input bg-[#5E1EE0] text-white"
        style={{ width: size, height: size, fontSize: small ? 8 : 10 }}
      >
        naya
      </span>
    );
  }
  if (method === 'SADAPAY') {
    return (
      <span
        className="flex shrink-0 flex-col items-center justify-center rounded-input bg-[#00C2A8] leading-none text-white"
        style={{ width: size, height: size, fontSize: small ? 8 : 10 }}
      >
        <span className="font-display font-bold">Sada</span>
        <span className="font-display font-bold">Pay</span>
      </span>
    );
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-input bg-[#1D4ED8] text-white"
      style={{ width: size, height: size }}
    >
      <Landmark size={small ? 14 : 18} />
    </span>
  );
}

const STATUS_TONE: Record<string, string> = {
  COMPLETED: 'bg-success/15 text-success border-success/30',
  APPROVED: 'bg-success/15 text-success border-success/30',
  PAID: 'bg-success/15 text-success border-success/30',
  PENDING: 'bg-warning/15 text-warning border-warning/30',
  PROCESSING: 'bg-info/15 text-info border-info/30',
  REJECTED: 'bg-danger/15 text-danger border-danger/30',
  CANCELLED: 'bg-white/5 text-fg-3 border-line',
};

export function StatusPill({ status }: { status: string }) {
  const label = status === 'PROCESSING' ? 'Processing' : status === 'PAID' ? 'Paid' : status.charAt(0) + status.slice(1).toLowerCase();
  return (
    <span className={`inline-flex items-center rounded-pill border px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_TONE[status] ?? STATUS_TONE.CANCELLED}`}>
      {label}
    </span>
  );
}

const TYPE_META: Record<string, { label: string; icon: React.ComponentType<{ size?: number }>; tone: string }> = {
  DEPOSIT: { label: 'Deposit', icon: ArrowDownLeft, tone: 'bg-success/15 text-success' },
  ENTRY_FEE: { label: 'Entry Fee', icon: ArrowUpRight, tone: 'bg-danger/15 text-danger' },
  ENTRY_REFUND: { label: 'Refund', icon: RefreshCcw, tone: 'bg-info/15 text-info' },
  WINNING: { label: 'Winning', icon: Trophy, tone: 'bg-reward/15 text-reward' },
  WITHDRAWAL: { label: 'Withdrawal', icon: ArrowUpRight, tone: 'bg-danger/15 text-danger' },
  WITHDRAWAL_REVERSAL: { label: 'Reversal', icon: RefreshCcw, tone: 'bg-info/15 text-info' },
  REFERRAL_REWARD: { label: 'Referral Bonus', icon: Gift, tone: 'bg-accent/15 text-accent' },
  COIN_CONVERSION: { label: 'Coin Conversion', icon: Coins, tone: 'bg-accent/15 text-accent' },
  BONUS_CREDIT: { label: 'Bonus', icon: Gift, tone: 'bg-success/15 text-success' },
  BONUS_DEBIT: { label: 'Bonus Used', icon: ArrowUpRight, tone: 'bg-danger/15 text-danger' },
  ADMIN_CREDIT: { label: 'Admin Credit', icon: BadgeCheck, tone: 'bg-info/15 text-info' },
  ADMIN_DEBIT: { label: 'Admin Debit', icon: ArrowUpRight, tone: 'bg-danger/15 text-danger' },
};

export function TypeChip({ type }: { type: string }) {
  const meta = TYPE_META[type] ?? { label: type, icon: Banknote, tone: 'bg-white/5 text-fg-2' };
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${meta.tone}`}>
        <Icon size={13} />
      </span>
      <span className="text-sm font-medium text-fg">{meta.label}</span>
    </span>
  );
}

export function CopyChip({ value, className = '' }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch { /* clipboard unavailable */ }
      }}
      className={`inline-flex items-center gap-1 rounded-input border border-line px-2 py-1 text-fg-3 transition hover:border-accent/40 hover:text-accent ${className}`}
      title="Copy"
    >
      {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
    </button>
  );
}

export function BucketIcon({ bucket, size = 16 }: { bucket: 'CASH' | 'COINS' | 'WINNING' | 'BONUS'; size?: number }) {
  const map = {
    CASH: { icon: WalletIcon, cls: 'bg-accent/15 text-accent' },
    COINS: { icon: Coins, cls: 'bg-reward/15 text-reward' },
    WINNING: { icon: Trophy, cls: 'bg-reward/15 text-reward' },
    BONUS: { icon: Gift, cls: 'bg-success/15 text-success' },
  } as const;
  const { icon: Icon, cls } = map[bucket];
  return (
    <span className={`flex items-center justify-center rounded-full ${cls}`} style={{ width: size + 14, height: size + 14 }}>
      <Icon size={size} />
    </span>
  );
}

export function MobileField({ icon: Icon }: { icon: React.ComponentType<{ size?: number; className?: string }> }) {
  return <Icon size={15} className="text-fg-3" />;
}

export const SmartPhoneIcon = Smartphone;
