const fs = require('fs');

// Check webhook idempotency for Pinata
const ipfsContent = fs.readFileSync('services/ipfs.js', 'utf8');
if (ipfsContent.includes('pinataBreaker') && ipfsContent.includes('circuitBreaker')) console.log('PASS: Pinata circuit breaker');
else console.log('FAIL: Pinata circuit breaker missing');

// Check blockchain RPC circuit breaker
const blockchainContent = fs.readFileSync('services/blockchain.js', 'utf8');
if (blockchainContent.includes('rpcBreaker') && blockchainContent.includes('alchemy-rpc')) console.log('PASS: Blockchain RPC circuit breaker');
else console.log('FAIL: Blockchain RPC circuit breaker missing');

// Check Firebase auth in middleware
const authContent = fs.readFileSync('middleware/auth.js', 'utf8');
if (authContent.includes('firebaseAdmin') && authContent.includes('verifyIdToken')) console.log('PASS: Firebase auth verification');
else console.log('FAIL: Firebase auth verification missing');

// Check JWT verification
if (authContent.includes('jwt.verify') && authContent.includes('JWT_SECRET')) console.log('PASS: JWT verification present');
else console.log('FAIL: JWT verification missing');

console.log('All checks done');