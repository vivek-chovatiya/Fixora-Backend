// Captures everything the app logs, so a test can prove no code ever reaches a log line.
// The console and file transports are silenced for the run; the capture sees the same formatted
// output they would have written.
const { Writable } = require('stream');
const winston = require('winston');
const logger = require('../../src/utils/logger');

const lines = [];

logger.transports.forEach((transport) => {
  transport.silent = true;
});

logger.add(
  new winston.transports.Stream({
    stream: new Writable({
      write(chunk, encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    }),
  })
);

module.exports = {
  all: () => lines.join('\n'),
  reset: () => {
    lines.length = 0;
  },
};
