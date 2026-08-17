// __mocks__/pool.js
module.exports = {
  safeQuery: jest.fn(),
  withTransaction: jest.fn((fn) => fn({
    query: jest.fn(),
    release: jest.fn(),
  })),
  getReadPool: jest.fn(() => ({
    query: jest.fn(),
  })),
  getPrimaryPool: jest.fn(() => ({
    query: jest.fn(),
  })),
};