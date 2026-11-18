/**
 * Six-digit secrets: the one-time sign-in code and the vendor's permanent auth code.
 *
 * Both are generated here (crypto-random, leading zeros kept, always a string) and stored only as a
 * bcrypt hash. Comparison is bcrypt's, which does not short-circuit on the first differing
 * character, and `compareCode` still spends a full comparison when there is no hash at all (unknown
 * phone, no code issued yet) so the response time does not reveal which case it was.
 *
 * Callers go through the exported object (`secretCode.generateNumericCode()`), never a destructured
 * copy, so the test suite can pin the code a challenge receives.
 *
 * ⚠️ A plain code never leaves the function that generated it except in the one response that must
 * show it (a newly issued vendor auth code) and the delivery seam. Never log it, never put it in an
 * error, never store it.
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const CODE_LENGTH = 6;
const HASH_ROUNDS = 10;

let dummyHash = null;

/** A hash nothing matches, compared against when there is no real hash, to keep timing uniform. */
const getDummyHash = () => {
  if (!dummyHash) {
    dummyHash = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), HASH_ROUNDS);
  }
  return dummyHash;
};

const secretCode = {
  CODE_LENGTH,

  generateNumericCode() {
    return String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
  },

  hashCode(code) {
    return bcrypt.hash(code, HASH_ROUNDS);
  },

  async compareCode(code, hash) {
    if (typeof code !== 'string' || !hash) {
      await bcrypt.compare(String(code), getDummyHash());
      return false;
    }
    return bcrypt.compare(code, hash);
  },
};

module.exports = secretCode;
