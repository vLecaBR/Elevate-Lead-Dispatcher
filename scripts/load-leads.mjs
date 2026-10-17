// Fires N distinct leads at the API at the same time and reports throughput and the
// resulting split per call center. Demo / measurement tool, not part of the test suite.
//
//   npm run load:leads -- 200
//
// Env: API_URL (default http://localhost:3001), DATABASE_URL (to read the split).
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const total = Number(process.argv[2] ?? 100);
const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const databaseUrl = process.env.DATABASE_URL;

if (!Number.isInteger(total) || total < 1) {
  console.error('Usage: npm run load:leads -- <number of leads>');
  process.exit(1);
}

const runId = randomUUID().slice(0, 8);

function lead(i) {
  return {
    name: `Load Test ${i}`,
    email: `load-${runId}-${i}@example.com`,
    phone: '+5511987654321',
    product: 'nutralean',
    funnel: 'vsl-01',
    source: 'load-test',
    campaign: runId,
  };
}

async function post(body) {
  try {
    const response = await fetch(`${apiUrl}/api/leads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return response.status;
  } catch {
    return 'network_error';
  }
}

const t0 = performance.now();
const statuses = await Promise.all(Array.from({ length: total }, (_, i) => post(lead(i))));
const seconds = (performance.now() - t0) / 1000;

const byStatus = {};
for (const status of statuses) {
  byStatus[status] = (byStatus[status] ?? 0) + 1;
}

console.log(`run ${runId}: ${total} leads against ${apiUrl}`);
console.log(`time: ${seconds.toFixed(2)} s, throughput: ${(total / seconds).toFixed(1)} leads/s`);
console.log('HTTP status:', byStatus);
if (byStatus[429]) {
  // The intake is rate limited per IP (60/min by default) and this script is one IP.
  console.warn(
    `\n${byStatus[429]} requests were rate limited (429). For a load demo, start the stack with` +
      ' RATE_LIMIT_LEADS_PER_MIN raised, e.g. RATE_LIMIT_LEADS_PER_MIN=100000 in .env.\n',
  );
}

if (!databaseUrl) {
  console.log('DATABASE_URL not set: skipping the split per call center.');
  process.exit(0);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  // Only leads from this run (campaign = runId), so earlier data does not skew the split.
  const { rows } = await client.query(
    `SELECT c.slug, c.weight, count(d.id)::int AS leads
     FROM call_centers c
     LEFT JOIN distributions d ON d.call_center_id = c.id
       AND d.lead_id IN (SELECT id FROM leads WHERE campaign = $1)
     GROUP BY c.slug, c.weight ORDER BY c.slug`,
    [runId],
  );
  const distributed = rows.reduce((sum, row) => sum + row.leads, 0);
  console.log('split per call center:');
  for (const row of rows) {
    const share = distributed ? ((100 * row.leads) / distributed).toFixed(1) : '0.0';
    console.log(`  ${row.slug} (weight ${row.weight}): ${row.leads} (${share}%)`);
  }
} finally {
  await client.end();
}
