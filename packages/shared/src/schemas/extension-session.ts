import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';

/**
 * A Chrome extension auth session. See docs/DATA_MODEL.md "extension_sessions" and
 * docs/EXTENSION_DESIGN.md §4. `token_hash` never appears here — this is the shape returned by
 * list/read endpoints, never the mint endpoint.
 */
export const extensionSessionSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  deviceLabel: z.string().nullable(),
  lastUsedAt: isoDateTimeSchema.nullable(),
  expiresAt: isoDateTimeSchema,
  revokedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type ExtensionSession = z.infer<typeof extensionSessionSchema>;

/**
 * Returned exactly once, at mint time, by POST /api/auth/extension-token. A distinct schema
 * from extensionSessionSchema (rather than an optional `token` field on it) so no list/read
 * code path can accidentally end up with a type that even allows a raw token to be present.
 */
export const mintedExtensionTokenSchema = extensionSessionSchema.extend({
  token: z.string().min(20),
});
export type MintedExtensionToken = z.infer<typeof mintedExtensionTokenSchema>;
