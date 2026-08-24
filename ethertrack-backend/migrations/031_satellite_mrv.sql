-- Migration: Add Satellite & zk-MRV Tables
-- Created: 2024-01-15
-- Description: Tables for satellite imagery, IoT sensors, zk-proofs, and MRV verifications

-- ============================================
-- Satellite Images
-- ============================================

CREATE TABLE IF NOT EXISTS satellite_images (
    id BIGSERIAL PRIMARY KEY,
    image_id VARCHAR(100) UNIQUE NOT NULL,
    project_id VARCHAR(100) NOT NULL REFERENCES projects(project_id),
    satellite VARCHAR(30) NOT NULL CHECK (satellite IN ('SENTINEL_2', 'SENTINEL_1', 'LANDSAT_8', 'LANDSAT_9', 'PLANET', 'MAXAR', 'AIRBUS', 'CUSTOM')),
    acquisition_date DATE NOT NULL,
    processing_level VARCHAR(10) CHECK (processing_level IN ('L1C', 'L2A', 'L1', 'L2', 'ORTHO')),
    bounds JSONB NOT NULL,
    resolution DECIMAL(10,2) NOT NULL, -- meters per pixel
    bands JSONB DEFAULT '[]',
    cloud_cover DECIMAL(5,2) DEFAULT 0,
    sun_azimuth DECIMAL(5,2),
    sun_elevation DECIMAL(5,2),
    file_path VARCHAR(500) NOT NULL,
    file_size BIGINT,
    checksum VARCHAR(100),
    metadata JSONB DEFAULT '{}',
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    processed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_sat_images_project ON satellite_images(project_id);
CREATE INDEX idx_sat_images_date ON satellite_images(acquisition_date);
CREATE INDEX idx_sat_images_status ON satellite_images(status);
CREATE INDEX idx_sat_images_satellite ON satellite_images(satellite);

-- ============================================
-- Satellite Analyses
-- ============================================

CREATE TABLE IF NOT EXISTS satellite_analyses (
    id BIGSERIAL PRIMARY KEY,
    analysis_id VARCHAR(100) UNIQUE NOT NULL,
    project_id VARCHAR(100) NOT NULL REFERENCES projects(project_id),
    image_ids JSONB NOT NULL DEFAULT '[]',
    analysis_type VARCHAR(50) NOT NULL CHECK (analysis_type IN ('FOREST_COVER', 'DEFORESTATION', 'REFORESTATION', 'BIOMASS', 'CARBON_STOCK', 'LAND_USE_CHANGE', 'FIRE_DETECTION', 'FLOOD_MONITORING', 'CROP_HEALTH', 'WATER_BODIES', 'URBAN_EXPANSION', 'CUSTOM')),
    model VARCHAR(100) NOT NULL,
    model_version VARCHAR(50) NOT NULL,
    parameters JSONB DEFAULT '{}',
    results JSONB NOT NULL DEFAULT '[]',
    confidence DECIMAL(4,3) DEFAULT 0,
    quality_flags JSONB DEFAULT '[]',
    processing_time_ms INTEGER,
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_sat_analyses_project ON satellite_analyses(project_id);
CREATE INDEX idx_sat_analyses_type ON satellite_analyses(analysis_type);
CREATE INDEX idx_sat_analyses_status ON satellite_analyses(status);
CREATE INDEX idx_sat_analyses_created ON satellite_analyses(created_at DESC);

-- ============================================
-- IoT Sensors
-- ============================================

CREATE TABLE IF NOT EXISTS iot_sensors (
    id BIGSERIAL PRIMARY KEY,
    sensor_id VARCHAR(100) UNIQUE NOT NULL,
    project_id VARCHAR(100) NOT NULL REFERENCES projects(project_id),
    sensor_type VARCHAR(50) NOT NULL CHECK (sensor_type IN ('SOIL_MOISTURE', 'TEMPERATURE', 'HUMIDITY', 'CO2_FLUX', 'CH4_FLUX', 'N2O_FLUX', 'PAR', 'NDVI', 'SAP_FLOW', 'DENDROMETER', 'WEATHER_STATION', 'CAMERA_TRAP', 'ACOUSTIC', 'CUSTOM')),
    manufacturer VARCHAR(100),
    model VARCHAR(100),
    serial_number VARCHAR(100),
    firmware_version VARCHAR(50),
    location JSONB NOT NULL,
    installation_date DATE NOT NULL,
    calibration_date DATE,
    calibration_expiry DATE,
    sampling_interval INTEGER NOT NULL, -- seconds
    measurement_range JSONB NOT NULL,
    accuracy DECIMAL(5,2),
    precision DECIMAL(5,2),
    status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'MAINTENANCE', 'ERROR', 'DECOMMISSIONED')),
    connectivity VARCHAR(30) CHECK (connectivity IN ('LORAWAN', 'NB_IOT', 'SATELLITE', 'WIFI', 'ETHERNET', 'CELLULAR', 'BLUETOOTH', 'CUSTOM')),
    gateway_id VARCHAR(100),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_iot_sensors_project ON iot_sensors(project_id);
CREATE INDEX idx_iot_sensors_status ON iot_sensors(status);
CREATE INDEX idx_iot_sensors_type ON iot_sensors(sensor_type);

-- ============================================
-- IoT Readings
-- ============================================

CREATE TABLE IF NOT EXISTS iot_readings (
    id BIGSERIAL PRIMARY KEY,
    reading_id VARCHAR(100) UNIQUE NOT NULL,
    sensor_id VARCHAR(100) NOT NULL REFERENCES iot_sensors(sensor_id),
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    value DECIMAL(20,6) NOT NULL,
    unit VARCHAR(50) NOT NULL,
    quality VARCHAR(20) DEFAULT 'GOOD' CHECK (quality IN ('GOOD', 'SUSPECT', 'BAD', 'MISSING')),
    flags JSONB DEFAULT '[]',
    raw_data JSONB,
    processed_data JSONB,
    location JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_iot_readings_sensor ON iot_readings(sensor_id);
CREATE INDEX idx_iot_readings_timestamp ON iot_readings(timestamp DESC);
CREATE INDEX idx_iot_readings_quality ON iot_readings(quality);

-- Partition by month for performance
-- CREATE TABLE iot_readings_y2024m01 PARTITION OF iot_readings FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

-- ============================================
-- ZK Circuits
-- ============================================

CREATE TABLE IF NOT EXISTS zk_circuits (
    id BIGSERIAL PRIMARY KEY,
    circuit_id VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    version VARCHAR(50) NOT NULL,
    source_code TEXT NOT NULL,
    compiled_artifacts JSONB NOT NULL,
    constraints INTEGER,
    public_inputs JSONB DEFAULT '[]',
    private_inputs JSONB DEFAULT '[]',
    verification_contract VARCHAR(100),
    audit_status VARCHAR(20) DEFAULT 'UNAUDITED' CHECK (audit_status IN ('UNAUDITED', 'AUDITED', 'FORMAL_VERIFICATION')),
    audit_report VARCHAR(500),
    status VARCHAR(20) DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'COMPILED', 'DEPLOYED', 'DEPRECATED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_zk_circuits_status ON zk_circuits(status);

-- ============================================
-- ZK Proofs
-- ============================================

CREATE TABLE IF NOT EXISTS zk_proofs (
    id BIGSERIAL PRIMARY KEY,
    proof_id VARCHAR(100) UNIQUE NOT NULL,
    circuit_id VARCHAR(100) NOT NULL REFERENCES zk_circuits(circuit_id),
    project_id VARCHAR(100) NOT NULL REFERENCES projects(project_id),
    witness_type VARCHAR(50) NOT NULL CHECK (witness_type IN ('EMISSIONS', 'REMOVALS', 'STOCK_CHANGE', 'ACTIVITY_DATA', 'EMISSION_FACTOR', 'BOUNDARY', 'ADDITIONALITY', 'PERMANENCE', 'LEAKAGE', 'CUSTOM')),
    public_inputs JSONB NOT NULL,
    proof TEXT NOT NULL,
    verification_key TEXT NOT NULL,
    verifying_contract VARCHAR(100),
    status VARCHAR(30) DEFAULT 'GENERATED' CHECK (status IN ('GENERATED', 'VERIFIED', 'FAILED', 'SUBMITTED_ON_CHAIN', 'CONFIRMED_ON_CHAIN')),
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    verified_at TIMESTAMP WITH TIME ZONE,
    tx_hash VARCHAR(100),
    block_number BIGINT,
    gas_used BIGINT
);

CREATE INDEX idx_zk_proofs_circuit ON zk_proofs(circuit_id);
CREATE INDEX idx_zk_proofs_project ON zk_proofs(project_id);
CREATE INDEX idx_zk_proofs_status ON zk_proofs(status);
CREATE INDEX idx_zk_proofs_type ON zk_proofs(witness_type);

-- ============================================
-- MRV Verifications
-- ============================================

CREATE TABLE IF NOT EXISTS mrv_verifications (
    id BIGSERIAL PRIMARY KEY,
    verification_id VARCHAR(100) UNIQUE NOT NULL,
    project_id VARCHAR(100) NOT NULL REFERENCES projects(project_id),
    verification_type VARCHAR(30) NOT NULL CHECK (verification_type IN ('INITIAL', 'PERIODIC', 'RENEWAL', 'REVERSAL_CHECK', 'SPOT_CHECK')),
    standard VARCHAR(30) NOT NULL CHECK (standard IN ('VERRA', 'GOLD_STANDARD', 'CDM', 'ACR', 'CAR', 'CCTS', 'ART', 'FCPF', 'CUSTOM')),
    verifier_id VARCHAR(100) NOT NULL,
    verifier_name VARCHAR(255) NOT NULL,
    verifier_accreditation VARCHAR(255) NOT NULL,
    scope JSONB NOT NULL,
    site_visit JSONB NOT NULL,
    document_review JSONB NOT NULL,
    data_verification JSONB NOT NULL,
    findings JSONB DEFAULT '[]',
    non_conformities JSONB DEFAULT '[]',
    opportunities_for_improvement JSONB DEFAULT '[]',
    conclusion VARCHAR(20) NOT NULL CHECK (conclusion IN ('POSITIVE', 'NEGATIVE', 'QUALIFIED')),
    assurance_level VARCHAR(20) NOT NULL CHECK (assurance_level IN ('LIMITED', 'REASONABLE')),
    statement TEXT NOT NULL,
    issued_at TIMESTAMP WITH TIME ZONE,
    valid_until TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ISSUED', 'WITHDRAWN', 'SUSPENDED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_mrv_project ON mrv_verifications(project_id);
CREATE INDEX idx_mrv_standard ON mrv_verifications(standard);
CREATE INDEX idx_mrv_status ON mrv_verifications(status);
CREATE INDEX idx_mrv_conclusion ON mrv_verifications(conclusion);

-- ============================================
-- Updated timestamps trigger
-- ============================================

DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN ('satellite_images', 'satellite_analyses', 'iot_sensors', 'zk_circuits', 'mrv_verifications')
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS update_%s_updated_at ON %s', t, t);
        EXECUTE format('CREATE TRIGGER update_%s_updated_at BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', t, t);
    END LOOP;
END $$;

-- ============================================
-- Views for MRV Dashboard
-- ============================================

CREATE OR REPLACE VIEW project_mrv_dashboard AS
SELECT 
    p.project_id,
    p.name as project_name,
    p.project_type,
    p.status as project_status,
    
    -- Satellite
    COUNT(DISTINCT si.image_id) as total_images,
    COUNT(DISTINCT si.image_id) FILTER (WHERE si.status = 'COMPLETED') as processed_images,
    COUNT(DISTINCT sa.analysis_id) as total_analyses,
    MAX(sa.confidence) as latest_confidence,
    
    -- IoT
    COUNT(DISTINCT iots.sensor_id) as total_sensors,
    COUNT(DISTINCT iots.sensor_id) FILTER (WHERE iots.status = 'ACTIVE') as active_sensors,
    COUNT(DISTINCT iotr.reading_id) FILTER (WHERE iotr.timestamp > NOW() - INTERVAL '24 hours') as readings_24h,
    COUNT(DISTINCT iotr.reading_id) FILTER (WHERE iotr.timestamp > NOW() - INTERVAL '7 days') as readings_7d,
    
    -- ZK Proofs
    COUNT(DISTINCT zkp.proof_id) as total_proofs,
    COUNT(DISTINCT zkp.proof_id) FILTER (WHERE zkp.status = 'VERIFIED') as verified_proofs,
    COUNT(DISTINCT zkp.proof_id) FILTER (WHERE zkp.status = 'CONFIRMED_ON_CHAIN') as onchain_proofs,
    
    -- Verifications
    COUNT(DISTINCT mrv.verification_id) as total_verifications,
    COUNT(DISTINCT mrv.verification_id) FILTER (WHERE mrv.status = 'ISSUED') as issued_verifications,
    MAX(mrv.issued_at) as latest_verification,
    
    -- Overall data quality score (0-1)
    COALESCE(AVG(sa.confidence) FILTER (WHERE sa.status = 'COMPLETED'), 0) as avg_analysis_confidence
FROM projects p
LEFT JOIN satellite_images si ON si.project_id = p.project_id
LEFT JOIN satellite_analyses sa ON sa.project_id = p.project_id
LEFT JOIN iot_sensors iots ON iots.project_id = p.project_id
LEFT JOIN iot_readings iotr ON iotr.sensor_id = iots.sensor_id
LEFT JOIN zk_proofs zkp ON zkp.project_id = p.project_id
LEFT JOIN mrv_verifications mrv ON mrv.project_id = p.project_id
GROUP BY p.project_id, p.name, p.project_type, p.status;

-- ============================================
-- IoT Data Quality View
-- ============================================

CREATE OR REPLACE VIEW iot_data_quality AS
SELECT 
    s.sensor_id,
    s.project_id,
    s.sensor_type,
    s.status,
    COUNT(r.reading_id) as total_readings,
    COUNT(r.reading_id) FILTER (WHERE r.quality = 'GOOD') as good_readings,
    COUNT(r.reading_id) FILTER (WHERE r.quality = 'SUSPECT') as suspect_readings,
    COUNT(r.reading_id) FILTER (WHERE r.quality = 'BAD') as bad_readings,
    COUNT(r.reading_id) FILTER (WHERE r.quality = 'MISSING') as missing_readings,
    ROUND(
        COUNT(r.reading_id) FILTER (WHERE r.quality = 'GOOD')::numeric / 
        NULLIF(COUNT(r.reading_id), 0) * 100, 2
    ) as data_quality_percentage,
    MAX(r.timestamp) as last_reading,
    MIN(r.timestamp) as first_reading,
    EXTRACT(EPOCH FROM (MAX(r.timestamp) - MIN(r.timestamp))) / 
    NULLIF(COUNT(r.reading_id) - 1, 0) as avg_interval_seconds
FROM iot_sensors s
LEFT JOIN iot_readings r ON r.sensor_id = s.sensor_id
GROUP BY s.sensor_id, s.project_id, s.sensor_type, s.status;