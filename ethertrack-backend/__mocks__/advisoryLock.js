// __mocks__/advisoryLock.js
module.exports = {
  generateIdempotencyLockKey: jest.fn((userId, key) => {
    return Math.abs(userId.split('').reduce((a, b) => a + b.charCodeAt(0), 0) + key.split('').reduce((a, b) => a + b.charCodeAt(0), 0)) % 2147483647;
  }),
  acquireAdvisoryLockInt: jest.fn(async (key) => {
    // Mock successful lock acquisition
    return true;
  }),
};