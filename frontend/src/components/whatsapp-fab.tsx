// Floating WhatsApp support — design 41: "Need help? Chat with us" bubble +
// green circle (configurable number from admin settings).
import { MessageCircle } from 'lucide-react';
import { apiServerSafe } from '@/lib/api';

export async function WhatsAppFab() {
  const settings = await apiServerSafe<Record<string, unknown>>('/public/settings/public');
  const whatsapp = String(settings?.['platform.whatsappNumber'] ?? '');
  if (!whatsapp) return null;
  const href = `https://wa.me/${whatsapp.replace(/\D/g, '')}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label="Chat with us on WhatsApp"
      className="fixed bottom-20 right-4 z-40 flex items-center gap-2 lg:bottom-6 lg:right-6"
    >
      <span className="rounded-lg rounded-br-none border border-line bg-surface px-3 py-2 text-[11px] font-semibold leading-tight text-fg shadow-xl lg:hidden">
        Need help?
        <br />
        Chat with us
      </span>
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#25D366] text-white shadow-[0_8px_24px_rgba(37,211,102,0.5)] transition hover:scale-105">
        <MessageCircle size={22} />
      </span>
    </a>
  );
}
