-- 20260809141957_audit_hardening_indexes_and_rls.sql
-- FIN-001/FIN-002/FIN-003/FIN-004/FIN-005/FIN-006: Audit hardening indexes and RLS
-- This migration adds additional indexes and RLS policies identified in the production-readiness audit.

-- ════════════════════════════════════════════════════════════════════
-- ADDITIONAL PERFORMANCE INDEXES
-- ════════════════════════════════════════════════════════════════════

-- trades: additional query patterns
CREATE INDEX IF NOT EXISTS idx_trades_batch_status ON public.trades(batch_id, status);
CREATE INDEX IF NOT EXISTS idx_trades_payment_mode_status ON public.trades(payment_mode, status);
CREATE INDEX IF NOT EXISTS idx_trades_seller_status ON public.trades(seller_id, status);
CREATE INDEX IF NOT EXISTS idx_trades_completed_at ON public.trades(completed_at DESC) WHERE status = 'completed';

-- wallet_transactions: additional query patterns
CREATE INDEX IF NOT EXISTS idx_wallet_tx_user_status ON public.wallet_transactions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_method_created ON public.wallet_transactions(method, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_type_status ON public.wallet_transactions(type, status);
CREATE INDEX IF NOT EXISTS idx_wallet_tx_amount_range ON public.wallet_transactions(amount) WHERE status = 'success';

-- wallet_ledger: additional query patterns
CREATE INDEX IF NOT EXISTS idx_wl_user_ref ON public.wallet_ledger(user_id, ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_wl_ref_type_created ON public.wallet_ledger(ref_type, created_at DESC) WHERE ref_id IS NOT NULL;

-- credit_ledger_entries: additional query patterns
CREATE INDEX IF NOT EXISTS idx_credit_ledger_created_at ON public.credit_ledger_entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_action_type ON public.credit_ledger_entries(action_type);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_ref ON public.credit_ledger_entries(ref_table, ref_id);

-- credit_ledger_balances: additional query patterns
CREATE INDEX IF NOT EXISTS idx_cl_balances_token ON public.credit_ledger_balances(token_id);
CREATE INDEX IF NOT EXISTS idx_cl_balances_balance ON public.credit_ledger_balances(balance) WHERE balance > 0;

-- wallet_transactions: additional composite indexes for reconciliation
CREATE INDEX IF NOT EXISTS idx_wt_user_type_created ON public.wallet_transactions(user_id, type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wt_user_method_status ON public.wallet_transactions(user_id, method, status);
CREATE INDEX IF NOT EXISTS idx_wt_trade_type ON public.wallet_transactions(trade_id, trade_type);

-- trades: reconciliation indexes
CREATE INDEX IF NOT EXISTS idx_trades_inr_settlement ON public.trades(inr_settlement_at DESC) WHERE inr_settlement_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trades_chain_logged ON public.trades(chain_logged_at DESC) WHERE chain_logged_at IS NOT NULL;

-- wallet_transactions: additional webhook reconciliation indexes
CREATE INDEX IF NOT EXISTS idx_wt_order_status ON public.wallet_transactions(razorpay_order_id, status) WHERE razorpay_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wt_payment_status ON public.wallet_transactions(razorpay_payment_id, status) WHERE razorpay_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wt_payout_status ON public.wallet_transactions(razorpay_payout_id, status) WHERE razorpay_payout_id IS NOT NULL;

-- ═════════════════════════════════════════════════════════════════════
-- MISSING RLS POLICIES FOR EXISTING TABLES
-- ═════════════════════════════════════════════════════════════════════

-- carbon_batches: users can read their own batches
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'carbon_batches' AND policyname = 'batches_owner_select') THEN
    CREATE POLICY batches_owner_select ON public.carbon_batches
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'carbon_batches' AND policyname = 'batches_owner_insert') THEN
    CREATE POLICY batches_owner_insert ON public.carbon_batches
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'carbon_batches' AND policyname = 'batches_admin_all') THEN
    CREATE POLICY batches_admin_all ON public.carbon_batches
      FOR ALL USING (
        EXISTS (
          SELECT 1 FROM public.users 
          WHERE id = auth.uid() AND role = 'admin'
        )
      );
  END IF;
END $$;

-- projects: users can read approved projects, developers can read their own
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'projects' AND policyname = 'projects_public_read') THEN
    CREATE POLICY projects_public_read ON public.projects
      FOR SELECT USING (status = 'approved');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'projects' AND policyname = 'projects_developer_access') THEN
    CREATE POLICY projects_developer_access ON public.projects
      FOR ALL USING (auth.uid() = developer_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'projects' AND policyname = 'projects_admin_all') THEN
    CREATE POLICY projects_admin_all ON public.projects
      FOR ALL USING (
        EXISTS (
          SELECT 1 FROM public.users 
          WHERE id = auth.uid() AND role = 'admin'
        )
      );
  END IF;
END $$;

-- registry_transactions: users can read their own transactions
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'registry_transactions' AND policyname = 'rt_user_select') THEN
    CREATE POLICY rt_user_select ON public.registry_transactions
      FOR SELECT USING (
        auth.uid() = from_user_id OR auth.uid() = to_user_id
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'registry_transactions' AND policyname = 'rt_backend_all') THEN
    CREATE POLICY rt_backend_all ON public.registry_transactions
      FOR ALL USING (
        current_setting('app.current_user_id', true) IS NOT NULL
      );
  END IF;
END $$;

-- retirements: users can read their own retirements
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'retirements' AND policyname = 'retirements_user_select') THEN
    CREATE POLICY retirements_user_select ON public.retirements
      FOR SELECT USING (auth.uid() = retired_by);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'retirements' AND policyname = 'retirements_backend_all') THEN
    CREATE POLICY retirements_backend_all ON public.retirements
      FOR ALL USING (
        current_setting('app.current_user_id', true) IS NOT NULL
      );
  END IF;
END $$;

-- emission_activities: users can read/write their own
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'emission_activities' AND policyname = 'ea_user_select') THEN
    CREATE POLICY ea_user_select ON public.emission_activities
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'emission_activities' AND policyname = 'ea_user_write') THEN
    CREATE POLICY ea_user_write ON public.emission_activities
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- emission_reports: users can read their own
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'emission_reports' AND policyname = 'er_user_select') THEN
    CREATE POLICY er_user_select ON public.emission_reports
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'emission_reports' AND policyname = 'er_user_write') THEN
    CREATE POLICY er_user_write ON public.emission_reports
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- notifications: users can read their own
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications' AND policyname = 'notifications_user_select') THEN
    CREATE POLICY notifications_user_select ON public.notifications
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications' AND policyname = 'notifications_user_update') THEN
    CREATE POLICY notifications_user_update ON public.notifications
      FOR UPDATE USING (auth.uid() = user_id);
  END IF;
END $$;

-- audit_log: users can read their own audit logs
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'audit_log' AND policyname = 'audit_user_select') THEN
    CREATE POLICY audit_user_select ON public.audit_log
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

-- audit_logs: admin only
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'audit_logs' AND policyname = 'audit_logs_admin') THEN
    CREATE POLICY audit_logs_admin ON public.audit_logs
      FOR ALL USING (
        EXISTS (
          SELECT 1 FROM public.users 
          WHERE id = auth.uid() AND role = 'admin'
        )
      );
  END IF;
END $$;

-- organisations: members can read their org
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'organisations' AND policyname = 'org_member_select') THEN
    CREATE POLICY org_member_select ON public.organisations
      FOR SELECT USING (
        id IN (
          SELECT org_id FROM public.org_members 
          WHERE user_id = auth.uid() AND status = 'active'
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'organisations' AND policyname = 'org_admin_all') THEN
    CREATE POLICY org_admin_all ON public.organisations
      FOR ALL USING (
        EXISTS (
          SELECT 1 FROM public.users 
          WHERE id = auth.uid() AND role = 'admin'
        )
      );
  END IF;
END $$;

-- org_members: users can read their own memberships
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'org_members' AND policyname = 'om_member_select') THEN
    CREATE POLICY om_member_select ON public.org_members
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'org_members' AND policyname = 'om_admin_all') THEN
    CREATE POLICY om_admin_all ON public.org_members
      FOR ALL USING (
        EXISTS (
          SELECT 1 FROM public.users 
          WHERE id = auth.uid() AND role = 'admin'
        )
      );
  END IF;
END $$;

-- org_invites: users can read their own invites
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'org_invites' AND policyname = 'oi_user_select') THEN
    CREATE POLICY oi_user_select ON public.org_invites
      FOR SELECT USING (auth.uid() = invited_by OR EXISTS (
        SELECT 1 FROM public.org_members 
        WHERE org_id = org_invites.org_id AND user_id = auth.uid() AND team_role IN ('admin', 'owner')
      ));
  END IF;
END $$;

-- user_bank_accounts: users can manage their own bank accounts
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_bank_accounts' AND policyname = 'uba_user_all') THEN
    CREATE POLICY uba_user_all ON public.user_bank_accounts
      FOR ALL USING (auth.uid() = user_id);
  END IF;
END $$;

-- subscription_payments: users can read their own payments
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'subscription_payments' AND policyname = 'sp_user_select') THEN
    CREATE POLICY sp_user_select ON public.subscription_payments
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'subscription_payments' AND policyname = 'sp_backend_all') THEN
    CREATE POLICY sp_backend_all ON public.subscription_payments
      FOR ALL USING (
        current_setting('app.current_user_id', true) IS NOT NULL
      );
  END IF;
END $$;

-- subscription_history: users can read their own history
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'subscription_history' AND policyname = 'sh_user_select') THEN
    CREATE POLICY sh_user_select ON public.subscription_history
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

-- coupons: public read, admin write
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'coupons' AND policyname = 'coupons_public_read') THEN
    CREATE POLICY coupons_public_read ON public.coupons
      FOR SELECT USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'coupons' AND policyname = 'coupons_admin_write') THEN
    CREATE POLICY coupons_admin_write ON public.coupons
      FOR ALL USING (
        EXISTS (
          SELECT 1 FROM public.users 
          WHERE id = auth.uid() AND role = 'admin'
        )
      );
  END IF;
END $$;

-- coupon_redemptions: users can read their own
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'coupon_redemptions' AND policyname = 'cr_user_select') THEN
    CREATE POLICY cr_user_select ON public.coupon_redemptions
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

-- support_tickets: users can read their own tickets
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'support_tickets' AND policyname = 'st_user_select') THEN
    CREATE POLICY st_user_select ON public.support_tickets
      FOR SELECT USING (auth.uid() = user_id::uuid);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'support_tickets' AND policyname = 'st_user_write') THEN
    CREATE POLICY st_user_write ON public.support_tickets
      FOR INSERT WITH CHECK (auth.uid() = user_id::uuid);
  END IF;
END $$;

-- support_tickets: admin can manage all
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'support_tickets' AND policyname = 'st_admin_all') THEN
    CREATE POLICY st_admin_all ON public.support_tickets
      FOR ALL USING (
        EXISTS (
          SELECT 1 FROM public.users 
          WHERE id = auth.uid() AND role = 'admin'
        )
      );
  END IF;
END $$;

-- support_feedback: users can read their own feedback
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'support_feedback' AND policyname = 'sf_user_select') THEN
    CREATE POLICY sf_user_select ON public.support_feedback
      FOR SELECT USING (auth.uid() = user_id::uuid);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'support_feedback' AND policyname = 'sf_user_write') THEN
    CREATE POLICY sf_user_write ON public.support_feedback
      FOR INSERT WITH CHECK (auth.uid() = user_id::uuid);
  END IF;
END $$;

-- support_unanswered: users can read their own unanswered queries
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'support_unanswered' AND policyname = 'su_user_select') THEN
    CREATE POLICY su_user_select ON public.support_unanswered
      FOR SELECT USING (auth.uid() = user_id::uuid);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'support_unanswered' AND policyname = 'su_user_write') THEN
    CREATE POLICY su_user_write ON public.support_unanswered
      FOR INSERT WITH CHECK (auth.uid() = user_id::uuid);
  END IF;
END $$;

-- ═════════════════════════════════════════════════════════════════════
-- ENABLE RLS ON TABLES THAT MAY BE MISSING IT
-- ══════════════════════════════════════════════════════════════════════

ALTER TABLE public.carbon_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registry_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emission_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emission_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_unanswered ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_unanswered ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupon_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_unanswered ENABLE ROW LEVEL SECURITY;

-- ═════════════════════════════════════════════════════════════════════
-- ADDITIONAL CHECK CONSTRAINTS FOR DATA INTEGRITY
-- ═════════════════════════════════════════════════════════════════════

-- trades: ensure non-negative fees
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_schema = 'public' AND constraint_name = 'chk_trades_fees_non_negative'
  ) THEN
    ALTER TABLE public.trades 
    ADD CONSTRAINT chk_trades_fees_non_negative 
    CHECK (buyer_fee_inr >= 0 AND seller_fee_inr >= 0 AND total_fee_inr >= 0 AND gst_inr >= 0);
  END IF;
END $$;

-- trades: ensure positive amounts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_schema = 'public' AND constraint_name = 'chk_trades_quantity'
  ) THEN
    ALTER TABLE public.trades 
    ADD CONSTRAINT chk_trades_quantity CHECK (quantity > 0);
  END IF;
END $$;

-- wallet_transactions: ensure positive amount
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

-- credit_ledger_balances: non-negative balance and retired
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

-- wallet_ledger: non-negative amount
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_schema = 'public' AND constraint_name = 'wallet_ledger_amount_paise_check'
  ) THEN
    ALTER TABLE public.wallet_ledger 
    ADD CONSTRAINT wallet_ledger_amount_paise_check CHECK (amount_paise >= 0);
  END IF;
END $$;

-- ═════════════════════════════════════════════════════════════════════
-- ADDITIONAL UNIQUE CONSTRAINTS FOR IDEMPOTENCY
-- ═════════════════════════════════════════════════════════════════════

-- subscription_payments: idempotency key
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_schema = 'public' AND constraint_name = 'subscription_payments_idempotency_key_unique'
  ) THEN
    ALTER TABLE public.subscription_payments 
    ADD CONSTRAINT subscription_payments_idempotency_key_unique UNIQUE (idempotency_key);
  END IF;
END $$;

-- trades: failed trade records tx_hash uniqueness
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_schema = 'public' AND constraint_name = 'failed_trade_records_tx_hash_key'
  ) THEN
    ALTER TABLE public.failed_trade_records 
    ADD CONSTRAINT failed_trade_records_tx_hash_key UNIQUE (tx_hash);
  END IF;
END $$;

-- wallet_transactions: reference uniqueness
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_schema = 'public' AND constraint_name = 'wallet_transactions_reference_key'
  ) THEN
    ALTER TABLE public.wallet_transactions 
    ADD CONSTRAINT wallet_transactions_reference_key UNIQUE (reference);
  END IF;
END $$;

-- wallet_transactions: razorpay_payment_id uniqueness
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_schema = 'public' AND constraint_name = 'wallet_transactions_razorpay_payment_id_key'
  ) THEN
    ALTER TABLE public.wallet_transactions 
    ADD CONSTRAINT wallet_transactions_razorpay_payment_id_key UNIQUE (razorpay_payment_id);
  END IF;
END $$;

-- wallet_transactions: razorpay_payout_id uniqueness
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_schema = 'public' AND constraint_name = 'wallet_transactions_razorpay_payout_id_key'
  ) THEN
    ALTER TABLE public.wallet_transactions 
    ADD CONSTRAINT wallet_transactions_razorpay_payout_id_key UNIQUE (razorpay_payout_id);
  END IF;
END $$;

-- wallet_transactions: razorpay_order_id uniqueness
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_schema = 'public' AND constraint_name = 'wallet_transactions_razorpay_order_id_key'
  ) THEN
    ALTER TABLE public.wallet_transactions 
    ADD CONSTRAINT wallet_transactions_razorpay_order_id_key UNIQUE (razorpay_order_id);
  END IF;
END $$;

-- wallet_transactions: razorpay_payout_id uniqueness
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_schema = 'public' AND constraint_name = 'wallet_transactions_razorpay_payout_id_key'
  ) THEN
    ALTER TABLE public.wallet_transactions 
    ADD CONSTRAINT wallet_transactions_razorpay_payout_id_key UNIQUE (razorpay_payout_id);
  END IF;
END $$;

-- wallet_transactions: razorpay_order_id uniqueness
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_schema = 'public' AND constraint_name = 'wallet_transactions_razorpay_order_id_key'
  ) THEN
    ALTER TABLE public.wallet_transactions 
    ADD CONSTRAINT wallet_transactions_razorpay_order_id_key UNIQUE (razorpay_order_id);
  END IF;
END $$;

-- wallet_transactions: razorpay_payment_id uniqueness
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_schema = 'public' AND constraint_name = 'wallet_transactions_razorpay_payment_id_key'
  ) THEN
    ALTER TABLE public.wallet_transactions 
    ADD CONSTRAINT wallet_transactions_razorpay_payment_id_key UNIQUE (razorpay_payment_id);
  END IF;
END $$;

-- ═════════════════════════════════════════════════════════════════════
-- AUDIT LOGGING ENHANCEMENTS
-- ═════════════════════════════════════════════════════════════════════

-- Add admin_audit_log table if not exists (for security audit trail)
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id        UUID NOT NULL REFERENCES public.users(id),
  action          VARCHAR(100) NOT NULL,
  target_user_id  UUID,
  details         JSONB,
  ip_address      VARCHAR(45),
  user_agent      TEXT,
  created_at      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin ON public.admin_audit_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_target ON public.admin_audit_log(target_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action ON public.admin_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON public.admin_audit_log(created_at DESC);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'admin_audit_log' AND policyname = 'audit_admin_all') THEN
    CREATE POLICY audit_admin_all ON public.admin_audit_log
      FOR ALL USING (
        EXISTS (
          SELECT 1 FROM public.users 
          WHERE id = auth.uid() AND role = 'admin'
        )
      );
  END IF;
END $$;