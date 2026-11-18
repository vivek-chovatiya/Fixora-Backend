// Search text is matched literally, never as a regular expression: a raw `$regex` from a request
// body lets a caller send a pattern that is invalid (a 500) or catastrophically slow.
const escapeRegex = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = {
  escapeRegex,
};
