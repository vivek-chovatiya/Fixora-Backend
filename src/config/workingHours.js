/**
 * The vendor's working week (PROJECT_BIBLE.md section 38; Phase 4B contract §6).
 *
 * Why it exists: the vendor model, the `/vendors/update` validation and the seed must agree on the
 * same seven days in the same order, the app's `VENDOR_WORKING_DAYS`.
 *
 * The decision that shaped it: Monday first, exactly seven entries whenever hours are set, so the
 * app can show the week without sorting or filling gaps. The hours are information only: the
 * backend never filters requests by them.
 *
 * ⚠️ The order is part of the contract — `workingHours.3` is always Thursday. Never reorder or
 * rename a day: stored weeks and the app's screens both read it as written here.
 */

const VENDOR_WORKING_DAYS = Object.freeze(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);

module.exports = {
  VENDOR_WORKING_DAYS,
};
