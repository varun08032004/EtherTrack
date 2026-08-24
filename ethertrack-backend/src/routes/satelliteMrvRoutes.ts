// Satellite & zk-MRV API Routes
// Satellite imagery, IoT sensors, zk-proofs, and MRV verification endpoints

import { Router, Request, Response } from 'express';
import { SatelliteMRVService } from '../services/satellite/satelliteMrvService.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { query } from '../db/pool.js';

const router = Router();

// ============================================
// Satellite Imagery
// ============================================

/**
 * Register satellite image
 * POST /api/satellite/images
 */
router.post('/images', requireAuth, requireRole(['PROJECT_OWNER', 'ADMIN', 'MRV_ANALYST']), async (req: Request, res: Response) => {
    try {
        const image = req.body;
        
        // Validate required fields
        const required = ['projectId', 'satellite', 'acquisitionDate', 'processingLevel', 'bounds', 'resolution', 'bands', 'filePath', 'fileSize'];
        for (const field of required) {
            if (!image[field]) {
                return res.status(400).json({ error: `Missing required field: ${field}` });
            }
        }
        
        const registered = await SatelliteMRVService.registerImage(image);
        res.status(201).json(registered);
    } catch (error) {
        console.error('Satellite image registration error:', error);
        res.status(500).json({ error: 'Failed to register satellite image' });
    }
});

/**
 * Process satellite image
 * POST /api/satellite/images/:imageId/process
 */
router.post('/images/:imageId/process', requireAuth, requireRole(['PROJECT_OWNER', 'ADMIN', 'MRV_ANALYST']), async (req: Request, res: Response) => {
    try {
        const { imageId } = req.params;
        const { analysisType } = req.body;
        
        if (!analysisType) {
            return res.status(400).json({ error: 'analysisType is required' });
        }
        
        const analysis = await SatelliteMRVService.processImage(imageId, analysisType);
        res.json(analysis);
    } catch (error) {
        console.error('Satellite image processing error:', error);
        res.status(500).json({ error: 'Failed to process satellite image' });
    }
});

/**
 * Get satellite images for project
 * GET /api/satellite/images/:projectId
 */
router.get('/images/:projectId', requireAuth, async (req: Request, res: Response) => {
    try {
        const { projectId } = req.params;
        const { status, satellite, startDate, endDate, limit = 50, offset = 0 } = req.query;
        
        let sql = 'SELECT * FROM satellite_images WHERE project_id = $1';
        const params: any[] = [projectId];
        let paramIndex = 2;
        
        if (status) {
            sql += ` AND status = $${paramIndex++}`;
            params.push(status);
        }
        
        if (satellite) {
            sql += ` AND satellite = $${paramIndex++}`;
            params.push(satellite);
        }
        
        if (startDate) {
            sql += ` AND acquisition_date >= $${paramIndex++}`;
            params.push(startDate);
        }
        
        if (endDate) {
            sql += ` AND acquisition_date <= $${paramIndex++}`;
            params.push(endDate);
        }
        
        sql += ` ORDER BY acquisition_date DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
        params.push(parseInt(limit as string), parseInt(offset as string));
        
        const { rows } = await query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error('Satellite images fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch satellite images' });
    }
});

/**
 * Get satellite analyses for project
 * GET /api/satellite/analyses/:projectId
 */
router.get('/analyses/:projectId', requireAuth, async (req: Request, res: Response) => {
    try {
        const { projectId } = req.params;
        const { analysisType, limit = 50, offset = 0 } = req.query;
        
        let sql = 'SELECT * FROM satellite_analyses WHERE project_id = $1';
        const params: any[] = [projectId];
        let paramIndex = 2;
        
        if (analysisType) {
            sql += ` AND analysis_type = $${paramIndex++}`;
            params.push(analysisType);
        }
        
        sql += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
        params.push(parseInt(limit as string), parseInt(offset as string));
        
        const { rows } = await query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error('Satellite analyses fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch satellite analyses' });
    }
});

// ============================================
// IoT Sensors
// ============================================

/**
 * Register IoT sensor
 * POST /api/satellite/iot/sensors
 */
router.post('/iot/sensors', requireAuth, requireRole(['PROJECT_OWNER', 'ADMIN', 'FIELD_TECHNICIAN']), async (req: Request, res: Response) => {
    try {
        const sensor = req.body;
        
        const required = ['projectId', 'sensorType', 'manufacturer', 'model', 'serialNumber', 'firmwareVersion', 'location', 'installationDate', 'samplingInterval', 'measurementRange', 'accuracy', 'precision', 'connectivity'];
        for (const field of required) {
            if (!sensor[field]) {
                return res.status(400).json({ error: `Missing required field: ${field}` });
            }
        }
        
        const registered = await SatelliteMRVService.registerSensor(sensor);
        res.status(201).json(registered);
    } catch (error) {
        console.error('IoT sensor registration error:', error);
        res.status(500).json({ error: 'Failed to register IoT sensor' });
    }
});

/**
 * Get IoT sensors for project
 * GET /api/satellite/iot/sensors/:projectId
 */
router.get('/iot/sensors/:projectId', requireAuth, async (req: Request, res: Response) => {
    try {
        const { projectId } = req.params;
        const { status, sensorType } = req.query;
        
        let sql = 'SELECT * FROM iot_sensors WHERE project_id = $1';
        const params: any[] = [projectId];
        let paramIndex = 2;
        
        if (status) {
            sql += ` AND status = $${paramIndex++}`;
            params.push(status);
        }
        
        if (sensorType) {
            sql += ` AND sensor_type = $${paramIndex++}`;
            params.push(sensorType);
        }
        
        sql += ' ORDER BY installation_date DESC';
        
        const { rows } = await query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error('IoT sensors fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch IoT sensors' });
    }
});

/**
 * Ingest IoT readings (batch)
 * POST /api/satellite/iot/readings
 */
router.post('/iot/readings', requireAuth, async (req: Request, res: Response) => {
    try {
        const readings = req.body;
        
        if (!Array.isArray(readings) || readings.length === 0) {
            return res.status(400).json({ error: 'readings must be a non-empty array' });
        }
        
        // Validate each reading
        for (const reading of readings) {
            if (!reading.sensorId || !reading.timestamp || reading.value === undefined || !reading.unit || !reading.quality) {
                return res.status(400).json({ error: 'Each reading must have sensorId, timestamp, value, unit, quality' });
            }
        }
        
        const result = await SatelliteMRVService.ingestReadings(readings);
        res.json(result);
    } catch (error) {
        console.error('IoT readings ingestion error:', error);
        res.status(500).json({ error: 'Failed to ingest IoT readings' });
    }
});

/**
 * Get IoT readings for sensor
 * GET /api/satellite/iot/readings/:sensorId
 */
router.get('/iot/readings/:sensorId', requireAuth, async (req: Request, res: Response) => {
    try {
        const { sensorId } = req.params;
        const { startDate, endDate, quality, limit = 1000, offset = 0 } = req.query;
        
        let sql = 'SELECT * FROM iot_readings WHERE sensor_id = $1';
        const params: any[] = [sensorId];
        let paramIndex = 2;
        
        if (startDate) {
            sql += ` AND timestamp >= $${paramIndex++}`;
            params.push(startDate);
        }
        
        if (endDate) {
            sql += ` AND timestamp <= $${paramIndex++}`;
            params.push(endDate);
        }
        
        if (quality) {
            sql += ` AND quality = $${paramIndex++}`;
            params.push(quality);
        }
        
        sql += ` ORDER BY timestamp DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
        params.push(parseInt(limit as string), parseInt(offset as string));
        
        const { rows } = await query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error('IoT readings fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch IoT readings' });
    }
});

/**
 * Get IoT data quality dashboard
 * GET /api/satellite/iot/quality/:projectId
 */
router.get('/iot/quality/:projectId', requireAuth, async (req: Request, res: Response) => {
    try {
        const { projectId } = req.params;
        
        const { rows } = await query(
            `SELECT * FROM iot_data_quality WHERE project_id = $1 ORDER BY data_quality_percentage`,
            [projectId]
        );
        
        res.json(rows);
    } catch (error) {
        console.error('IoT data quality fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch IoT data quality' });
    }
});

// ============================================
// ZK Proofs
// ============================================

/**
 * Generate ZK proof
 * POST /api/satellite/zk/proofs
 */
router.post('/zk/proofs', requireAuth, requireRole(['PROJECT_OWNER', 'ADMIN', 'CRYPTOGRAPHER']), async (req: Request, res: Response) => {
    try {
        const { circuitId, projectId, witnessType, privateInputs, publicInputs } = req.body;
        
        if (!circuitId || !projectId || !witnessType || !privateInputs || !publicInputs) {
            return res.status(400).json({ error: 'circuitId, projectId, witnessType, privateInputs, publicInputs are required' });
        }
        
        const proof = await SatelliteMRVService.generateZKProof(circuitId, projectId, witnessType, privateInputs, publicInputs);
        res.status(201).json(proof);
    } catch (error) {
        console.error('ZK proof generation error:', error);
        res.status(500).json({ error: 'Failed to generate ZK proof' });
    }
});

/**
 * Verify ZK proof
 * POST /api/satellite/zk/proofs/:proofId/verify
 */
router.post('/zk/proofs/:proofId/verify', requireAuth, async (req: Request, res: Response) => {
    try {
        const { proofId } = req.params;
        const result = await SatelliteMRVService.verifyZKProof(proofId);
        res.json(result);
    } catch (error) {
        console.error('ZK proof verification error:', error);
        res.status(500).json({ error: 'Failed to verify ZK proof' });
    }
});

/**
 * Submit ZK proof on-chain
 * POST /api/satellite/zk/proofs/:proofId/submit
 */
router.post('/zk/proofs/:proofId/submit', requireAuth, requireRole(['PROJECT_OWNER', 'ADMIN']), async (req: Request, res: Response) => {
    try {
        const { proofId } = req.params;
        const { walletAddress } = req.body;
        
        if (!walletAddress) {
            return res.status(400).json({ error: 'walletAddress is required' });
        }
        
        const result = await SatelliteMRVService.submitProofOnChain(proofId, walletAddress);
        res.json(result);
    } catch (error) {
        console.error('ZK proof submission error:', error);
        res.status(500).json({ error: 'Failed to submit ZK proof on-chain' });
    }
});

/**
 * Get ZK proofs for project
 * GET /api/satellite/zk/proofs/:projectId
 */
router.get('/zk/proofs/:projectId', requireAuth, async (req: Request, res: Response) => {
    try {
        const { projectId } = req.params;
        const { status, witnessType, limit = 50, offset = 0 } = req.query;
        
        let sql = 'SELECT * FROM zk_proofs WHERE project_id = $1';
        const params: any[] = [projectId];
        let paramIndex = 2;
        
        if (status) {
            sql += ` AND status = $${paramIndex++}`;
            params.push(status);
        }
        
        if (witnessType) {
            sql += ` AND witness_type = $${paramIndex++}`;
            params.push(witnessType);
        }
        
        sql += ` ORDER BY generated_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
        params.push(parseInt(limit as string), parseInt(offset as string));
        
        const { rows } = await query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error('ZK proofs fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch ZK proofs' });
    }
});

/**
 * Get ZK circuits
 * GET /api/satellite/zk/circuits
 */
router.get('/zk/circuits', requireAuth, async (req: Request, res: Response) => {
    try {
        const { status } = req.query;
        
        let sql = 'SELECT circuit_id, name, description, version, constraints, public_inputs, private_inputs, audit_status, status FROM zk_circuits';
        const params: any[] = [];
        
        if (status) {
            sql += ' WHERE status = $1';
            params.push(status);
        }
        
        sql += ' ORDER BY created_at DESC';
        
        const { rows } = await query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error('ZK circuits fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch ZK circuits' });
    }
});

// ============================================
// MRV Verifications
// ============================================

/**
 * Create MRV verification
 * POST /api/satellite/mrv/verifications
 */
router.post('/mrv/verifications', requireAuth, requireRole(['VERIFIER', 'ADMIN']), async (req: Request, res: Response) => {
    try {
        const verification = req.body;
        
        const required = ['projectId', 'verificationType', 'standard', 'verifierId', 'verifierName', 'verifierAccreditation', 'scope', 'siteVisit', 'documentReview', 'dataVerification', 'findings', 'nonConformities', 'opportunitiesForImprovement', 'conclusion', 'assuranceLevel', 'statement'];
        for (const field of required) {
            if (!verification[field]) {
                return res.status(400).json({ error: `Missing required field: ${field}` });
            }
        }
        
        const created = await SatelliteMRVService.createMRVVerification(verification);
        res.status(201).json(created);
    } catch (error) {
        console.error('MRV verification creation error:', error);
        res.status(500).json({ error: 'Failed to create MRV verification' });
    }
});

/**
 * Issue MRV verification
 * POST /api/satellite/mrv/verifications/:verificationId/issue
 */
router.post('/mrv/verifications/:verificationId/issue', requireAuth, requireRole(['VERIFIER', 'ADMIN']), async (req: Request, res: Response) => {
    try {
        const { verificationId } = req.params;
        const issued = await SatelliteMRVService.issueVerification(verificationId);
        res.json(issued);
    } catch (error) {
        console.error('MRV verification issue error:', error);
        res.status(500).json({ error: 'Failed to issue MRV verification' });
    }
});

/**
 * Get MRV verifications for project
 * GET /api/satellite/mrv/verifications/:projectId
 */
router.get('/mrv/verifications/:projectId', requireAuth, async (req: Request, res: Response) => {
    try {
        const { projectId } = req.params;
        const { status, standard, limit = 50, offset = 0 } = req.query;
        
        let sql = 'SELECT * FROM mrv_verifications WHERE project_id = $1';
        const params: any[] = [projectId];
        let paramIndex = 2;
        
        if (status) {
            sql += ` AND status = $${paramIndex++}`;
            params.push(status);
        }
        
        if (standard) {
            sql += ` AND standard = $${paramIndex++}`;
            params.push(standard);
        }
        
        sql += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
        params.push(parseInt(limit as string), parseInt(offset as string));
        
        const { rows } = await query(sql, params);
        res.json(rows);
    } catch (error) {
        console.error('MRV verifications fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch MRV verifications' });
    }
});

// ============================================
// Project MRV Dashboard
// ============================================

/**
 * Get project MRV dashboard
 * GET /api/satellite/dashboard/:projectId
 */
router.get('/dashboard/:projectId', requireAuth, async (req: Request, res: Response) => {
    try {
        const { projectId } = req.params;
        const dashboard = await SatelliteMRVService.getProjectMRVDashboard(projectId);
        res.json(dashboard);
    } catch (error) {
        console.error('MRV dashboard error:', error);
        res.status(500).json({ error: 'Failed to fetch MRV dashboard' });
    }
});

/**
 * Get all projects MRV dashboard
 * GET /api/satellite/dashboard
 */
router.get('/dashboard', requireAuth, async (req: Request, res: Response) => {
    try {
        const { rows } = await query('SELECT * FROM project_mrv_dashboard ORDER BY project_name');
        res.json(rows);
    } catch (error) {
        console.error('MRV dashboard list error:', error);
        res.status(500).json({ error: 'Failed to fetch MRV dashboards' });
    }
});

export default router;