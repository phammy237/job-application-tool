import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;

/**
 * Lazy singleton — constructed on first use, not at import time, so this package can be
 * imported by tooling (typecheck, tests that never call the API) without ANTHROPIC_API_KEY
 * set. Reads the key from the environment; never accepts one as a parameter (CLAUDE.md:
 * ANTHROPIC_API_KEY must never reach client-side code — this package is server-only by
 * construction, so the only sanctioned source is process.env).
 */
export function getAnthropicClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}
