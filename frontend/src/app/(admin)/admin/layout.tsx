import { AdminShell } from '@/components/admin/admin-shell';

// Admin control center — RBAC-gated shell (design 26). All data is fetched
// client-side with the admin's token; the API enforces ADMIN+ on every route.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
