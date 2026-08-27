'use client';
// NEXA chat widget + WhatsApp bubble — design 44/42 (Phase 11).
// NEXA answers questions only: it can never approve payments, change balances
// or reveal room credentials (enforced server-side; the notice is always visible).
import { useEffect, useRef, useState } from 'react';
import { Bot, MessageCircle, Send, ShieldCheck, X } from 'lucide-react';
import { api } from '@/lib/client-api';

interface Msg {
  role: 'nexa' | 'you';
  text: string;
}

interface NexaResponse {
  reply: string;
  quickReplies: string[];
  intent: string;
  guarded: boolean;
}

const GREETING =
  "Salam! I'm NEXA, your CLUTCHNEX assistant. Ask me anything about tournaments, entries, deposits, withdrawals or room unlocks.";

export function NexaWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([{ role: 'nexa', text: GREETING }]);
  const [quick, setQuick] = useState<string[]>([
    'How do I join a tournament?',
    'Where is my deposit?',
    'How do I withdraw winnings?',
    'How do room unlocks work?',
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [whatsapp, setWhatsapp] = useState('');
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch('/api/backend/public/settings/public')
      .then((r) => r.json())
      .then((j) => setWhatsapp(String(j?.data?.['platform.whatsappNumber'] ?? '')))
      .catch(() => {});
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, open]);

  async function ask(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setMessages((m) => [...m, { role: 'you', text: q }]);
    setInput('');
    setBusy(true);
    try {
      const data = await api<NexaResponse>('/nexa', { method: 'POST', body: { message: q } });
      setMessages((m) => [...m, { role: 'nexa', text: data.reply }]);
      if (data.quickReplies?.length) setQuick(data.quickReplies);
    } catch {
      setMessages((m) => [
        ...m,
        { role: 'nexa', text: 'My line glitched for a second — try again, or reach staff on WhatsApp / a support ticket.' },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Floating bubbles */}
      <div className="fixed bottom-20 right-4 z-40 flex items-center gap-2 lg:bottom-6 lg:right-6">
        {whatsapp && (
          <a
            href={`https://wa.me/${whatsapp.replace(/\D/g, '')}`}
            target="_blank"
            rel="noreferrer"
            aria-label="Chat with us on WhatsApp"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-[#25D366] text-white shadow-[0_8px_24px_rgba(37,211,102,0.5)] transition hover:scale-105"
          >
            <MessageCircle size={22} />
          </a>
        )}
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close NEXA assistant' : 'Open NEXA assistant'}
          aria-expanded={open}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-strong text-white shadow-[0_8px_24px_rgba(139,92,246,0.55)] transition hover:scale-105"
        >
          {open ? <X size={22} /> : <Bot size={24} />}
        </button>
      </div>

      {/* Chat panel — bottom-right glass panel on desktop, near-full sheet on mobile */}
      {open && (
        <div
          role="dialog"
          aria-label="NEXA assistant"
          className="fixed inset-x-3 bottom-36 top-20 z-40 flex flex-col overflow-hidden rounded-[20px] border border-line bg-surface/95 shadow-2xl backdrop-blur-xl sm:inset-x-auto sm:right-6 sm:top-auto sm:bottom-24 sm:h-[520px] sm:w-[380px]"
        >
          <div className="flex items-center gap-3 border-b border-line bg-gradient-to-r from-accent/20 to-transparent px-4 py-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-strong text-white shadow-[0_0_16px_rgba(139,92,246,0.5)]">
              <Bot size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-sm font-bold text-fg">NEXA</p>
              <p className="flex items-center gap-1.5 text-[11px] text-fg-3">
                <span className="h-1.5 w-1.5 rounded-full bg-success" /> Assistant · always on
              </p>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close chat" className="rounded-input border border-line p-1.5 text-fg-3 transition hover:text-fg">
              <X size={14} />
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'you' ? 'justify-end' : 'justify-start'}`}>
                <p
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                    m.role === 'you'
                      ? 'rounded-br-sm bg-accent/25 text-fg'
                      : 'rounded-bl-sm border border-line bg-white/[4%] text-fg-2'
                  }`}
                >
                  {m.text}
                </p>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <p className="rounded-2xl rounded-bl-sm border border-line bg-white/[4%] px-3.5 py-2.5 text-[13px] text-fg-3">
                  <span className="animate-pulse">NEXA is typing…</span>
                </p>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="border-t border-line px-4 pb-3 pt-2">
            <div className="flex gap-1.5 overflow-x-auto pb-2 [scrollbar-width:none]">
              {quick.map((q) => (
                <button
                  key={q}
                  onClick={() => ask(q)}
                  disabled={busy}
                  className="shrink-0 rounded-pill border border-accent/30 bg-accent/10 px-3 py-1 text-[11px] font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                ask(input);
              }}
              className="flex items-center gap-2"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask NEXA anything…"
                maxLength={500}
                className="min-w-0 flex-1 rounded-input border border-line bg-white/[3%] px-3 py-2.5 text-sm text-fg outline-none placeholder:text-fg-3 focus:border-accent/50"
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                aria-label="Send"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-input bg-accent text-white transition hover:bg-accent-strong disabled:opacity-40"
              >
                <Send size={16} />
              </button>
            </form>
            <p className="mt-2 flex items-center gap-1.5 text-[10px] leading-tight text-fg-3">
              <ShieldCheck size={12} className="shrink-0 text-success" />
              NEXA answers questions only — it never approves payments, changes balances or shares room IDs.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
