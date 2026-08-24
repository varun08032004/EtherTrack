-- 018_asset_eligibility_rules.sql
-- Asset Eligibility Rules per Scheme

CREATE TABLE asset_eligibility_rules (
    rule_id               UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    scheme                eligibility_scheme NOT NULL,
    instrument_type       carbon_instrument_type NOT NULL,
    
    -- Criteria (JSON rules engine)
    criteria              JSONB NOT NULL,                 -- Rule engine format
    
    -- Metadata
    description           TEXT,
    is_active             BOOLEAN DEFAULT TRUE,
    priority              INT DEFAULT 0,                  -- Higher = more specific
    effective_from        DATE NOT NULL,
    effective_to          DATE,
    
    created_by            UUID REFERENCES users(id),
    created_at            TIMESTAMP DEFAULT NOW(),
    updated_at            TIMESTAMP DEFAULT NOW(),
    
    UNIQUE (scheme, instrument_type, priority)
);

CREATE INDEX idx_asset_eligibility_rules_scheme ON asset_eligibility_rules(scheme);
CREATE INDEX idx_asset_eligibility_rules_active ON asset_eligibility_rules(is_active) WHERE is_active = TRUE;

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_asset_eligibility_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_asset_eligibility_rules_updated_at
BEFORE UPDATE ON asset_eligibility_rules
FOR EACH ROW EXECUTE FUNCTION update_asset_eligibility_rules_updated_at();

-- Seed default eligibility rules
INSERT INTO asset_eligibility_rules (scheme, instrument_type, criteria, description, is_active, priority, effective_from, effective_to, created_by) VALUES
-- VCM Rules
('VCM', 'VCM_CREDIT', 
 '{"registry": {"in": ["VCS", "GS", "CDM", "ACR"]}, "vintage": {"gte": 2015}, "status": {"eq": "active"}}',
 'Standard VCM eligibility', TRUE, 10, '2020-01-01', NULL, NULL),

-- CCTS Offset Rules  
('CCTS_OFFSET', 'CCTS_OFFSET_CCC',
 '{"registry": {"eq": "ICM"}, "ccts_category": {"eq": "offset"}, "status": {"eq": "active"}}',
 'CCTS Offset CCC eligibility', TRUE, 10, '2024-01-01', NULL, NULL),

-- CCTS Compliance Rules
('CCTS_COMPLIANCE', 'CCTS_COMPLIANCE_CCC',
 '{"registry": {"eq": "ICM"}, "ccts_category": {"eq": "compliance"}, "status": {"eq": "active"}}',
 'CCTS Compliance CCC eligibility', TRUE, 10, '2024-01-01', NULL, NULL),

-- Article 6
('ARTICLE_6', 'ARTICLE_6_ITMO',
 '{"corresponding_adjustment": {"eq": "authorized"}, "registry": {"in": ["VCS", "GS", "ICM"]}}',
 'Article 6 ITMO eligibility', TRUE, 10, '2024-01-01', NULL, NULL),

-- CORSIA
('CORSIA', 'CORSIA_ELIGIBLE',
 '{"corsia_eligible": {"eq": true}, "registry": {"in": ["VCS", "GS", "CDM", "ACR"]}}',
 'CORSIA eligible credits', TRUE, 10, '2024-01-01', NULL, NULL);