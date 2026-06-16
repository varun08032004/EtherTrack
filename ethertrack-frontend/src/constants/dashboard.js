/**
 * constants/dashboard.js
 * Single source of truth for all dashboard configuration.
 * No magic numbers anywhere else.
 */

// ── Timing ─────────────────────────────────────────────────────────────────
export const FETCH_TIMEOUT_MS     = 8_000;
export const RATE_REFRESH_MS      = 5  * 60 * 1_000;   // 5 min
export const RATE_STALE_WARN_MS   = 15 * 60 * 1_000;   // 15 min
export const REFRESH_COOLDOWN_MS  = 10 * 1_000;         // 10 s
export const PENDING_POLL_MS      = 30 * 1_000;         // 30 s
export const ALERT_POLL_MS        = 60 * 1_000;         // 60 s
export const HEALTH_POLL_MS       = 15 * 1_000;         // 15 s — was 60 s (too slow)
export const AUTO_RETRY_DELAY_MS  = 30 * 1_000;

// ── KYC ────────────────────────────────────────────────────────────────────
export const KYC_EXPIRY_WARN_DAYS = 30;

// ── Local-storage keys ─────────────────────────────────────────────────────
export const LS_KEY_REFRESH = 'et:lastRefreshAt';

// ── Network status colours ─────────────────────────────────────────────────
export const NETWORK_COLOR = {
  ONLINE:   '#22c55e',
  CHECKING: '#facc15',
  DEGRADED: '#f87171',
};

// ── News ────────────────────────────────────────────────────────────────────
export const ALLOWED_NEWS_TAGS = new Set([
  'CCTS', 'BEE', 'MARKET', 'POLICY', 'TOKENIZATION', 'GLOBAL', 'SEBI', 'CBAM',
]);

export const TAG_COLORS = {
  CCTS:         { bg: '#1a0a28', c: '#a78bfa', border: '#a78bfa33' },
  BEE:          { bg: '#1a1500', c: '#facc15', border: '#facc1533' },
  MARKET:       { bg: '#0d2e1f', c: '#22c55e', border: '#22c55e33' },
  POLICY:       { bg: '#0a1628', c: '#60a5fa', border: '#60a5fa33' },
  TOKENIZATION: { bg: '#1a0d00', c: '#f97316', border: '#f9731633' },
  GLOBAL:       { bg: '#120a28', c: '#c084fc', border: '#c084fc33' },
  SEBI:         { bg: '#0a1628', c: '#38bdf8', border: '#38bdf833' },
  CBAM:         { bg: '#1a0e00', c: '#fb923c', border: '#fb923c33' },
};

export const NEWS_SOURCE_LINKS = [
  { label: 'PIB / MoEFCC', url: 'https://pib.gov.in/RSSFeed.aspx?ModID=6' },
  { label: 'CCTS Portal',  url: 'https://ccts.gov.in'                       },
  { label: 'BEE India',    url: 'https://beeindia.gov.in'                   },
  { label: 'UNFCCC',       url: 'https://unfccc.int/news'                   },
];

export const STATIC_NEWS_FALLBACK = [
  { id: 1, tag: 'CCTS',         title: 'Carbon Credit Trading Scheme: MoEFCC notifies Phase 1 obligated entities for compliance year 2026–27', source: 'PIB / MoEFCC', url: 'https://pib.gov.in'        },
  { id: 2, tag: 'BEE',          title: 'Bureau of Energy Efficiency releases updated PAT Cycle VII baseline norms for designated consumers',   source: 'BEE India',    url: 'https://beeindia.gov.in'  },
  { id: 3, tag: 'MARKET',       title: 'Indian carbon credit prices on ICX stabilise near ₹1,200/tCO₂ as voluntary demand rises',            source: 'Carbon Pulse', url: 'https://carbon-pulse.com' },
  { id: 4, tag: 'POLICY',       title: 'COP31 pre-session: Article 6.4 mechanism rulebook finalised; India signals active participation',     source: 'UNFCCC',       url: 'https://unfccc.int/news'  },
  { id: 5, tag: 'TOKENIZATION', title: 'Ethereum-based carbon tokenisation volumes cross 2M tCO₂ in Q1 2026 driven by DeFi integrations',   source: 'CoinDesk',     url: 'https://coindesk.com'     },
];

// ── Allowed wallet hostnames (UX gating only — enforce server-side too) ────
export const ALLOWED_WALLET_HOSTS = (
  (typeof process !== 'undefined' && process.env?.REACT_APP_ALLOWED_HOSTS)
  || 'ethertrack.in'
)
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

// ── Network / chain config (drive from env, not hardcoded) ─────────────────
export const NETWORK_DISPLAY_NAME = process.env.REACT_APP_NETWORK_NAME  || 'Ethereum Sepolia';
export const CONTRACT_DISPLAY_NAME = process.env.REACT_APP_CONTRACT_NAME || 'Marketplace.sol';

// ── Circuit breaker ────────────────────────────────────────────────────────
export const CB_FAILURE_THRESHOLD = 3;    // open after N consecutive failures
export const CB_OPEN_DURATION_MS  = 60_000; // stay open for 60 s then probe