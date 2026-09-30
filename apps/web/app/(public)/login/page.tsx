import Link from 'next/link';
import { safeRedirectPath } from '../../../lib/safe-redirect-path';
import { LoginForm } from './login-form';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ confirmEmail?: string; redirectTo?: string }>;
}) {
  const { confirmEmail, redirectTo } = await searchParams;

  return (
    <div className="mx-auto max-w-sm px-6 py-20">
      <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
      {confirmEmail ? (
        <p className="bg-accent text-accent-foreground mt-3 rounded-md px-3 py-2 text-sm">
          Check your email to confirm your account before logging in.
        </p>
      ) : null}
      <div className="mt-6">
        <LoginForm redirectTo={safeRedirectPath(redirectTo)} />
      </div>
      <p className="text-muted-foreground mt-6 text-sm">
        No account yet?{' '}
        <Link href="/join" className="text-primary hover:underline">
          Join
        </Link>
      </p>
    </div>
  );
}
