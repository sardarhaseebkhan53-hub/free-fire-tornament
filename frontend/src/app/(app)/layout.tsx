import { UserShell } from '@/components/user/user-shell';

// User app (dashboard, wallet, matches, teams) — sidebar shell per design 12+.
// Route group keeps public URLs (/wallet, /dashboard…) unchanged.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <UserShell>{children}</UserShell>;
}
