import type { CountryCode } from 'libphonenumber-js/max';
import { z } from 'zod';
import { normalizeEmail, normalizePhone } from './normalize.js';

const slug = z.string().trim().toLowerCase().min(1).max(64);
const utmValue = z.string().trim().max(128).optional();

// Validated and normalized lead, as the rest of the code sees it.
export interface LeadInput {
  name: string;
  email: string;
  phoneE164: string;
  product: string;
  funnel: string;
  source: string;
  campaign?: string;
  affiliateCode?: string;
  utm?: { source?: string; medium?: string; campaign?: string; content?: string; term?: string };
}

// PLAN.md §7. Unknown top-level keys are dropped (z.object strips them): a landing page
// sending an extra field must not lose the lead. utm is strict because the challenge asks
// for "correct structure" there.
export function buildLeadInputSchema(defaultRegion: CountryCode) {
  return z
    .object({
      name: z.string().trim().min(2).max(120),
      email: z.string().trim().max(254).pipe(z.email()).transform(normalizeEmail),
      phone: z
        .string()
        .max(32)
        .transform((raw, ctx) => {
          const e164 = normalizePhone(raw, defaultRegion);
          if (!e164) {
            ctx.addIssue({ code: 'custom', message: 'invalid_phone' });
            return z.NEVER;
          }
          return e164;
        }),
      product: slug,
      funnel: slug,
      source: z.string().trim().toLowerCase().min(1).max(64),
      campaign: z.string().trim().max(128).optional(),
      // A JSON number is rejected on purpose: affiliate codes are strings ("007" != 7).
      affiliate_id: z.string().trim().min(1).max(64).optional(),
      utm: z
        .strictObject({
          source: utmValue,
          medium: utmValue,
          campaign: utmValue,
          content: utmValue,
          term: utmValue,
        })
        .optional(),
    })
    .transform(({ phone, affiliate_id, ...rest }): LeadInput => ({
      ...rest,
      phoneE164: phone,
      ...(affiliate_id !== undefined && { affiliateCode: affiliate_id }),
    }));
}

export interface ValidationDetail {
  field: string;
  issue: string;
}

// Zod issues -> the public error format ({ field, issue }). Custom issues carry their code
// in `message` (e.g. invalid_phone); the rest use Zod's own code (too_small, invalid_type...).
export function toValidationDetails(error: z.ZodError): ValidationDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.'),
    issue: issue.code === 'custom' ? issue.message : issue.code,
  }));
}
