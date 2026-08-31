const metaCache = new Map();
const inflight = new Map();
let groupsCache = { ts: 0, data: null };
let backoffUntil = 0;
let backoffAttempts = 0;

const RATE_MARKERS = /rate.?overlimit|over.?limit|429|too many requests|rate limit/i;

export function isRateLimited() {
  return Date.now() < backoffUntil;
}

export function rateLimitEndsAt() {
  return backoffUntil;
}

function noteRateLimit(err) {
  const msg = `${err?.message || ''} ${err?.statusCode || ''}`;
  if (!RATE_MARKERS.test(msg)) return false;
  const base = 30000 * Math.pow(2, Math.min(backoffAttempts, 5));
  backoffUntil = Date.now() + base;
  backoffAttempts += 1;
  console.log(`[groupCache] rate-overlimit detected; backing off calls for ${Math.round(base / 1000)}s`);
  return true;
}

export function markRateLimit() {
  backoffUntil = Date.now() + 60000;
  backoffAttempts += 1;
}

function resetBackoff() {
  if (!backoffUntil) return;
  if (Date.now() >= backoffUntil && backoffAttempts > 0) {
    backoffAttempts = 0;
  }
}

const TTL_META = 60000;
const TTL_GROUPS = 120000;

export async function fetchAllGroups(sock, { force = false } = {}) {
  resetBackoff();
  if (!force && groupsCache.data && Date.now() - groupsCache.ts < TTL_GROUPS) {
    return groupsCache.data;
  }
  if (force) groupsCache = { ts: 0, data: null };
  if (isRateLimited()) {
    const err = new Error(`rate-overlimit (cooling down until ${new Date(backoffUntil).toLocaleTimeString()})`);
    err.isRateLimited = true;
    throw err;
  }
  if (inflight.has('__all__')) return inflight.get('__all__');
  const prom = sock
    .groupFetchAllParticipating()
    .then((groups) => {
      groupsCache = { ts: Date.now(), data: groups || {} };
      return groupsCache.data;
    })
    .catch((e) => {
      noteRateLimit(e);
      throw e;
    })
    .finally(() => inflight.delete('__all__'));
  inflight.set('__all__', prom);
  return prom;
}

export async function getGroupMetadata(sock, groupJid, { ttl = TTL_META, fresh = false } = {}) {
  if (!groupJid) return null;
  resetBackoff();
  if (!fresh) {
    const cached = metaCache.get(groupJid);
    if (cached && Date.now() - cached.ts < ttl) return cached.meta;
  }
  if (isRateLimited()) {
    const err = new Error(`rate-overlimit (cooling down until ${new Date(backoffUntil).toLocaleTimeString()})`);
    err.isRateLimited = true;
    throw err;
  }
  if (inflight.has(groupJid)) return inflight.get(groupJid);
  const prom = sock
    .groupMetadata(groupJid)
    .then((meta) => {
      metaCache.set(groupJid, { ts: Date.now(), meta });
      return meta;
    })
    .catch((e) => {
      noteRateLimit(e);
      throw e;
    })
    .finally(() => inflight.delete(groupJid));
  inflight.set(groupJid, prom);
  return prom;
}

export async function getAllGroupIds(sock, { force = false } = {}) {
  const groups = await fetchAllGroups(sock, { force });
  return Object.keys(groups || {});
}

export async function getGroupIds(sock, { force = false } = {}) {
  return getAllGroupIds(sock, { force });
}

export function clearCache() {
  metaCache.clear();
  groupsCache = { ts: 0, data: null };
}
