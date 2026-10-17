// Signs and sends call center webhooks, to demo HMAC, dedupe and out-of-order handling.
//
//   npm run webhook:send -- --status contacted            one event
//   npm run webhook:send -- --status sale --duplicate     same event twice -> "duplicate"
//   npm run webhook:send -- --out-of-order                sale (t2) first, then contacted (t1)
//
// Options: --lead <uuid> (default: latest lead of the call center, needs DATABASE_URL),
// --cc <slug> (default cc-a), --secret <s> (default: the demo seed's dev secret),
// --external-id <id>. Env: API_URL (default http://localhost:3001), DATABASE_URL.
import { createHmac } from 'node:crypto';
import { parseArgs } from 'node:util';
import pg from 'pg';

const { values: args } = parseArgs({
  options: {
    status: { type: 'string' },
    lead: { type: 'string' },
    cc: { type: 'string', default: 'cc-a' },
    secret: { type: 'string' },
    'external-id': { type: 'string' },
    duplicate: { type: 'boolean', default: false },
    'out-of-order': { type: 'boolean', default: false },
  },
});

const apiUrl = process.env.API_URL ?? 'http://localhost:3001';
const databaseUrl = process.env.DATABASE_URL;

if (!args.status && !args['out-of-order']) {
  console.error('Usage: npm run webhook:send -- --status <status> [--duplicate] | --out-of-order');
  process.exit(1);
}

let secret = args.secret;
if (!secret) {
  secret = `dev-webhook-secret-${args.cc}`;
  console.log(`(using the demo seed's development secret for ${args.cc})`);
}

const db = databaseUrl ? new pg.Client({ connectionString: databaseUrl }) : null;
await db?.connect();

try {
  const leadId = args.lead ?? (await latestLeadOf(args.cc));
  console.log(`lead ${leadId} via ${args.cc}`);

  // Event times just after the lead was created (when known), so the history reads in a
  // natural order: new -> contacted -> sale.
  const base = (await leadCreatedAt(leadId)) ?? new Date(Date.now() - 60_000);
  const secondsAfterLead = (s) => new Date(base.getTime() + s * 1000).toISOString();
  const externalId = args['external-id'];

  if (args['out-of-order']) {
    // Delivered in the wrong order: the later event (sale) arrives first.
    await send({
      lead_id: leadId,
      status: 'sale',
      timestamp: secondsAfterLead(2),
      external_id: externalId,
    });
    await send({
      lead_id: leadId,
      status: 'contacted',
      timestamp: secondsAfterLead(1),
      external_id: externalId,
    });
  } else {
    const body = {
      lead_id: leadId,
      status: args.status,
      timestamp: new Date().toISOString(),
      external_id: externalId,
    };
    await send(body);
    if (args.duplicate) {
      await send(body); // provider retry: same event, re-signed with a fresh timestamp
    }
  }

  await printLead(leadId);
} finally {
  await db?.end();
}

async function send(body) {
  const raw = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = `sha256=${createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex')}`;
  const response = await fetch(`${apiUrl}/api/webhooks/callcenter`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-callcenter-id': args.cc,
      'x-elevate-timestamp': timestamp,
      'x-elevate-signature': signature,
    },
    body: raw,
  });
  console.log(`-> ${body.status} @ ${body.timestamp}: ${response.status} ${await response.text()}`);
}

async function latestLeadOf(slug) {
  if (!db) {
    console.error('Pass --lead <uuid> or set DATABASE_URL to pick the latest lead.');
    process.exit(1);
  }
  const { rows } = await db.query(
    `SELECT l.id FROM leads l JOIN call_centers c ON c.id = l.call_center_id
     WHERE c.slug = $1 ORDER BY l.created_at DESC LIMIT 1`,
    [slug],
  );
  if (!rows[0]) {
    console.error(`No lead dispatched to ${slug} yet (try npm run load:leads first).`);
    process.exit(1);
  }
  return rows[0].id;
}

async function leadCreatedAt(leadId) {
  if (!db) {
    return null;
  }
  const { rows } = await db.query('SELECT created_at FROM leads WHERE id = $1', [leadId]);
  return rows[0]?.created_at ?? null;
}

async function printLead(leadId) {
  if (!db) {
    return;
  }
  const { rows } = await db.query(
    `SELECT l.status, array_agg(e.status::text || ' @ ' || to_char(e.event_ts, 'HH24:MI:SS') ORDER BY e.event_ts, e.id) AS history
     FROM leads l JOIN lead_status_events e ON e.lead_id = l.id
     WHERE l.id = $1 GROUP BY l.status`,
    [leadId],
  );
  console.log(`final status: ${rows[0].status}`);
  console.log(`history (event time order): ${rows[0].history.join(' -> ')}`);
}
