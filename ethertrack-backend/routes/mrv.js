// routes/mrv.js
// MRV (Monitoring, Reporting, Verification) Workflow API

'use strict';

const router = require('express').Router();
const { safeQuery: query, withTransaction } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requirePlan } = require('../middleware/planGate');
const { writeLimiter } = require('../middleware/rateLimit');
const multer = require('multer');
const MRVService = require('../src/services/mrvService').default;
const { uploadToIPFS } = require('../services/ipfs');

const mrvService = new MRVService();

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'application/pdf',
            'image/jpeg', 'image/png', 'image/tiff',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
            'text/csv'
        ];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Allowed: PDF, images, Excel, CSV'));
        }
    }
});

// ── Rate limiters ────────────────────────────────────────────────────────────
const mrvWriteLimiter = require('express-rate-limit')({
    windowMs: 60 * 1000,
    max: 30,
    keyGenerator: (req) => req.user?.id ?? req.ip,
    handler: (req, res) => res.status(429).json({ error: 'Too many MRV requests' })
});

const mrvReadLimiter = require('express-rate-limit')({
    windowMs: 60 * 1000,
    max: 120,
    keyGenerator: (req) => req.user?.id ?? req.ip,
});

// ── Plan Management ──────────────────────────────────────────────────────────

// POST /api/mrv/plans - Create MRV plan
router.post('/plans', authenticate, requirePlan('growth'), mrvWriteLimiter, async (req, res) => {
    try {
        const {
            planName, description, reportingYear, methodologyTemplate,
            coversScope1, coversScope2, coversScope3,
            facilityIds, assetIds,
            reportingPeriodStart, reportingPeriodEnd,
            submissionDeadline, verificationDeadline
        } = req.body;

        if (!planName || !reportingYear || !methodologyTemplate || !reportingPeriodStart || !reportingPeriodEnd) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const plan = await MRVService.createPlan({
            userId: req.user.id,
            orgId: req.user.org_id,
            planName,
            description,
            reportingYear,
            methodologyTemplate,
            coversScope1,
            coversScope2,
            coversScope3,
            facilityIds,
            assetIds,
            reportingPeriodStart,
            reportingPeriodEnd,
            submissionDeadline,
            verificationDeadline
        });

        res.status(201).json({ success: true, plan });
    } catch (error) {
        console.error('[mrv/plans POST]', error.message);
        res.status(400).json({ error: error.message });
    }
});

// GET /api/mrv/plans - List plans
router.get('/plans', authenticate, mrvReadLimiter, async (req, res) => {
    try {
        const { state, year, limit, offset } = req.query;
        const result = await MRVService.listPlans(req.user.id, { state, year, limit, offset });
        res.json(result);
    } catch (error) {
        console.error('[mrv/plans GET]', error.message);
        res.status(500).json({ error: 'Failed to fetch plans' });
    }
});

// GET /api/mrv/plans/:id - Get plan details
router.get('/plans/:id', authenticate, async (req, res) => {
    try {
        const plan = await MRVService.getPlan(req.params.id);
        if (!plan) return res.status(404).json({ error: 'Plan not found' });
        if (plan.userId !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Not authorized' });
        }
        res.json({ plan });
    } catch (error) {
        console.error('[mrv/plans/:id GET]', error.message);
        res.status(500).json({ error: 'Failed to fetch plan' });
    }
});

// POST /api/mrv/plans/:id/submit - Submit plan for verification
router.post('/plans/:id/submit', authenticate, requirePlan('growth'), mrvWriteLimiter, async (req, res) => {
    try {
        const plan = await MRVService.submitPlan(req.params.id, req.user.id);
        res.json({ success: true, plan });
    } catch (error) {
        console.error('[mrv/plans/submit]', error.message);
        res.status(400).json({ error: error.message });
    }
});

// POST /api/mrv/plans/:id/transition - Transition plan state
router.post('/plans/:id/transition', authenticate, requirePlan('growth'), mrvWriteLimiter, async (req, res) => {
    try {
        const { fromState, toState, reason } = req.body;
        if (!fromState || !toState) {
            return res.status(400).json({ error: 'fromState and toState required' });
        }
        const plan = await MRVService.transitionState(req.params.id, fromState, toState, req.user.id, reason);
        res.json({ success: true, plan });
    } catch (error) {
        console.error('[mrv/plans/transition]', error.message);
        res.status(400).json({ error: error.message });
    }
});

// ── Evidence Management ──────────────────────────────────────────────────────

// POST /api/mrv/plans/:planId/evidence - Upload evidence
router.post('/plans/:planId/evidence', authenticate, requirePlan('growth'), mrvWriteLimiter, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const { title, description, evidenceType, activityId } = req.body;
        if (!title || !evidenceType) {
            return res.status(400).json({ error: 'title and evidenceType required' });
        }

        const evidence = await MRVService.uploadEvidence({
            planId: req.params.planId,
            activityId: activityId || undefined,
            title,
            description,
            evidenceType,
            file: req.file.buffer,
            fileName: req.file.originalname,
            mimeType: req.file.mimetype,
            uploadedBy: req.user.id,
            metadata: req.body.metadata ? JSON.parse(req.body.metadata) : undefined
        });

        res.status(201).json({ success: true, evidence });
    } catch (error) {
        console.error('[mrv/evidence POST]', error.message);
        res.status(400).json({ error: error.message });
    }
});

// GET /api/mrv/plans/:planId/evidence - List evidence
router.get('/plans/:planId/evidence', authenticate, async (req, res) => {
    try {
        const evidence = await MRVService.getEvidenceForPlan(req.params.planId);
        res.json({ evidence });
    } catch (error) {
        console.error('[mrv/evidence GET]', error.message);
        res.status(500).json({ error: 'Failed to fetch evidence' });
    }
});

// POST /api/mrv/evidence/:id/anchor - Anchor evidence on-chain
router.post('/evidence/:id/anchor', authenticate, requirePlan('growth'), async (req, res) => {
    try {
        const result = await MRVService.anchorEvidenceOnChain(req.params.id, req.user.id);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('[mrv/evidence/anchor]', error.message);
        res.status(400).json({ error: error.message });
    }
});

// POST /api/mrv/evidence/:id/verify - Verify evidence
router.post('/evidence/:id/verify', authenticate, async (req, res) => {
    try {
        const { notes } = req.body;
        const evidence = await MRVService.verifyEvidence(req.params.id, req.user.id, notes);
        res.json({ success: true, evidence });
    } catch (error) {
        console.error('[mrv/evidence/verify]', error.message);
        res.status(400).json({ error: error.message });
    }
});

// POST /api/mrv/evidence/:id/reject - Reject evidence
router.post('/evidence/:id/reject', authenticate, async (req, res) => {
    try {
        const { notes } = req.body;
        if (!notes) return res.status(400).json({ error: 'Rejection notes required' });
        const evidence = await MRVService.rejectEvidence(req.params.id, req.user.id, notes);
        res.json({ success: true, evidence });
    } catch (error) {
        console.error('[mrv/evidence/reject]', error.message);
        res.status(400).json({ error: error.message });
    }
});

// ── Verification Findings ────────────────────────────────────────────────────

// POST /api/mrv/plans/:planId/findings - Add finding
router.post('/plans/:planId/findings', authenticate, requirePlan('growth'), mrvWriteLimiter, async (req, res) => {
    try {
        const { severity, category, title, description, recommendation, referenceSection, referenceActivity, referenceEvidence } = req.body;
        if (!severity || !category || !title || !description) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const finding = await MRVService.addFinding({
            planId: req.params.planId,
            evidenceId: req.body.evidenceId,
            severity,
            category,
            title,
            description,
            recommendation,
            referenceSection,
            referenceActivity,
            referenceEvidence: req.body.referenceEvidence,
            createdBy: req.user.id
        });

        res.status(201).json({ success: true, finding });
    } catch (error) {
        console.error('[mrv/findings POST]', error.message);
        res.status(400).json({ error: error.message });
    }
});

// GET /api/mrv/plans/:planId/findings - List findings
router.get('/plans/:planId/findings', authenticate, async (req, res) => {
    try {
        const findings = await MRVService.getFindings(req.params.planId);
        res.json({ findings });
    } catch (error) {
        console.error('[mrv/findings GET]', error.message);
        res.status(500).json({ error: 'Failed to fetch findings' });
    }
});

// POST /api/mrv/findings/:id/resolve - Resolve finding
router.post('/findings/:id/resolve', authenticate, async (req, res) => {
    try {
        const { response } = req.body;
        if (!response) return res.status(400).json({ error: 'Response required' });
        const finding = await MRVService.resolveFinding(req.params.id, req.user.id, response);
        res.json({ success: true, finding });
    } catch (error) {
        console.error('[mrv/findings/resolve]', error.message);
        res.status(400).json({ error: error.message });
    }
});

// ── Verifier Management ────────────────────────────────────────────────────

// POST /api/mrv/verifiers - Register verifier
router.post('/verifiers', authenticate, requirePlan('corporate'), mrvWriteLimiter, async (req, res) => {
    try {
        const {
            accreditationBody, accreditationNumber, accreditationScope,
            accreditationValidFrom, accreditationValidTo,
            sectors, methodologies
        } = req.body;

        if (!accreditationBody || !accreditationNumber || !accreditationValidFrom || !accreditationValidTo) {
            return res.status(400).json({ error: 'Missing required accreditation fields' });
        }

        const verifier = await MRVService.registerVerifier({
            userId: req.user.id,
            accreditationBody,
            accreditationNumber,
            accreditationScope,
            accreditationValidFrom,
            accreditationValidTo,
            sectors: sectors || [],
            methodologies: methodologies || []
        });

        res.status(201).json({ success: true, verifier });
    } catch (error) {
        console.error('[mrv/verifiers POST]', error.message);
        res.status(400).json({ error: error.message });
    }
});

// GET /api/mrv/verifiers - List verifiers
router.get('/verifiers', authenticate, async (req, res) => {
    try {
        // List verifiers (filtered by plan if provided)
        const { planId } = req.query;
        if (planId) {
            const verifiers = await MRVService.getAvailableVerifiers(planId);
            return res.json({ verifiers });
        }
        // Admin list all verifiers
        if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
        const { rows } = await query('SELECT * FROM emission_verifiers ORDER BY created_at DESC');
        res.json({ verifiers: rows });
    } catch (error) {
        console.error('[mrv/verifiers GET]', error.message);
        res.status(500).json({ error: 'Failed to fetch verifiers' });
    }
});

// POST /api/mrv/verifiers/:id/approve - Approve verifier (admin)
router.post('/verifiers/:id/approve', authenticate, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
        const verifier = await MRVService.approveVerifier(req.params.id, req.user.id);
        res.json({ success: true, verifier });
    } catch (error) {
        console.error('[mrv/verifiers/approve]', error.message);
        res.status(400).json({ error: error.message });
    }
});

// POST /api/mrv/plans/:planId/assign-verifier - Assign verifier to plan
router.post('/plans/:planId/assign-verifier', authenticate, requirePlan('growth'), mrvWriteLimiter, async (req, res) => {
    try {
        const { verifierId } = req.body;
        if (!verifierId) return res.status(400).json({ error: 'verifierId required' });
        await MRVService.assignVerifier(req.params.planId, verifierId, req.user.id);
        res.json({ success: true });
    } catch (error) {
        console.error('[mrv/plans/assign-verifier]', error.message);
        res.status(400).json({ error: error.message });
    }
});

// ── Verification Workflow ──────────────────────────────────────────────────

// POST /api/mrv/plans/:planId/complete-verification - Complete verification
router.post('/plans/:planId/complete-verification', authenticate, requirePlan('growth'), mrvWriteLimiter, async (req, res) => {
    try {
        const { findings, overallConclusion } = req.body;
        if (!findings || !Array.isArray(findings) || !overallConclusion) {
            return res.status(400).json({ error: 'findings array and overallConclusion required' });
        }

        const plan = await MRVService.completeVerification(req.params.planId, req.user.id, {
            findings,
            overallConclusion
        });

        res.json({ success: true, plan });
    } catch (error) {
        console.error('[mrv/plans/complete-verification]', error.message);
        res.status(400).json({ error: error.message });
    }
});

// POST /api/mrv/plans/:planId/approve - Approve verified plan (admin)
router.post('/plans/:planId/approve', authenticate, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
        const plan = await MRVService.approvePlan(req.params.planId, req.user.id);
        res.json({ success: true, plan });
    } catch (error) {
        console.error('[mrv/plans/approve]', error.message);
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;