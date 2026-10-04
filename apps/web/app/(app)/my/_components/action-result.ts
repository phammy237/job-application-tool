export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

export function okResult(message: string): ActionResult {
  return { ok: true, message };
}

export function errorResult(message: string): ActionResult {
  return { ok: false, message };
}

/** Maps an unknown thrown value to a user-safe message (never leaks internals verbatim). */
export function toErrorResult(error: unknown, fallback: string): ActionResult {
  if (error instanceof Error && /23503|does not exist|not found/i.test(error.message)) {
    return errorResult('That item no longer exists. Refresh and try again.');
  }
  return errorResult(fallback);
}
