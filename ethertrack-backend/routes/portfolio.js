// routes/portfolio.js — EtherTrack Corporate Edition
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

const VALID_STANDARDS        = ['VCS','GS','CDM','ACR','BEE'];
const VALID_CREDIT_TYPES     = ['voluntary','compliance'];
const VALID_BANKING          = ['available','banked'];
const VALID_VERIF_STATUSES   = ['pending','in_progress','verified'];
const VALID_CA_OPTIONS       = ['none','host_issued','itmo','pending'];

// ── POST /api/portfolio/submit-credit ─────────────────────────────
router.post('/submit-credit', authenticate, requireKYC, async (req, res) => {
  try {
    let {
      projectName, projectLocation, country, standard,
      projectId, projectType, developer,
      quantity, vintageYear, expiryDate, registrySerial, docIpfsHash,
      creditType            = 'voluntary',
      cbamEligible          = false,
      acvaName              = null,
      acvaDate              = null,
      acvaStatus            = 'pending',
      icmRegistryId         = null,
      bankingStatus         = 'available',
      correspondingAdjustment = 'none',
      sdgTags               = [],
      icvcmCcpEligible      = false,
      icvcmCcpLabel         = null,
      icvcmCcpDate          = null,
      registryLink          = null,
      methodologyId         = null,
      additionalityType     = 'not_specified',
      permanenceRating      = 'not_rated',
      coBenefitsVerified    = false,
    } = req.body;

    const parsedQuantity    = parseInt(quantity);
    const parsedVintageYear = parseInt(vintageYear);

    if (!parsedQuantity || !parsedVintageYear)
      return res.status(400).json({ error: 'Invalid quantity or vintage year' });
    if (!projectName || !registrySerial || !docIpfsHash || !projectId)
      return res.status(400).json({ error: 'Missing required fields' });

    const mappedProjectType = PROJECT_TYPE_MAP[projectType];
    if (!mappedProjectType)
      return res.status(400).json({ error: `Invalid project type: "${projectType}"` });
    if (!VALID_STANDARDS.includes(standard))
      return res.status(400).json({ error: `Invalid standard: "${standard}"` });
    if (!VALID_CREDIT_TYPES.includes(creditType))
      return res.status(400).json({ error: `Invalid credit type: "${creditType}"` });
    if (!VALID_BANKING.includes(bankingStatus))
      return res.status(400).json({ error: `Invalid banking status` });
    if (!VALID_VERIF_STATUSES.includes(acvaStatus))
      return res.status(400).json({ error: `Invalid verification status` });
    if (!VALID_CA_OPTIONS.includes(correspondingAdjustment))
      return res.status(400).json({ error: 'Invalid corresponding adjustment value' });
    if (standard === 'GS' && (!sdgTags || sdgTags.length === 0))
      return res.status(400).json({ error: 'Gold Standard credits require at least one SDG tag' });

    const { rows: dup } = await query(
      `SELECT id FROM carbon_batches WHERE registry_serial=$1 AND user_id=$2`,
      [registrySerial, req.user.id]
    );
    if (dup.length) return res.status(409).json({ error: 'Duplicate serial' });

    const { rows: projectRows } = await query(
      `SELECT id FROM projects WHERE project_code=$1 LIMIT 1`, [projectId]
    );

    let dbProjectId;
    if (projectRows.length > 0) {
      dbProjectId = projectRows[0].id;
    } else {
      const dbStandard = standard === 'BEE' ? 'VCS' : standard;
      const { rows: newProject } = await query(
        `INSERT INTO projects
         (developer_id,name,project_code,standard,project_type,location,country,developer_name,ipfs_document_hash,created_at)
         VALUES ($1,$2,$3,$4::credit_standard,$5::project_type,$6,$7,$8,$9,NOW())
         RETURNING id`,
        [req.user.id, projectName, projectId, dbStandard, mappedProjectType,
         projectLocation, country, developer, docIpfsHash]
      );
      dbProjectId = newProject[0].id;
    }

    const { rows } = await query(
      `INSERT INTO carbon_batches
       (user_id,project_id,project_name,project_location,country,
        standard,project_type,developer,
        quantity,total_credits,available_credits,
        vintage_year,expiry_date,registry_serial,doc_ipfs_hash,
        status,admin_status,
        credit_type,cbam_eligible,acva_name,acva_date,acva_status,
        icm_registry_id,banking_status,corresponding_adjustment,sdg_tags,
        icvcm_ccp_eligible,icvcm_ccp_label,icvcm_ccp_date,
        registry_link,methodology_id,additionality_type,permanence_rating,co_benefits_verified)
       VALUES ($1,$2,$3,$4,$5,
               $6,$7,$8,
               $9,$10,$11,
               $12,$13,$14,$15,
               'pending','pending',
               $16,$17,$18,$19,$20,
               $21,$22,$23,$24,
               $25,$26,$27,
               $28,$29,$30,$31,$32)
       RETURNING id`,
      [
        req.user.id, dbProjectId, projectName, projectLocation, country,
        standard, mappedProjectType, developer,
        parsedQuantity, parsedQuantity, parsedQuantity,
        parsedVintageYear, expiryDate || null, registrySerial, docIpfsHash,
        creditType,
        cbamEligible === true || cbamEligible === 'true',
        acvaName || null, acvaDate || null, acvaStatus,
        icmRegistryId || null, bankingStatus, correspondingAdjustment,
        JSON.stringify(sdgTags || []),
        icvcmCcpEligible === true || icvcmCcpEligible === 'true',
        icvcmCcpLabel || null,
        icvcmCcpDate || null,
        registryLink || null,
        methodologyId || null,
        additionalityType || 'not_specified',
        permanenceRating || 'not_rated',
        coBenefitsVerified === true || coBenefitsVerified === 'true',
      ]
    );

    res.json({ message: 'Credit submitted', id: rows[0].id });
  } catch (e) {
    console.error('Credit submit error:', e.message);
    res.status(500).json({ error: 'Submission failed', detail: e.message });
  }
});

// ── GET /api/portfolio/my-submissions ────────────────────────────
router.get('/my-submissions', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT cb.id, cb.project_name, cb.project_location, cb.country,
              cb.standard, cb.project_type, cb.developer, cb.quantity,
              cb.vintage_year, cb.expiry_date, cb.registry_serial,
              cb.doc_ipfs_hash, cb.admin_status, cb.admin_notes,
              cb.status, cb.created_at,
              cb.credit_type, cb.cbam_eligible,
              cb.acva_name, cb.acva_date, cb.acva_status,
              cb.icm_registry_id, cb.banking_status,
              cb.corresponding_adjustment, cb.sdg_tags,
              cb.icvcm_ccp_eligible, cb.icvcm_ccp_label, cb.icvcm_ccp_date,
              cb.registry_link, cb.methodology_id,
              cb.additionality_type, cb.permanence_rating, cb.co_benefits_verified,
              p.project_code AS project_id
       FROM carbon_batches cb
       LEFT JOIN projects p ON p.id = cb.project_id
       WHERE cb.user_id = $1
         AND cb.admin_status IN ('pending', 'rejected')
       ORDER BY cb.created_at DESC`,
      [req.user.id]
    );

    const submissions = rows.map(r => ({
      ...r,
      sdg_tags: typeof r.sdg_tags === 'string'
        ? JSON.parse(r.sdg_tags || '[]')
        : (r.sdg_tags || []),
    }));

    res.json({ submissions });
  } catch (e) {
    console.error('my-submissions error:', e.message);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

// ── GET /api/portfolio/my-credits ─────────────────────────────────
// ✅ FIXED: Now returns heldCredits and listedCredits separately
// so frontend can show partial listings correctly
router.get('/my-credits', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT cb.id, cb.project_name, cb.project_location, cb.country,
              cb.standard, cb.project_type, cb.developer,
              cb.quantity, cb.total_credits, cb.available_credits, cb.retired_credits,
              cb.vintage_year, cb.expiry_date, cb.registry_serial,
              cb.doc_ipfs_hash, cb.admin_status, cb.admin_notes,
              cb.status, cb.token_id, cb.tx_hash_mint,
              cb.created_at, cb.updated_at,
              cb.credit_type, cb.cbam_eligible,
              cb.acva_name, cb.acva_date, cb.acva_status,
              cb.icm_registry_id, cb.banking_status,
              cb.corresponding_adjustment, cb.sdg_tags,
              cb.icvcm_ccp_eligible, cb.icvcm_ccp_label, cb.icvcm_ccp_date,
              cb.registry_link, cb.methodology_id,
              cb.additionality_type, cb.permanence_rating, cb.co_benefits_verified,
              p.project_code AS project_id
       FROM carbon_batches cb
       LEFT JOIN projects p ON p.id = cb.project_id
       WHERE cb.user_id = $1
         AND cb.admin_status = 'approved'
       ORDER BY cb.updated_at DESC`,
      [req.user.id]
    );

    const credits = rows.map(r => ({
      ...r,
      // ✅ available_credits = held (not listed)
      // total_credits = full original amount
      // listed = total - available (what's currently on market)
      credits:        r.available_credits ?? r.quantity,
      heldCredits:    r.available_credits ?? r.quantity,
      listedCredits:  Math.max(0, (r.total_credits || r.quantity || 0) - (r.available_credits || 0)),
      vintageYear:    r.vintage_year,
      projectName:    r.project_name,
      serialNumber:   r.registry_serial,
      projectId:      r.project_id,
      tokenId:        r.token_id,
      tokenHex:       r.token_id != null
        ? `0x${Number(r.token_id).toString(16).padStart(8, '0').toUpperCase()}`
        : null,
      expiryDate:     r.expiry_date,
      // ✅ FIXED status logic:
      // PARTIAL = has both held and listed credits
      // LISTED = all credits listed (none held)
      // HELD = nothing listed
      status: (() => {
        if (r.status === 'exhausted') return 'RETIRED';
        if (r.status === 'expired')   return 'RETIRED';
        const held   = r.available_credits || 0;
        const listed = Math.max(0, (r.total_credits || r.quantity || 0) - held);
        if (listed > 0 && held > 0) return 'PARTIAL';  // ✅ new — has both
        if (listed > 0 && held === 0) return 'LISTED';
        return 'HELD';
      })(),
      isOnChain: r.status === 'tokenised' && r.token_id != null,
      sdg_tags: typeof r.sdg_tags === 'string'
        ? JSON.parse(r.sdg_tags || '[]')
        : (r.sdg_tags || []),
    }));

    res.json({ credits });
  } catch (e) {
    console.error('my-credits error:', e.message);
    res.status(500).json({ error: 'Failed to fetch credits' });
  }
});

// ── GET /api/portfolio/my-bought-credits ─────────────────────────
// ✅ NEW: Returns credits purchased from other sellers on marketplace
// These show in ALL + BOUGHT tabs
router.get('/my-bought-credits', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT
         t.id             AS trade_id,
         t.token_id,
         t.quantity,
         t.price_per_credit_inr,
         t.subtotal_inr,
         t.buyer_pays_inr,
         t.payment_mode,
         t.tx_hash,
         t.created_at    AS bought_at,
         t.status        AS trade_status,
         -- seller info
         su.full_name    AS seller_name,
         su.email        AS seller_email,
         su.wallet_address AS seller_wallet,
         -- batch/project info from the seller's batch
         cb.id           AS batch_id,
         cb.project_name,
         cb.project_location,
         cb.country,
         cb.standard,
         cb.project_type,
         cb.developer,
         cb.vintage_year,
         cb.expiry_date,
         cb.registry_serial,
         cb.credit_type,
         cb.cbam_eligible,
         cb.corresponding_adjustment,
         cb.sdg_tags,
         cb.icvcm_ccp_eligible,
         cb.icvcm_ccp_label,
         cb.registry_link,
         cb.methodology_id
       FROM trades t
       JOIN users su ON su.id = t.seller_id
       LEFT JOIN carbon_batches cb ON cb.id = t.batch_id
       WHERE t.buyer_id = $1
         AND t.status = 'completed'
       ORDER BY t.created_at DESC`,
      [req.user.id]
    );

    const bought = rows.map(r => ({
      // unique id for frontend keying
      id:               `bought-${r.trade_id}`,
      tradeId:          r.trade_id,
      tokenId:          r.token_id,
      tokenHex:         r.token_id != null
        ? `0x${Number(r.token_id).toString(16).padStart(8, '0').toUpperCase()}`
        : null,
      // credits
      credits:          r.quantity,
      heldCredits:      r.quantity,
      listedCredits:    0,
      quantity:         r.quantity,
      // pricing
      pricePerCredit:   r.price_per_credit_inr,
      totalPaid:        r.buyer_pays_inr,
      paymentMode:      r.payment_mode,
      txHash:           r.tx_hash,
      boughtAt:         r.bought_at,
      // project info
      batchId:          r.batch_id,
      projectName:      r.project_name || 'Unknown Project',
      location:         r.project_location || '',
      country:          r.country || '',
      standard:         r.standard || 'VCS',
      projectType:      r.project_type || '',
      developer:        r.developer || '',
      vintageYear:      r.vintage_year,
      expiryDate:       r.expiry_date,
      serialNumber:     r.registry_serial,
      creditType:       r.credit_type || 'voluntary',
      cbamEligible:     r.cbam_eligible || false,
      correspondingAdjustment: r.corresponding_adjustment || 'none',
      sdgTags:          typeof r.sdg_tags === 'string'
        ? JSON.parse(r.sdg_tags || '[]')
        : (r.sdg_tags || []),
      icvcmCcpEligible: r.icvcm_ccp_eligible || false,
      icvcmCcpLabel:    r.icvcm_ccp_label || '',
      registryLink:     r.registry_link || '',
      methodologyId:    r.methodology_id || '',
      // seller
      sellerName:       r.seller_name,
      sellerWallet:     r.seller_wallet,
      // status flags
      status:           'BOUGHT',
      isBought:         true,
      isOnChain:        true,
      admin_status:     'approved',
      vintageDiscount:  0,
    }));

    res.json({ bought });
  } catch (e) {
    console.error('my-bought-credits error:', e.message);
    res.status(500).json({ error: 'Failed to fetch bought credits' });
  }
});

// ── GET /api/portfolio/batch-by-token/:tokenId ────────────────────
router.get('/batch-by-token/:tokenId', authenticate, async (req, res) => {
  try {
    const tokenId = parseInt(req.params.tokenId);
    if (isNaN(tokenId)) return res.status(400).json({ error: 'Invalid tokenId' });

    const { rows } = await query(
      `SELECT id, project_name, standard, available_credits, user_id
       FROM carbon_batches
       WHERE token_id = $1
       LIMIT 1`,
      [tokenId]
    );

    if (!rows.length) return res.json({ batchId: null });

    res.json({
      batchId:          rows[0].id,
      projectName:      rows[0].project_name,
      standard:         rows[0].standard,
      availableCredits: rows[0].available_credits,
      sellerId:         rows[0].user_id,
    });
  } catch (e) {
    console.error('batch-by-token error:', e.message);
    res.json({ batchId: null });
  }
});

// ── DELETE /api/portfolio/submissions/:id ─────────────────────────
router.delete('/submissions/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await query(
      `SELECT id, user_id, admin_status FROM carbon_batches WHERE id=$1`, [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    if (rows[0].admin_status === 'approved')
      return res.status(400).json({ error: 'Cannot delete an approved credit' });
    await query(`DELETE FROM carbon_batches WHERE id=$1`, [id]);
    res.json({ message: 'Submission deleted' });
  } catch (e) {
    console.error('Delete submission error:', e.message);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// ── GET /api/portfolio/check-duplicate-retirement ─────────────────
router.get('/check-duplicate-retirement', authenticate, async (req, res) => {
  const { serial } = req.query;
  if (!serial) return res.status(400).json({ error: 'serial required' });
  try {
    const { rows } = await query(
      `SELECT id FROM retirements WHERE serial_number=$1 LIMIT 1`, [serial]
    );
    res.json({ found: rows.length > 0 });
  } catch (e) {
    res.status(500).json({ error: 'Check failed' });
  }
});

// ── GET /api/portfolio/kyc-status ────────────────────────────────
router.get('/kyc-status', authenticate, async (req, res) => {
  try {
    const { rows } = await query(
      `SELECT kyc_verified, kyc_verified_at, kyc_expires_at,
              kyc_renewal_notified, kyc_status
       FROM users WHERE id=$1`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    const u              = rows[0];
    const now            = new Date();
    const expiresAt      = u.kyc_expires_at ? new Date(u.kyc_expires_at) : null;
    const daysLeft       = expiresAt ? Math.floor((expiresAt - now) / (1000 * 60 * 60 * 24)) : null;
    const isExpired      = expiresAt ? expiresAt < now : false;
    const isExpiringSoon = daysLeft !== null && daysLeft <= 90 && daysLeft > 0;

    res.json({
      kycVerified:     u.kyc_verified,
      kycStatus:       u.kyc_status,
      kycVerifiedAt:   u.kyc_verified_at,
      kycExpiresAt:    u.kyc_expires_at,
      daysUntilExpiry: daysLeft,
      isExpired,
      isExpiringSoon,
      needsRenewal:    isExpired || isExpiringSoon,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch KYC status' });
  }
});

// ── GET /api/portfolio/emissions-summary ─────────────────────────
router.get('/emissions-summary', authenticate, async (req, res) => {
  const { year = new Date().getFullYear() } = req.query;
  try {
    const { rows } = await query(
      `SELECT
         COALESCE(SUM(co2e),0)                                          AS total,
         COALESCE(SUM(CASE WHEN scope=1 THEN co2e ELSE 0 END),0)       AS scope1,
         COALESCE(SUM(CASE WHEN scope=2 THEN co2e ELSE 0 END),0)       AS scope2,
         COALESCE(SUM(CASE WHEN scope=3 THEN co2e ELSE 0 END),0)       AS scope3,
         COUNT(*)                                                        AS record_count
       FROM emission_activities
       WHERE user_id=$1
         AND EXTRACT(YEAR FROM date::date) = $2`,
      [req.user.id, parseInt(year)]
    );
    res.json({ ...rows[0], year: parseInt(year) });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch emissions summary' });
  }
});

// ── GET /api/portfolio/export/ghg-protocol ───────────────────────
router.get('/export/ghg-protocol', authenticate, async (req, res) => {
  const { year = new Date().getFullYear() } = req.query;
  try {
    const [creditsRes, emissionsRes, retirementsRes] = await Promise.all([
      query(`SELECT * FROM carbon_batches WHERE user_id=$1 AND admin_status='approved'`, [req.user.id]),
      query(`SELECT * FROM emission_activities WHERE user_id=$1 AND EXTRACT(YEAR FROM date::date)=$2`, [req.user.id, year]),
      query(`SELECT * FROM retirements WHERE retired_by=$1 AND EXTRACT(YEAR FROM retired_at)=$2`, [req.user.id, year]),
    ]);

    const lines = [
      '# GHG Protocol Corporate Standard Inventory',
      `# Reporting Year: ${year}`,
      `# Methodology: GHG Protocol Corporate Standard`,
      '',
      '## SECTION 1: GHG INVENTORY',
      'Date,Activity,Scope,Category,Quantity,Unit,Emission Factor,CO2e (tonnes),Verification Status,Notes',
      ...emissionsRes.rows.map(r =>
        `${r.date},${r.activity},${r.scope},${r.category},${r.quantity},${r.unit},${r.factor},${parseFloat(r.co2e).toFixed(4)},${r.verified ? 'Verified' : 'Unverified'},${r.notes || ''}`
      ),
      '',
      '## SECTION 2: CARBON CREDITS PORTFOLIO',
      'Project Name,Standard,Serial Number,ICVCM CCP,Quantity (tCO2e),Vintage Year,Country,Credit Type,CBAM Eligible,Status,Token ID,Corresponding Adjustment',
      ...creditsRes.rows.map(r =>
        `"${r.project_name}",${r.standard},${r.registry_serial},${r.icvcm_ccp_eligible ? 'Yes' : 'No'},${r.quantity},${r.vintage_year},${r.country},${r.credit_type},${r.cbam_eligible ? 'Yes' : 'No'},${r.status},${r.token_id || 'Pending'},${r.corresponding_adjustment}`
      ),
      '',
      '## SECTION 3: RETIREMENTS',
      'Certificate ID,Project Name,Standard,Credits Retired (tCO2e),Vintage Year,Scope,Beneficiary Name,TX Hash,Date',
      ...retirementsRes.rows.map(r =>
        `${r.certificate_id},${r.project_name},${r.standard},${r.amount},${r.vintage_year},${r.retire_scope},${r.beneficiary_name || ''},${r.tx_hash},${r.retired_at?.toISOString().slice(0,10)}`
      ),
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="ghg_protocol_inventory_${year}.csv"`);
    res.send(lines.join('\n'));
  } catch (e) {
    console.error('GHG export error:', e.message);
    res.status(500).json({ error: 'Export failed' });
  }
});

// ── GET /api/portfolio/export/brsr ───────────────────────────────
router.get('/export/brsr', authenticate, async (req, res) => {
  const { year = new Date().getFullYear() } = req.query;
  try {
    const [emissionsRes, retirementsRes, userRes] = await Promise.all([
      query(`SELECT * FROM emission_activities WHERE user_id=$1 AND EXTRACT(YEAR FROM date::date)=$2`, [req.user.id, year]),
      query(`SELECT * FROM retirements WHERE retired_by=$1 AND EXTRACT(YEAR FROM retired_at)=$2`, [req.user.id, year]),
      query(`SELECT * FROM users WHERE id=$1`, [req.user.id]),
    ]);

    const u      = userRes.rows[0];
    const emits  = emissionsRes.rows;
    const rets   = retirementsRes.rows;
    const scope1 = emits.filter(r=>r.scope===1).reduce((s,r)=>s+parseFloat(r.co2e),0);
    const scope2 = emits.filter(r=>r.scope===2).reduce((s,r)=>s+parseFloat(r.co2e),0);
    const scope3 = emits.filter(r=>r.scope===3).reduce((s,r)=>s+parseFloat(r.co2e),0);
    const totalRetired = rets.reduce((s,r)=>s+r.amount,0);

    const lines = [
      '# SEBI BRSR Core',
      `# Company: ${u.company_name || u.full_name}`,
      `# Reporting Year: FY ${year}-${parseInt(year)+1}`,
      '',
      'Metric,Unit,FY Current,Source',
      `Scope 1 Emissions,tCO2e,${scope1.toFixed(2)},GHG Protocol`,
      `Scope 2 Emissions,tCO2e,${scope2.toFixed(2)},GHG Protocol`,
      `Scope 3 Emissions,tCO2e,${scope3.toFixed(2)},GHG Protocol`,
      `Total GHG Emissions,tCO2e,${(scope1+scope2+scope3).toFixed(2)},GHG Protocol`,
      `Carbon Credits Retired,tCO2e,${totalRetired},EtherTrack Blockchain`,
      `Net Emissions,tCO2e,${Math.max(0,(scope1+scope2+scope3)-totalRetired).toFixed(2)},Calculated`,
      '',
      'Certificate ID,Project,Standard,Quantity,Vintage,Scope Offset,Date,TX Hash',
      ...rets.map(r =>
        `${r.certificate_id},${r.project_name},${r.standard},${r.amount},${r.vintage_year},Scope ${r.retire_scope},${r.retired_at?.toISOString().slice(0,10)},${r.tx_hash}`
      ),
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="brsr_core_fy${year}.csv"`);
    res.send(lines.join('\n'));
  } catch (e) {
    console.error('BRSR export error:', e.message);
    res.status(500).json({ error: 'Export failed' });
  }
});

// ── GET /api/portfolio/export/cdp ────────────────────────────────
router.get('/export/cdp', authenticate, async (req, res) => {
  const { year = new Date().getFullYear() } = req.query;
  try {
    const [emissionsRes, retirementsRes, creditsRes] = await Promise.all([
      query(`SELECT * FROM emission_activities WHERE user_id=$1 AND EXTRACT(YEAR FROM date::date)=$2`, [req.user.id, year]),
      query(`SELECT * FROM retirements WHERE retired_by=$1 AND EXTRACT(YEAR FROM retired_at)=$2`, [req.user.id, year]),
      query(`SELECT * FROM carbon_batches WHERE user_id=$1 AND admin_status='approved'`, [req.user.id]),
    ]);

    const emits  = emissionsRes.rows;
    const rets   = retirementsRes.rows;
    const scope1 = emits.filter(r=>r.scope===1).reduce((s,r)=>s+parseFloat(r.co2e),0);
    const scope2 = emits.filter(r=>r.scope===2).reduce((s,r)=>s+parseFloat(r.co2e),0);
    const scope3 = emits.filter(r=>r.scope===3).reduce((s,r)=>s+parseFloat(r.co2e),0);

    const lines = [
      '# CDP Climate Change Questionnaire',
      `# Reporting Year: ${year}`,
      '',
      'CDP Question,Response',
      `C6.1 Scope 1 GHG emissions (metric tons CO2e),${scope1.toFixed(2)}`,
      `C6.3 Scope 2 GHG emissions location-based,${scope2.toFixed(2)}`,
      `C6.5 Scope 3 total,${scope3.toFixed(2)}`,
      `C11.2 Carbon credits retired,${rets.reduce((s,r)=>s+r.amount,0)} tCO2e`,
      '',
      'Project Name,Standard,Serial,ICVCM CCP,Quantity,Vintage,Country,CA,Certificate ID,TX Hash',
      ...rets.map(r => {
        const credit = creditsRes.rows.find(c => c.registry_serial === r.serial_number);
        return `"${r.project_name}",${r.standard},${r.serial_number},${credit?.icvcm_ccp_eligible ? 'Yes' : 'No'},${r.amount},${r.vintage_year},${r.country},${r.corresponding_adjustment},${r.certificate_id},${r.tx_hash}`;
      }),
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="cdp_climate_${year}.csv"`);
    res.send(lines.join('\n'));
  } catch (e) {
    console.error('CDP export error:', e.message);
    res.status(500).json({ error: 'Export failed' });
  }
});

// ── GET /api/portfolio/export/tcfd ───────────────────────────────
router.get('/export/tcfd', authenticate, async (req, res) => {
  const { year = new Date().getFullYear() } = req.query;
  try {
    const [emissionsRes, retirementsRes] = await Promise.all([
      query(`SELECT * FROM emission_activities WHERE user_id=$1 AND EXTRACT(YEAR FROM date::date)=$2`, [req.user.id, year]),
      query(`SELECT * FROM retirements WHERE retired_by=$1 AND EXTRACT(YEAR FROM retired_at)=$2`, [req.user.id, year]),
    ]);

    const emits  = emissionsRes.rows;
    const scope1 = emits.filter(r=>r.scope===1).reduce((s,r)=>s+parseFloat(r.co2e),0);
    const scope2 = emits.filter(r=>r.scope===2).reduce((s,r)=>s+parseFloat(r.co2e),0);
    const scope3 = emits.filter(r=>r.scope===3).reduce((s,r)=>s+parseFloat(r.co2e),0);
    const total  = scope1 + scope2 + scope3;

    const lines = [
      '# TCFD Climate Disclosure',
      `# Reporting Period: ${year}`,
      '',
      'Metric,Value,Unit,Year',
      `Scope 1 GHG Emissions,${scope1.toFixed(2)},tCO2e,${year}`,
      `Scope 2 GHG Emissions,${scope2.toFixed(2)},tCO2e,${year}`,
      `Scope 3 GHG Emissions,${scope3.toFixed(2)},tCO2e,${year}`,
      `Total GHG Emissions,${total.toFixed(2)},tCO2e,${year}`,
      `Carbon Credits Retired,${retirementsRes.rows.reduce((s,r)=>s+r.amount,0)},tCO2e,${year}`,
      `Net Emissions,${Math.max(0,total-retirementsRes.rows.reduce((s,r)=>s+r.amount,0)).toFixed(2)},tCO2e,${year}`,
      '',
      'Certificate ID,Standard,Amount (tCO2e),Scope,Date,TX Hash',
      ...retirementsRes.rows.map(r =>
        `${r.certificate_id},${r.standard},${r.amount},Scope ${r.retire_scope},${r.retired_at?.toISOString().slice(0,10)},${r.tx_hash}`
      ),
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="tcfd_disclosure_${year}.csv"`);
    res.send(lines.join('\n'));
  } catch (e) {
    console.error('TCFD export error:', e.message);
    res.status(500).json({ error: 'Export failed' });
  }
});

module.exports = router;