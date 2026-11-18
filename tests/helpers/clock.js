// Moves the auth flows' clock (src/utils/clock.js) without touching real timers, which the
// MongoDB driver needs.
const clock = require('../../src/utils/clock');

let offsetMs = 0;

const install = () => {
  offsetMs = 0;
  clock.setNowForTests(() => Date.now() + offsetMs);
};

module.exports = {
  install,
  advance: (ms) => {
    offsetMs += ms;
  },
  restore: () => {
    offsetMs = 0;
    clock.setNowForTests();
  },
};
