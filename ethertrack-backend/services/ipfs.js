// services/ipfs.js — EtherTrack
// PRODUCTION HARDENED
'use strict';

const axios    = require('axios');
const FormData = require('form-data');
const { getBreaker } = require('../lib/circuitBreaker');

const PINATA_URL = 'https://api.pinata.cloud';
const GATEWAY    = process.env.PINATA_GATEWAY || 'https://gateway.pinata.cloud/ipfs';

// Pinata circuit breaker
const pinataBreaker = getBreaker('pinata', {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 30000
});

// ── Startup validation ────────────────────────────────────────────
if (!process.env.PINATA_API_KEY || !process.env.PINATA_SECRET_KEY) {
  console.error('[IPFS] FATAL: PINATA_API_KEY or PINATA_SECRET_KEY environment variable is missing.');
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

// ── Constants ─────────────────────────────────────────────────────
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB hard limit
const REQUEST_TIMEOUT_MS  = 30_000;           // 30 s

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

// ── Auth headers ──────────────────────────────────────────────────
const authHeaders = () => ({
  pinata_api_key        : process.env.PINATA_API_KEY,
  pinata_secret_api_key : process.env.PINATA_SECRET_KEY,
});

// ── Sanitise a plain string for safe storage in metadata ──────────
const sanitiseMeta = (s, maxLen = 500) => {
  if (typeof s !== 'string') return '';
  return s.replace(/[<>"'`]/g, '').trim().slice(0, maxLen);
};

// ── Validate a CIDv1 hash returned by Pinata ─────────────────────
const isValidCID = (hash) => {
  if (typeof hash !== 'string') return false;
  // CIDv0: Qm... (46 chars), CIDv1: ba... or b... (varies)
  return /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})$/.test(hash);
};

// ── Upload JSON metadata to IPFS ──────────────────────────────────
const uploadJSON = async (jsonData, name = 'metadata') => {
  if (!jsonData || typeof jsonData !== 'object') {
    throw new Error('uploadJSON: jsonData must be a non-null object');
  }

  const body = {
    pinataContent  : jsonData,
    pinataMetadata : { name: sanitiseMeta(`${name}-${Date.now()}`) },
    pinataOptions  : { cidVersion: 1 },
  };

  const res = await pinataBreaker.execute(async () => {
    const response = await axios.post(`${PINATA_URL}/pinning/pinJSONToIPFS`, body, {
      headers : authHeaders(),
      timeout : REQUEST_TIMEOUT_MS,
    });
    return response;
  });

  const hash = res.data?.IpfsHash;
  if (!hash || !isValidCID(hash)) {
    throw new Error(`Pinata returned invalid CID: ${hash}`);
  }

  return {
    hash,
    uri : `ipfs://${hash}`,
    url : `${GATEWAY}/${hash}`,
  };
};

// ── Upload file buffer to IPFS ────────────────────────────────────
const uploadFile = async (buffer, filename, mimetype = 'application/pdf') => {
  // 1. MIME type validation
  if (!ALLOWED_MIME_TYPES.has(mimetype)) {
    throw new Error(`Unsupported file type: ${mimetype}. Allowed: ${[...ALLOWED_MIME_TYPES].join(', ')}`);
  }

  // 2. File size validation
  const size = Buffer.isBuffer(buffer) ? buffer.length : buffer?.byteLength ?? 0;
  if (size === 0) {
    throw new Error('File buffer is empty');
  }
  if (size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File too large (${(size / 1024 / 1024).toFixed(1)} MB). Maximum is ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB.`);
  }

  // 3. Sanitise filename
  const safeFilename = sanitiseMeta(filename, 200)
    .replace(/[^a-zA-Z0-9._\-]/g, '_') || `upload-${Date.now()}`;

  const form = new FormData();
  form.append('file', buffer, { filename: safeFilename, contentType: mimetype });
  form.append('pinataMetadata', JSON.stringify({ name: safeFilename }));
  form.append('pinataOptions',  JSON.stringify({ cidVersion: 1 }));

  const res = await pinataBreaker.execute(async () => {
    const response = await axios.post(`${PINATA_URL}/pinning/pinFileToIPFS`, form, {
      headers          : { ...authHeaders(), ...form.getHeaders() },
      timeout          : REQUEST_TIMEOUT_MS,
      maxContentLength : Infinity,
      maxBodyLength    : Infinity,
    });
    return response;
  });

  const hash = res.data?.IpfsHash;
  if (!hash || !isValidCID(hash)) {
    throw new Error(`Pinata returned invalid CID: ${hash}`);
  }

  return {
    hash,
    uri : `ipfs://${hash}`,
    url : `${GATEWAY}/${hash}`,
  };
};

// ── Build batch metadata JSON (ERC-1155 standard) ─────────────────
const buildBatchMetadata = (batch, project) => ({
  name        : sanitiseMeta(`${project.name} — Batch ${batch.batch_number}`),
  description : sanitiseMeta(`Carbon credit batch from ${project.name}. ${batch.total_credits} tCO₂ credits. Vintage ${batch.vintage_year}.`),
  image       : project.ipfs_image_hash ? `ipfs://${project.ipfs_image_hash}` : '',
  external_url: `https://ethertrack.io/registry/batch/${encodeURIComponent(String(batch.batch_number))}`,
  attributes  : [
    { trait_type: 'Project Name',  value: sanitiseMeta(project.name) },
    { trait_type: 'Project Code',  value: sanitiseMeta(project.project_code) },
    { trait_type: 'Standard',      value: sanitiseMeta(project.standard) },
    { trait_type: 'Project Type',  value: sanitiseMeta(project.project_type) },
    { trait_type: 'Developer',     value: sanitiseMeta(project.developer_name || '') },
    { trait_type: 'Vintage Year',  value: Number(batch.vintage_year)   },
    { trait_type: 'Location',      value: sanitiseMeta(project.location || '') },
    { trait_type: 'Country',       value: sanitiseMeta(project.country  || '') },
    { trait_type: 'Total Credits', value: Number(batch.total_credits)  },
    { trait_type: 'Batch Number',  value: Number(batch.batch_number)   },
    // Serial range stored as separate fields — never as a freeform joined string
    { trait_type: 'Serial From',   value: sanitiseMeta(String(batch.serial_number_from || '')) },
    { trait_type: 'Serial To',     value: sanitiseMeta(String(batch.serial_number_to   || '')) },
    { trait_type: 'Methodology',   value: sanitiseMeta(project.methodology || '') },
  ],
  registry: {
    tokenId      : null, // filled after mint
    batchId      : batch.id,
    projectId    : project.id,
    batchNumber  : batch.batch_number,
    vintageYear  : batch.vintage_year,
    totalCredits : batch.total_credits,
    serialFrom   : batch.serial_number_from,
    serialTo     : batch.serial_number_to,
    standard     : sanitiseMeta(project.standard),
    projectType  : sanitiseMeta(project.project_type),
    developer    : sanitiseMeta(project.developer_name),
    verifier     : sanitiseMeta(project.verifier_name),
    registeredAt : new Date().toISOString(),
  },
});

// ── Build retirement certificate metadata ──────────────────────────
const buildRetirementMetadata = (retirement, batch, project, user) => ({
  name        : sanitiseMeta(`Retirement Certificate — ${retirement.certificate_id}`),
  description : sanitiseMeta(`${retirement.amount} tCO₂ credits retired from ${project.name}`),
  attributes  : [
    { trait_type: 'Certificate ID',  value: sanitiseMeta(retirement.certificate_id) },
    { trait_type: 'Amount Retired',  value: Number(retirement.amount) },
    { trait_type: 'Project',         value: sanitiseMeta(project.name) },
    { trait_type: 'Vintage Year',    value: batch?.vintage_year ? Number(batch.vintage_year) : '' },
    { trait_type: 'Standard',        value: sanitiseMeta(project.standard) },
    { trait_type: 'Retired By',      value: sanitiseMeta(user.full_name || user.email) },
    { trait_type: 'Beneficiary',     value: sanitiseMeta(retirement.beneficiary_name || '') },
    { trait_type: 'Reason',          value: sanitiseMeta(retirement.reason || '') },
    { trait_type: 'Retired At',      value: retirement.retired_at },
    { trait_type: 'Tx Hash',         value: sanitiseMeta(retirement.tx_hash || '') },
  ],
  registry: {
    certificateId : sanitiseMeta(retirement.certificate_id),
    tokenId       : retirement.token_id,
    amount        : Number(retirement.amount),
    retiredBy     : sanitiseMeta(retirement.wallet_address),
    beneficiary   : sanitiseMeta(retirement.beneficiary_name),
    txHash        : sanitiseMeta(retirement.tx_hash || ''),
    retiredAt     : retirement.retired_at,
  },
});

module.exports = {
  uploadJSON,
  uploadFile,
  buildBatchMetadata,
  buildRetirementMetadata,
  // Exposed for testing
  _isValidCID      : isValidCID,
  _sanitiseMeta    : sanitiseMeta,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
};