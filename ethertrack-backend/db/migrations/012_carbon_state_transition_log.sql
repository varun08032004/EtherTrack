-- 012_carbon_state_transition_log.sql
-- Carbon State Transition Log Table
-- Audit log for carbon asset lifecycle state transitions

CREATE TABLE carbon_state_transition_log (
    log_id            UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    batch_id          UUID NOT NULL REFERENCES carbon_batches(id),
    from_state        carbon_asset_state NOT NULL,
    to_state          carbon_asset_state NOT NULL,
    transitioned_by   UUID NOT NULL REFERENCES users(id),
    reason            TEXT,
    side_effect       TEXT,
    created_at        TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_carbon_state_log_batch ON carbon_state_transition_log(batch_id);
CREATE INDEX idx_carbon_state_log_transitioned_by ON carbon_state_transition_log(transitioned_by);
CREATE INDEX idx_carbon_state_log_created_at ON carbon_state_transition_log(created_at);