// routes/ipfsRoute.js — EtherTrack IPFS proxy
// Proxies Pinata uploads server-side so API keys never reach the browser.
//
// Wired in server.js as:  app.use('/api/ipfs', require('./routes/ipfsRoute'));
//
// POST /api/ipfs/pin         — verified users only (portfolio docs, certificates)
// POST /api/ipfs/pin-kyc-doc — authenticated users only, no KYC required
//                              (unverified users submitting KYC + re-KYC)

const express                      = require('express');
const multer                       = require('multer');
const { uploadFile }               = require('../services/ipfs');
const { authenticate, requireKYC } = require('../middleware/auth');

const router = express.Router();

// Store upload in memory — no disk writes, no temp file cleanup needed
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 }, // 5 MB — matches frontend validation
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    allowed.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error('Only PDF, JPG, PNG and WEBP files are allowed'));
  },
});

// Shared upload handler — used by both /pin and /pin-kyc-doc
const handleUpload = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  try {
    const result = await uploadFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
    );
    return res.json({
      ipfsHash: result.hash,
      uri:      result.uri,
      url:      result.url,
    });
  } catch (err) {
    console.error('[IPFS upload]', err.message);
    return res.status(502).json({ error: 'IPFS upload failed', detail: err.message });
  }
};

/**
 * POST /api/ipfs/pin
 * For already-verified users — portfolio docs, certificates, etc.
 * Requires: authenticated + KYC verified
 */
router.post('/pin', authenticate, requireKYC, upload.single('file'), handleUpload);

/**
 * POST /api/ipfs/pin-kyc-doc
 * For KYC document upload — unverified users and re-KYC submissions.
 * requireKYC intentionally omitted — user is uploading to GET verified.
 * Still requires a valid login session via authenticate.
 */
router.post('/pin-kyc-doc', authenticate, upload.single('file'), handleUpload);

// Multer error handler — catches file size + type rejections
router.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File too large. Maximum size is 5 MB.' });
  }
  if (err.message?.includes('Only PDF')) {
    return res.status(400).json({ error: err.message });
  }
  console.error('[ipfsRoute error]', err.message);
  return res.status(500).json({ error: 'Upload error' });
});

module.exports = router;