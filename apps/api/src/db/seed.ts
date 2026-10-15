import { inArray } from 'drizzle-orm';
import { parseEnv } from '../config/env.js';
import { hashPassword } from '../shared/password.js';
import { createDb, createPool, type Db } from './client.js';
import { callCenters, funnels, products, users } from './schema.js';

// DEVELOPMENT DATA ONLY. Fictitious products and known credentials, guarded by SEED_DEMO.
// Every insert is ON CONFLICT DO NOTHING, so running the seed again changes nothing.
export const DEMO_PASSWORD = 'elevate-dev-2026';

const demoProducts = [
  { slug: 'nutralean', name: 'NutraLean', funnels: ['vsl-01', 'vsl-02', 'dtc-01'] },
  { slug: 'glicofit', name: 'GlicoFit', funnels: ['vsl-01'] },
  { slug: 'sonoleve', name: 'SonoLeve', funnels: ['vsl-01'] },
];

// Inserted in this order so ids are 1, 2, 3 on a fresh database: the dispatcher tie-breaks
// by id, which gives the golden sequence A,B,C,A,A,B,A,C,B,A for weights 50/30/20.
const demoCallCenters = [
  { slug: 'cc-a', name: 'Call Center A', weight: 50, webhookSecret: 'dev-webhook-secret-cc-a' },
  { slug: 'cc-b', name: 'Call Center B', weight: 30, webhookSecret: 'dev-webhook-secret-cc-b' },
  { slug: 'cc-c', name: 'Call Center C', weight: 20, webhookSecret: 'dev-webhook-secret-cc-c' },
];

export async function seedDemo(db: Db): Promise<void> {
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  await db.transaction(async (tx) => {
    await tx
      .insert(products)
      .values(demoProducts.map(({ slug, name }) => ({ slug, name })))
      .onConflictDoNothing({ target: products.slug });
    const productRows = await tx
      .select({ id: products.id, slug: products.slug })
      .from(products)
      .where(
        inArray(
          products.slug,
          demoProducts.map((p) => p.slug),
        ),
      );
    const productIdBySlug = new Map(productRows.map((row) => [row.slug, row.id]));

    await tx
      .insert(funnels)
      .values(
        demoProducts.flatMap((product) =>
          product.funnels.map((slug) => ({
            productId: productIdBySlug.get(product.slug)!,
            slug,
            name: `${product.name} ${slug}`,
          })),
        ),
      )
      .onConflictDoNothing({ target: [funnels.productId, funnels.slug] });

    await tx
      .insert(callCenters)
      .values(demoCallCenters)
      .onConflictDoNothing({ target: callCenters.slug });
    const callCenterRows = await tx
      .select({ id: callCenters.id, slug: callCenters.slug })
      .from(callCenters)
      .where(
        inArray(
          callCenters.slug,
          demoCallCenters.map((c) => c.slug),
        ),
      );

    await tx
      .insert(users)
      .values([
        { email: 'admin@elevate.local', passwordHash, role: 'ADMIN' as const, callCenterId: null },
        ...callCenterRows.map((center) => ({
          // cc-a -> operator.a@elevate.local
          email: `operator.${center.slug.replace('cc-', '')}@elevate.local`,
          passwordHash,
          role: 'OPERATOR' as const,
          callCenterId: center.id,
        })),
      ])
      .onConflictDoNothing({ target: users.email });
  });
}

if (import.meta.main) {
  const env = parseEnv(process.env);
  if (!env.SEED_DEMO) {
    console.error('Refusing to seed: set SEED_DEMO=true (development only).');
    process.exit(1);
  }
  const pool = createPool(env.DATABASE_URL, {
    max: 1,
    onIdleClientError: (error) => console.error('idle database client error', error),
  });
  try {
    await seedDemo(createDb(pool));
    console.log('demo seed applied');
  } finally {
    await pool.end();
  }
}
