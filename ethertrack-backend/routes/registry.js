// routes/registry.js — with notification triggers
const router = require('express').Router();
const { query, withTransaction } = require('../db/pool');
const { authenticate, requireKYC, requireWallet, requireRole } = require('../middleware/auth');
const { uploadJSON, uploadFile, buildBatchMetadata } = require('../services/ipfs');
const multer = require('multer');
const { createNotification } = require('./notifications');
const { sendMintSuccessEmail } = require('../services/email');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const genProjectCode = async () => {
  const year = new Date().getFullYear();
  const { rows } = await query('SELECT COUNT(*) FROM projects WHERE project_code LIKE $1', [`ET-${year}-%`]);
  return `ET-${year}-${String(parseInt(rows[0].count) + 1).padStart(3, '0')}`;
};

const genBatchNumber = async (projectCode, vintageYear) => {
  const { rows } = await query('SELECT COUNT(*) FROM carbon_batches WHERE batch_number LIKE $1', [`BATCH-${projectCode}-%`]);
  return `BATCH-${projectCode}-${vintageYear}-${String(parseInt(rows[0].count) + 1).padStart(3, '0')}`;
};

router.get('/projects', async (req, res) => {
  try {
    const { status, type, standard, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const conditions = ['p.status = $1'];
    const params = [status || 'approved'];
    let idx = 2;
    if (type)     { conditions.push(`p.project_type = $${idx++}`); params.push(type); }
    if (standard) { conditions.push(`p.standard = $${idx++}`);     params.push(standard); }
    params.push(limit, offset);
    const { rows } = await query(`SELECT p.*, u.full_name as developer_user_name, u.email as developer_email, (SELECT COUNT(*) FROM carbon_batches b WHERE b.project_id=p.id AND b.status='tokenised') as batch_count FROM projects p JOIN users u ON p.developer_id=u.id WHERE ${conditions.join(' AND ')} ORDER BY p.created_at DESC LIMIT $${idx} OFFSET $${idx+1}`, params);
    const { rows: countRows } = await query(`SELECT COUNT(*) FROM projects p WHERE ${conditions.join(' AND ')}`, params.slice(0,-2));
    res.json({ projects: rows, total: parseInt(countRows[0].count), page: +page, limit: +limit });
  } catch (e) { console.error('Get projects error:', e); res.status(500).json({ error: 'Failed to fetch projects' }); }
});

router.get('/projects/:id', async (req, res) => {
  try {
    const { rows } = await query(`SELECT p.*, u.full_name as developer_user_name, u.email as developer_email FROM projects p JOIN users u ON p.developer_id=u.id WHERE p.id=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Project not found' });
    const { rows: batches } = await query(`SELECT id, batch_number, vintage_year, total_credits, available_credits, retired_credits, token_id, status, ipfs_metadata_hash, created_at FROM carbon_batches WHERE project_id=$1 ORDER BY created_at DESC`, [req.params.id]);
    res.json({ ...rows[0], batches });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch project' }); }
});

router.post('/projects', authenticate, requireWallet, upload.single('document'), async (req, res) => {
  try {
    const { name, standard, projectType, location, country, description, methodology, developerName, verifierName, coordinates } = req.body;
    if (!name || !standard || !projectType) return res.status(400).json({ error: 'name, standard and projectType required' });
    const projectCode = await genProjectCode();
    let ipfsDocHash = null;
    if (req.file) {
      const result = await uploadFile(req.file.buffer, req.file.originalname, req.file.mimetype);
      ipfsDocHash = result.hash;
    }
    const { rows } = await query(
      `INSERT INTO projects (developer_id,name,project_code,standard,project_type,location,country,coordinates,description,methodology,developer_name,verifier_name,ipfs_document_hash,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending') RETURNING *`,
      [req.user.id, name, projectCode, standard, projectType, location, country, coordinates ? JSON.parse(coordinates) : null, description, methodology, developerName, verifierName, ipfsDocHash]
    );
    res.status(201).json({ message: 'Project submitted for review', project: rows[0] });
  } catch (e) { console.error('Create project error:', e); res.status(500).json({ error: 'Failed to create project' }); }
});

router.patch('/projects/:id/approve', authenticate, requireRole('admin','verifier'), async (req, res) => {
  try {
    const { rows } = await query(`UPDATE projects SET status='approved', approved_by=$1, approved_at=NOW(), updated_at=NOW() WHERE id=$2 RETURNING *`, [req.user.id, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Project not found' });
    res.json({ message: 'Project approved', project: rows[0] });
  } catch (e) { res.status(500).json({ error: 'Failed to approve project' }); }
});

router.patch('/projects/:id/reject', authenticate, requireRole('admin','verifier'), async (req, res) => {
  const { reason } = req.body;
  try {
    const { rows } = await query(`UPDATE projects SET status='rejected', rejection_reason=$1, updated_at=NOW() WHERE id=$2 RETURNING *`, [reason, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Project not found' });
    res.json({ message: 'Project rejected', project: rows[0] });
  } catch (e) { res.status(500).json({ error: 'Failed to reject project' }); }
});

router.get('/batches', async (req, res) => {
  try {
    const { projectId, status, page = 1, limit = 20 } = req.query;
    const offset = (page-1)*limit;
    const conditions = ['1=1'];
    const params = [];
    let idx = 1;
    if (projectId) { conditions.push(`b.project_id=$${idx++}`); params.push(projectId); }
    if (status)    { conditions.push(`b.status=$${idx++}`);      params.push(status); }
    params.push(limit, offset);
    const { rows } = await query(`SELECT b.*, p.name as project_name, p.standard, p.project_type, p.location FROM carbon_batches b JOIN projects p ON b.project_id=p.id WHERE ${conditions.join(' AND ')} ORDER BY b.created_at DESC LIMIT $${idx} OFFSET $${idx+1}`, params);
    res.json({ batches: rows });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch batches' }); }
});

router.get('/batches/token/:tokenId', async (req, res) => {
  try {
    const { rows } = await query(`SELECT b.*, p.name as project_name, p.standard, p.project_type, p.location, p.country, p.developer_name, p.methodology FROM carbon_batches b JOIN projects p ON b.project_id=p.id WHERE b.token_id=$1`, [req.params.tokenId]);
    if (!rows.length) return res.status(404).json({ error: 'Batch not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: 'Failed to fetch batch' }); }
});

router.post('/batches', authenticate, requireWallet, async (req, res) => {
  try {
    const { projectId, vintageYear, totalCredits, serialFrom, serialTo } = req.body;
    if (!projectId || !vintageYear || !totalCredits) return res.status(400).json({ error: 'projectId, vintageYear and totalCredits required' });
    const { rows: projects } = await query('SELECT * FROM projects WHERE id=$1', [projectId]);
    if (!projects.length) return res.status(404).json({ error: 'Project not found' });
    const project = projects[0];
    if (project.developer_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Not your project' });
    if (project.status !== 'approved') return res.status(400).json({ error: 'Project must be approved before creating batches' });
    const batchNumber = await genBatchNumber(project.project_code, vintageYear);
    const { rows } = await query(`INSERT INTO carbon_batches (project_id,developer_id,batch_number,vintage_year,total_credits,available_credits,serial_number_from,serial_number_to,status) VALUES ($1,$2,$3,$4,$5,$5,$6,$7,'pending') RETURNING *`, [projectId, req.user.id, batchNumber, vintageYear, totalCredits, serialFrom, serialTo]);
    res.status(201).json({ message: 'Batch created', batch: rows[0] });
  } catch (e) { console.error('Create batch error:', e); res.status(500).json({ error: 'Failed to create batch' }); }
});

router.post('/batches/:id/tokenise', authenticate, requireWallet, async (req, res) => {
  try {
    const { tokenId, txHash } = req.body;
    if (!tokenId || !txHash) return res.status(400).json({ error: 'tokenId and txHash required' });
    const { rows: existing } = await query('SELECT id FROM carbon_batches WHERE token_id=$1', [tokenId]);
    if (existing.length) return res.status(409).json({ error: 'TokenId already registered to another batch' });
    const { rows: batchRows } = await query('SELECT b.*, p.* FROM carbon_batches b JOIN projects p ON b.project_id=p.id WHERE b.id=$1', [req.params.id]);
    if (!batchRows.length) return res.status(404).json({ error: 'Batch not found' });
    const batch   = batchRows[0];
    const project = { ...batch, id: batch.project_id, name: batch.project_name };
    const metadata = buildBatchMetadata({ ...batch, token_id: tokenId }, project);
    metadata.registry.tokenId = tokenId;
    const ipfsResult = await uploadJSON(metadata, `batch-${batch.batch_number}`);
    const { rows } = await query(
      `UPDATE carbon_batches SET token_id=$1, tx_hash_mint=$2, tokenised_at=NOW(), tokenised_by=$3, status='tokenised', ipfs_metadata_hash=$4, metadata_uri=$5, expires_at=NOW()+INTERVAL '10 years', updated_at=NOW() WHERE id=$6 RETURNING *`,
      [tokenId, txHash, req.user.id, ipfsResult.hash, ipfsResult.uri, req.params.id]
    );
    await query('UPDATE projects SET issued_credits=issued_credits+$1 WHERE id=$2', [batch.total_credits, batch.project_id]);

    // ── NOTIFICATION: Credit tokenised ──
    await createNotification(
      req.user.id, 'CREDIT', '🪙 Credit Tokenised On-Chain',
      `"${batch.project_name}" tokenised as Token #${tokenId} on Ethereum Sepolia. Ready to list on the marketplace.`,
      '/portfolio', { tokenId, txHash, batchId: req.params.id, projectName: batch.project_name }
    );

    sendMintSuccessEmail(req.user.email, {
      name: req.user.full_name, projectName: batch.project_name, tokenId, txHash,
      portfolioUrl: `${process.env.FRONTEND_URL}/portfolio`,
    }).catch(e => console.warn('[registry/tokenise] email failed:', e.message));

    res.json({ message: 'Batch tokenised and metadata uploaded to IPFS', batch: rows[0], ipfs: { hash: ipfsResult.hash, uri: ipfsResult.uri, url: ipfsResult.url } });
  } catch (e) { console.error('Tokenise error:', e); res.status(500).json({ error: 'Failed to record tokenisation' }); }
});

router.get('/my-projects', authenticate, async (req, res) => {
  try {
    const { rows } = await query(`SELECT p.*, (SELECT COUNT(*) FROM carbon_batches b WHERE b.project_id=p.id) as batch_count, (SELECT SUM(b.total_credits) FROM carbon_batches b WHERE b.project_id=p.id AND b.status='tokenised') as total_tokenised FROM projects p WHERE p.developer_id=$1 ORDER BY p.created_at DESC`, [req.user.id]);
    res.json({ projects: rows });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch your projects' }); }
});

module.exports = router;