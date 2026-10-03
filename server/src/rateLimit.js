// rateLimit.js — "at most N requests per minute from one IP address".
//
// Used on /join and /claim, where someone could otherwise try invite codes
// over and over until one works.
//
// It's a simple "fixed window" counter kept in memory: each IP gets a count
// that starts when its first request arrives and resets one window later.
// Memory is fine here because the server runs as a single process. (If it
// ever ran on several machines, each would count separately.)

/**
 * Make an Express middleware that allows `max` requests per `windowMs`
 * milliseconds from each IP. Extra requests get a 429 reply.
 */
export function rateLimit({ max, windowMs }) {
  // ip → { count, resetAt }
  const hits = new Map();

  return (req, res, next) => {
    const now = Date.now();

    // Now and then, forget IPs whose window has ended, so the Map can't grow
    // forever. (Checking only when it's big keeps normal requests cheap.)
    if (hits.size > 10000) {
      for (const [ip, entry] of hits) {
        if (entry.resetAt <= now) hits.delete(ip);
      }
    }

    let entry = hits.get(req.ip);
    if (!entry || entry.resetAt <= now) {
      // First request from this IP, or its last window is over: start fresh.
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(req.ip, entry);
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
