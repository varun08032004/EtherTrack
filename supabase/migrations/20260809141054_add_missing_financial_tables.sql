-- 20260809141054_add_missing_financial_tables.sql
-- FIN-001: Add missing financial tables and constraints
-- This migration adds the missing financial tables identified in the schema.sql
-- that are not present in the current remote database.

-- ═══════════════════════════════════════════════════════════════════
-- FINANCIAL — TRADES
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.trades (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  buyer_id              UUID NOT NULL REFERENCES public.users(id),
  seller_id             UUID NOT NULL REFERENCES public.users(id),
  buyer_wallet          VARCHAR(42),
  seller_wallet         VARCHAR(42),
  batch_id              UUID NOT NULL REFERENCES public.carbon_batches(id),
  token_id              INTEGER NOT NULL,
  listing_id_onchain    INTEGER,
  quantity              INTEGER NOT NULL,
  price_per_credit_inr  NUMERIC(20, 2) NOT NULL,
  subtotal_inr          NUMERIC(20, 2) NOT NULL,
  buyer_fee_inr         NUMERIC(20, 2) NOT NULL,
  seller_fee_inr        NUMERIC(20, 2) NOT NULL,
  total_fee_inr         NUMERIC(20, 2) NOT NULL,
  gst_inr               NUMERIC(20, 2) NOT NULL,
  buyer_pays_inr        NUMERIC(20, 2) NOT NULL,
  seller_receives_inr   NUMERIC(20, 2) NOT NULL,
  platform_net_inr      NUMERIC(20, 2) NOT NULL,
  price_per_credit_eth  NUMERIC(20, 8),
  total_eth             NUMERIC(20, 8),
  eth_inr_rate          NUMERIC(20, 2),
  fee_eth               NUMERIC(20, 8),
  payment_mode          VARCHAR(20) NOT NULL,  -- 'inr', 'eth', 'direct_razorpay'
  status                VARCHAR(20) DEFAULT 'completed',
  tx_hash               VARCHAR(66),
  razorpay_payment_id   VARCHAR(100),
  razorpay_order_id     VARCHAR(100),
  buyer_inr_deducted    BOOLEAN DEFAULT FALSE,
  seller_inr_credited   BOOLEAN DEFAULT FALSE,
  inr_settlement_at     TIMESTAMP,
  completed_at          TIMESTAMP DEFAULT NOW(),
  idempotency_key       VARCHAR(100),
  chain_status          VARCHAR(20),  -- 'pending', 'confirmed', 'failed'
  chain_tx_hash         VARCHAR(66),
  chain_block           BIGINT,
  chain_logged_at       TIMESTAMP,
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW(),

  CONSTRAINT chk_trades_quantity_positive CHECK (quantity > 0),
  CONSTRAINT chk_trades_price_positive CHECK (price_per_credit_inr > 0)
);

CREATE INDEX IF NOT EXISTS idx_trades_buyer ON public.trades(buyer_id);
CREATE INDEX IF NOT EXISTS idx_trades_seller ON public.trades(seller_id);
CREATE INDEX IF NOT EXISTS idx_trades_batch ON public.trades(batch_id);
CREATE INDEX IF NOT EXISTS idx_trades_status ON public.trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_chain_status ON public.trades(chain_status);
CREATE INDEX IF NOT EXISTS idx_trades_idempotency ON public.trades(idempotency_key) WHERE status = 'completed';
CREATE INDEX IF NOT EXISTS idx_trades_tx_hash ON public.trades(tx_hash) WHERE tx_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trades_razorpay_order ON public.trades(razorpay_order_id) WHERE razorpay_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trades_buyer_created ON public.trades(buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_seller_created ON public.trades(seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_payment_mode ON public.trades(payment_mode);
CREATE INDEX IF NOT EXISTS idx_trades_razorpay_payment ON public.trades(razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trades_trade_invoice_number ON public.trades(trade_invoice_number) WHERE trade_invoice_number IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════
-- FINANCIAL — WALLET TRANSACTIONS
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type                VARCHAR(10) NOT NULL,       -- 'credit' | 'debit'
  method              VARCHAR(20) NOT NULL,       -- 'upi', 'bank', 'inr', 'eth', 'system', 'razorpay'
  amount              NUMERIC(20, 2) NOT NULL,
  status              VARCHAR(20) DEFAULT 'pending',  -- 'pending', 'success', 'failed'
  balance_before      NUMERIC(20, 2),
  balance_after       NUMERIC(20, 2),
  reference           VARCHAR(100) UNIQUE,
  razorpay_order_id   VARCHAR(100),
  razorpay_payment_id VARCHAR(100),
  razorpay_signature  VARCHAR(200),
  razorpay_payout_id  VARCHAR(100),
  gst_invoice_no      VARCHAR(100),
  bank_account_number VARCHAR(30),
  bank_ifsc           VARCHAR(20),
  bank_account_name   VARCHAR(100),
  notes               TEXT,
  trade_id            UUID REFERENCES public.trades(id),
  trade_type          VARCHAR(20),
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW(),

  CONSTRAINT chk_wallet_tx_amount_positive CHECK (amount > 0),
  CONSTRAINT chk_wallet_tx_status CHECK (status IN ('pending', 'success', 'failed')),
  CONSTRAINT chk_wallet_tx_type CHECK (type IN ('credit', 'debit')),
  CONSTRAINT chk_wallet_tx_method CHECK (method IN ('upi', 'bank', 'inr', 'eth', 'system', 'razorpay'))
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON public.wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_status ON public.wallet_transactions(status);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_reference ON public.wallet_transactions(reference);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_razorpay_order ON public.wallet_transactions(razorpay_order_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_razorpay_payment ON public.wallet_transactions(razorpay_payment_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_razorpay_payout ON public.wallet_transactions(razorpay_payout_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_trade ON public.wallet_transactions(trade_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_user_created ON public.wallet_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_created_at ON public.wallet_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_user_method ON public.wallet_transactions(user_id, method);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_razorpay_payment ON public.wallet_transactions(razorpay_payment_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_razorpay_payout ON public.wallet_transactions(razorpay_payout_id);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_user_debit_date ON public.wallet_transactions(user_id, type, method, created_at) WHERE type = 'debit' AND method = 'bank';

-- ════════════════════════════════════════════════════════════════════
-- FINANCIAL — PLATFORM FEES
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.platform_fees (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trade_id              UUID NOT NULL REFERENCES public.trades(id),
  buyer_fee_inr         NUMERIC(20, 2) NOT NULL,
  seller_fee_inr        NUMERIC(20, 2) NOT NULL,
  total_fee_inr         NUMERIC(20, 2) NOT NULL,
  gst_inr               NUMERIC(20, 2) NOT NULL,
  platform_net_inr      NUMERIC(20, 2) NOT NULL,
  fee_eth               NUMERIC(20, 8),
  eth_rate              NUMERIC(20, 2),
  payment_mode          VARCHAR(20) NOT NULL,
  status                VARCHAR(20) DEFAULT 'collected',
  gst_type              VARCHAR(20) DEFAULT 'cgst_sgst',
  cgst_inr              NUMERIC(20, 2),
  sgst_inr              NUMERIC(20, 2),
  igst_inr              NUMERIC(20, 2),
  razorpay_payment_id   VARCHAR(100),
  created_at            TIMESTAMP DEFAULT NOW(),

  CONSTRAINT unq_platform_fees_trade UNIQUE (trade_id)
);

CREATE INDEX IF NOT EXISTS idx_platform_fees_trade ON public.platform_fees(trade_id);

-- ════════════════════════════════════════════════════════════════════
-- FINANCIAL — CREDIT LEDGER
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.credit_ledger_entries (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  onchain_log_id        BIGINT,
  user_id               UUID NOT NULL REFERENCES public.users(id),
  user_id_hash          VARCHAR(66) NOT NULL,
  token_id              INTEGER NOT NULL,
  amount_delta          INTEGER NOT NULL,
  action_type           VARCHAR(20) NOT NULL,
  ref_hash              VARCHAR(66) NOT NULL,
  ref_table             VARCHAR(50),
  ref_id                UUID,
  note                  TEXT,
  tx_hash               VARCHAR(66),
  block_number          BIGINT,
  chain_status          VARCHAR(20) DEFAULT 'confirmed',
  created_at            TIMESTAMP DEFAULT NOW(),

  CONSTRAINT chk_cl_entries_action_type CHECK (action_type IN ('MINT', 'LIST', 'DELIST', 'BUY', 'SELL', 'RETIRE', 'WITHDRAW_TO_WALLET')),
  CONSTRAINT chk_cl_entries_chain_status CHECK (chain_status IN ('pending', 'confirmed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_credit_ledger_user ON public.credit_ledger_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_token ON public.credit_ledger_entries(token_id);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_ref ON public.credit_ledger_entries(ref_table, ref_id);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_tx_hash ON public.credit_ledger_entries(tx_hash);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_token ON public.credit_ledger_entries(user_id, token_id);

CREATE TABLE IF NOT EXISTS public.credit_ledger_balances (
  user_id               UUID NOT NULL REFERENCES public.users(id),
  token_id              INTEGER NOT NULL,
  balance               INTEGER NOT NULL DEFAULT 0,
  total_retired         INTEGER NOT NULL DEFAULT 0,
  updated_at            TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (user_id, token_id),

  CONSTRAINT chk_ledger_balance_nonneg CHECK (balance >= 0),
  CONSTRAINT chk_ledger_retired_nonneg CHECK (total_retired >= 0)
);

-- ════════════════════════════════════════════════════════════════════
-- BLOCKCHAIN — PENDING CHAIN LOGS (retry queue)
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.pending_chain_logs (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trade_id              UUID NOT NULL REFERENCES public.trades(id),
  payload               JSONB NOT NULL,
  attempts              INTEGER NOT NULL DEFAULT 0,
  next_retry_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMP DEFAULT NOW(),
  UNIQUE (trade_id)
);

CREATE INDEX IF NOT EXISTS idx_pending_chain_logs_retry ON public.pending_chain_logs(next_retry_at) WHERE attempts < 5;

-- ════════════════════════════════════════════════════════════════════
-- ADD MISSING COLUMNS TO EXISTING TABLES
-- ════════════════════════════════════════════════════════════════════

-- Add listed_quantity column to carbon_batches if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'carbon_batches' AND column_name = 'listed_quantity'
  ) THEN
    ALTER TABLE public.carbon_batches ADD COLUMN listed_quantity INTEGER DEFAULT 0;
  END IF;
END $$;

-- Add user_id_hash column to users if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'user_id_hash'
  ) THEN
    ALTER TABLE public.users ADD COLUMN user_id_hash VARCHAR(66);
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- ADD MISSING CHECK CONSTRAINTS TO EXISTING TABLES
-- ════════════════════════════════════════════════════════════════════

-- carbon_batches: listed_quantity >= 0
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_schema = 'public' AND constraint_name = 'chk_carbon_batches_listed_quantity_nonneg'
  ) THEN
    ALTER TABLE public.carbon_batches 
    ADD CONSTRAINT chk_carbon_batches_listed_quantity_nonneg CHECK (listed_quantity >= 0);
  END IF;
END $$;

-- carbon_batches: available_credits >= listed_quantity
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_schema = 'public' AND constraint_name = 'chk_carbon_batches_available_gte_listed'
  ) THEN
    ALTER TABLE public.carbon_batches 
    ADD CONSTRAINT chk_carbon_batches_available_gte_listed CHECK (available_credits >= COALESCE(listed_quantity, 0));
  END IF;
END $$;

-- wallet_transactions: amount > 0
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_schema = 'public' AND constraint_name = 'chk_wallet_tx_amount_positive'
  ) THEN
    ALTER TABLE public.wallet_transactions 
    ADD CONSTRAINT chk_wallet_tx_amount_positive CHECK (amount > 0);
  END IF;
END $$;

-- wallet_transactions: status check
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_schema = 'public' AND constraint_name = 'chk_wallet_tx_status'
  ) THEN
    ALTER TABLE public.wallet_transactions 
    ADD CONSTRAINT chk_wallet_tx_status CHECK (status IN ('pending', 'success', 'failed'));
  END IF;
END $$;

-- wallet_transactions: type check
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_schema = 'public' AND constraint_name = 'chk_wallet_tx_type'
  ) THEN
    ALTER TABLE public.wallet_transactions 
    ADD CONSTRAINT chk_wallet_tx_type CHECK (type IN ('credit', 'debit'));
  END IF;
END $$;

-- wallet_transactions: method check
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_schema = 'public' AND constraint_name = 'chk_wallet_tx_method'
  ) THEN
    ALTER TABLE public.wallet_transactions 
    ADD CONSTRAINT chk_wallet_tx_method CHECK (method IN ('upi', 'bank', 'inr', 'eth', 'system', 'razorpay'));
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- ADD MISSING UNIQUE CONSTRAINTS TO EXISTING TABLES
-- ════════════════════════════════════════════════════════════════════

-- platform_fees: unique trade_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_schema = 'public' AND constraint_name = 'unq_platform_fees_trade'
  ) THEN
    ALTER TABLE public.platform_fees 
    ADD CONSTRAINT unq_platform_fees_trade UNIQUE (trade_id);
  END IF;
END $$;

-- credit_ledger_balances: check constraints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_schema = 'public' AND constraint_name = 'chk_ledger_balance_nonneg'
  ) THEN
    ALTER TABLE public.credit_ledger_balances 
    ADD CONSTRAINT chk_ledger_balance_nonneg CHECK (balance >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_schema = 'public' AND constraint_name = 'chk_ledger_retired_nonneg'
  ) THEN
    ALTER TABLE public.credit_ledger_balances 
    ADD CONSTRAINT chk_ledger_retired_nonneg CHECK (total_retired >= 0);
  END IF;
END $$;

-- pending_chain_logs: unique trade_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_schema = 'public' AND constraint_name = 'pending_chain_logs_trade_id_key'
  ) THEN
    ALTER TABLE public.pending_chain_logs 
    ADD CONSTRAINT pending_chain_logs_trade_id_key UNIQUE (trade_id);
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════
-- INDEXES FOR PERFORMANCE
-- ════════════════════════════════════════════════════════════════════

-- trades: additional indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_trades_buyer_created ON public.trades(buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_seller_created ON public.trades(seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_payment_mode ON public.trades(payment_mode);
CREATE INDEX IF NOT EXISTS idx_trades_razorpay_payment ON public.trades(razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trades_razorpay_order ON public.trades(razorpay_order_id) WHERE razorpay_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trades_trade_invoice_number ON public.trades(trade_invoice_number) WHERE trade_invoice_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trades_payment_mode_status ON public.trades(payment_mode, status);

-- wallet_transactions: additional indexes
CREATE INDEX IF NOT EXISTS idx_wallet_tx_user_created ON public.wallet_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_created_at ON public.wallet_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_user_method ON public.wallet_transactions(user_id, method);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_user_debit_date ON public.wallet_transactions(user_id, type, method, created_at) WHERE type = 'debit' AND method = 'bank';

-- credit_ledger_entries: additional indexes
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_token ON public.credit_ledger_entries(user_id, token_id);

-- pending_chain_logs: retry index
CREATE INDEX IF NOT EXISTS idx_pending_chain_logs_retry ON public.pending_chain_logs(next_retry_at) WHERE attempts < 5;

-- ════════════════════════════════════════════════════════════════════
-- TRIGGERS
-- ═══════════════════════════════════════════════════════════════════

-- Ensure update_updated_at trigger exists on new tables
CREATE TRIGGER trg_trades_updated_at
  BEFORE UPDATE ON public.trades
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_wallet_transactions_updated_at
  BEFORE UPDATE ON public.wallet_transactions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_platform_fees_updated_at
  BEFORE UPDATE ON public.platform_fees
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_credit_ledger_entries_updated_at
  BEFORE UPDATE ON public.credit_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_credit_ledger_balances_updated_at
  BEFORE UPDATE ON public.credit_ledger_balances
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_pending_chain_logs_updated_at
  BEFORE UPDATE ON public.pending_chain_logs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ════════════════════════════════════════════════════════════════════
-- RLS POLICIES FOR FINANCIAL TABLES
-- ════════════════════════════════════════════════════════════════════

-- Enable RLS on new financial tables
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_ledger_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_chain_logs ENABLE ROW LEVEL SECURITY;

-- trades: users can see their own trades
CREATE POLICY trades_user_select ON public.trades
  FOR SELECT USING (
    auth.uid() = buyer_id OR auth.uid() = seller_id
  );

-- trades: backend can insert/update
CREATE POLICY trades_backend_all ON public.trades
  FOR ALL USING (
    current_setting('app.current_user_id', true) IS NOT NULL
  );

-- wallet_transactions: users see their own
CREATE POLICY wallet_tx_user_select ON public.wallet_transactions
  FOR SELECT USING (auth.uid() = user_id);

-- wallet_transactions: backend can insert/update
CREATE POLICY wallet_tx_backend_all ON public.wallet_transactions
  FOR ALL USING (
    current_setting('app.current_user_id', true) IS NOT NULL
  );

-- platform_fees: admin only
CREATE POLICY platform_fees_admin ON public.platform_fees
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() AND role IN ('admin')
    )
  );

-- credit_ledger_entries: users see their own
CREATE POLICY cl_entries_user_select ON public.credit_ledger_entries
  FOR SELECT USING (auth.uid() = user_id);

-- credit_ledger_entries: backend can insert
CREATE POLICY cl_entries_backend_insert ON public.credit_ledger_entries
  FOR INSERT WITH CHECK (
    current_setting('app.current_user_id', true) IS NOT NULL
  );

-- credit_ledger_balances: users see their own
CREATE POLICY cl_balances_user_select ON public.credit_ledger_balances
  FOR SELECT USING (auth.uid() = user_id);

-- credit_ledger_balances: backend can upsert
CREATE POLICY cl_balances_backend_upsert ON public.credit_ledger_balances
  FOR ALL USING (
    current_setting('app.current_user_id', true) IS NOT NULL
  );

-- pending_chain_logs: backend only
CREATE POLICY pending_logs_backend ON public.pending_chain_logs
  FOR ALL USING (
    current_setting('app.current_user_id', true) IS NOT NULL
  );

-- Enable RLS on existing tables that may not have it
ALTER TABLE public.credit_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_ledger_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_chain_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_fees ENABLE ROW LEVEL SECURITY;

-- Ensure RLS is enabled on existing financial tables
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_ledger_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_chain_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carbon_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

-- Add RLS policies for existing tables that may be missing
DO $$
BEGIN
  -- wallet_ledger policies
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'wallet_ledger' AND policyname = 'wl_select_own') THEN
    CREATE POLICY wl_select_own ON public.wallet_ledger FOR SELECT USING (auth.uid() = user_id);
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'wallet_ledger' AND policyname = 'wl_backend_all') THEN
    CREATE POLICY wl_backend_all ON public.wallet_ledger FOR ALL USING (
      current_setting('app.current_user_id', true) IS NOT NULL
    );
  END IF;
END $$;