// routes/reportAutoPopulate.js
// Auto-populate BRSR, CDP, TCFD reports from emission data

'use strict';

const router = require('express').Router();
const { safeQuery: query, withTransaction } = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { requirePlan } = require('../middleware/planGate');
const { writeLimiter } = require('../middleware/rateLimit');
const { generateReportPDF } = require('../services/reportPDF');
const { emitAutoPopulateData } = require('../services/reportAutoPopulate');

const writeLimiter30 = require('express-rate-limit')({
    windowMs: 60 * 1000,
    max: 30,
    keyGenerator: (req) => req.user?.id ?? req.ip,
    handler: (req, res) => res.status(429).json({ error: 'Too many requests' })
});

// ── GET /api/reports/auto-populate/:reportType/:year ─────────────────────────
// Auto-populate report from emission data
router.get('/auto-populate/:reportType/:year', authenticate, requirePlan('growth'), async (req, res) => {
    try {
        const { reportType, year } = req.params;
        const validTypes = ['BRSR', 'CDP', 'TCFD', 'GHG_PROTOCOL'];
        
        if (!validTypes.includes(reportType.toUpperCase())) {
            return res.status(400).json({ error: 'Invalid report type. Use: BRSR, CDP, TCFD, or GHG_PROTOCOL' });
        }

        const yearNum = parseInt(year);
        if (isNaN(yearNum) || yearNum < 2020 || yearNum > 2030) {
            return res.status(400).json({ error: 'Invalid year' });
        }

        const data = await emitAutoPopulateData(req.user.id, reportType.toUpperCase(), yearNum);
        
        res.json({ 
            success: true, 
            reportType: reportType.toUpperCase(),
            year: yearNum,
            data,
            generatedAt: new Date().toISOString()
        });
    } catch (error) {
        console.error('[reports/auto-populate]', error.message);
        res.status(500).json({ error: 'Failed to auto-populate report' });
    }
});

// ── POST /api/reports/generate/:reportType/:year ─────────────────────────────
// Generate full report PDF with auto-populated data + manual inputs
router.post('/generate/:reportType/:year', authenticate, requirePlan('growth'), writeLimiter30, async (req, res) => {
    try {
        const { reportType, year } = req.params;
        const { manualData, sections, format = 'pdf' } = req.body;
        
        const validTypes = ['BRSR', 'CDP', 'TCFD', 'GHG_PROTOCOL'];
        if (!validTypes.includes(reportType.toUpperCase())) {
            return res.status(400).json({ error: 'Invalid report type' });
        }

        const yearNum = parseInt(year);
        if (isNaN(yearNum)) return res.status(400).json({ error: 'Invalid year' });

        // Get auto-populated data
        const autoData = await emitAutoPopulateData(req.user.id, reportType.toUpperCase(), yearNum);
        
        // Merge with manual data
        const mergedData = { ...autoData, ...manualData };
        
        // Generate report
        const pdfBuffer = await generateReportPDF(reportType.toUpperCase(), yearNum, mergedData, sections);
        
        // Save report record
        const { rows } = await query(
            `INSERT INTO generated_reports (user_id, report_type, year, data, format, file_size, status)
             VALUES ($1, $2, $3, $4, $5, $6, 'completed')
             RETURNING id`,
            [req.user.id, reportType.toUpperCase(), yearNum, JSON.stringify(mergedData), format, pdfBuffer.length]
        );

        const reportId = rows[0].id;
        
        // Set response headers for PDF download
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${reportType}_${year}_${reportId}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        res.send(pdfBuffer);
        
    } catch (error) {
        console.error('[reports/generate]', error.message);
        res.status(500).json({ error: 'Failed to generate report' });
    }
});

// ── GET /api/reports/list ────────────────────────────────────────────────────
// List generated reports
router.get('/list', authenticate, async (req, res) => {
    try {
        const { reportType, year, page = 0, limit = 20 } = req.query;
        
        let sql = `SELECT id, report_type, year, format, file_size, status, created_at 
                   FROM generated_reports 
                   WHERE user_id = $1`;
        const params = [req.user.id];
        let paramIndex = 2;

        if (reportType) {
            sql += ` AND report_type = $${paramIndex++}`;
            params.push(reportType.toUpperCase());
        }
        if (year) {
            sql += ` AND year = $${paramIndex++}`;
            params.push(parseInt(year));
        }

        sql += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        params.push(parseInt(limit), parseInt(page) * parseInt(limit));

        const { rows } = await query(sql, params);

        // Get total count
        let countSql = `SELECT COUNT(*) FROM generated_reports WHERE user_id = $1`;
        const countParams = [req.user.id];
        if (reportType) {
            countSql += ` AND report_type = $2`;
            countParams.push(reportType.toUpperCase());
        }
        if (year) {
            countSql += ` AND year = $${countParams.length + 1}`;
            countParams.push(parseInt(year));
        }
        const { rows: countRows } = await query(countSql, countParams);

        res.json({ 
            reports: rows, 
            total: parseInt(countRows[0].count),
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (error) {
        console.error('[reports/list]', error.message);
        res.status(500).json({ error: 'Failed to fetch reports' });
    }
});

// ── GET /api/reports/:id/download ────────────────────────────────────────────
// Download generated report
router.get('/:id/download', authenticate, async (req, res) => {
    try {
        const { rows } = await query(
            `SELECT id, report_type, year, format, data FROM generated_reports 
             WHERE id = $1 AND user_id = $2`,
            [req.params.id, req.user.id]
        );

        if (!rows.length) {
            return res.status(404).json({ error: 'Report not found' });
        }

        const report = rows[0];
        const pdfBuffer = await generateReportPDF(report.report_type, report.year, report.data);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${report.report_type}_${report.year}_${report.id}.pdf"`);
        res.setHeader('Content-Length', pdfBuffer.length);
        res.send(pdfBuffer);
    } catch (error) {
        console.error('[reports/download]', error.message);
        res.status(500).json({ error: 'Failed to download report' });
    }
});

// ── DELETE /api/reports/:id ──────────────────────────────────────────────────
// Delete generated report
router.delete('/:id', authenticate, async (req, res) => {
    try {
        await query(
            `DELETE FROM generated_reports WHERE id = $1 AND user_id = $2`,
            [req.params.id, req.user.id]
        );
        res.json({ success: true, message: 'Report deleted' });
    } catch (error) {
        console.error('[reports/delete]', error.message);
        res.status(500).json({ error: 'Failed to delete report' });
    }
});

module.exports = router;