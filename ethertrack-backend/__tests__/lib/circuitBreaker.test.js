// __tests__/lib/circuitBreaker.test.js — Circuit breaker tests
const { CircuitBreaker, getBreaker } = require('../../lib/circuitBreaker');

describe('CircuitBreaker', () => {
  let breaker;

  beforeEach(() => {
    breaker = new CircuitBreaker('test', {
      failureThreshold: 3,
      successThreshold: 2,
      timeout: 1000,
    });
  });

  afterEach(() => {
    breaker.reset();
  });

  test('starts in CLOSED state', () => {
    expect(breaker.state).toBe('CLOSED');
  });

  test('executes successful operation', async () => {
    const result = await breaker.execute(() => Promise.resolve('success'));
    expect(result).toBe('success');
    expect(breaker.state).toBe('CLOSED');
  });

  test('opens after failure threshold', async () => {
    const failingOp = () => Promise.reject(new Error('fail'));
    
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(failingOp)).rejects.toThrow('fail');
    }
    
    expect(breaker.state).toBe('OPEN');
  });

  test('rejects immediately when OPEN', async () => {
    const failingOp = () => Promise.reject(new Error('fail'));
    
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(failingOp)).rejects.toThrow('fail');
    }
    
    await expect(breaker.execute(() => Promise.resolve('success')))
      .rejects.toThrow('circuit breaker is OPEN');
  });

  test('transitions to HALF_OPEN after timeout', async () => {
    const shortTimeoutBreaker = new CircuitBreaker('test2', {
      failureThreshold: 2,
      successThreshold: 2, // Need 2 successes to close
      timeout: 100,
    });
    
    await expect(shortTimeoutBreaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
    await expect(shortTimeoutBreaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
    
    expect(shortTimeoutBreaker.state).toBe('OPEN');
    
    // Wait for timeout
    await new Promise(r => setTimeout(r, 150));
    
    // Next call should go to HALF_OPEN
    const result = await shortTimeoutBreaker.execute(() => Promise.resolve('success'));
    expect(result).toBe('success');
    expect(shortTimeoutBreaker.state).toBe('HALF_OPEN');
  });

  test('closes after success threshold in HALF_OPEN', async () => {
    const shortTimeoutBreaker = new CircuitBreaker('test3', {
      failureThreshold: 2,
      successThreshold: 2,
      timeout: 100,
    });
    
    await expect(shortTimeoutBreaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
    await expect(shortTimeoutBreaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
    
    await new Promise(r => setTimeout(r, 150));
    
    await shortTimeoutBreaker.execute(() => Promise.resolve('success'));
    await shortTimeoutBreaker.execute(() => Promise.resolve('success'));
    
    expect(shortTimeoutBreaker.state).toBe('CLOSED');
  });

  test('resets to OPEN on failure in HALF_OPEN', async () => {
    const shortTimeoutBreaker = new CircuitBreaker('test4', {
      failureThreshold: 2,
      successThreshold: 2,
      timeout: 100,
    });
    
    await expect(shortTimeoutBreaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
    await expect(shortTimeoutBreaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
    
    await new Promise(r => setTimeout(r, 150));
    
    await shortTimeoutBreaker.execute(() => Promise.resolve('success'));
    await expect(shortTimeoutBreaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow();
    
    expect(shortTimeoutBreaker.state).toBe('OPEN');
  });

  test('tracks failure count', () => {
    expect(breaker.failures).toBe(0);
    
    breaker.onFailure(new Error('test'));
    expect(breaker.failures).toBe(1);
    
    breaker.onSuccess();
    expect(breaker.failures).toBe(0);
  });
});

describe('getBreaker (singleton)', () => {
  test('returns same instance for same name', () => {
    const b1 = getBreaker('test-breaker');
    const b2 = getBreaker('test-breaker');
    expect(b1).toBe(b2);
  });

  test('returns different instances for different names', () => {
    const b1 = getBreaker('breaker-1');
    const b2 = getBreaker('breaker-2');
    expect(b1).not.toBe(b2);
  });
});