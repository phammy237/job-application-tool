// Imported from the specific file, not the package barrel (@career-os/database) — middleware
// runs on the Edge runtime, which can't bundle node:crypto (pulled in transitively via the
// barrel by packages/database/src/crypto/extension-token.ts). This file alone has no such
// dependency.
import { createSupabaseServerClient } from '@career-os/database/src/client/server';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Refreshes the Supabase session on every request and gates the authenticated route group.
 * This is the enforcement point referenced in docs/ARCHITECTURE.md §5: a public page must
 * never reach a private data fetch, and this runs before any page code does.
 *
 * Route protection here is a first layer, not the only one — every server action and query
 * in packages/database independently re-derives user_id from the verified session and RLS
 * enforces the database boundary regardless of what middleware decided. See CLAUDE.md.
 */
const PROTECTED_PREFIXES = [
  '/dashboard',
  '/profile',
  '/applications',
  '/resumes',
  '/settings',
  '/extension-connect',
];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createSupabaseServerClient({
    getAll() {
      return request.cookies.getAll();
    },
    setAll(cookiesToSet) {
      for (const { name, value } of cookiesToSet) {
        request.cookies.set(name, value);
      }
      response = NextResponse.next({ request });
      for (const { name, value, options } of cookiesToSet) {
        response.cookies.set(name, value, options);
      }
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isProtectedRoute = PROTECTED_PREFIXES.some((prefix) =>
    request.nextUrl.pathname.startsWith(prefix),
  );

  if (isProtectedRoute && !user) {
    const redirectUrl = new URL('/login', request.url);
    redirectUrl.searchParams.set('redirectTo', request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image (Next internals)
     * - favicon.ico and other static assets
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
