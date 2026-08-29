// Page-transition wrapper for the authenticated app area (dashboard, wallet,
// matches, teams). Remounts on navigation → replays the fast fade-up.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-in">{children}</div>;
}
