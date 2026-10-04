// api.js — talking to the YaarSplit server over HTTP.
//
// One function, request(), used by the sync engine and the sign-up screen.
// It adds the device token, sends/receives JSON, and turns every kind of
// failure into one of two errors:
//
//   OfflineError  we couldn't reach the server: no internet, the request
//                 timed out, or the server itself broke (a 5xx reply).
//                 Nothing is wrong with the data — just try again later.
//   ApiError      the server answered and said no (400 bad data, 401 unknown
//                 token, 403 not allowed, 409 conflict...). `status` is the
//                 HTTP code, `message` the server's explanation and `errors`
//                 the list of problems, when it sent one.
//
// The server's address comes from EXPO_PUBLIC_API_URL. Expo copies
// EXPO_PUBLIC_ variables into the app when it's built:
//   - on your computer (npx expo start): from a .env file in the project
//     root, see .env.example
//   - EAS builds (eas build --profile preview): from the EAS environment
//     variable of the same name, see eas.json
// There is deliberately no built-in address, so a build that forgot to set
// it fails loudly instead of quietly talking to the wrong server.

import { getToken } from './account';

// Render's free server sleeps when unused and takes up to a minute to wake
// up, so be patient before giving up on a request.
const TIMEOUT_MS = 60 * 1000;

export class OfflineError extends Error {}

export class ApiError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

/** The server's base address, without a trailing "/". */
export function apiUrl() {
  // Must be written out in full as process.env.EXPO_PUBLIC_API_URL: Expo
  // only swaps in the value when it sees exactly that text.
  const url = process.env.EXPO_PUBLIC_API_URL;
  if (!url) throw new Error('EXPO_PUBLIC_API_URL is not set, so the app does not know its server.');
  return url.replace(/\/+$/, '');
}

/**
 * Send one request. `body` (optional) is sent as JSON. Returns the parsed
 * JSON reply, or throws OfflineError / ApiError (see the top of this file).
 */
export async function request(method, path, body) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  // fetch() has no timeout of its own: AbortController cancels it for us.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  // Outside the try below: a missing server address is a setup mistake,
  // not "offline", and shouldn't be reported as one.
  const url = apiUrl() + path;

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    // No connection, DNS failure, or our timeout fired.
    throw new OfflineError('Could not reach the server.');
  } finally {
    clearTimeout(timer);
  }

  // Every reply from our server is JSON. Anything else (e.g. a proxy's HTML
  // error page) means the server isn't really there.
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (response.status >= 500 || data === null) {
    throw new OfflineError('The server is not answering properly right now.');
  }
  if (!response.ok) {
    throw new ApiError(response.status, data.error || 'The server refused this.', data.errors);
  }
  return data;
}
