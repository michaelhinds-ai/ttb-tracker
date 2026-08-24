/**
 * shopify.mjs — minimal Admin GraphQL client.
 *
 * Only used by the VIP backfill, which needs to find everyone who already has
 * two or more orders. Everything else in this system is driven by webhooks
 * precisely so it needs no Shopify credentials at all.
 *
 * Auth is the client-credentials grant, matching how lib/mailchimp.mjs already
 * talks to Shopify: app and store in the same org, no redirect flow, no static
 * token. Reuses the env vars that are already set.
 *
 * IMPORTANT (from the project handoff): if SHOPIFY_ADMIN_TOKEN is set it
 * overrides client credentials and breaks auth. It should not exist.
 */

const STORE = process.env.SHOPIFY_STORE || 'buyspiritsdirect.myshopify.com';
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-07';

let cached = { token: null, expiresAt: 0 };

async function accessToken() {
  if (cached.token && Date.now() < cached.expiresAt - 60_000) return cached.token;

  const id = process.env.SHOPIFY_CLIENT_ID;
  const secret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!id || !secret) throw new Error('SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET are not set');

  const res = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: id, client_secret: secret, grant_type: 'client_credentials' })
  });

  if (!res.ok) {
    throw new Error(`Shopify token exchange failed: ${res.status} ${await res.text()}`);
  }

  const body = await res.json();
  cached = {
    token: body.access_token,
    expiresAt: Date.now() + (body.expires_in ? body.expires_in * 1000 : 300_000)
  };
  return cached.token;
}

export async function shopifyGraphQL(query, variables = {}) {
  const token = await accessToken();
  const res = await fetch(`https://${STORE}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({ query, variables })
  });

  const body = await res.json().catch(() => null);

  if (!res.ok) throw new Error(`Shopify GraphQL ${res.status}: ${JSON.stringify(body)}`);
  if (body?.errors?.length) {
    // A missing scope shows up here rather than as an HTTP error, and the
    // message is the only clue. Surface it verbatim.
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(body.errors)}`);
  }
  return body.data;
}

/**
 * Everyone with two or more orders.
 *
 * `orders_count:>=2` is search syntax, not a field name, so this does not
 * depend on whether the current API calls the field ordersCount or
 * numberOfOrders — a distinction that has changed between versions.
 *
 * Requires read_customers, which this app already has for the Mailchimp sync.
 */
export async function fetchRepeatCustomers({ minOrders = 2, maxPages = 60 } = {}) {
  const out = [];
  let cursor = null;
  let pages = 0;

  const query = `
    query RepeatCustomers($cursor: String, $q: String!) {
      customers(first: 250, after: $cursor, query: $q) {
        pageInfo { hasNextPage endCursor }
        nodes {
          email
          firstName
          tags
          emailMarketingConsent { marketingState }
        }
      }
    }`;

  while (pages < maxPages) {
    const data = await shopifyGraphQL(query, {
      cursor,
      q: `orders_count:>=${minOrders}`
    });

    const conn = data?.customers;
    if (!conn) break;

    for (const c of conn.nodes || []) {
      if (c.email) {
        out.push({
          email: c.email,
          firstName: c.firstName || '',
          tags: (c.tags || []).map((t) => String(t).toLowerCase()),
          marketingState: c.emailMarketingConsent?.marketingState || null
        });
      }
    }

    pages += 1;
    if (!conn.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }

  if (pages >= maxPages) {
    console.warn(`[vip] repeat-customer paging hit the ${maxPages}-page cap — list may be truncated`);
  }
  return out;
}
