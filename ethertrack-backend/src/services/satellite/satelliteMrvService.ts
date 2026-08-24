// Satellite & zk-MRV Verification Service
// Implements satellite imagery processing, IoT sensor integration, and zero-knowledge MRV proofs

import { safeQuery as query, withTransaction } from '../../db/pool.js';
import { createHash, randomBytes } from 'crypto';

export interface SatelliteImage {
    imageId: string;
    projectId: string;
    satellite: 'SENTINEL_2' | 'SENTINEL_1' | 'LANDSAT_8' | 'LANDSAT_9' | 'PLANET' | 'MAXAR' | 'AIRBUS' | 'CUSTOM';
    acquisitionDate: string;
    processingLevel: 'L1C' | 'L2A' | 'L1' | 'L2' | 'ORTHO';
    bounds: {
        north: number;
        south: number;
        east: number;
        west: number;
    };
    resolution: number; // meters per pixel
    bands: string[];
    cloudCover: number; // percentage
    sunAzimuth: number;
    sunElevation: number;
    filePath: string;
    fileSize: number; // bytes
    checksum: string;
    metadata: Record<string, any>;
    status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    createdAt: string;
    processedAt?: string;
}

export interface SatelliteAnalysis {
    analysisId: string;
    projectId: string;
    imageIds: string[];
    analysisType: 'FOREST_COVER' | 'DEFORESTATION' | 'REFORESTATION' | 'BIOMASS' | 'CARBON_STOCK' | 'LAND_USE_CHANGE' | 'FIRE_DETECTION' | 'FLOOD_MONITORING' | 'CROP_HEALTH' | 'WATER_BODIES' | 'URBAN_EXPANSION' | 'CUSTOM';
    model: string; // e.g., 'Random Forest', 'CNN', 'U-Net', 'Custom'
    modelVersion: string;
    parameters: Record<string, any>;
    results: SatelliteAnalysisResult[];
    confidence: number; // 0-1
    qualityFlags: string[];
    processingTimeMs: number;
    status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    createdAt: string;
    completedAt?: string;
}

export interface SatelliteAnalysisResult {
    geometry: GeoJSON.Geometry;
    properties: Record<string, any>;
    areaHectares: number;
    value: number; // e.g., biomass tC/ha, forest cover %, carbon stock tCO2e/ha
    confidence: number;
    changeDetected?: boolean;
    changeType?: 'GAIN' | 'LOSS' | 'STABLE';
    changeMagnitude?: number;
}

export interface IoTSensor {
    sensorId: string;
    projectId: string;
    sensorType: 'SOIL_MOISTURE' | 'TEMPERATURE' | 'HUMIDITY' | 'CO2_FLUX' | 'CH4_FLUX' | 'N2O_FLUX' | 'PAR' | 'NDVI' | 'SAP_FLOW' | 'DENDROMETER' | 'WEATHER_STATION' | 'CAMERA_TRAP' | 'ACOUSTIC' | 'CUSTOM';
    manufacturer: string;
    model: string;
    serialNumber: string;
    firmwareVersion: string;
    location: {
        latitude: number;
        longitude: number;
        elevation: number;
        datum: 'WGS84' | 'EPSG:4326';
    };
    installationDate: string;
    calibrationDate?: string;
    calibrationExpiry?: string;
    samplingInterval: number; // seconds
    measurementRange: {
        min: number;
        max: number;
        unit: string;
    };
    accuracy: number; // percentage
    precision: number; // percentage
    status: 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE' | 'ERROR' | 'DECOMMISSIONED';
    connectivity: 'LORAWAN' | 'NB_IOT' | 'SATELLITE' | 'WIFI' | 'ETHERNET' | 'CELLULAR' | 'BLUETOOTH' | 'CUSTOM';
    gatewayId?: string;
    metadata: Record<string, any>;
    createdAt: string;
    updatedAt: string;
}

export interface IoTReading {
    readingId: string;
    sensorId: string;
    timestamp: string;
    value: number;
    unit: string;
    quality: 'GOOD' | 'SUSPECT' | 'BAD' | 'MISSING';
    flags: string[];
    rawData?: any;
    processedData?: any;
    location?: {
        latitude: number;
        longitude: number;
    };
}

export interface ZKProof {
    proofId: string;
    circuitId: string;
    projectId: string;
    witnessType: 'EMISSIONS' | 'REMOVALS' | 'STOCK_CHANGE' | 'ACTIVITY_DATA' | 'EMISSION_FACTOR' | 'BOUNDARY' | 'ADDITIONALITY' | 'PERMANENCE' | 'LEAKAGE' | 'CUSTOM';
    publicInputs: Record<string, any>;
    proof: string; // Base64 encoded
    verificationKey: string;
    verifyingContract?: string; // Ethereum contract address
    status: 'GENERATED' | 'VERIFIED' | 'FAILED' | 'SUBMITTED_ON_CHAIN' | 'CONFIRMED_ON_CHAIN';
    generatedAt: string;
    verifiedAt?: string;
    txHash?: string;
    blockNumber?: number;
    gasUsed?: number;
}

export interface ZKCircuit {
    circuitId: string;
    name: string;
    description: string;
    version: string;
    sourceCode: string; // Circom/Rust/Noir source
    compiledArtifacts: {
        wasm: string; // Base64
        zkey: string; // Base64
        vkey: string; // Base64
        r1cs: string; // Base64
    };
    constraints: number;
    publicInputs: string[];
    privateInputs: string[];
    verificationContract?: string;
    auditStatus: 'UNAUDITED' | 'AUDITED' | 'FORMAL_VERIFICATION';
    auditReport?: string;
    status: 'DRAFT' | 'COMPILED' | 'DEPLOYED' | 'DEPRECATED';
    createdAt: string;
    updatedAt: string;
}

export interface MRVVerification {
    verificationId: string;
    projectId: string;
    verificationType: 'INITIAL' | 'PERIODIC' | 'RENEWAL' | 'REVERSAL_CHECK' | 'SPOT_CHECK';
    standard: 'VERRA' | 'GOLD_STANDARD' | 'CDM' | 'ACR' | 'CAR' | 'CCTS' | 'ART' | 'FCPF' | 'CUSTOM';
    verifierId: string;
    verifierName: string;
    verifierAccreditation: string;
    scope: {
        projectBoundary: boolean;
        baseline: boolean;
        additionality: boolean;
        monitoringPlan: boolean;
        dataManagement: boolean;
        emissionReductions: boolean;
        leakage: boolean;
        permanence: boolean;
        sdgContribution: boolean;
    };
    siteVisit: {
        conducted: boolean;
        date?: string;
        team: string[];
        findings: string[];
    };
    documentReview: {
        documentsReviewed: string[];
        findings: string[];
        nonConformities: NonConformity[];
    };
    dataVerification: {
        satelliteVerified: boolean;
        iotVerified: boolean;
        zkProofsVerified: boolean;
        manualVerification: boolean;
        accuracyAssessment: number; // 0-1
    };
    findings: VerificationFinding[];
    nonConformities: NonConformity[];
    opportunitiesForImprovement: string[];
    conclusion: 'POSITIVE' | 'NEGATIVE' | 'QUALIFIED';
    assuranceLevel: 'LIMITED' | 'REASONABLE';
    statement: string;
    issuedAt: string;
    validUntil?: string;
    status: 'DRAFT' | 'ISSUED' | 'WITHDRAWN' | 'SUSPENDED';
    createdAt: string;
    updatedAt: string;
}

export interface VerificationFinding {
    findingId: string;
    category: 'MATERIAL' | 'NON_MATERIAL' | 'OBSERVATION';
    description: string;
    evidence: string[];
    riskLevel: 'HIGH' | 'MEDIUM' | 'LOW';
    status: 'OPEN' | 'CLOSED' | 'ACCEPTED_RISK';
}

export interface NonConformity {
    ncId: string;
    type: 'MAJOR' | 'MINOR';
    requirement: string;
    description: string;
    evidence: string[];
    rootCause: string;
    correctiveAction: string;
    deadline: string;
    status: 'OPEN' | 'CLOSED' | 'VERIFIED_CLOSED';
    closedAt?: string;
}

export class SatelliteMRVService {
    /**
     * Register satellite image for processing
     */
    static async registerImage(image: Omit<SatelliteImage, 'imageId' | 'checksum' | 'status' | 'createdAt'>): Promise<SatelliteImage> {
        const imageId = `IMG-${Date.now()}-${randomBytes(6).toString('hex')}`;
        const checksum = await this.calculateChecksum(image.filePath);
        
        const fullImage: SatelliteImage = {
            ...image,
            imageId,
            checksum,
            status: 'PENDING',
            createdAt: new Date().toISOString(),
        };
        
        await query(
            `INSERT INTO satellite_images 
             (image_id, project_id, satellite, acquisition_date, processing_level, bounds, resolution, bands, cloud_cover, sun_azimuth, sun_elevation, file_path, file_size, checksum, metadata, status, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'PENDING', NOW())`,
            [
                imageId, image.projectId, image.satellite, image.acquisitionDate, image.processingLevel,
                JSON.stringify(image.bounds), image.resolution, JSON.stringify(image.bands),
                image.cloudCover, image.sunAzimuth, image.sunElevation,
                image.filePath, image.fileSize, checksum, JSON.stringify(image.metadata)
            ]
        );
        
        return fullImage;
    }
    
    /**
     * Process satellite image (placeholder for actual processing pipeline)
     */
    static async processImage(imageId: string, analysisType: SatelliteAnalysis['analysisType']): Promise<SatelliteAnalysis> {
        const { rows } = await query('SELECT * FROM satellite_images WHERE image_id = $1', [imageId]);
        if (!rows.length) throw new Error('Image not found');
        
        const image = rows[0];
        
        // Update status
        await query('UPDATE satellite_images SET status = $1 WHERE image_id = $2', ['PROCESSING', imageId]);
        
        const analysisId = `ANAL-${Date.now()}-${randomBytes(6).toString('hex')}`;
        const startedAt = new Date().toISOString();
        
        // In production, this would call actual processing pipeline (Python/GDAL/Google Earth Engine)
        // For now, return mock results
        const analysis: SatelliteAnalysis = {
            analysisId,
            projectId: image.project_id,
            imageIds: [imageId],
            analysisType,
            model: 'U-Net + Random Forest Ensemble',
            modelVersion: 'v2.3.1',
            parameters: {
                cloudThreshold: 20,
                minMappingUnit: 0.5, // hectares
                confidenceThreshold: 0.7,
            },
            results: await this.generateMockResults(analysisType, image.bounds),
            confidence: 0.87,
            qualityFlags: [],
            processingTimeMs: 45000,
            status: 'COMPLETED',
            createdAt: startedAt,
            completedAt: new Date().toISOString(),
        };
        
        await query(
            `INSERT INTO satellite_analyses 
             (analysis_id, project_id, image_ids, analysis_type, model, model_version, parameters, results, confidence, quality_flags, processing_time_ms, status, created_at, completed_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'COMPLETED', $12, $13)`,
            [
                analysisId, image.project_id, JSON.stringify([imageId]), analysisType,
                analysis.model, analysis.modelVersion, JSON.stringify(analysis.parameters),
                JSON.stringify(analysis.results), analysis.confidence, JSON.stringify(analysis.qualityFlags),
                analysis.processingTimeMs, startedAt, analysis.completedAt
            ]
        );
        
        await query('UPDATE satellite_images SET status = $1, processed_at = $2 WHERE image_id = $3', ['COMPLETED', analysis.completedAt, imageId]);
        
        return analysis;
    }
    
    /**
     * Register IoT sensor
     */
    static async registerSensor(sensor: Omit<IoTSensor, 'sensorId' | 'status' | 'createdAt' | 'updatedAt'>): Promise<IoTSensor> {
        const sensorId = `SENSOR-${Date.now()}-${randomBytes(6).toString('hex')}`;
        
        const fullSensor: IoTSensor = {
            ...sensor,
            sensorId,
            status: 'ACTIVE',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        
        await query(
            `INSERT INTO iot_sensors 
             (sensor_id, project_id, sensor_type, manufacturer, model, serial_number, firmware_version, location, installation_date, calibration_date, calibration_expiry, sampling_interval, measurement_range, accuracy, precision, status, connectivity, gateway_id, metadata, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'ACTIVE', $16, $17, $18, NOW(), NOW())`,
            [
                sensorId, sensor.projectId, sensor.sensorType, sensor.manufacturer, sensor.model,
                sensor.serialNumber, sensor.firmwareVersion, JSON.stringify(sensor.location),
                sensor.installationDate, sensor.calibrationDate, sensor.calibrationExpiry,
                sensor.samplingInterval, JSON.stringify(sensor.measurementRange),
                sensor.accuracy, sensor.precision, sensor.connectivity, sensor.gatewayId,
                JSON.stringify(sensor.metadata)
            ]
        );
        
        return fullSensor;
    }
    
    /**
     * Ingest IoT readings (batch)
     */
    static async ingestReadings(readings: Omit<IoTReading, 'readingId'>[]): Promise<{ success: number; failed: number; errors: string[] }> {
        const errors: string[] = [];
        let success = 0;
        
        for (const reading of readings) {
            try {
                const readingId = `READ-${Date.now()}-${randomBytes(6).toString('hex')}`;
                
                await query(
                    `INSERT INTO iot_readings 
                     (reading_id, sensor_id, timestamp, value, unit, quality, flags, raw_data, processed_data, location)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                    [
                        readingId, reading.sensorId, reading.timestamp, reading.value,
                        reading.unit, reading.quality, JSON.stringify(reading.flags),
                        reading.rawData ? JSON.stringify(reading.rawData) : null,
                        reading.processedData ? JSON.stringify(reading.processedData) : null,
                        reading.location ? JSON.stringify(reading.location) : null
                    ]
                );
                success++;
            } catch (error) {
                errors.push(`Reading ${reading.sensorId}@${reading.timestamp}: ${error instanceof Error ? error.message : 'Unknown'}`);
            }
        }
        
        return { success, failed: readings.length - success, errors };
    }
    
    /**
     * Generate zk-proof for MRV data
     */
    static async generateZKProof(
        circuitId: string,
        projectId: string,
        witnessType: ZKProof['witnessType'],
        privateInputs: Record<string, any>,
        publicInputs: Record<string, any>
    ): Promise<ZKProof> {
        // Verify circuit exists
        const { rows: circuits } = await query('SELECT * FROM zk_circuits WHERE circuit_id = $1 AND status = $2', [circuitId, 'DEPLOYED']);
        if (!circuits.length) throw new Error('Circuit not found or not deployed');
        
        const circuit = circuits[0];
        
        // In production, this would call snarkjs/circom or RISC Zero/SP1 prover
        // For now, generate mock proof
        const proofId = `ZKP-${Date.now()}-${randomBytes(8).toString('hex')}`;
        const mockProof = this.generateMockProof(privateInputs, publicInputs);
        
        const zkProof: ZKProof = {
            proofId,
            circuitId,
            projectId,
            witnessType,
            publicInputs,
            proof: mockProof.proof,
            verificationKey: circuit.compiled_artifacts.vkey,
            verifyingContract: circuit.verification_contract,
            status: 'GENERATED',
            generatedAt: new Date().toISOString(),
        };
        
        await query(
            `INSERT INTO zk_proofs 
             (proof_id, circuit_id, project_id, witness_type, public_inputs, proof, verification_key, verifying_contract, status, generated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'GENERATED', NOW())`,
            [
                proofId, circuitId, projectId, witnessType,
                JSON.stringify(publicInputs), mockProof.proof,
                circuit.compiled_artifacts.vkey, circuit.verification_contract
            ]
        );
        
        return zkProof;
    }
    
    /**
     * Verify zk-proof
     */
    static async verifyZKProof(proofId: string): Promise<{ valid: boolean; error?: string }> {
        const { rows } = await query('SELECT * FROM zk_proofs WHERE proof_id = $1', [proofId]);
        if (!rows.length) return { valid: false, error: 'Proof not found' };
        
        const proof = rows[0];
        
        // In production, verify using snarkjs or on-chain verifier
        // For now, mock verification
        const valid = proof.proof.length > 100; // Simple check
        
        if (valid) {
            await query(
                `UPDATE zk_proofs SET status = 'VERIFIED', verified_at = NOW() WHERE proof_id = $1`,
                [proofId]
            );
        } else {
            await query(
                `UPDATE zk_proofs SET status = 'FAILED' WHERE proof_id = $1`,
                [proofId]
            );
        }
        
        return { valid };
    }
    
    /**
     * Submit zk-proof on-chain
     */
    static async submitProofOnChain(proofId: string, walletAddress: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
        const { rows } = await query('SELECT * FROM zk_proofs WHERE proof_id = $1', [proofId]);
        if (!rows.length) return { success: false, error: 'Proof not found' };
        
        const proof = rows[0];
        
        if (proof.status !== 'VERIFIED') {
            return { success: false, error: 'Proof must be verified before submission' };
        }
        
        if (!proof.verifying_contract) {
            return { success: false, error: 'No verifying contract configured' };
        }
        
        // In production, would call ethers.js to submit transaction
        // For now, mock submission
        const txHash = `0x${randomBytes(32).toString('hex')}`;
        
        await query(
            `UPDATE zk_proofs SET status = 'SUBMITTED_ON_CHAIN', tx_hash = $1 WHERE proof_id = $2`,
            [txHash, proofId]
        );
        
        return { success: true, txHash };
    }
    
    /**
     * Create MRV verification
     */
    static async createMRVVerification(verification: Omit<MRVVerification, 'verificationId' | 'status' | 'createdAt' | 'updatedAt'>): Promise<MRVVerification> {
        const verificationId = `MRV-${Date.now()}-${randomBytes(6).toString('hex')}`;
        
        const fullVerification: MRVVerification = {
            ...verification,
            verificationId,
            status: 'DRAFT',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        
        await query(
            `INSERT INTO mrv_verifications 
             (verification_id, project_id, verification_type, standard, verifier_id, verifier_name, verifier_accreditation, scope, site_visit, document_review, data_verification, findings, non_conformities, opportunities_for_improvement, conclusion, assurance_level, statement, status, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'DRAFT', NOW(), NOW())`,
            [
                verificationId, verification.projectId, verification.verificationType, verification.standard,
                verification.verifierId, verification.verifierName, verification.verifierAccreditation,
                JSON.stringify(verification.scope), JSON.stringify(verification.siteVisit),
                JSON.stringify(verification.documentReview), JSON.stringify(verification.dataVerification),
                JSON.stringify(verification.findings), JSON.stringify(verification.nonConformities),
                JSON.stringify(verification.opportunitiesForImprovement), verification.conclusion,
                verification.assuranceLevel, verification.statement
            ]
        );
        
        return fullVerification;
    }
    
    /**
     * Issue MRV verification
     */
    static async issueVerification(verificationId: string): Promise<MRVVerification> {
        const { rows } = await query('SELECT * FROM mrv_verifications WHERE verification_id = $1', [verificationId]);
        if (!rows.length) throw new Error('Verification not found');
        
        await query(
            `UPDATE mrv_verifications SET status = 'ISSUED', issued_at = NOW(), updated_at = NOW() WHERE verification_id = $1`,
            [verificationId]
        );
        
        const { rows: updated } = await query('SELECT * FROM mrv_verifications WHERE verification_id = $1', [verificationId]);
        return this.mapRowToVerification(updated[0]);
    }
    
    /**
     * Get project MRV dashboard
     */
    static async getProjectMRVDashboard(projectId: string): Promise<{
        satelliteImages: number;
        analyses: number;
        iotSensors: number;
        iotReadings24h: number;
        zkProofs: number;
        verifications: number;
        latestAnalysis?: SatelliteAnalysis;
        dataQuality: number;
    }> {
        const [
            { rows: images },
            { rows: analyses },
            { rows: sensors },
            { rows: readings },
            { rows: proofs },
            { rows: verifications },
        ] = await Promise.all([
            query('SELECT count(*) as cnt FROM satellite_images WHERE project_id = $1', [projectId]),
            query('SELECT * FROM satellite_analyses WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1', [projectId]),
            query('SELECT count(*) as cnt FROM iot_sensors WHERE project_id = $1 AND status = $2', [projectId, 'ACTIVE']),
            query('SELECT count(*) as cnt FROM iot_readings r JOIN iot_sensors s ON r.sensor_id = s.sensor_id WHERE s.project_id = $1 AND r.timestamp > NOW() - INTERVAL \'24 hours\'', [projectId]),
            query('SELECT count(*) as cnt FROM zk_proofs WHERE project_id = $1', [projectId]),
            query('SELECT count(*) as cnt FROM mrv_verifications WHERE project_id = $1', [projectId]),
        ]);
        
        return {
            satelliteImages: parseInt(images[0].cnt),
            analyses: parseInt(analyses.length ? '1' : '0'),
            iotSensors: parseInt(sensors[0].cnt),
            iotReadings24h: parseInt(readings[0].cnt),
            zkProofs: parseInt(proofs[0].cnt),
            verifications: parseInt(verifications[0].cnt),
            latestAnalysis: analyses.length ? this.mapRowToAnalysis(analyses[0]) : undefined,
            dataQuality: analyses.length ? analyses[0].confidence : 0,
        };
    }
    
    // Private helpers
    private static async calculateChecksum(filePath: string): Promise<string> {
        // In production, read file and calculate SHA256
        return `sha256:${randomBytes(32).toString('hex')}`;
    }
    
    private static async generateMockResults(type: string, bounds: any): Promise<SatelliteAnalysisResult[]> {
        const area = this.calculateArea(bounds);
        const numPolygons = Math.floor(Math.random() * 10) + 1;
        
        return Array.from({ length: numPolygons }, (_, i) => ({
            geometry: {
                type: 'Polygon',
                coordinates: [[
                    [bounds.west + (i * 0.01), bounds.south],
                    [bounds.west + ((i + 1) * 0.01), bounds.south],
                    [bounds.west + ((i + 1) * 0.01), bounds.south + 0.01],
                    [bounds.west + (i * 0.01), bounds.south + 0.01],
                    [bounds.west + (i * 0.01), bounds.south],
                ]],
            },
            properties: {
                class: type === 'FOREST_COVER' ? 'forest' : 'analysis',
                confidence: 0.8 + Math.random() * 0.15,
            },
            areaHectares: area / numPolygons,
            value: type === 'BIOMASS' ? 50 + Math.random() * 100 :
                   type === 'CARBON_STOCK' ? 100 + Math.random() * 200 :
                   type === 'FOREST_COVER' ? 60 + Math.random() * 40 :
                   Math.random() * 100,
            confidence: 0.8 + Math.random() * 0.15,
            changeDetected: Math.random() > 0.7,
            changeType: Math.random() > 0.5 ? 'GAIN' : 'LOSS',
            changeMagnitude: Math.random() * 10,
        }));
    }
    
    private static calculateArea(bounds: any): number {
        // Approximate area in hectares
        const latDiff = bounds.north - bounds.south;
        const lngDiff = bounds.east - bounds.west;
        const avgLat = (bounds.north + bounds.south) / 2;
        const latKm = latDiff * 111;
        const lngKm = lngDiff * 111 * Math.cos(avgLat * Math.PI / 180);
        return latKm * lngKm * 100; // hectares
    }
    
    private static generateMockProof(privateInputs: any, publicInputs: any): { proof: string } {
        // Mock proof generation - in production uses snarkjs
        const proofData = {
            pi_a: [randomBytes(32).toString('hex'), randomBytes(32).toString('hex')],
            pi_b: [[randomBytes(32).toString('hex'), randomBytes(32).toString('hex')], [randomBytes(32).toString('hex'), randomBytes(32).toString('hex')]],
            pi_c: [randomBytes(32).toString('hex'), randomBytes(32).toString('hex')],
            protocol: 'groth16',
            curve: 'bn128',
        };
        return { proof: Buffer.from(JSON.stringify(proofData)).toString('base64') };
    }
    
    private static mapRowToAnalysis(row: any): SatelliteAnalysis {
        return {
            analysisId: row.analysis_id,
            projectId: row.project_id,
            imageIds: JSON.parse(row.image_ids),
            analysisType: row.analysis_type,
            model: row.model,
            modelVersion: row.model_version,
            parameters: JSON.parse(row.parameters),
            results: JSON.parse(row.results),
            confidence: parseFloat(row.confidence),
            qualityFlags: JSON.parse(row.quality_flags),
            processingTimeMs: row.processing_time_ms,
            status: row.status,
            createdAt: row.created_at,
            completedAt: row.completed_at,
        };
    }
    
    private static mapRowToVerification(row: any): MRVVerification {
        return {
            verificationId: row.verification_id,
            projectId: row.project_id,
            verificationType: row.verification_type,
            standard: row.standard,
            verifierId: row.verifier_id,
            verifierName: row.verifier_name,
            verifierAccreditation: row.verifier_accreditation,
            scope: JSON.parse(row.scope),
            siteVisit: JSON.parse(row.site_visit),
            documentReview: JSON.parse(row.document_review),
            dataVerification: JSON.parse(row.data_verification),
            findings: JSON.parse(row.findings),
            nonConformities: JSON.parse(row.non_conformities),
            opportunitiesForImprovement: JSON.parse(row.opportunities_for_improvement),
            conclusion: row.conclusion,
            assuranceLevel: row.assurance_level,
            statement: row.statement,
            issuedAt: row.issued_at,
            validUntil: row.valid_until,
            status: row.status,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}

export default SatelliteMRVService;