// backend/services/socketServer.js
// Socket.io real-time sync server.
// Call init(httpServer) once in server.js after app.listen()
//
// Install: npm install socket.io
//
// In server.js:
//   const http   = require('http');
//   const server = http.createServer(app);
//   const { init: initSocket, emitToOrg } = require('./services/socketServer');
//   initSocket(server);
//   server.listen(PORT, ...);
//
// Then in any route that changes portfolio state:
//   const { emitToOrg } = require('../services/socketServer');
//   emitToOrg(orgId, 'portfolio:updated', { type: 'RETIREMENT', certId });

const { Server }  = require('socket.io');
const jwt         = require('jsonwebtoken');
const { safeQuery: query } = require('../db/pool');

let io;

const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'https://ethertrackapp.vercel.app',
  process.env.FRONTEND_URL,
].filter(Boolean);

// [FIX-SCALE] Without this, Socket.io only broadcasts within the process
// that received the event — the moment you run more than one server
// instance, a user connected to instance A silently stops receiving
// real-time updates triggered by actions processed on instance B. No
// error, no crash, just events that quietly never arrive for some users.
// This adapter fans events out through Redis pub/sub so every instance
// sees every emit, regardless of which instance the affected user is
// connected to.
//
// Uses the standard `redis` package (already a dependency — see
// cron/jobs.js's distributed lock) against REDIS_URL, NOT the Upstash
// REST client used elsewhere for rate limiting — Upstash's REST API has
// no pub/sub support, only a real persistent connection does. If
// REDIS_URL isn't set, falls back to Socket.io's default in-memory
// adapter (correct on a single instance, silently wrong on multiple —
// see the warning below).
const setupRedisAdapter = async (io) => {
  if (!process.env.REDIS_URL) {
    console.warn('⚠️  Socket.io: REDIS_URL not set — using in-memory adapter. This is fine on a single instance; if you ever scale to 2+ instances, real-time events will NOT reach all connected users until this is configured.');
    return;
  }
  try {
    const { createClient } = require('redis');
    const { createAdapter } = require('@socket.io/redis-adapter');
    const pubClient = createClient({ url: process.env.REDIS_URL });
    const subClient = pubClient.duplicate();
    pubClient.on('error', (e) => console.error('[socket.io-redis pub]', e.message));
    subClient.on('error', (e) => console.error('[socket.io-redis sub]', e.message));
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    console.log('✅ Socket.io Redis adapter connected — safe to run multiple instances');
  } catch (e) {
    console.warn('⚠️  Socket.io Redis adapter failed to initialize, falling back to in-memory (single-instance only):', e.message);
  }
};

const init = async (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin:      ALLOWED_ORIGINS,
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Auth middleware — same JWT logic as HTTP routes
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('No token'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const { rows } = await query(
        `SELECT id, email, full_name, role, org_id
         FROM users WHERE id = $1 AND is_active = true`,
        [decoded.userId]
      );

      if (!rows.length) return next(new Error('User not found'));

      socket.userId = rows[0].id;
      socket.orgId  = rows[0].org_id;
      socket.role   = rows[0].role;
      next();
    } catch (err) {
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    // Join personal room always
    socket.join(`user:${socket.userId}`);

    // Join org room when client requests it
    socket.on('join:org', ({ orgId }) => {
      // Verify the user actually belongs to this org
      if (String(socket.orgId) === String(orgId)) {
        socket.join(`org:${orgId}`);
      }
    });

    socket.on('disconnect', () => {
      // cleanup handled automatically by socket.io
    });
  });

  console.log('🔌 Socket.io real-time sync ready');
  await setupRedisAdapter(io);
  return io;
};

/**
 * Emit a portfolio update to all members of an org.
 * Call this from any route that changes portfolio state.
 *
 * @param {string|number} orgId
 * @param {string}        event   — 'portfolio:updated' | 'retirement:approved'
 * @param {object}        payload — { type, certId, tokenId, ... }
 */
const emitToOrg = (orgId, event, payload) => {
  if (!io || !orgId) return;
  io.to(`org:${orgId}`).emit(event, payload);
};

/**
 * Emit to a specific user (e.g. notify the requester their retirement was approved)
 */
const emitToUser = (userId, event, payload) => {
  if (!io || !userId) return;
  io.to(`user:${userId}`).emit(event, payload);
};

module.exports = { init, emitToOrg, emitToUser };