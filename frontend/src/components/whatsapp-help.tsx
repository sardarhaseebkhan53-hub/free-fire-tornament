'use client';
// "Need help with this payment?" — WhatsApp strip for the payment flow (design
// 16/15). The number is admin-configurable (platform.whatsappNumber).
import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';

export function WhatsAppHelp({ label = 'Payment stuck or a question about this transfer?' }: { label?: string }) {
  const [whatsapp, setWhatsapp] = useState('');
  useEffect(() => {
    fetch('/api/backend/public/settings/public')
      .then((r) => r.json())
      .then((j) => setWhatsapp(String(j?.data?.['platform.whatsappNumber'] ?? '')))
      .catch(() => {});
  }, []);
  if (!whatsapp) return null;
  return (
    <a
      href={`https://wa.me/${whatsapp.replace(/\D/g, '')}`}
      target="_blank"
      rel="noreferrer"
      className="mt-5 flex items-center justify-center gap-2.5 rounded-card border border-success/30 bg-success/[6%] px-5 py-3.5 text-sm text-fg-2 transition hover:border-success/50"
    >
      <MessageCircle size={17} className="text-success" />
      <span>
        {label} <span className="font-bold text-success">WhatsApp support</span> — {whatsapp}
      </span>
    </a>
  );
}
