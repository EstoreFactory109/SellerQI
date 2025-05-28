/**
 * Creates a debounced version of a function that delays invoking the function
 * until after `delay` milliseconds have elapsed since the last time it was invoked.
 * 
 * @param {Function} func - The function to debounce
 * @param {number} delay - The number of milliseconds to delay
 * @returns {Function} The debounced function
 */
export const debounce = (func, delay) => {
  let timeoutId;
  
  return function debounced(...args) {
    clearTimeout(timeoutId);
    
    return new Promise((resolve) => {
      timeoutId = setTimeout(() => {
        resolve(func.apply(this, args));
      }, delay);
    });
  };
};

/**
 * Creates a throttled version of a function that only invokes the function
 * at most once per every `limit` milliseconds.
 * 
 * @param {Function} func - The function to throttle
 * @param {number} limit - The number of milliseconds to limit function calls
 * @returns {Function} The throttled function
 */
export const throttle = (func, limit) => {
  let inThrottle;
  let lastResult;
  
  return function throttled(...args) {
    if (!inThrottle) {
      inThrottle = true;
      lastResult = func.apply(this, args);
      
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
    
    return lastResult;
  };
}; 