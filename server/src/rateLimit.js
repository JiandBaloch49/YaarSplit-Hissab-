// rateLimit.js — "at most N requests per minute from one caller".
//
// Used where someone could otherwise hammer the server: making accounts,
// making invites, and accepting/looking at invites (guessing link codes).
//
// It's a simple "fixed window" counter kept in memory: each caller gets a
// count that starts when its first request arrives and resets one window
// later. Memory is fine here because the server runs as a single process.
// (If it ever ran on several machines, each would count separately.)

// Default "who is calling": the IP address. Routes that run after
// requireAccount use the account instead (see byAccount), so friends behind
// the same Wi-Fi don't share one limit.
const byIp = (req) => req.ip;

/** Key function: count per signed-in account. */
export const byAccount = (req) => `account:${req.account._id}`;

/**
 * Make an Express middleware that allows `max` requests per `windowMs`
 * milliseconds from each caller. Extra requests get a 429 reply.
 * `key(req)` says who the caller is (default: their IP).
 */
export function rateLimit({ max, windowMs, key = byIp }) {
  // caller → { count, resetAt }
  const hits = new Map();

  return (req, res, next) => {
    const now = Date.now();

    // Now and then, forget callers whose window has ended, so the Map can't
    // grow forever. (Checking only when it's big keeps normal requests cheap.)
    if (hits.size > 10000) {
      for (const [caller, entry] of hits) {
        if (entry.resetAt <= now) hits.delete(caller);
      }
    }

    const caller = key(req);
    let entry = hits.get(caller);
    if (!entry || entry.resetAt <= now) {
      // First request from this caller, or its last window is over: start fresh.
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(caller, entry);
    }
    entry.count++;

    if (entry.count > max) {
      // Tell the client how many seconds to wait (standard Retry-After header).
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'Too many tries. Wait a minute and try again.' });
    }
    next();
  };
}
