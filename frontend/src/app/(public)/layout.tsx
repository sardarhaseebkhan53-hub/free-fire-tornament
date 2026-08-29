import { Navbar } from '@/components/navbar';
import { Footer } from '@/components/footer';
import { AdSlot } from '@/components/ad-slot';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Navbar />
      <AdSlot placement="HEADER" className="mx-auto mt-4 max-w-7xl px-4 sm:px-6" />
      <AdSlot placement="MOBILE" className="mx-auto mt-4 max-w-7xl px-4 md:hidden" />
      <main className="flex-1 pb-24 lg:pb-0">{children}</main>
      <AdSlot placement="FOOTER" className="mx-auto mb-8 max-w-7xl px-4 sm:px-6" />
      <Footer />
    </>
  );
}
