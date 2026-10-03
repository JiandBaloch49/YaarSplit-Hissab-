// errors.js — a small error type for "refuse this request with status N".
//
// Route code can `throw new HttpError(403, 'Only the receiver can confirm.')`
// from anywhere, even deep inside a database transaction. Express 5 sends
// errors from async routes to the error handler at the bottom of app.js,
// which replies { error: message } with that status. Throwing inside
// saveWithSeqs() also cancels the transaction, so nothing half-done is saved.

export class HttpError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.status = status;
    this.errors = errors; // optional list of messages (failed checks)
  }
}
