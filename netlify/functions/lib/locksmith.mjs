/**
 * locksmith.mjs — work out which products are gated by Locksmith.
 *
 * Needed so new-drop announcements never point customers at a bottle they
 * cannot open. Nothing is more annoying than an email about a release that
 * dead-ends on a lock screen.
 *
 * Locksmith stores its locks in Lightward's own database, NOT in Shopify
 * metafields — there is no `locksmith` namespace to read, and anyone who tells
 * you otherwise is guessing. What Locksmith does provide is a merchant-
 * authenticated Admin API. Generate a token once in Locksmith's settings
 * ("Add access token", near the bottom of the settings area) and set:
 *
 *   LOCKSMITH_ACCESS_TOKEN
 *   LOCKSMITH_SHOP_DOMAIN   (defaults to SHOPIFY_STORE)
 *
 * Docs: https://www.locksmith.guide/developer-tools/locksmith-admin-api
 */

const API_BASE = 'https://uselocksmith.com/api/unstable';

/**
 * Fetch every lock. Returns [] and logs if Locksmith is not configured —
 * callers then fall back to the manual `do-not-announce` tag, so a missing
 * token degrades to "announce nothing you did not explicitly approve" rather
 * than "announce everything including the gated ones".
 */
export async function fetchLocks() {
  const token = process.env.LOCKSMITH_ACCESS_TOKEN;
  const shop = process.env.LOCKSMITH_SHOP_DOMAIN || process.env.SHOPIFY_STORE;

  if (!token || !shop) {
    console.warn('[locksmith] no LOCKSMITH_ACCESS_TOKEN / shop domain — cannot read locks');
    return null;
  }

  const res = await fetch(`${API_BASE}/locks.json`, {
    headers: {
      'x-shopify-shop-domain': shop,
      'x-locksmith-access-token': token,
      Accept: 'application/json'
    }
  });

  if (!res.ok) {
    throw new Error(`Locksmith /locks.json -> ${res.status} ${await res.text()}`);
  }

  const body = await res.json();
  return Array.isArray(body) ? body : body?.locks || [];
}

/**
 * Reduce locks to something a caller can test against.
 *
 * Returns:
 *   {
 *     wholeShopLocked: boolean,
 *     productIds:      Set<string>,   // directly locked products
 *     collectionIds:   Set<string>,   // locked collections — see caveat
 *     unresolvable:    number         // vendor / custom-Liquid locks
 *   }
 *
 * CAVEAT worth testing on the store before trusting it: Locksmith's docs do not
 * state whether locking a COLLECTION also gates the product pages of its
 * members, or only the collection page itself. Until that is confirmed, treat a
 * locked collection as a reason to skip its products — over-caution here costs
 * you one announcement, under-caution emails people a dead link.
 *
 * Vendor locks and custom-Liquid locks cannot be expanded by any external
 * system (Liquid locks are arbitrary code). Those are counted and reported so a
 * human knows the answer is incomplete rather than silently wrong.
 */
export function summariseLocks(locks) {
  const summary = {
    wholeShopLocked: false,
    productIds: new Set(),
    collectionIds: new Set(),
    unresolvable: 0
  };

  for (const lock of locks || []) {
    if (lock?.enabled === false) continue;

    for (const resource of lock?.resources || []) {
      const type = resource?.resource_type || lock?.resource_type;
      const id = resource?.resource_id != null ? String(resource.resource_id) : null;

      switch (type) {
        case 'shop':
          summary.wholeShopLocked = true;
          break;
        case 'product':
          if (id) summary.productIds.add(id);
          break;
        case 'custom_collection':
        case 'smart_collection':
          if (id) summary.collectionIds.add(id);
          break;
        default:
          summary.unresolvable += 1;
      }
    }
  }

  return summary;
}

/**
 * Convenience: is this product safe to announce?
 *
 * `product` needs { id, tags[], collectionIds[] }.
 *
 * The `do-not-announce` tag is checked first and works with or without
 * Locksmith configured. It is the escape hatch for "this exists but I do not
 * want it in an email" — allocation-only bottles, staff picks, trade samples —
 * which is a business decision Locksmith does not model.
 */
export function isAnnounceable(product, summary) {
  const tags = (product.tags || []).map((t) => String(t).toLowerCase());
  if (tags.includes('do-not-announce')) return { ok: false, reason: 'do-not-announce tag' };

  if (!summary) return { ok: false, reason: 'lock state unknown — refusing to guess' };
  if (summary.wholeShopLocked) return { ok: false, reason: 'entire shop is locked' };

  const id = String(product.id).replace(/^gid:\/\/shopify\/Product\//, '');
  if (summary.productIds.has(id)) return { ok: false, reason: 'product is Locksmith-gated' };

  for (const cid of product.collectionIds || []) {
    const clean = String(cid).replace(/^gid:\/\/shopify\/Collection\//, '');
    if (summary.collectionIds.has(clean)) {
      return { ok: false, reason: `in Locksmith-gated collection ${clean}` };
    }
  }

  return { ok: true };
}
