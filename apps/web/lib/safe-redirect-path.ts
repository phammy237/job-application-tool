/**
 * Reduces a client-supplied post-login destination (`?next=`, `?redirectTo=`) to a same-origin
 * path, or the fallback. Callers build the final URL as `${origin}${path}`, so anything that
 * isn't a plain absolute path would change the host: `@evil.com` becomes userinfo
 * (`https://apply.mypham.space@evil.com`), `.evil.com` extends the hostname, and `//evil.com`
 * / `/\evil.com` are protocol-relative once a browser normalizes them.
 */
export function safeRedirectPath(value: unknown, fallback = '/dashboard'): string {
  if (typeof value !== 'string') return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
  // Control characters (tab/newline) are stripped by URL parsers, which can turn `/\t/evil.com`
  // back into `//evil.com`.
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  return value;
}
