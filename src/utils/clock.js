/**
 * The time, as the auth flows see it.
 *
 * One-time codes expire after five minutes, resends wait thirty seconds and vendor registrations
 * lapse after a day. Proving those rules with real waiting would mean tests nobody runs, and Jest's
 * fake timers also stall the MongoDB driver, so the flows read the time from here and a test moves
 * it instead.
 *
 * ⚠️ `setNowForTests` exists for the test suite only. Production code never calls it.
 */

const realNow = () => Date.now();

let source = realNow;

/** The current instant, as a Date. */
const now = () => new Date(source());

/** Replaces the clock (a function returning epoch milliseconds); call with nothing to restore. */
const setNowForTests = (fn) => {
  source = typeof fn === 'function' ? fn : realNow;
};

module.exports = {
  now,
  setNowForTests,
};
