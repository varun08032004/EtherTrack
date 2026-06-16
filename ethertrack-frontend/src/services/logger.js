// services/logger.js — EtherTrack · Production structured logger -   28/05/2026
// Pino with PII redaction, correlation IDs, and environment-aware transport
'use strict';

const pino = require('pino');

const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'body.idNumber',
  'body.aadhaarHash',
  'body.panHash',
  'body.kycDataHash',
  'body.password',
  'body.token',
  'err.stack',           // never log full stacks in prod
];

const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  redact: {
    paths: REDACTED_PATHS,
    censor: '[REDACTED]',
  },
  serializers: {
    err: (e) => ({
      code:    e.code,
      msg:     e.message,
      type:    e.constructor?.name,
      // No stack in production
      ...(process.env.NODE_ENV !== 'production' && { stack: e.stack }),
    }),
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
  formatters: {
    level: (label) => ({ level: label }),
    bindings: (b) => ({ pid: b.pid, host: b.hostname, service: 'ethertrack-kyc' }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(process.env.NODE_ENV !== 'production' && {
    transport: { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } },
  }),
});

module.exports = logger;
