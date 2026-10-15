import { type CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js/max';

// Returns the number in E.164 (+5511987654321) or null when it is not a real, valid number.
// A number without "+" is read as local to defaultRegion. The "max" metadata checks real
// numbering plans, not just length, so impossible numbers are rejected.
export function normalizePhone(raw: string, defaultRegion: CountryCode): string | null {
  const phone = parsePhoneNumberFromString(raw, defaultRegion);
  return phone?.isValid() ? phone.number : null;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}
