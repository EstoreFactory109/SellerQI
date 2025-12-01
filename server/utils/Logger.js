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

// Helper function to format timestamp
const getTimestamp = () => {
  const now = new Date();
  return now.toISOString().replace('T', ' ').substring(0, 19);
};

// Helper function to format log message
const formatLogMessage = (level, ...args) => {
  const timestamp = getTimestamp();
  const message = args.map(arg => {
    if (typeof arg === 'object') {
      return JSON.stringify(arg, null, 2);
    }
    return String(arg);
  }).join(' ');
  return `[${timestamp}] [${level}] ${message}\n`;
};

// Helper function to write to file (async, non-blocking)
const writeToFile = (message) => {
  try {
    fs.appendFileSync(logsFilePath, message, 'utf8');
  } catch (error) {
    // Silently fail if file write fails to avoid breaking the application
    console.error('[LOGGER ERROR] Failed to write to logs.txt:', error.message);
  }
};

// Helper function to colorize arguments
const colorizeArgs = (colorFn, ...args) => {
  return args.map(arg => {
    if (typeof arg === 'object') {
      return colorFn(JSON.stringify(arg, null, 2));
    }
    return colorFn(String(arg));
  });
};

const logger = {
  info: (...args) => {
    const message = formatLogMessage('INFO', ...args);
    const coloredArgs = colorizeArgs(chalk.green, ...args);
    console.log(chalk.green('[INFO]'), ...coloredArgs);
    writeToFile(message);
  },
  error: (...args) => {
    const message = formatLogMessage('ERROR', ...args);
    const coloredArgs = colorizeArgs(chalk.red, ...args);
    console.error(chalk.red('[ERROR]'), ...coloredArgs);
    writeToFile(message);
  },
  warn: (...args) => {
    const message = formatLogMessage('WARN', ...args);
    const coloredArgs = colorizeArgs(chalk.yellow, ...args);
    console.warn(chalk.yellow('[WARN]'), ...coloredArgs);
    writeToFile(message);
  },
  debug: (...args) => {
    const message = formatLogMessage('DEBUG', ...args);
    const coloredArgs = colorizeArgs(chalk.cyan, ...args);
    console.log(chalk.cyan('[DEBUG]'), ...coloredArgs);
    writeToFile(message);
  }
};

module.exports = logger;
