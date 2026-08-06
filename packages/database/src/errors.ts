export class DatabaseError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

export function assertNoError(error: { message: string } | null, context: string): void {
  if (error) {
    throw new DatabaseError(`${context}: ${error.message}`, error);
  }
}

/**
 * Supabase's `.single()`/`.maybeSingle()` responses type `data` as `T | null` even when an
 * error would make that impossible in practice (mutually exclusive at runtime, not narrowed
 * by the type system). This asserts both: no error, and a non-null row.
 */
export function unwrapRow<T>(
  data: T | null,
  error: { message: string } | null,
  context: string,
): T {
  assertNoError(error, context);
  if (data === null) {
    throw new DatabaseError(`${context}: expected a row but got null`);
  }
  return data;
}
