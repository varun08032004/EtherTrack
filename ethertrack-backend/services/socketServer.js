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

const init = (httpServer) => {
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