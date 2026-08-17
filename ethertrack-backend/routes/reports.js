// backend/routes/reports.js — EtherTrack
// PRODUCTION HARDENED — v3
// ─────────────────────────────────────────────────────────────────────────────
// CHANGES vs v2:
//
// [FEAT-BRSR-DATA]  For reportType === 'brsr', data is now assembled from
//                   the DB (section-a, section-b, principles, environmental,
//                   emission_activities, retirements) via assembleBrsrData().
//                   Client only needs to send { reportType, year } — all
//                   BRSR content is fetched server-side, not from the request
//                   body. This prevents stale/partial data from reaching the
//                   PDF generator and avoids 10MB payload limits on large orgs.
//                   Falls back to req.body fields if DB returns nothing yet
//                   (backward compat for clients that still send energyData etc).
//
// [FIX-TIMEOUT]     req/res timeouts bumped to 240000ms (4 min) — BRSR + GRI
//                   reports are large and Puppeteer needs time.
//
// [FIX-GRI]         'gri' added to ALLOWED_TYPES.
//
// All v2 fixes retained.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const express  = require('express');
const crypto   = require('crypto');
const { PDFDocument }    = require('pdf-lib');
const { authenticate }   = require('../middleware/auth');
const { pdfQueue } = require('../services/pdfQueue');
const { safeQuery }      = require('../db/pool');
const { assembleBrsrPayload } = require('../services/brsrPdfAdapter');

const router = express.Router();

const ALLOWED_TYPES = new Set(['ghg-protocol', 'brsr', 'cdp', 'tcfd', 'gri']);

const buildFilename = (type, year, orgName) => {
  const safe = (s) => String(s || 'org').replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40);
  const map = {
    'ghg-protocol': `ethertrack_ghg_protocol_FY${year}_${safe(orgName)}.pdf`,
    'brsr':         `ethertrack_brsr_core_FY${year}_${safe(orgName)}.pdf`,
    'cdp':          `ethertrack_cdp_climate_FY${year}_${safe(orgName)}.pdf`,
    'tcfd':         `ethertrack_tcfd_FY${year}_${safe(orgName)}.pdf`,
    'gri':          `ethertrack_gri_FY${year}_${safe(orgName)}.pdf`,
  };
  return map[type] || `ethertrack_report_FY${year}.pdf`;
};

const buildAuditHash = (emissions = []) => {
  const payload = JSON.stringify(
    [...emissions]
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map(r => ({ id: r.id, date: r.date, activity: r.activity, co2e: r.co2e, scope: r.scope }))
  );
  return crypto.createHash('sha256').update(payload).digest('hex').toUpperCase().slice(0, 32);
};

const injectMetadata = async (pdfBuffer, { type, year, orgName, auditHash }) => {
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const typeLabels = {
      'ghg-protocol': 'GHG Protocol Corporate Standard',
      'brsr':         'SEBI BRSR Core Environmental Disclosures',
      'cdp':          'CDP Climate Change Questionnaire',
      'tcfd':         'TCFD Climate-related Financial Disclosures',
      'gri':          'GRI Sustainability Report',
    };
    pdfDoc.setTitle(`${typeLabels[type] || type} — ${orgName} — FY ${year}`);
    pdfDoc.setAuthor(orgName || 'EtherTrack');
    pdfDoc.setSubject(`GHG / ESG Regulatory Report FY ${year}`);
    pdfDoc.setKeywords(['GHG','ESG','BRSR','CDP','TCFD','GRI','ISO 14064','CEA V20.0','DEFRA 2024','IPCC AR6','EtherTrack',`FY${year}`,orgName]);
    pdfDoc.setProducer('EtherTrack Carbon Intelligence — Puppeteer/Chromium');
    pdfDoc.setCreator('EtherTrack Technologies Private Limited');
    pdfDoc.setCreationDate(new Date());
    pdfDoc.setModificationDate(new Date());
    return Buffer.from(await pdfDoc.save());
  } catch (err) {
    console.error('[reports] pdf-lib metadata injection failed:', err.message);
    return pdfBuffer;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// [FEAT-BRSR-DATA] Assemble full BRSR payload from DB for PDF generation
// ─────────────────────────────────────────────────────────────────────────────
async function assembleBrsrData(userId, year, reqUser = null) {
  // Same scope resolution as routes/emissions.js and routes/brsrDataRoutes.js:
  // business accounts share one org-wide ledger, individuals stay solo.
  // Section A/B/principles already key off org_id (falls back to the
  // caller's own id for individuals, matching brsrDataRoutes.js). P6
  // environmental has no org_id column, so it always stays user-scoped.
  const scopeId = reqUser?.org_id || userId;
  const isOrgScoped = Boolean(reqUser?.org_id);

  const [secA, secB, principlesRows, environmental, emissionRows, retirementRows, profileRows] =
    await Promise.all([
      safeQuery(
        `SELECT entity, business, workforce, structure, grievance
         FROM brsr_section_a WHERE org_id = $1 AND year = $2`,
        [scopeId, year]
      ),
      safeQuery(
        `SELECT policy_matrix AS "policyMatrix", non_coverage AS "nonCoverage", governance
         FROM brsr_section_b WHERE org_id = $1 AND year = $2`,
        [scopeId, year]
      ),
      safeQuery(
        `SELECT principle_id, data FROM brsr_principles WHERE org_id = $1 AND year = $2`,
        [scopeId, year]
      ),
      safeQuery(
        `SELECT energy, water, waste FROM brsr_environmental WHERE user_id = $1 AND year = $2`,
        [userId, year] // P6 has no org_id column — always the requester's own row
      ),
      safeQuery(
        isOrgScoped
          ? `SELECT
               COALESCE(SUM(co2e) FILTER (WHERE scope = 1), 0) AS scope1,
               COALESCE(SUM(co2e) FILTER (WHERE scope = 2), 0) AS scope2,
               COALESCE(SUM(co2e) FILTER (WHERE scope = 3), 0) AS scope3
             FROM emission_activities
             WHERE org_id = $1 AND EXTRACT(YEAR FROM date) = $2`
          : `SELECT
               COALESCE(SUM(co2e) FILTER (WHERE scope = 1), 0) AS scope1,
               COALESCE(SUM(co2e) FILTER (WHERE scope = 2), 0) AS scope2,
               COALESCE(SUM(co2e) FILTER (WHERE scope = 3), 0) AS scope3
             FROM emission_activities
             WHERE user_id = $1 AND EXTRACT(YEAR FROM date) = $2`,
        [scopeId, year]
      ),
      safeQuery(
        isOrgScoped
          ? `SELECT COALESCE(SUM(amount), 0) AS retired_tco2e
             FROM retirements
             WHERE retire_year = $2
               AND retired_by IN (SELECT id FROM users WHERE org_id = $1)`
          : `SELECT COALESCE(SUM(amount), 0) AS retired_tco2e
             FROM retirements WHERE retired_by = $1 AND retire_year = $2`,
        [scopeId, year]
      ).catch(() => ({ rows: [{ retired_tco2e: 0 }] })),
      safeQuery(
        `SELECT company_name, company_cin, company_gstin, company_pan, company_type,
                industry AS industry, revenue_cr, employees, base_year, net_zero_year
         FROM emission_profiles WHERE user_id = $1 LIMIT 1`,
        [userId]
      ).catch(() => ({ rows: [] })),
    ]);

  // Build principle map
  const principleMap = {};
  for (const row of principlesRows.rows) {
    principleMap[row.principle_id] = row.data;
  }
  // Inject P6 environmental data
  const env = environmental.rows[0];
  if (env) {
    principleMap.p6 = { energyData: env.energy, waterData: env.water, wasteData: env.waste };
  }

  const snapshot = {
    sectionA:   secA.rows[0]  || null,
    sectionB:   secB.rows[0]  || null,
    principles: principleMap,
  };

  const { brsr, energyData, waterData, wasteData } = assembleBrsrPayload(snapshot);

  const em = emissionRows.rows[0]   || {};
  const re = retirementRows.rows[0] || {};
  const pr = profileRows.rows[0]    || {};

  // Fall back to the signup-time company fields on `users` when the person
  // hasn't filled in the Company Profile tab (emission_profiles) yet — so a
  // freshly-verified business account still gets a populated BRSR header
  // instead of "Organisation" with blank fields.
  const orgName = pr.company_name || reqUser?.company_name || 'Organisation';

  return {
    orgName,
    year,
    profile: {
      company_cin:   pr.company_cin    || reqUser?.company_cin    || null,
      company_gstin: pr.company_gstin  || reqUser?.company_gstin  || null,
      company_pan:   pr.company_pan    || reqUser?.company_pan    || null,
      company_type:  pr.company_type   || reqUser?.company_type   || null,
      industry:      pr.industry       || reqUser?.industry_sector || null,
      revenue_cr:    pr.revenue_cr     || null,
      employees:     pr.employees      || null,
      base_year:     pr.base_year      || null,
      net_zero_year: pr.net_zero_year  || null,
    },
    brsr,
    energyData:  energyData || null,
    waterData:   waterData  || null,
    wasteData:   wasteData  || null,
    emissions: [
      { scope: 1, co2e: parseFloat(em.scope1 || 0) },
      { scope: 2, co2e: parseFloat(em.scope2 || 0) },
      { scope: 3, co2e: parseFloat(em.scope3 || 0) },
    ],
    retirements:           [{ amount: parseFloat(re.retired_tco2e || 0) }],
    previousYearEmissions: [],
    gridEmissionFactor:    0.727,
    gridEFVersion:         'CEA V20.0 Dec 2024',
    pppRate:               27.3,
    pppRateSource:         'IMF WEO April 2025',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/reports/generate
// ─────────────────────────────────────────────────────────────────────────────
router.post('/generate', authenticate, async (req, res) => {
  req.setTimeout(240000);
  res.setTimeout(240000);

  const {
    reportType,
    orgName,
    year,
    profile,
    emissions             = [],
    retirements           = [],
    credits               = [],
    verifier              = null,
    previousYearEmissions = [],
    scope2Location,
    scope2Market,
    gridEmissionFactor = 0.727,
    gridEFVersion      = 'CEA V20.0 Dec 2024',
    pppRate            = 27.3,
    pppRateSource      = 'IMF WEO April 2025',
    energyData  = null,
    waterData   = null,
    wasteData   = null,
  } = req.body;

  if (!ALLOWED_TYPES.has(reportType)) {
    return res.status(400).json({ error: `Invalid report type. Allowed: ${[...ALLOWED_TYPES].join(', ')}` });
  }
  if (!year || !Number.isInteger(Number(year))) {
    return res.status(400).json({ error: 'year is required and must be an integer' });
  }
  if (!Array.isArray(emissions)) {
    return res.status(400).json({ error: 'emissions must be an array' });
  }

  try {
    let reportData;

    if (reportType === 'brsr') {
      // [FEAT-BRSR-DATA] Assemble from DB — ignore most body fields for BRSR
      console.log(`[reports] assembling BRSR from DB for user=${req.user.id} year=${year}`);
      const dbData = await assembleBrsrData(req.user.id, Number(year), req.user);

      // Merge DB data with verifier from request body (verifier not in DB yet)
      reportData = {
        ...dbData,
        verifier:      verifier       || null,
        scope2Location: scope2Location ?? 0,
        scope2Market:   scope2Market   ?? 0,
        auditHash:     buildAuditHash(dbData.emissions),
      };
    } else {
      // GHG / CDP / TCFD / GRI — use client-supplied data
      const safeEmissions     = Array.isArray(emissions)             ? emissions             : [];
      const safeRetirements   = Array.isArray(retirements)           ? retirements           : [];
      const safeCredits       = Array.isArray(credits)               ? credits               : [];
      const safePrevEmissions = Array.isArray(previousYearEmissions) ? previousYearEmissions : [];

      reportData = {
        orgName:               orgName || profile?.company_name || req.user.company_name || 'Organisation',
        year:                  Number(year),
        profile: {
          company_name:  req.user.company_name  || null,
          company_gstin: req.user.company_gstin || null,
          company_pan:   req.user.company_pan   || null,
          company_cin:   req.user.company_cin   || null,
          company_type:  req.user.company_type  || null,
          industry:      req.user.industry_sector || null,
          ...(profile || {}), // client-supplied values win over defaults
        },
        emissions:             safeEmissions,
        retirements:           safeRetirements,
        credits:               safeCredits,
        verifier:              verifier              || null,
        previousYearEmissions: safePrevEmissions,
        scope2Location:        scope2Location        ?? 0,
        scope2Market:          scope2Market          ?? 0,
        gridEmissionFactor:    gridEmissionFactor    || 0.727,
        gridEFVersion:         gridEFVersion         || 'CEA V20.0 Dec 2024',
        pppRate:               pppRate               || 27.3,
        pppRateSource:         pppRateSource         || 'IMF WEO April 2025',
        auditHash:             buildAuditHash(safeEmissions),
        energyData:            energyData            || null,
        waterData:             waterData             || null,
        wasteData:             wasteData             || null,
      };
    }

    console.log(`[reports] generating ${reportType} for ${reportData.orgName} FY ${year}`);
    
    // Use PDF queue for async generation
    const rawPdf = await pdfQueue.generateReport(reportType, reportData);

    const finalPdf = await injectMetadata(rawPdf, {
      type:      reportType,
      year:      Number(year),
      orgName:   reportData.orgName,
      auditHash: reportData.auditHash,
    });

    const filename = buildFilename(reportType, year, reportData.orgName);

    res.setHeader('Content-Type',        'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length',      finalPdf.length);
    res.setHeader('X-Audit-Hash',        reportData.auditHash);
    res.setHeader('X-Report-Type',       reportType);
    res.setHeader('X-Report-Year',       String(year));
    res.setHeader('Cache-Control',       'no-store');
    res.send(finalPdf);

    console.log(`[reports] sent ${filename} (${(finalPdf.length / 1024).toFixed(0)} KB)`);
  } catch (err) {
    console.error(`[reports] generation failed for ${reportType}:`, err.message);
    res.status(500).json({
      error:  'PDF generation failed',
      detail: process.env.NODE_ENV !== 'production' ? err.message : undefined,
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/reports/health
// ─────────────────────────────────────────────────────────────────────────────
router.get('/health', authenticate, (req, res) => {
  res.json({
    status:      'ok',
    engine:      'Puppeteer/Chromium',
    reportTypes: [...ALLOWED_TYPES],
    metadataLib: 'pdf-lib',
    pdfStandard: 'PDF/A-1b',
    timestamp:   new Date().toISOString(),
  });
});

module.exports = router;