import Link from 'next/link';
import { requireUser } from '../../lib/auth';
import { AppNav } from './app-nav';
import { SignOutButton } from './sign-out-button';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-border bg-card flex w-full shrink-0 flex-col border-b md:w-56 md:border-r md:border-b-0">
        <div className="px-4 py-5">
          <Link href="/dashboard" className="text-lg font-semibold tracking-tight">
            Career OS
          </Link>
        </div>
        <AppNav />
        <div className="border-border border-t px-4 py-4">
          <p className="text-muted-foreground truncate text-xs">{user.email}</p>
          <SignOutButton />
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
