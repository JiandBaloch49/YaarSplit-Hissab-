// app.js — builds the Express app from the route files.
//
// It only builds the app; it doesn't connect to MongoDB or start listening.
// index.js does that for the real server, and the tests do it with an
// in-memory MongoDB. Keeping them apart is what makes the tests possible.
//
// Where the endpoints live:
//   routes/accounts.js   POST /accounts, GET /me, GET /me/invites
//   routes/groups.js     upload, /changes, settings, roles, settle-up, history
//   routes/invites.js    inviting, accepting, declining
//   routes/expenses.js   add / edit / delete expenses
//   routes/payments.js   record / confirm / reject / cancel payments
// The server README has the full table.
//
// Every reply is JSON. Errors look like { error: '...' }, and failed checks
// also carry the full list: { error: '...', errors: ['...', ...] }.

import express from 'express';
import { byAccount, rateLimit } from './rateLimit.js';
import { HttpError } from './errors.js';
import { accountRoutes } from './routes/accounts.js';
import { groupRoutes } from './routes/groups.js';
import { inviteRoutes } from './routes/invites.js';
import { expenseRoutes } from './routes/expenses.js';
import { paymentRoutes } from './routes/payments.js';

/**
 * Build the app.
 * options.rateLimit: { max, windowMs } for the rate-limited endpoints. The
 * default is 10 requests per minute; tests can pass smaller numbers.
 */
export function createApp(options = {}) {
  const app = express();
  const { max, windowMs } = options.rateLimit ?? { max: 10, windowMs: 60 * 1000 };

  // On Render, requests reach us through Render's proxy, so the socket's IP
  // is the proxy's. This tells Express to take the phone's real IP from the
  // X-Forwarded-For header the proxy adds (trusting one proxy hop), so
  // req.ip — and the per-IP rate limit — is per phone, not shared by everybody.
  app.set('trust proxy', 1);

  // Parse JSON bodies. 5 MB leaves room for a group with a long history.
  app.use(express.json({ limit: '5mb' }));

  // Separate limiters, each counting on its own:
  //   account — sign-ups, per IP (there's no account yet)
  //   invite  — making / regenerating invites, per account
  //   answer  — looking at / accepting / declining invites, per account
  //             (this is where someone could try guessing link codes)
  const limits = {
    account: rateLimit({ max, windowMs }),
    invite: rateLimit({ max, windowMs, key: byAccount }),
    answer: rateLimit({ max, windowMs, key: byAccount }),
  };

  // --- Health check: Render (and you) can open this to see the server is up.
  app.get('/', (req, res) => {
    res.json({ ok: true, name: 'YaarSplit server' });
  });

  app.use(accountRoutes(limits));
  app.use(groupRoutes());
  app.use(inviteRoutes(limits));
  app.use(expenseRoutes());
  app.use(paymentRoutes());

  // --- Anything else: 404 ---
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  // --- Errors ---
  // HttpError: a refusal on purpose (see errors.js) → its status and message.
  // Anything else is unexpected: log it, reply 500 without internal details.
  // (Express 5 sends errors thrown inside async routes here automatically.)
  // eslint-disable-next-line no-unused-vars -- Express needs all 4 arguments
  app.use((error, req, res, next) => {
    if (error instanceof HttpError) {
      const body = { error: error.message };
      if (error.errors) body.errors = error.errors;
      return res.status(error.status).json(body);
    }
    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'The request body is not valid JSON.' });
    }
    console.error(error);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  });

  return app;
}
