require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

async function fixAll() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Create ENUM types
    console.log('Creating ENUM types...');
    await client.query(`
      CREATE TYPE carbon_instrument_type AS ENUM (
        'VCM_CREDIT', 'CCTS_OFFSET_CCC', 'CCTS_COMPLIANCE_CCC', 'ARTICLE_6_ITMO', 'CORSIA_ELIGIBLE'
      );
    `);
    console.log('Created carbon_instrument_type');
    
    await client.query(`
      CREATE TYPE asset_passport_state AS ENUM (
        'DRAFT', 'ACTIVE', 'RETIRED', 'CANCELLED', 'EXPIRED', 'SUSPENDED'
      );
    `);
    console.log('Created asset_passport_state');
    
    await client.query(`
      CREATE TYPE eligibility_scheme AS ENUM (
        'VCM', 'CCTS_OFFSET', 'CCTS_COMPLIANCE', 'ARTICLE_6', 'CORSIA'
      );
    `);
    console.log('Created eligibility_scheme');
    
    // Drop the existing table if it exists (it was created without the proper columns)
    await client.query(`DROP TABLE IF EXISTS carbon_asset_passports CASCADE`);
    console.log('Dropped existing carbon_asset_passports table');
    
    // Create the table with all columns
    console.log('Creating carbon_asset_passports table...');
    await client.query(`
      CREATE TABLE carbon_asset_passports (
          passport_id           UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
          asset_id              UUID NOT NULL REFERENCES carbon_batches(id) ON DELETE CASCADE,
          CONSTRAINT uq_carbon_asset_passports_asset UNIQUE (asset_id),
          
          -- Identity
          instrument_type       carbon_instrument_type NOT NULL DEFAULT 'VCM_CREDIT',
          registry              VARCHAR(50) NOT NULL,
          registry_project_id   VARCHAR(100),
          registry_serial_start VARCHAR(100),
          registry_serial_end   VARCHAR(100),
          
          -- Project Details
          project_name          VARCHAR(300) NOT NULL,
          project_type          VARCHAR(100),
          methodology           VARCHAR(200),
          vintage               INT NOT NULL,
          geography_country     VARCHAR(100) NOT NULL,
          geography_region      VARCHAR(100),
          geography_coordinates JSONB,
          
          -- Verification
          verification_body     VARCHAR(200),
          verification_date     DATE,
          verification_report_url TEXT,
          
          -- Issuance
          issuance_date         DATE NOT NULL,
          total_quantity        BIGINT NOT NULL,
          available_quantity    BIGINT NOT NULL DEFAULT 0,
          retired_quantity      BIGINT NOT NULL DEFAULT 0,
          cancelled_quantity    BIGINT NOT NULL DEFAULT 0,
          
          -- Eligibility (computed, cached)
          vcm_eligible          BOOLEAN DEFAULT TRUE,
          ccts_offset_eligible  BOOLEAN DEFAULT FALSE,
          ccts_compliance_eligible BOOLEAN DEFAULT FALSE,
          article6_eligible     BOOLEAN DEFAULT FALSE,
          corsia_eligible       BOOLEAN DEFAULT FALSE,
          eligibility_updated_at TIMESTAMP,
          eligibility_notes     JSONB,
          
          -- Quality Score (ECS)
          ecs_score             NUMERIC(5,2),
          ecs_grade             VARCHAR(10),
          ecs_percentile        INT,
          ecs_factors           JSONB,
          ecs_updated_at        TIMESTAMP,
          
          -- Market Data
          last_traded_price     NUMERIC(20,2),
          last_traded_at        TIMESTAMP,
          price_30d_avg         NUMERIC(20,2),
          price_30d_vol         BIGINT,
          
          -- Provenance Chain (JSON array of ownership transfers)
          provenance_chain      JSONB DEFAULT '[]'::jsonb,
          
          -- Status
          state                 asset_passport_state DEFAULT 'DRAFT',
          suspended_reason      TEXT,
          
          -- Metadata
          created_by            UUID NOT NULL REFERENCES users(id),
          created_at            TIMESTAMP DEFAULT NOW(),
          updated_at            TIMESTAMP DEFAULT NOW(),
          
          CONSTRAINT chk_quantities CHECK (
              available_quantity >= 0 AND
              retired_quantity >= 0 AND
              cancelled_quantity >= 0 AND
              total_quantity = available_quantity + retired_quantity + cancelled_quantity
          ),
          CONSTRAINT chk_quantities_positive CHECK (
              total_quantity > 0 AND
              available_quantity >= 0 AND
              retired_quantity >= 0 AND
              cancelled_quantity >= 0
          )
      );
    `);
    console.log('Created carbon_asset_passports table');
    
    // Create indexes
    await client.query(`
      CREATE INDEX idx_carbon_asset_passports_asset ON carbon_asset_passports(asset_id);
      CREATE INDEX idx_carbon_asset_passports_registry ON carbon_asset_passports(registry);
      CREATE INDEX idx_carbon_asset_passports_instrument ON carbon_asset_passports(instrument_type);
      CREATE INDEX idx_carbon_asset_passports_vintage ON carbon_asset_passports(vintage);
      CREATE INDEX idx_carbon_asset_passports_geography ON carbon_asset_passports(geography_country, geography_region);
      CREATE INDEX idx_carbon_asset_passports_state ON carbon_asset_passports(state);
      CREATE INDEX idx_carbon_asset_passports_ecs ON carbon_asset_passports(ecs_score DESC);
      CREATE INDEX idx_carbon_asset_passports_price ON carbon_asset_passports(last_traded_price);
      CREATE INDEX idx_carbon_asset_passports_vcm ON carbon_asset_passports(vcm_eligible) WHERE vcm_eligible = TRUE;
      CREATE INDEX idx_carbon_asset_passports_ccts_offset ON carbon_asset_passports(ccts_offset_eligible) WHERE ccts_offset_eligible = TRUE;
      CREATE INDEX idx_carbon_asset_passports_ccts_compliance ON carbon_asset_passports(ccts_compliance_eligible) WHERE ccts_compliance_eligible = TRUE;
    `);
    console.log('Created indexes');
    
    // Create asset_eligibility_rules table
    await client.query(`
      CREATE TABLE asset_eligibility_rules (
          rule_id               UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
          scheme                eligibility_scheme NOT NULL,
          instrument_type       carbon_instrument_type NOT NULL,
          
          criteria              JSONB NOT NULL,
          description           TEXT,
          is_active             BOOLEAN DEFAULT TRUE,
          priority              INT DEFAULT 0,
          effective_from        DATE NOT NULL,
          effective_to          DATE,
          
          created_by            UUID REFERENCES users(id),
          created_at            TIMESTAMP DEFAULT NOW(),
          updated_at            TIMESTAMP DEFAULT NOW(),
          
          UNIQUE (scheme, instrument_type, priority)
      );
    `);
    console.log('Created asset_eligibility_rules table');
    
    // Create asset_quality_scores table
    await client.query(`
      CREATE TABLE asset_quality_scores (
          score_id              UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
          batch_id              UUID NOT NULL REFERENCES carbon_batches(id) ON DELETE CASCADE,
          
          additionality         NUMERIC(5,2),
          permanence            NUMERIC(5,2),
          methodology_risk      NUMERIC(5,2),
          verification_quality  NUMERIC(5,2),
          registry_provenance   NUMERIC(5,2),
          project_risk          NUMERIC(5,2),
          country_risk          NUMERIC(5,2),
          double_counting_risk  NUMERIC(5,2),
          vintage               NUMERIC(5,2),
          transparency          NUMERIC(5,2),
          co_benefits           NUMERIC(5,2),
          
          overall_score         NUMERIC(5,2),
          grade                 VARCHAR(10),
          percentile_rank       INT,
          
          factor_contributions  JSONB,
          data_sources          TEXT[],
          
          calculated_at         TIMESTAMP DEFAULT NOW(),
          calculated_by         UUID REFERENCES users(id),
          
          UNIQUE (batch_id)
      );
    `);
    console.log('Created asset_quality_scores table');
    
    // Create asset_price_history table
    await client.query(`
      CREATE TABLE asset_price_history (
          history_id            UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
          batch_id              UUID NOT NULL REFERENCES carbon_batches(id) ON DELETE CASCADE,
          
          date                  DATE NOT NULL,
          price_inr             NUMERIC(20,2) NOT NULL,
          volume_traded         BIGINT DEFAULT 0,
          vwap                  NUMERIC(20,2),
          
          source                VARCHAR(50),
          exchange              VARCHAR(50),
          
          open_price            NUMERIC(20,2),
          high_price            NUMERIC(20,2),
          low_price             NUMERIC(20,2),
          close_price           NUMERIC(20,2),
          
          created_at            TIMESTAMP DEFAULT NOW(),
          
          UNIQUE (batch_id, date, source)
      );
    `);
    console.log('Created asset_price_history table');
    
    // Create indexes for asset_price_history
    await client.query(`
      CREATE INDEX idx_asset_price_history_batch ON asset_price_history(batch_id);
      CREATE INDEX idx_asset_price_history_date ON asset_price_history(date DESC);
      CREATE INDEX idx_asset_price_history_source ON asset_price_history(source);
    `);
    console.log('Created asset_price_history indexes');
    
    // Create triggers for updated_at
    await client.query(`
      CREATE OR REPLACE FUNCTION update_carbon_asset_passports_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
          NEW.updated_at = NOW();
          RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      
      CREATE TRIGGER trg_carbon_asset_passports_updated_at
      BEFORE UPDATE ON carbon_asset_passports
      FOR EACH ROW EXECUTE FUNCTION update_carbon_asset_passports_updated_at();
    `);
    console.log('Created updated_at trigger for carbon_asset_passports');
    
    await client.query(`
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
    `);
    console.log('Created updated_at trigger for asset_eligibility_rules');
    
    // Seed eligibility rules
    console.log('Seeding eligibility rules...');
    await client.query(`
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
    `);
    console.log('Seeded eligibility rules');
    
    await client.query('COMMIT');
    console.log('All done!');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error:', e.message);
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

fixAll().catch(e => console.error('Fatal:', e));