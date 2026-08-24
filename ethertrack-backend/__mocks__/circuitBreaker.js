// __mocks__/circuitBreaker.js
module.exports = {
  getBreaker: jest.fn(() => ({
    execute: jest.fn((fn) => fn()),
    on: jest.fn(),
  })),
  CircuitBreaker: jest.fn().mockImplementation(() => ({
    execute: jest.fn((fn) => fn()),
    on: jest.fn(),
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 30000,
  })),
};