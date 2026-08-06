import Link from 'next/link';

/**
 * docs/ARCHITECTURE.md §5: the public route group must never fetch a user-owned table.
 * Nothing under app/(public) should import from packages/database's query layer except the
 * feature-flag check (feature_flags is explicitly not user-owned).
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-border border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Career OS
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <a
              href="https://mypham.space"
              className="text-muted-foreground hover:text-foreground"
            >
              mypham.space
            </a>
            <Link href="/login" className="text-muted-foreground hover:text-foreground">
              Log in
            </Link>
            <Link
              href="/join"
              className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-1.5"
            >
              Join
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-border border-t">
        <div className="text-muted-foreground mx-auto flex max-w-5xl flex-col items-center gap-2 px-6 py-8 text-sm sm:flex-row sm:justify-between">
          <p>Built by My Pham</p>
          <a href="https://mypham.space" className="hover:text-foreground">
            mypham.space
          </a>
        </div>
      </footer>
    </div>
  );
}
