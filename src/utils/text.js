const generateSlug = (name = '') =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Prevents user input from being interpreted as a regular expression (ReDoS / injection). */
const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const fullName = (first, last) => `${first || ''} ${last || ''}`.trim();

module.exports = { generateSlug, escapeRegex, fullName };
