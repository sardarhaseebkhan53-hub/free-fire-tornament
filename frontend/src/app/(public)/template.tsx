// Page-transition wrapper: Next.js remounts templates on every navigation, so
// the .page-in animation replays for each route — a fast, subtle fade-up on
// the whole website without any router JS.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-in">{children}</div>;
}
