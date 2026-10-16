import type { FastifyInstance } from 'fastify';
import type { Db } from '../../db/client.js';
import { currentUser } from '../../plugins/auth.js';
import { scopeFor } from '../leads/scope.js';
import { LEAD_STATUSES } from '../status/state-machine.js';
import { listActiveFunnels, listCallCenters, listSources } from './repository.js';

// Options for the list filters of the front end (PLAN.md §6), within the user's scope.
export function registerCatalogRoutes(app: FastifyInstance, { db }: { db: Db }) {
  app.get('/api/catalog', async (request) => {
    const scope = scopeFor(currentUser(request));
    const [funnels, callCenters, sources] = await Promise.all([
      listActiveFunnels(db),
      listCallCenters(db, scope),
      listSources(db, scope),
    ]);

    // Group the flat product/funnel rows into products with their funnels.
    const products = new Map<
      string,
      { slug: string; name: string; funnels: { slug: string; name: string }[] }
    >();
    for (const row of funnels) {
      const product = products.get(row.productSlug) ?? {
        slug: row.productSlug,
        name: row.productName,
        funnels: [],
      };
      product.funnels.push({ slug: row.funnelSlug, name: row.funnelName });
      products.set(row.productSlug, product);
    }

    return {
      success: true,
      products: [...products.values()],
      call_centers: callCenters,
      sources,
      statuses: LEAD_STATUSES,
    };
  });
}
