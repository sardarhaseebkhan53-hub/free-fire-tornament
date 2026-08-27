import { Navbar } from '@/components/navbar';
import { Footer } from '@/components/footer';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Navbar />
      <main className="flex-1 pb-24 lg:pb-0">{children}</main>
      <Footer />
    </>
  );
}
