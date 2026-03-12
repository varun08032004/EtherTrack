const axios      = require('axios');
const FormData   = require('form-data');

const PINATA_URL  = 'https://api.pinata.cloud';
const GATEWAY     = process.env.PINATA_GATEWAY || 'https://gateway.pinata.cloud/ipfs';

const headers = () => ({
  pinata_api_key:        process.env.PINATA_API_KEY,
  pinata_secret_api_key: process.env.PINATA_SECRET_KEY,
});

// ── Upload JSON metadata to IPFS ─────────────────────────────────
const uploadJSON = async (jsonData, name = 'metadata') => {
  const body = {
    pinataContent: jsonData,
    pinataMetadata: { name: `${name}-${Date.now()}` },
    pinataOptions: { cidVersion: 1 },
  };
  const res = await axios.post(`${PINATA_URL}/pinning/pinJSONToIPFS`, body, { headers: headers() });
  return {
    hash: res.data.IpfsHash,
    uri:  `ipfs://${res.data.IpfsHash}`,
    url:  `${GATEWAY}/${res.data.IpfsHash}`,
  };
};

// ── Upload file buffer to IPFS ────────────────────────────────────
const uploadFile = async (buffer, filename, mimetype = 'application/pdf') => {
  const form = new FormData();
  form.append('file', buffer, { filename, contentType: mimetype });
  form.append('pinataMetadata', JSON.stringify({ name: filename }));
  form.append('pinataOptions',  JSON.stringify({ cidVersion: 1 }));

  const res = await axios.post(`${PINATA_URL}/pinning/pinFileToIPFS`, form, {
    headers: { ...headers(), ...form.getHeaders() },
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  });
  return {
    hash: res.data.IpfsHash,
    uri:  `ipfs://${res.data.IpfsHash}`,
    url:  `${GATEWAY}/${res.data.IpfsHash}`,
  };
};

// ── Build batch metadata JSON (ERC1155 standard) ─────────────────
const buildBatchMetadata = (batch, project) => ({
  name:        `${project.name} — Batch ${batch.batch_number}`,
  description: `Carbon credit batch from ${project.name}. ${batch.total_credits} tCO₂ credits. Vintage ${batch.vintage_year}.`,
  image:       project.ipfs_image_hash ? `ipfs://${project.ipfs_image_hash}` : '',
  external_url: `https://ethertrack.io/registry/batch/${batch.batch_number}`,
  attributes: [
    { trait_type: 'Project Name',    value: project.name },
    { trait_type: 'Project Code',    value: project.project_code },
    { trait_type: 'Standard',        value: project.standard },
    { trait_type: 'Project Type',    value: project.project_type },
    { trait_type: 'Developer',       value: project.developer_name || '' },
    { trait_type: 'Vintage Year',    value: batch.vintage_year },
    { trait_type: 'Location',        value: project.location || '' },
    { trait_type: 'Country',         value: project.country || '' },
    { trait_type: 'Total Credits',   value: batch.total_credits },
    { trait_type: 'Batch Number',    value: batch.batch_number },
    { trait_type: 'Serial From',     value: batch.serial_number_from || '' },
    { trait_type: 'Serial To',       value: batch.serial_number_to || '' },
    { trait_type: 'Methodology',     value: project.methodology || '' },
  ],
  // EtherTrack registry fields
  registry: {
    tokenId:          null,           // filled after mint
    batchId:          batch.id,
    projectId:        project.id,
    batchNumber:      batch.batch_number,
    vintageYear:      batch.vintage_year,
    totalCredits:     batch.total_credits,
    serialNumbers:    `${batch.serial_number_from} — ${batch.serial_number_to}`,
    standard:         project.standard,
    projectType:      project.project_type,
    developer:        project.developer_name,
    verifier:         project.verifier_name,
    registeredAt:     new Date().toISOString(),
  }
});

// ── Build retirement certificate metadata ────────────────────────
const buildRetirementMetadata = (retirement, batch, project, user) => ({
  name:        `Retirement Certificate — ${retirement.certificate_id}`,
  description: `${retirement.amount} tCO₂ credits retired from ${project.name}`,
  attributes: [
    { trait_type: 'Certificate ID',    value: retirement.certificate_id },
    { trait_type: 'Amount Retired',    value: retirement.amount },
    { trait_type: 'Project',           value: project.name },
    { trait_type: 'Vintage Year',      value: batch?.vintage_year || '' },
    { trait_type: 'Standard',          value: project.standard },
    { trait_type: 'Retired By',        value: user.full_name || user.email },
    { trait_type: 'Beneficiary',       value: retirement.beneficiary_name || '' },
    { trait_type: 'Reason',            value: retirement.reason },
    { trait_type: 'Retired At',        value: retirement.retired_at },
    { trait_type: 'Tx Hash',           value: retirement.tx_hash || '' },
  ],
  registry: {
    certificateId:   retirement.certificate_id,
    tokenId:         retirement.token_id,
    amount:          retirement.amount,
    retiredBy:       retirement.wallet_address,
    beneficiary:     retirement.beneficiary_name,
    txHash:          retirement.tx_hash,
    retiredAt:       retirement.retired_at,
  }
});

module.exports = { uploadJSON, uploadFile, buildBatchMetadata, buildRetirementMetadata };
