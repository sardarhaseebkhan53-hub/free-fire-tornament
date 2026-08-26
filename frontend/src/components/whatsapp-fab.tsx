// Floating WhatsApp support button — configurable number from admin settings.
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
      title="Need help? Chat with us"
      className="fixed bottom-20 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-success text-white shadow-[0_8px_24px_rgba(16,185,129,0.45)] transition hover:scale-105 lg:bottom-6 lg:right-6"
    >
      <MessageCircle size={22} />
    </a>
  );
}
