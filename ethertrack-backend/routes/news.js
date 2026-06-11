// routes/news.js — EtherTrack
// Production news — tiered strategy:
//   Tier 1: NewsData.io API (free tier — 200 req/day, reliable)
//   Tier 2: GNews API (free tier — 100 req/day)
//   Tier 3: Rich curated static fallback
//
// Setup (free, 2 minutes):
//   1. https://newsdata.io → get NEWSDATA_API_KEY
//   2. https://gnews.io   → get GNEWS_API_KEY (optional)
//   3. Add to .env:
//        NEWSDATA_API_KEY=your_key_here
//        GNEWS_API_KEY=your_key_here
//
// Without API keys → curated static fallback served automatically.
'use strict';

const router  = require('express').Router();
const https   = require('https');

const CACHE_TTL_MS     = 30 * 60 * 1_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_ITEMS        = 10;

const cache = { items: null, fetchedAt: 0, source: 'fallback' };

const STATIC_FALLBACK = [
  { id:'s-1', tag:'CCTS',         title:'MoEFCC notifies Phase 1 obligated entities under Carbon Credit Trading Scheme for compliance year 2026–27',                                                               source:'PIB / MoEFCC',  url:'https://pib.gov.in',         publishedAt:'2026-04-01T09:00:00Z' },
  { id:'s-2', tag:'BEE',          title:'Bureau of Energy Efficiency releases PAT Cycle VII baseline norms for designated consumers in steel, cement and aluminium sectors',                                       source:'BEE India',      url:'https://beeindia.gov.in',    publishedAt:'2026-03-28T10:00:00Z' },
  { id:'s-3', tag:'MARKET',       title:'Indian carbon credit prices on ICX stabilise near ₹1,200 per tCO₂ as voluntary corporate demand rises ahead of CCTS compliance deadline',                                source:'Carbon Pulse',   url:'https://carbon-pulse.com',   publishedAt:'2026-03-25T08:30:00Z' },
  { id:'s-4', tag:'POLICY',       title:'Article 6.4 mechanism rulebook finalised at COP31 pre-session; India signals active participation in international carbon markets',                                       source:'UNFCCC News',    url:'https://unfccc.int/news',    publishedAt:'2026-03-20T12:00:00Z' },
  { id:'s-5', tag:'TOKENIZATION', title:'Ethereum-based carbon tokenisation volumes cross 2 million tCO₂ in Q1 2026, driven by DeFi protocol integrations and institutional demand',                              source:'CoinDesk',       url:'https://coindesk.com',       publishedAt:'2026-03-18T14:00:00Z' },
  { id:'s-6', tag:'SEBI',         title:'SEBI releases consultation paper on ESG rating framework for carbon credit instruments listed on Indian exchanges',                                                        source:'SEBI',           url:'https://sebi.gov.in',        publishedAt:'2026-03-15T11:00:00Z' },
  { id:'s-7', tag:'CBAM',         title:'EU Carbon Border Adjustment Mechanism enters full implementation; Indian exporters in steel and cement sectors prepare compliance documentation',                           source:'Reuters',        url:'https://reuters.com',        publishedAt:'2026-03-10T09:00:00Z' },
  { id:'s-8', tag:'GLOBAL',       title:'Global voluntary carbon market reaches $2.4 billion in 2025; nature-based solutions and renewable energy credits lead demand growth',                                      source:'BloombergNEF',   url:'https://bloomberg.com',      publishedAt:'2026-03-05T13:00:00Z' },
];

const TAG_RULES = [
  { keywords:['ccts','carbon credit trading scheme','moefcc','obligated'],           tag:'CCTS'         },
  { keywords:['bee','bureau of energy efficiency','pat cycle','designated consumer'], tag:'BEE'          },
  { keywords:['sebi','esg rating','green bond','securities'],                         tag:'SEBI'         },
  { keywords:['cbam','carbon border','eu carbon','border adjustment'],                tag:'CBAM'         },
  { keywords:['tokeniz','blockchain','ethereum','defi','nft','web3','crypto'],        tag:'TOKENIZATION' },
  { keywords:['cop','unfccc','article 6','paris agreement','ipcc'],                   tag:'GLOBAL'       },
  { keywords:['policy','regulation','government','ministry','law','bill','act'],      tag:'POLICY'       },
  { keywords:['price','market','trade','exchange','volume','demand','supply'],        tag:'MARKET'       },
];

function inferTag(title, description = '') {
  const text = (title + ' ' + description).toLowerCase();
  for (const rule of TAG_RULES) {
    if (rule.keywords.some(k => text.includes(k))) return rule.tag;
  }
  return 'MARKET';
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), FETCH_TIMEOUT_MS);
    const req = https.get(url, {
      headers: { 'User-Agent': 'EtherTrack/1.0', 'Accept': 'application/json' },
    }, (res) => {
      if (res.statusCode !== 200) { clearTimeout(timer); return reject(new Error(`HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end',  () => { clearTimeout(timer); try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch(e) { reject(e); } });
      res.on('error', e => { clearTimeout(timer); reject(e); });
    });
    req.on('error', e => { clearTimeout(timer); reject(e); });
    req.end();
  });
}

async function fetchNewsData() {
  const key = process.env.NEWSDATA_API_KEY;
  if (!key) throw new Error('NEWSDATA_API_KEY not configured');
  const url = `https://newsdata.io/api/1/news?apikey=${key}&q=carbon+credit+OR+CCTS+OR+emission+trading&country=in&language=en&category=environment,business,politics`;
  const data = await fetchJSON(url);
  if (!data?.results?.length) throw new Error('No results');
  return data.results.slice(0, MAX_ITEMS).map((a, i) => ({
    id:          `nd-${Date.now()}-${i}`,
    tag:         inferTag(a.title, a.description),
    title:       String(a.title || '').slice(0, 200),
    source:      a.source_id || 'NewsData',
    url:         a.link || 'https://newsdata.io',
    publishedAt: a.pubDate ? new Date(a.pubDate).toISOString() : null,
  }));
}

async function fetchGNews() {
  const key = process.env.GNEWS_API_KEY;
  if (!key) throw new Error('GNEWS_API_KEY not configured');
  const url = `https://gnews.io/api/v4/search?q=carbon+credit+india+OR+CCTS+OR+emission+trading&lang=en&country=in&max=10&apikey=${key}`;
  const data = await fetchJSON(url);
  if (!data?.articles?.length) throw new Error('No results');
  return data.articles.slice(0, MAX_ITEMS).map((a, i) => ({
    id:          `gn-${Date.now()}-${i}`,
    tag:         inferTag(a.title, a.description),
    title:       String(a.title || '').slice(0, 200),
    source:      a.source?.name || 'GNews',
    url:         a.url || 'https://gnews.io',
    publishedAt: a.publishedAt || null,
  }));
}

async function fetchLiveNews() {
  try { const items = await fetchNewsData(); if (items.length) return { items, source:'newsdata' }; } catch(e) { console.warn('[news] NewsData.io:', e.message); }
  try { const items = await fetchGNews();    if (items.length) return { items, source:'gnews'    }; } catch(e) { console.warn('[news] GNews:', e.message); }
  return null;
}

router.get('/carbon', async (req, res) => {
  try {
    const now = Date.now();
    if (cache.items && now - cache.fetchedAt < CACHE_TTL_MS) {
      return res.json({ items:cache.items, total:cache.items.length, source:cache.source, cachedAt:new Date(cache.fetchedAt).toISOString(), stale:false });
    }
    const result = await fetchLiveNews();
    if (result) {
      cache.items = result.items; cache.fetchedAt = now; cache.source = result.source;
      return res.json({ items:result.items, total:result.items.length, source:result.source, cachedAt:new Date(now).toISOString(), stale:false });
    }
    if (cache.items) {
      return res.json({ items:cache.items, total:cache.items.length, source:'stale-cache', cachedAt:new Date(cache.fetchedAt).toISOString(), stale:true });
    }
    return res.json({ items:STATIC_FALLBACK, total:STATIC_FALLBACK.length, source:'fallback', cachedAt:new Date(now).toISOString(), stale:true });
  } catch(err) {
    console.error('[news/carbon]', err.message);
    return res.json({ items:STATIC_FALLBACK, total:STATIC_FALLBACK.length, source:'fallback', stale:true });
  }
});

router.get('/', (req, res) => res.redirect('/api/news/carbon'));

router.post('/refresh', (req, res) => {
  cache.items = null; cache.fetchedAt = 0; cache.source = 'fallback';
  res.json({ ok:true, message:'Cache cleared.' });
});

module.exports = router;