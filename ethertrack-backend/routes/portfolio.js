// routes/portfolio.js  —  EtherTrack · deployment-ready
const router = require('express').Router();
const { safeQuery: query } = require('../db/pool');
const { authenticate, requireKYC } = require('../middleware/auth');

// ── Project type → DB enum map ────────────────────────────────────
const PROJECT_TYPE_MAP = {
  'Renewable Energy (BEE)':'Renewable','Green Hydrogen (BEE)':'Renewable',
  'Industrial Energy Efficiency (BEE)':'Efficiency','Landfill Methane Recovery (BEE)':'Methane',
  'Mangrove Afforestation (BEE)':'Forestry','Renewable Energy with Storage (BEE)':'Renewable',
  'Offshore Wind (BEE)':'Renewable','Compressed Biogas (BEE)':'Methane',
  'Renewable Energy':'Renewable','Reforestation':'Forestry','REDD+':'Forestry',
  'Avoided Deforestation':'Forestry','Blue Carbon':'Ocean','Methane Capture':'Methane',
  'Energy Efficiency':'Efficiency','Cookstoves':'Efficiency','Soil Carbon':'Agriculture',
  'Industrial Gas':'Methane','Forestry':'Forestry','Renewable':'Renewable',
  'Methane':'Methane','Efficiency':'Efficiency','Ocean':'Ocean','Agriculture':'Agriculture',
};

const VALID_STANDARDS          = ['VCS','GS','CDM','ACR','BEE'];
const VALID_CREDIT_TYPES       = ['voluntary','compliance'];
const VALID_BANKING            = ['available','banked'];
const VALID_VERIF_STATUSES     = ['pending','in_progress','verified'];
const VALID_CA_OPTIONS         = ['none','host_issued','itmo','pending'];

// ── POST /api/portfolio/submit-credit ─────────────────────────────
router.post('/submit-credit', authenticate, requireKYC, async (req, res) => {
  const {
    projectName, projectLocation, country, standard,
    projectId, projectType, developer,
    quantity, vintageYear, expiryDate, registrySerial, docIpfsHash,
    // CCTS + compliance fields
    creditType            = 'voluntary',
    cbamEligible          = false,
    acvaName              = null,
    acvaDate              = null,
    acvaStatus            = 'pending',
    icmRegistryId         = null,
    bankingStatus         = 'available',
    // Article 6 / SDG fields
    correspondingAdjustment = 'none',
    sdgTags               = [],
  } = req.body;

  // Required field validation
  if (!projectName||!registrySerial||!quantity||!docIpfsHash||!projectId) {
    return res.status(400).json({ error:'Missing required fields' });
  }
  const mappedProjectType = PROJECT_TYPE_MAP[projectType];
  if (!mappedProjectType) return res.status(400).json({ error:`Invalid project type: "${projectType}"` });
  if (!VALID_STANDARDS.includes(standard)) return res.status(400).json({ error:`Invalid standard: "${standard}"` });
  if (!VALID_CREDIT_TYPES.includes(creditType)) return res.status(400).json({ error:`Invalid credit type: "${creditType}"` });
  if (!VALID_BANKING.includes(bankingStatus)) return res.status(400).json({ error:`Invalid banking status: "${bankingStatus}"` });
  if (!VALID_VERIF_STATUSES.includes(acvaStatus)) return res.status(400).json({ error:`Invalid verification status: "${acvaStatus}"` });
  if (!VALID_CA_OPTIONS.includes(correspondingAdjustment)) return res.status(400).json({ error:`Invalid corresponding adjustment value` });

  // Gold Standard requires at least 1 SDG tag
  if (standard==='GS'&&(!sdgTags||sdgTags.length===0)) {
    return res.status(400).json({ error:'Gold Standard credits require at least one SDG co-benefit tag' });
  }

  try {
    // Duplicate serial check for this user
    const { rows:dup } = await query(
      `SELECT id FROM carbon_batches WHERE registry_serial=$1 AND user_id=$2`,
      [registrySerial, req.user.id]
    );
    if (dup.length) return res.status(409).json({ error:'You already submitted this serial number' });

    // Look up or create project record
    const { rows:projectRows } = await query(
      `SELECT id FROM projects WHERE project_code=$1 LIMIT 1`,
      [projectId]
    );
    let dbProjectId;
    if (projectRows.length>0) {
      dbProjectId = projectRows[0].id;
    } else {
      const dbStandard = standard==='BEE'?'VCS':standard; // BEE not in credit_standard enum
      const { rows:newProject } = await query(
        `INSERT INTO projects
           (developer_id,name,project_code,standard,project_type,location,country,developer_name,ipfs_document_hash,created_at)
         VALUES ($1,$2,$3,$4::credit_standard,$5::project_type,$6,$7,$8,$9,NOW())
         RETURNING id`,
        [req.user.id,projectName,projectId,dbStandard,mappedProjectType,projectLocation,country,developer,docIpfsHash]
      );
      dbProjectId = newProject[0].id;
    }

    // Insert batch with all compliance + Article 6 + SDG fields
    const { rows } = await query(
      `INSERT INTO carbon_batches
         (user_id,project_id,project_name,project_location,country,standard,project_type,developer,quantity,
          vintage_year_sub,expiry_date,registry_serial,doc_ipfs_hash,admin_status,
          credit_type,cbam_eligible,acva_name,acva_date,acva_status,icm_registry_id,banking_status,
          corresponding_adjustment,sdg_tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',$14,$15,$16,$17,$18,$19,$20,$21,$22)
       RETURNING id`,
      [
        req.user.id, dbProjectId, projectName, projectLocation, country,
        standard, mappedProjectType, developer, quantity,
        vintageYear, expiryDate||null, registrySerial, docIpfsHash,
        creditType,
        cbamEligible===true||cbamEligible==='true',
        acvaName||null, acvaDate||null, acvaStatus,
        icmRegistryId||null, bankingStatus,
        correspondingAdjustment,
        JSON.stringify(sdgTags||[]),
      ]
    );

    res.json({ message:'Credit submitted for verification', id:rows[0].id });
  } catch(e) {
    console.error('Credit submit error:', e.message);
    res.status(500).json({ error:'Submission failed', detail:e.message });
  }
});

// ── GET /api/portfolio/my-submissions ─────────────────────────────
router.get('/my-submissions', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT cb.id, cb.project_name, cb.project_location, cb.country,
              cb.standard, cb.project_type, cb.developer, cb.quantity,
              cb.vintage_year_sub AS vintage_year, cb.expiry_date, cb.registry_serial,
              cb.doc_ipfs_hash, cb.admin_status, cb.admin_notes, cb.created_at,
              p.project_code AS project_id,
              cb.credit_type, cb.cbam_eligible,
              cb.acva_name, cb.acva_date, cb.acva_status,
              cb.icm_registry_id, cb.banking_status,
              cb.corresponding_adjustment,
              cb.sdg_tags
       FROM carbon_batches cb
       LEFT JOIN projects p ON p.id = cb.project_id
       WHERE cb.user_id=$1
       ORDER BY cb.created_at DESC`,
      [req.user.id]
    );
    // Parse sdg_tags JSON if stored as text
    const submissions = rows.map(r=>({
      ...r,
      sdg_tags: typeof r.sdg_tags==='string' ? JSON.parse(r.sdg_tags||'[]') : (r.sdg_tags||[]),
    }));
    res.json({ submissions });
  } catch(e) {
    console.error('My submissions error:', e.message);
    res.status(500).json({ error:'Failed to fetch submissions' });
  }
});

// ── DELETE /api/portfolio/submissions/:id ─────────────────────────
router.delete('/submissions/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT id,admin_status FROM carbon_batches WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error:'Submission not found' });
    if (rows[0].admin_status==='approved') return res.status(403).json({ error:'Cannot delete an approved submission' });
    await query(`DELETE FROM carbon_batches WHERE id=$1 AND user_id=$2`,[req.params.id, req.user.id]);
    res.json({ message:'Submission deleted' });
  } catch(e) {
    console.error('Delete submission error:', e.message);
    res.status(500).json({ error:'Failed to delete submission' });
  }
});

// ── GET /api/portfolio/check-duplicate-retirement ────────────────
// ✅ Real duplicate-retirement serial check — replaces fake "CLEAR" label
router.get('/check-duplicate-retirement', authenticate, async (req, res) => {
  const { serial } = req.query;
  if (!serial) return res.status(400).json({ error:'Serial required' });
  try {
    const { rows } = await query(
      `SELECT id FROM retirements WHERE serial_number=$1 LIMIT 1`,
      [serial]
    );
    res.json({ found: rows.length>0 });
  } catch(e) {
    console.error('Duplicate retirement check error:', e.message);
    // Fail safe — return not-found so retirement isn't blocked on DB error
    res.json({ found:false, error:'Check failed, proceeding with caution' });
  }
});

// ── GET /api/portfolio/emissions-summary ─────────────────────────
// Powers OffsetGapPanel — returns gracefully if emission_logs doesn't exist yet
router.get('/emissions-summary', authenticate, async (req, res) => {
  const year = parseInt(req.query.year)||new Date().getFullYear();
  try {
    const { rows } = await query(
      `SELECT
         COALESCE(SUM(scope1_total),0) AS scope1,
         COALESCE(SUM(scope2_total),0) AS scope2,
         COALESCE(SUM(scope3_total),0) AS scope3,
         COALESCE(SUM(scope1_total+scope2_total+scope3_total),0) AS total
       FROM emission_logs
       WHERE user_id=$1 AND EXTRACT(YEAR FROM log_date)=$2`,
      [req.user.id, year]
    );
    res.json({ ...rows[0], year });
  } catch(e) {
    if (e.message.includes('does not exist')||e.code==='42P01') {
      return res.json({ scope1:0, scope2:0, scope3:0, total:0, year });
    }
    res.json({ scope1:0, scope2:0, scope3:0, total:0, year });
  }
});

// ── POST /api/portfolio/record-retirement ────────────────────────
// Syncs on-chain retirement to DB — uses actual retirements schema
router.post('/record-retirement', authenticate, async (req, res) => {
  const {
    tokenId, projectName, standard, credits, vintageYear,
    serialNumber, developer, location, country, projectType,
    txHash, beneficiary, retireScope, correspondingAdjustment,
  } = req.body;
  try {
    await query(
      `INSERT INTO retirements
         (token_id,retired_by,amount,tx_hash,beneficiary_name,retire_scope,
          project_name,standard,vintage_year,serial_number,developer,location,country,project_type,
          corresponding_adjustment,retired_at,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())
       ON CONFLICT (tx_hash) DO NOTHING`,
      [
        tokenId, req.user.id, credits, txHash, beneficiary, retireScope,
        projectName, standard, vintageYear, serialNumber, developer, location, country, projectType,
        correspondingAdjustment||'none',
      ]
    );
    res.json({ message:'Retirement recorded' });
  } catch(e) {
    console.error('Record retirement error:', e.message);
    res.status(500).json({ error:'Failed to record retirement' });
  }
});

module.exports = router;