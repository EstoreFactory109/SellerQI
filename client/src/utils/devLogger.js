const isDev = Boolean(import.meta?.env?.DEV);

export const devLog = (...args) => {
  if (isDev) console.log(...args);
};

export const devInfo = (...args) => {
  if (isDev) console.info(...args);
};

export const devWarn = (...args) => {
  if (isDev) console.warn(...args);
};

