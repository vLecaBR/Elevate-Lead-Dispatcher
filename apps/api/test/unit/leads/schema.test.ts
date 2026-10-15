import { describe, expect, it } from 'vitest';
import { buildLeadInputSchema, toValidationDetails } from '../../../src/modules/leads/schema.js';

const schema = buildLeadInputSchema('BR');

const validBody = {
  name: '  Ana Souza ',
  email: ' Ana.Souza@Example.COM ',
  phone: '(11) 98765-4321',
  product: 'nutralean',
  funnel: 'vsl-01',
  source: 'Facebook',
  campaign: 'black-friday',
  affiliate_id: 'aff-123',
  utm: { source: 'fb', medium: 'cpc', campaign: 'bf', content: 'video-1', term: 'emagrecer' },
};

function issuesOf(body: unknown) {
  const result = schema.safeParse(body);
  if (result.success) {
    throw new Error('expected validation to fail');
  }
  return toValidationDetails(result.error);
}

describe('lead input schema: normalization', () => {
  it('normalizes a valid lead', () => {
    expect(schema.parse(validBody)).toEqual({
      name: 'Ana Souza',
      email: 'ana.souza@example.com',
      phoneE164: '+5511987654321',
      product: 'nutralean',
      funnel: 'vsl-01',
      source: 'facebook',
      campaign: 'black-friday',
      affiliateCode: 'aff-123',
      utm: { source: 'fb', medium: 'cpc', campaign: 'bf', content: 'video-1', term: 'emagrecer' },
    });
  });

  it('accepts the minimum set of fields', () => {
    const { campaign: _c, affiliate_id: _a, utm: _u, ...minimal } = validBody;

    expect(schema.parse(minimal)).toEqual({
      name: 'Ana Souza',
      email: 'ana.souza@example.com',
      phoneE164: '+5511987654321',
      product: 'nutralean',
      funnel: 'vsl-01',
      source: 'facebook',
    });
  });

  it('keeps a phone that already has a country code', () => {
    expect(schema.parse({ ...validBody, phone: '+1 202 555 0143' }).phoneE164).toBe('+12025550143');
  });

  it('drops unknown top-level fields (landing pages evolve)', () => {
    expect(schema.parse({ ...validBody, gclid: 'abc' })).not.toHaveProperty('gclid');
  });
});

describe('lead input schema: rejections', () => {
  it.each([
    ['name too short', { name: 'A' }, 'name', 'too_small'],
    ['name too long', { name: 'A'.repeat(121) }, 'name', 'too_big'],
    ['invalid email', { email: 'not-an-email' }, 'email', 'invalid_format'],
    ['email too long', { email: `${'a'.repeat(250)}@x.com` }, 'email', 'too_big'],
    ['phone that is not a number', { phone: 'call me' }, 'phone', 'invalid_phone'],
    ['impossible phone number', { phone: '+55 11 1234' }, 'phone', 'invalid_phone'],
    ['missing source', { source: undefined }, 'source', 'invalid_type'],
    ['source too long', { source: 'a'.repeat(65) }, 'source', 'too_big'],
    ['campaign too long', { campaign: 'a'.repeat(129) }, 'campaign', 'too_big'],
    ['numeric affiliate id', { affiliate_id: 123 }, 'affiliate_id', 'invalid_type'],
    ['affiliate id too long', { affiliate_id: 'a'.repeat(65) }, 'affiliate_id', 'too_big'],
    ['unknown utm key', { utm: { source: 'fb', foo: 'x' } }, 'utm', 'unrecognized_keys'],
    ['utm value too long', { utm: { source: 'a'.repeat(129) } }, 'utm.source', 'too_big'],
    ['missing product', { product: undefined }, 'product', 'invalid_type'],
    ['empty funnel', { funnel: '' }, 'funnel', 'too_small'],
  ])('rejects %s', (_label, override, field, issue) => {
    expect(issuesOf({ ...validBody, ...override })).toContainEqual({ field, issue });
  });

  it('rejects a body that is not an object', () => {
    expect(issuesOf('lead')).toEqual([{ field: '', issue: 'invalid_type' }]);
  });

  it('reports every invalid field at once', () => {
    const fields = issuesOf({ ...validBody, name: '', email: 'x' }).map((d) => d.field);

    expect(fields).toEqual(expect.arrayContaining(['name', 'email']));
  });
});
