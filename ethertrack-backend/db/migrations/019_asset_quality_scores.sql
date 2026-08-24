-- 019_asset_quality_scores.sql
-- Asset Quality Scores (ECS breakdown)

CREATE TABLE asset_quality_scores (
    score_id              UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    batch_id              UUID NOT NULL REFERENCES carbon_batches(id) ON DELETE CASCADE,
    
    -- Dimension Scores (0-100)
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
    
    -- Overall
    overall_score         NUMERIC(5,2),                   -- Weighted aggregate
    grade                 VARCHAR(10),                    -- 'AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'C', 'D'
    percentile_rank       INT,                            -- 1-99
    
    -- Factor contributions to final score
    factor_contributions  JSONB,                          -- {"additionality": 25.0, ...}
    
    -- Data sources
    data_sources          TEXT[],                         -- ['Verra Registry', 'Gold Standard', ...]
    
    calculated_at         TIMESTAMP DEFAULT NOW(),
    calculated_by         UUID REFERENCES users(id),
    
    UNIQUE (batch_id)
);

CREATE INDEX idx_asset_quality_scores_batch ON asset_quality_scores(batch_id);
CREATE INDEX idx_asset_quality_scores_score ON asset_quality_scores(overall_score DESC);
CREATE INDEX idx_asset_quality_scores_grade ON asset_quality_scores(grade);

-- Trigger for updated_at (not needed since no updated_at column)