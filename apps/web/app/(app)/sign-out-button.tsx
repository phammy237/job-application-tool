'use client';

import { signOut } from '../(public)/actions';

export function SignOutButton() {
  return (
    <form action={signOut}>
      <button
        type="submit"
        className="text-muted-foreground hover:text-foreground mt-2 text-xs font-medium"
      >
        Sign out
      </button>
    </form>
  );
}
