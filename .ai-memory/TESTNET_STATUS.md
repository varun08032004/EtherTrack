# Testnet Status - SEC-001 Items

# SEC-001A: SECRET ROTATION STATUS (TESTNET)

## Database & Infrastructure Secrets - TESTNET READY
- DATABASE_URL / SUPABASE_URL: Testnet Supabase project can be used
- SUPABASE_SERVICE_ROLE_KEY: Testnet key usable
- REDIS_URL: Local/Upstash testnet works
- SENTRY_DSN: Test project works
- ALCHEMY_RPC / SEPOLIA_RPC_URL: Testnet RPC works

## Authentication & Session Secrets - TESTNET READY
- JWT_SECRET / JWT_REFRESH_SECRET: Test secret works
- TOTP_ENCRYPTION_KEY: Test key works
- COOKIE_SECRET: Test secret works

## Payment & External Services - TESTNET READY
- RAZORPAY_KEY_ID/SECRET: Test keys work
- RAZORPAY_WEBHOOK_SECRET: Test webhook works
- PINATA_API_KEY/SECRET: Test keys work
- RESEND_API_KEY / SMTP_PASS: Test keys work
- FIREBASE_PRIVATE_KEY: Test project works

## Firebase Auth / Supabase RLS - TESTNET READY
- Firebase Auth config: Test project works
- Supabase RLS policies: Test policies work

## Blockchain Keys - TESTNET MIGRATION READY
- MINTER_PRIVATE_KEY: Sepolia contracts deployed
- CHAIN_SIGNER_PRIVATE_KEY: Sepolia Marketplace
- RELAYER_PRIVATE_KEY: Sepolia AuditTrail
- PRIVATE_KEY (deployer): Sepolia deployment

## Smart Contract Addresses - TESTNET DEPLOYED
- KYC_REGISTRY: 0x443e068FE6F2F7B57C71A3Bc5492aA98b5069597
- TREASURY: 0x2504e917A78C8094Aee0cba8e076fc3891b95265
- CARBON_CREDIT_TOKEN: 0x0C72dcc5a88C66259DDB09B187F9A8392f6cf3C2
- EMISSION_REGISTRY: 0xb978fB9661ED48C4Fac92a73034E619bc640c18b
- MARKETPLACE: 0x3cDE5d0e6A0B0955d5fb72e7E5Ba2e3070AEA19A
- AMM_POOL: 0x17d897aa29919cA5a39bcC165dE6E63eaB554c2F
- AUDIT_CONTRACT: 0x98D9f9555bd2049Fb52DCe040C1B895CB55BcE81
- CREDIT_LEDGER: 0x2046625FC6181DeE411a35F160Cb00b9FEC9d830

SEC-001A TESTNET CHECKLIST:
- Database/Infrastructure secrets testnet-ready
- Auth/Session secrets testnet-ready
- Payment/External services testnet-ready
- Firebase/Supabase config testnet-ready
- Blockchain keys testnet migration ready
- Smart contracts deployed on Sepolia
- Frontend build passes (testnet config)
- Secret scanning passes (false positives only)
- Git history audited

PRODUCTION BLOCKERS (NOT TESTNET):
- Rotate all 8 critical secrets in provider dashboards
- Execute blockchain migrations on Polygon mainnet (4+ txns)
- Deploy contracts to Polygon mainnet
- Fill production .env templates
- Update Vercel/Render/Cloudflare env vars
- Verify on-chain migrations on Polygonscan
- Full regression test suite
- Confirm old credentials revoked

SEC-001A STATUS: TESTNET READY | PRODUCTION BLOCKED
SEC-002 CAN START ON TESTNET