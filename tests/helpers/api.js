// Requests against the Express app (no listener), with every response body kept so a test can
// search all of them at once.
const request = require('supertest');
const app = require('../../index');

const responses = [];

const send = async (method, path, body, token) => {
  let req = request(app)[method](`/api/v1${path}`);
  if (token) {
    req = req.set('Authorization', `Bearer ${token}`);
  }
  const res = await (body === undefined ? req : req.send(body));
  responses.push({ method, path, status: res.status, text: res.text });
  return res;
};

module.exports = {
  app,
  post: (path, body, token) => send('post', path, body, token),
  get: (path, token) => send('get', path, undefined, token),
  responses,
  resetResponses: () => {
    responses.length = 0;
  },
};
