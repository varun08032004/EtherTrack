-- 020_asset_price_history.sql
-- Asset Price History for market data

CREATE TABLE asset_price_history (
    history_id            UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
    batch_id              UUID NOT NULL REFERENCES carbon_batches(id) ON DELETE CASCADE,
    
    -- Price Point
    date                  DATE NOT NULL,
    price_inr             NUMERIC(20,2) NOT NULL,         -- INR per credit
    volume                BIGINT DEFAULT 0,               -- Volume traded
    vwap                  NUMERIC(20,2),                  -- Volume-weighted avg price
    
    -- Source
    source                VARCHAR(50),                    -- 'exchange', 'otc', 'rfq', 'index'
    exchange              VARCHAR(50),                    -- 'IEX', 'PXIL', 'OTC', 'EtherTrack'
    
    -- OHLCV
    open_price            NUMERIC(20,2),
    high_price            NUMERIC(20,2),
    low_price             NUMERIC(20,2),
    close_price           NUMERIC(20,2),
    volume                BIGINT DEFAULT 0,
    
    created_at            TIMESTAMP DEFAULT NOW(),
    
    UNIQUE (batch_id, date, source)
);

CREATE INDEX idx_asset_price_history_batch ON asset_price_history(batch_id);
CREATE INDEX idx_asset_price_history_date ON asset_price_history(date DESC);
CREATE INDEX idx_asset_price_history_source ON asset_price_history(source);