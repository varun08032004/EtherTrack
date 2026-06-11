// lib/firebaseAdmin.js — EtherTrack
// ─────────────────────────────────────────────────────────────────
// Centralised Firebase Admin SDK initialisation.
//
// Extracted from routes/auth.js so:
//   1. Missing env vars cause a loud startup failure, not a silent
//      runtime error on the first /firebase-sync request.
//   2. The SDK is initialised exactly once regardless of how many
//      route files require this module (Node module cache handles it).
// ─────────────────────────────────────────────────────────────────
'use strict';

const admin = require('firebase-admin');

if (!admin.apps.length) {
  const required = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'];
  const missing  = required.filter(k => !process.env[k]);

  if (missing.length) {
    throw new Error(
      `[firebaseAdmin] FATAL: Missing required environment variables:\n  ${missing.join('\n  ')}\n` +
      'Firebase Admin SDK will not function. Set these in your .env file.'
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });

  console.log('✅ Firebase Admin SDK initialised');
}

module.exports = admin;