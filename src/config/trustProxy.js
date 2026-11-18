// How many proxies in front of the server Express should trust when it reads the client's IP
// (X-Forwarded-For). The per-IP /auth limit keys on req.ip, so behind a load balancer it must be set
// or every caller looks like the proxy. From env TRUST_PROXY: a hop count ("1"), or "false" (the
// default — right for local development, where there is no proxy).
//
// ⚠️ Never "true": that trusts any X-Forwarded-For a client sends, so anyone could pick their own
// IP and walk past the limit. Anything that is not a whole number is treated as false.
const parseTrustProxy = (value) => (/^\d+$/.test(String(value || '').trim()) ? Number(value) : false);

module.exports = parseTrustProxy;
