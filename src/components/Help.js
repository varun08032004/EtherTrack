import React, { useState, useMemo } from 'react';

// ── Manual download — serves the real .docx file from public folder
// Copy EtherTrack_User_Manual_Complete_v3.docx to /public/manual/
const MANUAL_URL = '/EtherTrack_User_Manual_Complete_v3.docx';

// ── FAQ data — sourced directly from Section 15 of the manual ────
const FAQ_DATA = [
  {
    category: 'PAYMENT & DEPOSITS',
    icon: '💳',
    color: '#22c55e',
    items: [
      {
        q: 'My Razorpay payment failed or was cancelled. Was money deducted?',
        a: 'No. A failed or cancelled Razorpay attempt does not affect your wallet. Click + DEPOSIT again and complete the payment without closing the popup. If UPI fails, try Net Banking instead — UPI can time out during peak hours.',
      },
      {
        q: 'Payment went through but my INR balance wasn\'t updated.',
        a: 'Wait 2–3 minutes and refresh the Wallet page — the webhook may still be processing. Check the TRANSACTIONS tab: if a SUCCESS entry exists, your balance was credited — try hard-refreshing (Ctrl+Shift+R on Windows, Cmd+Shift+R on Mac). If balance is still missing after 10 minutes, email support@ethertrack.in with your Razorpay payment ID (starts with pay_).',
      },
      {
        q: 'My withdrawal hasn\'t arrived after 2 business days.',
        a: 'Check WALLET → TRANSACTIONS tab. If status shows PENDING it is still processing. If SUCCESS, the transfer was initiated. Log into your bank to check for an NEFT/IMPS credit from EtherTrack or Razorpay. Verify your bank details are correct in BANK ACCOUNTS tab. If still missing after 3 business days, email support@ethertrack.in with your withdrawal Reference ID.',
      },
      {
        q: 'What are the deposit and withdrawal limits?',
        a: 'Minimum deposit: ₹100. Maximum deposit: ₹1,00,000 per transaction. Daily limit: ₹1,00,000. Monthly limit: ₹10,00,000. Minimum withdrawal: ₹100. These limits are set per RBI compliance guidelines.',
      },
      {
        q: 'Will TDS be deducted on my withdrawal?',
        a: 'Yes. Under Section 194S of the Income Tax Act (Virtual Digital Assets), 1% TDS is deducted on withdrawals of ₹10,000 or more. The deduction is shown before you confirm. Your net amount (after TDS) is what reaches your bank. A TDS certificate will be available at year end — consult your CA for ITR filing.',
      },
    ],
  },
  {
    category: 'METAMASK & WALLET',
    icon: '🦊',
    color: '#f59e0b',
    items: [
      {
        q: 'MetaMask isn\'t connecting. What do I do?',
        a: 'Install MetaMask from metamask.io if not installed. Make sure it is unlocked (enter your MetaMask password). MetaMask works on Chrome, Firefox, and Brave — not Safari or standard mobile browsers. Allow pop-ups for EtherTrack. If multiple wallet extensions are installed, disable them temporarily as they can conflict.',
      },
      {
        q: 'My wallet shows CONNECTED but NOT LINKED.',
        a: 'Click WALLET → DISCONNECT WALLET, then click CONNECT METAMASK again. The binding runs automatically on reconnect. Alternatively, hard-refresh the page (Ctrl+Shift+R) while MetaMask is unlocked. If still NOT LINKED after two attempts, the wallet address may already be linked to a different EtherTrack account — contact support@ethertrack.in.',
      },
      {
        q: 'I\'m on the wrong network. How do I switch to Sepolia?',
        a: 'Open MetaMask → click the network dropdown at the top → select Sepolia Test Network. If Sepolia is not listed, click Add Network, search for Sepolia, and add it. EtherTrack currently runs on Ethereum Sepolia testnet.',
      },
      {
        q: 'I need Sepolia ETH for gas. Where do I get it?',
        a: 'Go to sepoliafaucet.com or faucet.sepolia.dev. Enter your MetaMask wallet address and request free test ETH. Wait 1–2 minutes for it to arrive. You need a small amount of Sepolia ETH for gas even when paying with INR.',
      },
      {
        q: 'My transaction is stuck pending for more than 5 minutes.',
        a: 'Check sepolia.etherscan.io by pasting your wallet address. In MetaMask, find the pending transaction and click Speed Up to submit with higher gas. Or click Cancel — once cancelled, go back to EtherTrack and initiate the trade again.',
      },
      {
        q: 'Do I need MetaMask to pay with INR?',
        a: 'Yes, but only for signing the on-chain credit token transfer. Even when paying with INR Wallet, MetaMask is required to sign the blockchain transaction transferring the credit to you. This signature does not cost ETH — it is just a cryptographic confirmation.',
      },
    ],
  },
  {
    category: 'KYC VERIFICATION',
    icon: '🪪',
    color: '#60a5fa',
    items: [
      {
        q: 'My KYC has been pending for more than 2 business days.',
        a: 'Check your registered email including spam/junk — the approval email comes from EtherTrack. After 3 business days with no response, email support@ethertrack.in with subject "KYC Review" and your full name. The compliance team will check your submission.',
      },
      {
        q: 'I got the error: "These KYC credentials are already verified with another account."',
        a: 'Your Aadhaar or PAN is already linked to a different EtherTrack account — each person can only have one KYC-verified account. If you have two accounts, log into your original one and delete the duplicate via Profile → Request Account Deletion. If this is an error, email support@ethertrack.in with subject "KYC Duplicate — Incorrect Claim" immediately.',
      },
      {
        q: 'I\'m not receiving the OTP on my phone.',
        a: 'Wait the full 60 seconds — OTPs can be delayed by the SMS network. Enter only the 10-digit number without +91. Once the timer hits 0, click RESEND OTP. If your number is on the DND registry, SMS OTPs may be blocked — use a different mobile number. After too many attempts, wait 10 minutes before trying again.',
      },
      {
        q: 'What ID formats are accepted?',
        a: 'Aadhaar: exactly 12 digits, no spaces or dashes. PAN: format ABCDE1234F — 5 uppercase letters, 4 digits, 1 uppercase letter. Passport: 1 letter followed by 7 digits (e.g. A1234567). The fields auto-convert to uppercase.',
      },
      {
        q: 'What can I access before KYC is approved?',
        a: 'The Dashboard is accessible in read-only mode. Trading (Market), Portfolio management, and Emission Tracking unlock only after KYC is approved by the admin team. KYC typically takes 1–2 business days.',
      },
    ],
  },
  {
    category: 'TRADING & CREDITS',
    icon: '🌿',
    color: '#a78bfa',
    items: [
      {
        q: 'I can\'t buy my own listing.',
        a: 'This is by design — the same wallet cannot be both buyer and seller. To remove your listing, go to PORTFOLIO and click DELIST on the credit card.',
      },
      {
        q: 'My INR balance shows "INSUFFICIENT" for the trade.',
        a: 'Either deposit more funds (click ADD FUNDS TO WALLET or go to WALLET → DEPOSIT), reduce the quantity until SUFFICIENT appears in green, or switch to MetaMask payment if you have Sepolia ETH.',
      },
      {
        q: 'INR was deducted but MetaMask rejected the trade. Was I refunded?',
        a: 'Yes — automatically. EtherTrack detects the MetaMask rejection and triggers an instant refund. Check WALLET → TRANSACTIONS tab — you will see a SYSTEM credit entry labelled "Refund — MetaMask rejected". If not showing after 5 minutes, email support@ethertrack.in with the trade amount and approximate time.',
      },
      {
        q: 'My purchased credits are not appearing in Portfolio.',
        a: 'Ethereum Sepolia takes 15–30 seconds to confirm — wait then refresh. Credits submitted for admin review show in the PENDING tab, not HELD. Click the REFRESH button in Portfolio header. If confirmed on Etherscan but still missing after 10 minutes, email support with your transaction hash.',
      },
      {
        q: 'What is the platform fee?',
        a: '0.5% per trade, applied on top of the credit price. This is shown in the order summary before you confirm any purchase. AMM pool swaps have a separate 0.3% pool fee.',
      },
      {
        q: 'What is the difference between Market orders, Limit orders, and Bids?',
        a: 'MARKET: buy at current listed price immediately. LIMIT: set a maximum price — executes only if a seller lists at or below your price. BID: lock ETH in smart contract escrow — auto-executes when a seller lists at your bid price. Bids always use MetaMask; INR wallet is for Market and Limit orders only.',
      },
    ],
  },
  {
    category: 'EMISSIONS & REPORTS',
    icon: '📊',
    color: '#34d399',
    items: [
      {
        q: 'How do I generate a SEBI BRSR Core report?',
        a: 'Complete your Company Profile in EMISSIONS → COMPANY PROFILE tab first (GSTIN, revenue, headcount, floor area required). Log Scope 1, 2, and 3 emissions. Then go to PORTFOLIO → Corporate Reporting Exports → select FY → click SEBI BRSR Core. Or from EMISSIONS page → scroll to Corporate Regulatory Reports.',
      },
      {
        q: 'My report PDF is not downloading.',
        a: 'Allow pop-ups and file downloads for EtherTrack in your browser settings. Make sure you have logged at least Scope 1 and 2 emission data. Company Profile must be complete for BRSR. Hard-refresh the page (Ctrl+Shift+R) and try generating again.',
      },
      {
        q: 'What emission factors does EtherTrack use?',
        a: 'Scope 1: DEFRA 2024 factors for fuel combustion and refrigerants. Scope 2: CEA India 2024 grid emission factor (0.79 kgCO2e/kWh). Scope 3: DEFRA 2024 for travel, commuting, waste. PAT Scheme: BEE India sector-specific factors. These are the same sources expected by SEBI assessors and Big 4 auditors.',
      },
      {
        q: 'My retirement certificate QR code isn\'t working.',
        a: 'Use the ETHERSCAN button on the retirement card instead — it is always the most reliable verification method. Or copy the BLOCKCHAIN TX HASH from the retirement card and paste it directly at sepolia.etherscan.io — anyone can verify independently without contacting EtherTrack.',
      },
    ],
  },
  {
    category: 'ACCOUNT & LOGIN',
    icon: '👤',
    color: '#f87171',
    items: [
      {
        q: 'I forgot my password.',
        a: 'On the Login page, type your registered email in the EMAIL ADDRESS field first. Click Forgot password? — a green confirmation appears. Open the reset email and click the link. Set a new password on the Firebase page. Return and log in with the new password.',
      },
      {
        q: 'I\'m locked out after too many login attempts.',
        a: 'Use the Forgot password? flow on the Login page to reset your password — this also unlocks the account.',
      },
      {
        q: 'After signing up I was taken to Login but not automatically signed in.',
        a: 'This is by design. After successful sign-up you are redirected to the Login page and must log in manually with your email and password.',
      },
      {
        q: 'My bank accounts disappeared after logging in on a different device.',
        a: 'Bank accounts are now stored in your EtherTrack account database — they should persist across all devices. If they are missing, go to WALLET → BANK ACCOUNTS and re-add them. They will then persist everywhere.',
      },
    ],
  },
];

const SECTIONS = [
  { id: 'all',       label: 'All Topics'         },
  { id: 'PAYMENT & DEPOSITS',   label: '💳 Payments'   },
  { id: 'METAMASK & WALLET',    label: '🦊 MetaMask'   },
  { id: 'KYC VERIFICATION',     label: '🪪 KYC'        },
  { id: 'TRADING & CREDITS',    label: '🌿 Trading'    },
  { id: 'EMISSIONS & REPORTS',  label: '📊 Reports'    },
  { id: 'ACCOUNT & LOGIN',      label: '👤 Account'    },
];

export default function Help() {
  const [search,    setSearch]    = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [openFaq,   setOpenFaq]   = useState(null); // 'category|index'

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return FAQ_DATA
      .filter(cat => activeTab === 'all' || cat.category === activeTab)
      .map(cat => ({
        ...cat,
        items: cat.items.filter(item =>
          !q ||
          item.q.toLowerCase().includes(q) ||
          item.a.toLowerCase().includes(q)
        ),
      }))
      .filter(cat => cat.items.length > 0);
  }, [search, activeTab]);

  const totalResults = filtered.reduce((s, c) => s + c.items.length, 0);

  const toggleFaq = (key) => setOpenFaq(prev => prev === key ? null : key);

  const handleDownload = () => {
    window.open('/EtherTrack_User_Manual_Complete_v3.docx', '_blank');
  };

  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
    *{box-sizing:border-box;}
    .hlp{min-height:100vh;background:#040706;font-family:'DM Mono',monospace;color:#f0fdf4;}
    .hlp-wrap{max-width:960px;margin:0 auto;padding:40px 24px 80px;}
    /* hero */
    .hlp-hero{text-align:center;margin-bottom:40px;}
    .hlp-hero-label{font-size:9px;color:#22c55e55;letter-spacing:.22em;margin-bottom:10px;}
    .hlp-hero-title{font-family:'Syne',sans-serif;font-size:36px;font-weight:800;color:#f0fdf4;margin-bottom:8px;line-height:1.1;}
    .hlp-hero-title span{color:#22c55e;}
    .hlp-hero-sub{font-size:11px;color:#86efac44;letter-spacing:.08em;margin-bottom:28px;}
    /* search */
    .hlp-search-wrap{position:relative;max-width:520px;margin:0 auto 12px;}
    .hlp-search-icon{position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:13px;color:#4ade8033;pointer-events:none;}
    .hlp-search{width:100%;padding:12px 12px 12px 40px;border-radius:10px;border:1px solid #0f2a1a;background:#070c09;color:#f0fdf4;font-family:'DM Mono',monospace;font-size:12px;outline:none;transition:border-color .2s;}
    .hlp-search:focus{border-color:#22c55e33;}
    .hlp-search::placeholder{color:#86efac22;}
    .hlp-result-count{text-align:center;font-size:9px;color:#86efac33;letter-spacing:.1em;margin-bottom:28px;}
    /* download card */
    .hlp-dl-card{background:linear-gradient(135deg,#061408,#0a1f0d);border:1px solid #22c55e22;border-radius:14px;padding:20px 24px;display:flex;align-items:center;gap:20px;margin-bottom:36px;cursor:pointer;transition:border-color .2s;}
    .hlp-dl-card:hover{border-color:#22c55e55;}
    .hlp-dl-icon{font-size:36px;flex-shrink:0;}
    .hlp-dl-info{flex:1;min-width:0;}
    .hlp-dl-title{font-size:13px;font-weight:700;color:#f0fdf4;margin-bottom:4px;letter-spacing:.04em;}
    .hlp-dl-sub{font-size:10px;color:#86efac55;line-height:1.6;}
    .hlp-dl-btn{padding:10px 20px;border-radius:8px;border:none;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.08em;white-space:nowrap;flex-shrink:0;transition:opacity .2s;}
    .hlp-dl-btn:hover{opacity:.85;}
    /* filter tabs */
    .hlp-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:28px;justify-content:center;}
    .hlp-tab{padding:7px 14px;border-radius:20px;border:1px solid #0f2a1a;background:transparent;color:#86efac44;cursor:pointer;font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.1em;transition:all .2s;white-space:nowrap;}
    .hlp-tab:hover{border-color:#22c55e33;color:#86efac88;}
    .hlp-tab.act{border-color:#22c55e44;background:#0d2e1f;color:#22c55e;}
    /* category */
    .hlp-cat{margin-bottom:28px;}
    .hlp-cat-hdr{display:flex;align-items:center;gap:10px;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid #0f2a1a;}
    .hlp-cat-icon{font-size:18px;}
    .hlp-cat-label{font-size:9px;letter-spacing:.16em;font-weight:700;}
    .hlp-cat-count{font-size:8px;color:#86efac33;letter-spacing:.1em;margin-left:auto;}
    /* faq item */
    .hlp-faq{background:#070c09;border:1px solid #0f2a1a;border-radius:10px;margin-bottom:6px;overflow:hidden;transition:border-color .2s;}
    .hlp-faq:hover{border-color:#22c55e22;}
    .hlp-faq.open{border-color:#22c55e33;}
    .hlp-faq-q{display:flex;align-items:flex-start;gap:12px;padding:14px 16px;cursor:pointer;user-select:none;}
    .hlp-faq-qtext{flex:1;font-size:11px;color:#f0fdf4;font-weight:500;line-height:1.5;letter-spacing:.02em;}
    .hlp-faq-arrow{font-size:10px;color:#86efac33;flex-shrink:0;margin-top:2px;transition:transform .2s;}
    .hlp-faq.open .hlp-faq-arrow{transform:rotate(90deg);color:#22c55e;}
    .hlp-faq-a{padding:0 16px 14px 16px;font-size:11px;color:#86efac88;line-height:1.8;border-top:1px solid #0f2a1a18;}
    /* empty */
    .hlp-empty{text-align:center;padding:48px;color:#86efac22;font-size:11px;}
    /* contact */
    .hlp-contact{margin-top:40px;padding:20px 24px;background:#070c09;border:1px solid #0f2a1a;border-radius:12px;text-align:center;}
    .hlp-contact-title{font-size:12px;color:#f0fdf4;font-weight:700;margin-bottom:6px;letter-spacing:.06em;}
    .hlp-contact-sub{font-size:10px;color:#86efac55;line-height:1.7;margin-bottom:14px;}
    .hlp-contact-email{display:inline-block;padding:9px 20px;border-radius:7px;border:1px solid #22c55e33;background:#0d2e1f22;color:#22c55e;font-family:'DM Mono',monospace;font-size:11px;text-decoration:none;letter-spacing:.06em;transition:all .2s;}
    .hlp-contact-email:hover{background:#0d2e1f;border-color:#22c55e66;}
    /* highlight matched search */
    mark{background:#22c55e22;color:#22c55e;border-radius:2px;padding:0 2px;}
    @media(max-width:600px){.hlp-dl-card{flex-direction:column;text-align:center;}.hlp-dl-btn{width:100%;}.hlp-hero-title{font-size:26px;}.hlp-tabs{gap:4px;}.hlp-tab{font-size:8px;padding:5px 10px;}}
  `;

  // Highlight search term in text
  const highlight = (text) => {
    if (!search.trim()) return text;
    const regex = new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) =>
      regex.test(part) ? <mark key={i}>{part}</mark> : part
    );
  };

  return (
    <>
      <style>{CSS}</style>
      <div className="hlp">
        <div className="hlp-wrap">

          {/* Hero */}
          <div className="hlp-hero">
            <div className="hlp-hero-label">ETHERTRACK · HELP & SUPPORT</div>
            <div className="hlp-hero-title">
              How can we <span>help you?</span>
            </div>
            <div className="hlp-hero-sub">
              FAQs · User Manual · Troubleshooting · Contact Support
            </div>

            {/* Search */}
            <div className="hlp-search-wrap">
              <span className="hlp-search-icon">🔍</span>
              <input
                className="hlp-search"
                type="text"
                placeholder="Search FAQs — e.g. MetaMask, deposit, KYC, TDS..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            {search && (
              <div className="hlp-result-count">
                {totalResults} result{totalResults !== 1 ? 's' : ''} for "{search}"
              </div>
            )}
          </div>

          {/* Download Manual Card */}
          <div className="hlp-dl-card" onClick={handleDownload}>
            <span className="hlp-dl-icon">📘</span>
            <div className="hlp-dl-info">
              <div className="hlp-dl-title">EtherTrack User Manual — Complete Guide</div>
              <div className="hlp-dl-sub">
                12 sections · Account setup · KYC · Trading · Emissions · Wallet · Reports · Troubleshooting<br/>
                Version 1.0 · March 2026 · EtherTrack Technologies Pvt Ltd
              </div>
            </div>
            <button className="hlp-dl-btn" onClick={e => { e.stopPropagation(); handleDownload(); }}>
              ↓ DOWNLOAD .DOCX
            </button>
          </div>

          {/* Filter tabs */}
          <div className="hlp-tabs">
            {SECTIONS.map(s => (
              <button
                key={s.id}
                className={`hlp-tab${activeTab === s.id ? ' act' : ''}`}
                onClick={() => { setActiveTab(s.id); setSearch(''); }}>
                {s.label}
              </button>
            ))}
          </div>

          {/* FAQ content */}
          {filtered.length === 0 ? (
            <div className="hlp-empty">
              No results found for "{search}"<br/>
              <span style={{ fontSize:9, color:'#86efac15' }}>
                Try different keywords or email support@ethertrack.in
              </span>
            </div>
          ) : (
            filtered.map(cat => (
              <div key={cat.category} className="hlp-cat">
                <div className="hlp-cat-hdr">
                  <span className="hlp-cat-icon">{cat.icon}</span>
                  <span className="hlp-cat-label" style={{ color: cat.color }}>
                    {cat.category}
                  </span>
                  <span className="hlp-cat-count">{cat.items.length} Q&amp;A</span>
                </div>
                {cat.items.map((item, idx) => {
                  const key = `${cat.category}|${idx}`;
                  const isOpen = openFaq === key;
                  return (
                    <div key={idx} className={`hlp-faq${isOpen ? ' open' : ''}`}>
                      <div className="hlp-faq-q" onClick={() => toggleFaq(key)}>
                        <span className="hlp-faq-qtext">{highlight(item.q)}</span>
                        <span className="hlp-faq-arrow">▶</span>
                      </div>
                      {isOpen && (
                        <div className="hlp-faq-a">
                          {highlight(item.a)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}

          {/* Contact support */}
          <div className="hlp-contact">
            <div className="hlp-contact-title">Still need help?</div>
            <div className="hlp-contact-sub">
              For any issue not covered above, email our support team with:<br/>
              (1) your registered email address &nbsp;·&nbsp;
              (2) description of what happened &nbsp;·&nbsp;
              (3) any reference numbers or transaction hashes visible on screen<br/>
              We respond within 1 business day.
            </div>
            <a href="mailto:support@ethertrack.in" className="hlp-contact-email">
              ✉ support@ethertrack.in
            </a>
          </div>

        </div>
      </div>
    </>
  );
}