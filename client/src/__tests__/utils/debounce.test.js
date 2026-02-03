/**
 * Tests for debounce and throttle utility functions
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce, throttle } from '../../utils/debounce';

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should delay function execution', async () => {
    const mockFn = vi.fn(() => 'result');
    const debouncedFn = debounce(mockFn, 100);

    debouncedFn();

    expect(mockFn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);

    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should only execute once when called multiple times rapidly', async () => {
    const mockFn = vi.fn();
    const debouncedFn = debounce(mockFn, 100);

    debouncedFn();
    debouncedFn();
    debouncedFn();
    debouncedFn();
    debouncedFn();

    expect(mockFn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);

    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should reset timer on each call', async () => {
    const mockFn = vi.fn();
    const debouncedFn = debounce(mockFn, 100);

    debouncedFn();
    vi.advanceTimersByTime(50);

    debouncedFn();
    vi.advanceTimersByTime(50);

    expect(mockFn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);

    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should pass arguments to the debounced function', async () => {
    const mockFn = vi.fn();
    const debouncedFn = debounce(mockFn, 100);

    debouncedFn('arg1', 'arg2', 'arg3');

    vi.advanceTimersByTime(100);

    expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2', 'arg3');
  });

  it('should use the latest arguments when called multiple times', async () => {
    const mockFn = vi.fn();
    const debouncedFn = debounce(mockFn, 100);

    debouncedFn('first');
    debouncedFn('second');
    debouncedFn('third');

    vi.advanceTimersByTime(100);

    expect(mockFn).toHaveBeenCalledWith('third');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should return a Promise', () => {
    const mockFn = vi.fn(() => 'result');
    const debouncedFn = debounce(mockFn, 100);

    const result = debouncedFn();

    expect(result).toBeInstanceOf(Promise);
  });

  it('should resolve with the function return value', async () => {
    const mockFn = vi.fn(() => 'expected result');
    const debouncedFn = debounce(mockFn, 100);

    const promise = debouncedFn();

    vi.advanceTimersByTime(100);

    const result = await promise;
    expect(result).toBe('expected result');
  });

  it('should work with different delay values', async () => {
    const mockFn = vi.fn();
    const debouncedFn = debounce(mockFn, 500);

    debouncedFn();

    vi.advanceTimersByTime(400);
    expect(mockFn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(mockFn).toHaveBeenCalledTimes(1);
  });
});

describe('throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should execute immediately on first call', () => {
    const mockFn = vi.fn(() => 'result');
    const throttledFn = throttle(mockFn, 100);

    throttledFn();

    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should not execute again within limit period', () => {
    const mockFn = vi.fn();
    const throttledFn = throttle(mockFn, 100);

    throttledFn();
    throttledFn();
    throttledFn();

    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should execute again after limit period', () => {
    const mockFn = vi.fn();
    const throttledFn = throttle(mockFn, 100);

    throttledFn();
    expect(mockFn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);

    throttledFn();
    expect(mockFn).toHaveBeenCalledTimes(2);
  });

  it('should pass arguments to the throttled function', () => {
    const mockFn = vi.fn();
    const throttledFn = throttle(mockFn, 100);

    throttledFn('arg1', 'arg2');

    expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2');
  });

  it('should return the function result', () => {
    const mockFn = vi.fn(() => 'result');
    const throttledFn = throttle(mockFn, 100);

    const result = throttledFn();

    expect(result).toBe('result');
  });

  it('should return last result when called during throttle period', () => {
    const mockFn = vi.fn()
      .mockReturnValueOnce('first')
      .mockReturnValueOnce('second');
    const throttledFn = throttle(mockFn, 100);

    const result1 = throttledFn();
    const result2 = throttledFn();

    expect(result1).toBe('first');
    expect(result2).toBe('first'); // Returns cached result
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should use first arguments when called multiple times during throttle', () => {
    const mockFn = vi.fn();
    const throttledFn = throttle(mockFn, 100);

    throttledFn('first');
    throttledFn('second');
    throttledFn('third');

    expect(mockFn).toHaveBeenCalledWith('first');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });
});
