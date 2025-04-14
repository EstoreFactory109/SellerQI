const pino = require('pino');

// Use pretty-print for better readability in dev
const logger = pino({
  level: 'debug',
  transport: {
    target: 'pino-pretty', // Pretty formatting
    options: { colorize: true }
  }
});

module.exports = logger;
