import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';

export const emailConnectionStatusSchema = z.enum(['ACTIVE', 'DISCONNECTED', 'ERROR']);
export type EmailConnectionStatus = z.infer<typeof emailConnectionStatusSchema>;

/**
 * A connected Gmail mailbox (docs/DATA_MODEL.md "email_connections",
 * docs/EMAIL_INTEGRATION.md). Deliberately has no `encryptedRefreshToken` field — same
 * omission pattern as `extensionSessionSchema` excluding `tokenHash` — this is the shape
 * returned by every route/UI read; the encrypted token never travels beyond
 * packages/database's getOwnEmailConnectionWithToken, which is called only from packages/email.
 */
export const emailConnectionSchema = z.object({
  id: uuidSchema,
  userId: uuidSchema,
  provider: z.string(),
  emailAddress: z.string().email(),
  scopes: z.array(z.string()),
  status: emailConnectionStatusSchema,
  lastSyncedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type EmailConnection = z.infer<typeof emailConnectionSchema>;
