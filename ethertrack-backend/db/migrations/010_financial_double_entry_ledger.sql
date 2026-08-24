-- 010_financial_double_entry_ledger.sql
-- Financial Double-Entry Ledger Tables
-- Implements GAAP-compliant accounting with immutable journal entries

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;

-- Set search_path to include extensions schema for uuid_generate_v4()
SET LOCAL search_path = public, extensions;

-- Chart of Accounts
CREATE TABLE financial_accounts (
    account_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_code      VARCHAR(20) UNIQUE NOT NULL,  -- e.g., '1000', '2000', '4000', '5000'
    account_name      VARCHAR(100) NOT NULL,
    account_type      VARCHAR(20) NOT NULL,         -- ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE
    parent_account_id UUID REFERENCES financial_accounts(account_id),
    currency          VARCHAR(3) DEFAULT 'INR',
    is_active         BOOLEAN DEFAULT TRUE,
    created_at        TIMESTAMP DEFAULT NOW()
);

-- Immutable Journal Entries
CREATE TABLE journal_entries (
    entry_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entry_number      BIGSERIAL UNIQUE NOT NULL,    -- Sequential for audit
    entry_date        DATE NOT NULL DEFAULT CURRENT_DATE,
    reference_type    VARCHAR(50),                  -- 'TRADE', 'DEPOSIT', 'WITHDRAWAL', 'FEE', 'REFUND'
    reference_id      UUID,                         -- trade_id, payment_id, etc.
    description       TEXT,
    status            VARCHAR(20) DEFAULT 'POSTED', -- POSTED, REVERSED
    created_by        UUID REFERENCES users(id),
    created_at        TIMESTAMP DEFAULT NOW(),
    posted_at         TIMESTAMP DEFAULT NOW()
);

-- Journal Lines (double-entry)
CREATE TABLE journal_lines (
    line_id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entry_id          UUID NOT NULL REFERENCES journal_entries(entry_id) ON DELETE CASCADE,
    account_id        UUID NOT NULL REFERENCES financial_accounts(account_id),
    debit_amount      NUMERIC(20, 2) DEFAULT 0,
    credit_amount     NUMERIC(20, 2) DEFAULT 0,
    description       TEXT,
    line_number       INT NOT NULL,
    
    CONSTRAINT chk_one_side CHECK (
        (debit_amount > 0 AND credit_amount = 0) OR
        (debit_amount = 0 AND credit_amount > 0)
    )
);

-- Materialized Account Balances
CREATE TABLE account_balances (
    account_id        UUID PRIMARY KEY REFERENCES financial_accounts(account_id),
    balance           NUMERIC(20, 2) NOT NULL DEFAULT 0,  -- credit - debit
    last_entry_id     UUID REFERENCES journal_entries(entry_id),
    updated_at        TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT chk_balance_not_negative CHECK (balance >= 0) -- for asset/expense accounts
);

-- Indexes
CREATE INDEX idx_journal_entries_ref ON journal_entries(reference_type, reference_id);
CREATE INDEX idx_journal_lines_account ON journal_lines(account_id);
CREATE INDEX idx_journal_lines_entry ON journal_lines(entry_id);

-- Trigger to maintain account_balances
CREATE OR REPLACE FUNCTION update_account_balance()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE account_balances 
        SET balance = balance + NEW.credit_amount - NEW.debit_amount,
            last_entry_id = NEW.entry_id,
            updated_at = NOW()
        WHERE account_id = NEW.account_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE account_balances 
        SET balance = balance - NEW.credit_amount + NEW.debit_amount,
            updated_at = NOW()
        WHERE account_id = NEW.account_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_journal_lines_balance
AFTER INSERT OR DELETE ON journal_lines
FOR EACH ROW EXECUTE FUNCTION update_account_balance();

-- Standard Account Codes
INSERT INTO financial_accounts (account_code, account_name, account_type) VALUES
-- Assets
('1100', 'Cash - INR Wallet', 'ASSET'),
('1110', 'Cash - Razorpay Clearing', 'ASSET'),
('1120', 'Cash - Platform Fees Collected', 'ASSET'),
('1200', 'Accounts Receivable - Seller Payouts', 'ASSET'),

-- Liabilities
('2100', 'Accounts Payable - Buyer Deposits', 'LIABILITY'),
('2110', 'GST Payable - CGST', 'LIABILITY'),
('2120', 'GST Payable - SGST', 'LIABILITY'),
('2130', 'GST Payable - IGST', 'LIABILITY'),
('2200', 'Customer Deposits - INR Wallet', 'LIABILITY'),

-- Revenue
('4100', 'Revenue - Buyer Transaction Fees', 'REVENUE'),
('4110', 'Revenue - Seller Transaction Fees', 'REVENUE'),
('4200', 'Revenue - Subscription Fees', 'REVENUE'),

-- Expense
('5100', 'Expense - Payment Gateway Fees', 'EXPENSE'),
('5200', 'Expense - Blockchain Gas Fees', 'EXPENSE');

-- Initialize account_balances for all accounts
INSERT INTO account_balances (account_id, balance)
SELECT account_id, 0 FROM financial_accounts;