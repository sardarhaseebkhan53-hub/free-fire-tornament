'use client';
// Accessible FAQ accordion (keyboard + ARIA).
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Faq } from '@/lib/types';

export function FaqList({ faqs }: { faqs: Faq[] }) {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="space-y-3">
      {faqs.map((f, i) => {
        const isOpen = open === i;
        return (
          <div key={f.question} className="glass rounded-card">
            <button
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
            >
              <span className="text-sm font-semibold text-fg">{f.question}</span>
              <ChevronDown
                size={17}
                className={`shrink-0 text-fg-3 transition-transform ${isOpen ? 'rotate-180 text-accent' : ''}`}
              />
            </button>
            {isOpen && (
              <p className="border-t border-line px-5 py-4 text-sm leading-relaxed text-fg-2">
                {f.answer}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
