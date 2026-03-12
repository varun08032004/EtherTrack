# EtherTrack Backend API

Carbon Credit Registry — Node.js + Express + PostgreSQL

## Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Set up PostgreSQL on Supabase
1. Go to https://supabase.com → New Project
2. Copy your `DATABASE_URL` from Settings → Database → Connection string → URI
3. Run the schema: paste contents of `db/schema.sql` into Supabase SQL Editor and run

### 3. Set up environment variables
```bash
cp .env.example .env
```
Fill in:
- `DATABASE_URL` — from Supabase
- `JWT_SECRET` — any long random string
- `JWT_REFRESH_SECRET` — different long random string
- `RESEND_API_KEY` — from https://resend.com (free 3000 emails/month)
- `PINATA_API_KEY` + `PINATA_SECRET_KEY` — from https://pinata.cloud (free 1GB)
- Blockchain addresses — already filled if using same contracts

### 4. Run migrations
```bash
npm run db:migrate
```

### 5. Start dev server
```bash
npm run dev
```

---

## API Routes

### Auth
| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/auth/register | Register with email + password |
| POST | /api/auth/verify-email | Verify OTP from email |
| POST | /api/auth/resend-otp | Resend verification OTP |
| POST | /api/auth/login | Login → returns JWT tokens |
| POST | /api/auth/refresh | Refresh access token |
| POST | /api/auth/logout | Logout + invalidate refresh token |
| GET  | /api/auth/me | Get current user profile |

### Wallet
| Method | Route | Description |
|--------|-------|-------------|
| GET  | /api/wallet/challenge | Get message to sign with MetaMask |
| POST | /api/wallet/bind | Bind wallet via EIP-191 signature |
| GET  | /api/wallet/status | Check wallet + KYC status |
| POST | /api/wallet/kyc | Sync KYC status from blockchain |

### Registry — Projects
| Method | Route | Description |
|--------|-------|-------------|
| GET  | /api/registry/projects | List approved projects |
| GET  | /api/registry/projects/:id | Get project + batches |
| POST | /api/registry/projects | Submit new project |
| PATCH| /api/registry/projects/:id/approve | Approve project (admin) |
| PATCH| /api/registry/projects/:id/reject | Reject project (admin) |
| GET  | /api/registry/my-projects | Your projects |

### Registry — Batches
| Method | Route | Description |
|--------|-------|-------------|
| GET  | /api/registry/batches | List batches |
| GET  | /api/registry/batches/token/:tokenId | Get batch by tokenId |
| POST | /api/registry/batches | Create new batch |
| POST | /api/registry/batches/:id/tokenise | Record mint + upload IPFS metadata |

### Transactions
| Method | Route | Description |
|--------|-------|-------------|
| GET  | /api/transactions | Platform-wide transaction history |
| GET  | /api/transactions/my | My transactions |
| POST | /api/transactions/sync | Sync tx from frontend |
| GET  | /api/transactions/stats | Platform stats |
| GET  | /api/transactions/retirements | All retirements |
| POST | /api/transactions/retirements | Record retirement + upload certificate to IPFS |
| GET  | /api/transactions/retirements/:certId | Public certificate lookup |

### Emissions
| Method | Route | Description |
|--------|-------|-------------|
| GET  | /api/emissions/my | My emission reports |
| POST | /api/emissions | Submit emission report |
| PUT  | /api/emissions/:id | Update emission report |

---

## Deploy to Railway

1. Push to GitHub
2. Go to https://railway.app → New Project → Deploy from GitHub
3. Add all environment variables from `.env`
4. Railway auto-detects Node.js and runs `npm start`

## Frontend env additions
```
REACT_APP_API_URL=https://your-railway-app.railway.app
```
