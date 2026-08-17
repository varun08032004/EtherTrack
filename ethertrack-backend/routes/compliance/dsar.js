// routes/compliance/dsar.js
// GDPR/DPDP DSAR (Data Subject Access Request) endpoints
// Art. 15 GDPR / Sec. 11 DPDP - Right of access
// Art. 20 GDPR - Right to data portability

'use strict';

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { safeQuery: query } = require('../../db/pool');
const { authenticate } = require('../../middleware/auth');
const { logActivity } = require('../../middleware/auth');
const logger = require('../../services/logger');

const router = express.Router();

// POST /api/compliance/dsar/request - Submit a DSAR request
router.post('/request',
  authenticate,
  [
    body('requestType')
      .isIn(['access', 'rectification', 'erasure', 'portability', 'restriction', 'objection'])
      .withMessage('Invalid request type'),
    body('reason').optional().isString().trim().isLength({ min: 10, max: 1000 }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { requestType, reason } = req.body;
    const userId = req.user.id;

    try {
      // Check for existing pending request
      const { rows: existing } = await query(
        `SELECT id, status FROM dsar_requests WHERE user_id = $1 AND status IN ('pending', 'processing')`,
        [userId]
      );
      
      if (existing.length > 0) {
        return res.status(409).json({
          error: 'A DSAR request is already pending or being processed',
          existingRequest: existing[0],
        });
      }

      // Create DSAR request
      const { rows } = await query(
        `INSERT INTO dsar_requests (user_id, request_type, reason, status)
         VALUES ($1, $2, $3, 'pending')
         RETURNING *`,
        [userId, requestType, reason || '']
      );

      const request = rows[0];

      await logActivity(userId, 'DSAR_REQUESTED', { requestType, reason }, req.ip);

      // Send confirmation email
      try {
        const { sendDsarConfirmationEmail } = require('../../services/email');
        await sendDsarConfirmationEmail(req.user.email, {
          name: req.user.full_name,
          requestType,
          requestId: request.id,
        });
      } catch (e) {
        logger.warn('[DSAR] Confirmation email failed:', e.message);
      }

      res.status(201).json({
        message: 'DSAR request submitted successfully',
        request: {
          id: request.id,
          requestType: request.request_type,
          status: request.status,
          createdAt: request.created_at,
        },
      });
    } catch (err) {
      logger.error('[DSAR] Request creation failed:', err.message);
      res.status(500).json({ error: 'Failed to submit DSAR request' });
    }
  }
);

// GET /api/compliance/dsar/requests - List user's DSAR requests
router.get('/requests',
  authenticate,
  async (req, res) => {
    try {
      const { rows } = await query(
        `SELECT id, request_type, status, reason, created_at, completed_at, 
                download_url, expires_at
         FROM dsar_requests
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [req.user.id]
      );

      res.json({ requests: rows });
    } catch (err) {
      logger.error('[DSAR] List requests failed:', err.message);
      res.status(500).json({ error: 'Failed to fetch DSAR requests' });
    }
  }
);

// GET /api/compliance/dsar/requests/:id - Get DSAR request status
router.get('/requests/:id',
  authenticate,
  param('id').isUUID().withMessage('Invalid request ID'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { rows } = await query(
        `SELECT id, request_type, status, reason, created_at, completed_at,
                download_url, expires_at
         FROM dsar_requests
         WHERE id = $1 AND user_id = $2`,
        [req.params.id, req.user.id]
      );

      if (!rows.length) {
        return res.status(404).json({ error: 'DSAR request not found' });
      }

      res.json({ request: rows[0] });
    } catch (err) {
      logger.error('[DSAR] Get request failed:', err.message);
      res.status(500).json({ error: 'Failed to fetch DSAR request' });
    }
  }
);

// GET /api/compliance/dsar/requests/:id/data - Download data package (portability)
router.get('/requests/:id/data',
  authenticate,
  param('id').isUUID().withMessage('Invalid request ID'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { rows } = await query(
        `SELECT * FROM dsar_requests
         WHERE id = $1 AND user_id = $2 AND status = 'completed' AND download_url IS NOT NULL`,
        [req.params.id, req.user.id]
      );

      if (!rows.length) {
        return res.status(404).json({ 
          error: 'Data package not found or not ready for download',
          hint: 'Request must be completed and have a download URL available',
        });
      }

      const request = rows[0];
      
      // Check if download URL has expired
      if (request.expires_at && new Date(request.expires_at) < new Date()) {
        return res.status(410).json({ error: 'Download link has expired' });
      }

      // In production, redirect to signed S3 URL or serve file
      // For now, return the download URL
      res.json({ 
        downloadUrl: request.download_url,
        expiresAt: request.expires_at,
        format: 'json',
      });
    } catch (err) {
      logger.error('[DSAR] Data download failed:', err.message);
      res.status(500).json({ error: 'Failed to generate download link' });
    }
  }
);

// POST /api/compliance/dsar/requests/:id/cancel - Cancel a pending DSAR request
router.post('/requests/:id/cancel',
  authenticate,
  param('id').isUUID().withMessage('Invalid request ID'),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { rows } = await query(
        `UPDATE dsar_requests 
         SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1 AND user_id = $2 AND status = 'pending'
         RETURNING *`,
        [req.params.id, req.user.id]
      );

      if (!rows.length) {
        return res.status(404).json({ 
          error: 'DSAR request not found or cannot be cancelled',
          hint: 'Only pending requests can be cancelled',
        });
      }

      await logActivity(req.user.id, 'DSAR_CANCELLED', { requestId: req.params.id }, req.ip);

      res.json({ message: 'DSAR request cancelled', request: rows[0] });
    } catch (err) {
      logger.error('[DSAR] Cancel failed:', err.message);
      res.status(500).json({ error: 'Failed to cancel DSAR request' });
    }
  }
);

module.exports = router;