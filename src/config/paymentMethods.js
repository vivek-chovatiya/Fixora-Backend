/**
 * The ways a vendor may record that a customer paid (PROJECT_BIBLE.md section 37, amended
 * 21/10/2026; Phase 4B contract §4).
 *
 * Why it exists: section 37 says the supported methods "must follow backend configuration", so
 * the app shows exactly this list (`POST /payment-methods/list`) and the backend accepts exactly
 * these ids on `/requests/complete` and `/requests/record-payment`. Fixora processes no payment in
 * Phase 1: a method is a word on a record, nothing more.
 *
 * The decision that shaped it: an ordered code constant, not admin-editable data (an open item).
 * Each `id` is stored in the request's existing `paymentMode` field, so `PAYMENT_MODES` — that
 * field's enum — is defined here beside the list and checked against it when this file loads.
 * `ONLINE` stays in the enum for records the web views wrote earlier and is never offered.
 *
 * ⚠️ An id is stored on completed requests and matched by the app: renaming or removing one
 * strands those records. Add new methods to both lists; never repurpose an id.
 */

const PAYMENT_MODES = Object.freeze(['CASH', 'ONLINE', 'UPI', 'BANK_TRANSFER', 'CARD', 'OTHER']);

const PAYMENT_METHODS = Object.freeze(
  [
    { id: 'CASH', label: 'Cash' },
    { id: 'UPI', label: 'UPI' },
    { id: 'BANK_TRANSFER', label: 'Bank transfer' },
    { id: 'CARD', label: 'Card' },
    { id: 'OTHER', label: 'Other' },
  ].map((method) => Object.freeze(method))
);

const unknown = PAYMENT_METHODS.filter((method) => !PAYMENT_MODES.includes(method.id));
if (unknown.length) {
  throw new Error(`Payment methods outside the paymentMode enum: ${unknown.map((m) => m.id)}`);
}

const PAYMENT_METHOD_IDS = Object.freeze(PAYMENT_METHODS.map((method) => method.id));

/** The configured method with this id, or null. */
const paymentMethodById = (id) => PAYMENT_METHODS.find((method) => method.id === id) || null;

module.exports = {
  PAYMENT_MODES,
  PAYMENT_METHODS,
  PAYMENT_METHOD_IDS,
  paymentMethodById,
};
