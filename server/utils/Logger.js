// Logger with file and console output
const fs = require('fs');
const path = require('path');

// Try to require chalk, fallback to no colors if not available
let chalk;
try {
  chalk = require('chalk');
} catch (error) {
  // If chalk is not installed, create a no-op function
  chalk = {
    green: (text) => text,
    yellow: (text) => text,
    red: (text) => text,
    cyan: (text) => text
  };
}

// Get the logs file path (in server directory)
const logsFilePath = path.join(__dirname, '..', 'logs.txt');

// Whether to ALSO mirror every log line into server/logs.txt.
//
// This file is append-only with NO rotation, so in production it grows without
// bound and fills the disk — and each write is a synchronous appendFileSync that
// blocks the event loop on every log call. pm2 already captures stdout/stderr
// (and, with pm2-logrotate, rotates it), so the file is redundant in production.
//
// Default: enabled in dev, disabled in production. Override explicitly with
// LOG_TO_FILE=true / LOG_TO_FILE=false.
const FILE_LOGGING_ENABLED = process.env.LOG_TO_FILE !== undefined
  ? process.env.LOG_TO_FILE === 'true'
  : process.env.NODE_ENV !== 'production';

// Log-level gating. Lower number = higher priority (always shown first).
//   error < warn < info < debug
// Only messages at or above the active level are emitted (to console AND file).
// This is the single lever for taming log volume: high-frequency diagnostics
// (per-poll, per-item, per-SKU dumps) should be logged via `logger.debug`, so
// production (default level `info`) stays quiet while `LOG_LEVEL=debug` brings
// the full detail back with no redeploy.
//
// Default: `info` in production, `debug` in dev. Override with LOG_LEVEL=<name>.
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const configuredLevel = (process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug')).toLowerCase();
const ACTIVE_LEVEL = LEVELS[configuredLevel] !== undefined ? LEVELS[configuredLevel] : LEVELS.info;
const isLevelEnabled = (level) => LEVELS[level] <= ACTIVE_LEVEL;

// Helper function to format timestamp
const getTimestamp = () => {
  const now = new Date();
  return now.toISOString().replace('T', ' ').substring(0, 19);
};

// JSON.stringify replacer that expands Error values (their `message`/`stack`
// are non-enumerable, so a plain stringify of an Error — or an object holding
// one — produces `{}` and hides the real cause). This makes nested errors,
// e.g. `logger.error('x', { error: err })`, serialize with their details.
const errorReplacer = (key, value) => {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack, ...value };
  }
  return value;
};

// Serialize a single log argument. Critically, a top-level Error is rendered as
// its stack (which includes "name: message") instead of `{}`.
const formatArg = (arg) => {
  if (arg instanceof Error) {
    return arg.stack || `${arg.name}: ${arg.message}`;
  }
  if (typeof arg === 'object' && arg !== null) {
    try {
      return JSON.stringify(arg, errorReplacer, 2);
    } catch (_) {
      return String(arg);
    }
  }
  return String(arg);
};

// Helper function to format log message
const formatLogMessage = (level, ...args) => {
  const timestamp = getTimestamp();
  const message = args.map(formatArg).join(' ');
  return `[${timestamp}] [${level}] ${message}\n`;
};

// Helper function to write to file (async, non-blocking)
const writeToFile = (message) => {
  if (!FILE_LOGGING_ENABLED) return;
  try {
    fs.appendFileSync(logsFilePath, message, 'utf8');
  } catch (error) {
    // Silently fail if file write fails to avoid breaking the application
    console.error('[LOGGER ERROR] Failed to write to logs.txt:', error.message);
  }
};

// Helper function to colorize arguments (uses the same Error-aware formatter
// so the console shows the real message/stack, not `{}`).
const colorizeArgs = (colorFn, ...args) => {
  return args.map(arg => colorFn(formatArg(arg)));
};

const logger = {
  info: (...args) => {
    if (!isLevelEnabled('info')) return;
    const message = formatLogMessage('INFO', ...args);
    const coloredArgs = colorizeArgs(chalk.green, ...args);
    console.log(chalk.green('[INFO]'), ...coloredArgs);
    writeToFile(message);
  },
  error: (...args) => {
    if (!isLevelEnabled('error')) return;
    const message = formatLogMessage('ERROR', ...args);
    const coloredArgs = colorizeArgs(chalk.red, ...args);
    console.error(chalk.red('[ERROR]'), ...coloredArgs);
    writeToFile(message);
  },
  warn: (...args) => {
    if (!isLevelEnabled('warn')) return;
    const message = formatLogMessage('WARN', ...args);
    const coloredArgs = colorizeArgs(chalk.yellow, ...args);
    console.warn(chalk.yellow('[WARN]'), ...coloredArgs);
    writeToFile(message);
  },
  debug: (...args) => {
    if (!isLevelEnabled('debug')) return;
    const message = formatLogMessage('DEBUG', ...args);
    const coloredArgs = colorizeArgs(chalk.cyan, ...args);
    console.log(chalk.cyan('[DEBUG]'), ...coloredArgs);
    writeToFile(message);
  }
};

module.exports = logger;
