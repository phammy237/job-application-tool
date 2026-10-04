import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .transform((v) => (v.length ? v : null));

export const portfolioSettingsFormSchema = z.object({
  enabled: z.boolean(),
  displayName: optionalText(80),
  headline: optionalText(160),
});

/** Parses FormData-like input; a checked checkbox posts "on". */
export function parsePortfolioSettingsForm(data: {
  get(name: string): FormDataEntryValue | null;
}) {
  return portfolioSettingsFormSchema.safeParse({
    enabled: data.get('enabled') === 'on',
    displayName: String(data.get('displayName') ?? ''),
    headline: String(data.get('headline') ?? ''),
  });
}
