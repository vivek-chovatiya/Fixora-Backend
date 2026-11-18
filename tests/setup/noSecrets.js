// Runs in every test file: after the file's tests, no response any of them received may carry a
// secret key or a bcrypt hash (requests contract §1). Every endpoint a suite touches is covered.
const api = require('../helpers/api');

const SECRET_KEYS = /"(password|authCodeHash|codeHash)"\s*:/;
const BCRYPT_HASH = /\$2[aby]\$\d{2}\$/;

afterAll(() => {
  const leaks = api.responses
    .filter((res) => SECRET_KEYS.test(res.text) || BCRYPT_HASH.test(res.text))
    .map((res) => `${res.method.toUpperCase()} ${res.path} -> ${res.status}`);
  expect(leaks).toEqual([]);
});
