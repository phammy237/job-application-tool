/**
 * Typed GitHub client errors. Messages are fixed strings plus the request path — never the
 * Authorization header, token, or raw upstream body (CLAUDE.md "Secrets").
 */
export class GithubApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'GithubApiError';
  }
}

export class AuthError extends GithubApiError {
  constructor(path: string) {
    super(`GitHub rejected the credentials for ${path}`, 401);
    this.name = 'AuthError';
  }
}

export class NotFoundError extends GithubApiError {
  constructor(path: string, status = 404) {
    super(`GitHub resource not found or not accessible: ${path}`, status);
    this.name = 'NotFoundError';
  }
}

export class RateLimitError extends GithubApiError {
  constructor(
    public readonly resetAt: Date | null,
    public readonly secondary = false,
  ) {
    super(
      secondary ? 'GitHub secondary rate limit reached' : 'GitHub rate limit exhausted',
      429,
    );
    this.name = 'RateLimitError';
  }
}

const TOKEN_PATTERN =
  /(gh[pousr]_[A-Za-z0-9]{10,}|github_pat_[A-Za-z0-9_]{10,}|Bearer\s+\S+)/g;

/** Produces a short, user-safe message for persisting in `github_repositories.sync_error`. */
export function sanitizeErrorMessage(error: unknown): string {
  let message: string;
  if (error instanceof RateLimitError)
    message = 'GitHub rate limit reached; will retry later';
  else if (error instanceof AuthError) message = 'GitHub credentials were rejected';
  else if (error instanceof NotFoundError) message = 'Repository data was not accessible';
  else if (error instanceof GithubApiError) message = error.message;
  else message = 'Unexpected error while syncing repository';
  return message.replace(TOKEN_PATTERN, '[redacted]').slice(0, 200);
}
