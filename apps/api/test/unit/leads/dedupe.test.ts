import { describe, expect, it } from 'vitest';
import { buildDedupeKey, buildRequestHash } from '../../../src/modules/leads/dedupe.js';
import type { LeadInput } from '../../../src/modules/leads/schema.js';

const lead: LeadInput = {
  name: 'Ana Souza',
  email: 'ana@example.com',
  phoneE164: '+5511987654321',
  product: 'nutralean',
  funnel: 'vsl-01',
  source: 'facebook',
};

const sha256Hex = /^[0-9a-f]{64}$/;

describe('buildDedupeKey', () => {
  it('uses the Idempotency-Key when present', () => {
    const key = buildDedupeKey(lead, 'order-42');

    expect(key.startsWith('idem:')).toBe(true);
    expect(key.slice('idem:'.length)).toMatch(sha256Hex);
    expect(buildDedupeKey({ ...lead, name: 'Other' }, 'order-42')).toBe(key);
  });

  it('falls back to a fingerprint of product, funnel, email and phone', () => {
    const key = buildDedupeKey(lead, undefined);

    expect(key.startsWith('fp:')).toBe(true);
    expect(key.slice('fp:'.length)).toMatch(sha256Hex);
  });

  it('gives the same fingerprint when only non-identifying fields change', () => {
    expect(buildDedupeKey({ ...lead, name: 'Ana S.', source: 'google' }, undefined)).toBe(
      buildDedupeKey(lead, undefined),
    );
  });

  it.each([
    ['product', { product: 'glicofit' }],
    ['funnel', { funnel: 'vsl-02' }],
    ['email', { email: 'other@example.com' }],
    ['phone', { phoneE164: '+5511900000000' }],
  ])('gives a different fingerprint when %s changes', (_field, change) => {
    expect(buildDedupeKey({ ...lead, ...change }, undefined)).not.toBe(
      buildDedupeKey(lead, undefined),
    );
  });

  it('cannot be forged by a separator inside a field', () => {
    const a = buildDedupeKey({ ...lead, product: 'a|b', funnel: 'c' }, undefined);
    const b = buildDedupeKey({ ...lead, product: 'a', funnel: 'b|c' }, undefined);

    expect(a).not.toBe(b);
  });
});

describe('buildRequestHash', () => {
  it('ignores key order', () => {
    const reordered: LeadInput = {
      source: lead.source,
      funnel: lead.funnel,
      product: lead.product,
      phoneE164: lead.phoneE164,
      email: lead.email,
      name: lead.name,
    };

    expect(buildRequestHash(reordered)).toBe(buildRequestHash(lead));
  });

  it('ignores key order inside utm too', () => {
    expect(buildRequestHash({ ...lead, utm: { source: 'fb', medium: 'cpc' } })).toBe(
      buildRequestHash({ ...lead, utm: { medium: 'cpc', source: 'fb' } }),
    );
  });

  it('changes when any value changes', () => {
    expect(buildRequestHash({ ...lead, campaign: 'x' })).not.toBe(buildRequestHash(lead));
  });
});
