import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from './common';

export const profileLinksSchema = z.object({
  linkedin: z.string().url().nullable().optional(),
  portfolio: z.string().url().nullable().optional(),
  github: z.string().url().nullable().optional(),
  website: z.string().url().nullable().optional(),
});
export type ProfileLinks = z.infer<typeof profileLinksSchema>;

export const profileSchema = z.object({
  userId: uuidSchema,
  fullName: z.string().nullable(),
  headline: z.string().nullable(),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  location: z.string().nullable(),
  workAuthorization: z.string().nullable(),
  relocationPreference: z.string().nullable(),
  links: profileLinksSchema.default({}),
  publicSlug: z.string().nullable(),
  visibleOnPublicProfile: z.boolean().default(false),
  onboardingCompletedAt: isoDateTimeSchema.nullable(),
});
export type Profile = z.infer<typeof profileSchema>;

/** Everything a user can edit directly from /profile; userId is derived server-side. */
export const profileUpdateSchema = profileSchema
  .omit({ userId: true, onboardingCompletedAt: true })
  .partial();
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;
