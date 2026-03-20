import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { walletAPI } from '../services/api';
import { AuthContext } from '../App';

// ── Load Razorpay SDK ─────────────────────────────────────────────
const loadRazorpay = () =>
  new Promise(resolve => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload  = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });

// ── Helpers ───────────────────────────────────────────────────────
const fmtINR  = (n) => `₹${parseFloat(n||0).toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 })}`;
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
const ETH_INR_RATE = 280000; // fallback; fetched live below

// ── Mini sparkline ────────────────────────────────────────────────
function Sparkline({ data, color = '#22c55e', w = 80, h = 28 }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data), min = Math.min(...data), range = max - min || 1;
  const pts = data.map((v, i) => `${(i/(data.length-1))*w},${h-((v-min)/range)*(h-4)-2}`).join(' ');
  return (
    <svg width={w} height={h}>
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" points={pts} opacity="0.8"/>
    </svg>
  );
}

export default function Wallet() {
  const navigate = useNavigate();
  const { dbUser } = React.useContext(AuthContext);

  // ── State ─────────────────────────────────────────────────────
  const [tab,           setTab]           = useState('transactions');
  const [balance,       setBalance]       = useState(0);
  const [balanceLocked, setBalanceLocked] = useState(0);
  const [transactions,  setTransactions]  = useState([]);
  const [txFilter,      setTxFilter]      = useState('all');
  const [loading,       setLoading]       = useState(true);
  const [ethRate,       setEthRate]       = useState(ETH_INR_RATE);
  const [ethBalance,    setEthBalance]    = useState(null);

  // Deposit / withdraw modal
  const [modal,         setModal]         = useState(null);  // null | 'deposit' | 'withdraw'
  const [modalStep,     setModalStep]     = useState('amount'); // amount | method | processing | done
  const [modalAmount,   setModalAmount]   = useState('');
  const [modalMethod,   setModalMethod]   = useState('upi');
  const [modalUpiId,    setModalUpiId]    = useState('');
  const [modalErr,      setModalErr]      = useState('');
  const [modalDone,     setModalDone]     = useState(null);
  const [modalLoading,  setModalLoading]  = useState(false);
  const [progress,      setProgress]      = useState(0);

  // Bank accounts — fetched from DB, persists across devices/logins
  const [bankAccounts,  setBankAccounts]  = useState([]);
  const [bankLoading,   setBankLoading]   = useState(false);
  const [showAddBank,   setShowAddBank]   = useState(false);
  const [bankForm,      setBankForm]      = useState({ name:'', account:'', ifsc:'', bank:'' });
  const [bankErr,       setBankErr]       = useState({});

  // Withdraw bank
  const [wdAccount,     setWdAccount]     = useState('');
  const [wdIfsc,        setWdIfsc]        = useState('');
  const [wdName,        setWdName]        = useState('');

  // Toast
  const [toast,         setToast]         = useState(null);

  // ── Fetch data ────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [balData, txData, bankData] = await Promise.all([
        walletAPI.getBalance(),
        walletAPI.getTransactions(),
        walletAPI.getBankAccounts(),
      ]);
      if (balData) {
        setBalance(parseFloat(balData.balance) || 0);
        setBalanceLocked(parseFloat(balData.balanceLocked) || 0);
        setTransactions(balData.transactions || []);
      }
      if (txData?.transactions) setTransactions(txData.transactions);
      if (bankData?.accounts)   setBankAccounts(bankData.accounts);
    } catch (e) { showToast('Failed to load wallet data', 'error'); }
    finally { setLoading(false); }
  }, []);

  // Fetch live ETH rate
  const fetchEthRate = useCallback(async () => {
    try {
      const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=inr');
      const d = await r.json();
      if (d?.ethereum?.inr) setEthRate(d.ethereum.inr);
    } catch {}
  }, []);

  useEffect(() => { fetchData(); fetchEthRate(); }, []);
  useEffect(() => { const id = setInterval(fetchEthRate, 5*60*1000); return () => clearInterval(id); }, []);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  // ── Modal helpers ─────────────────────────────────────────────
  const openModal = (type) => {
    setModal(type);
    setModalStep('amount');
    setModalAmount('');
    setModalMethod('upi');
    setModalUpiId('');
    setModalErr('');
    setModalDone(null);
    setProgress(0);
    if (type === 'withdraw' && bankAccounts.length > 0) {
      const def = bankAccounts.find(a => a.is_default) || bankAccounts[0];
      setWdName(def.account_name);
      setWdAccount(def.account_number);
      setWdIfsc(def.ifsc);
    }
  };

  const closeModal = () => { setModal(null); setModalLoading(false); };

  const amtVal = parseFloat(modalAmount) || 0;

  // ── Deposit via Razorpay ──────────────────────────────────────
  const handleDeposit = async () => {
    setModalErr('');
    setModalLoading(true);
    try {
      const loaded = await loadRazorpay();
      if (!loaded) throw new Error('Razorpay SDK failed to load');

      const order = await walletAPI.createDepositOrder(amtVal, modalMethod);
      if (!order?.orderId) throw new Error('Failed to create payment order');

      const options = {
        key:         order.keyId,
        amount:      Math.round(amtVal * 100),
        currency:    'INR',
        name:        'EtherTrack',
        description: 'Add funds to INR wallet',
        order_id:    order.orderId,
        prefill:     { name: dbUser?.full_name || '', email: dbUser?.email || '' },
        theme:       { color: '#22c55e' },
        modal:       { ondismiss: () => { setModalLoading(false); setModalErr('Payment cancelled'); } },
        handler: async (response) => {
          try {
            const result = await walletAPI.verifyDeposit({
              razorpay_order_id:   response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature:  response.razorpay_signature,
            });
            if (result?.success) {
              setBalance(parseFloat(result.balance));
              setModalDone({ type:'deposit', amount:amtVal, reference:result.reference, paymentId:result.paymentId });
              setModalStep('done');
              await fetchData();
            } else throw new Error('Verification failed');
          } catch (e) { setModalErr(e.message || 'Payment verification failed'); }
          finally { setModalLoading(false); }
        },
      };
      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', (r) => {
        setModalLoading(false);
        setModalErr(r.error?.description || 'Payment failed');
      });
      rzp.open();
    } catch (e) { setModalLoading(false); setModalErr(e.message || 'Deposit failed'); }
  };

  // ── Withdraw ──────────────────────────────────────────────────
  const handleWithdraw = async () => {
    setModalErr('');
    if (!wdAccount || !wdIfsc || !wdName) { setModalErr('Fill all bank details'); return; }
    if (amtVal > balance) { setModalErr('Insufficient balance'); return; }
    setModalLoading(true);
    try {
      const result = await walletAPI.withdraw({ amount:amtVal, accountNumber:wdAccount, ifsc:wdIfsc, accountName:wdName });
      if (result?.success) {
        setModalDone({ type:'withdraw', amount:amtVal, reference:result.reference });
        setModalStep('done');
        await fetchData();
      }
    } catch (e) { setModalErr(e.error || e.message || 'Withdrawal failed'); }
    finally { setModalLoading(false); }
  };

  // ── Bank accounts ─────────────────────────────────────────────
  const saveBankAccount = async () => {
    const e = {};
    if (!bankForm.name.trim())    e.name    = 'Required';
    if (!bankForm.account.trim()) e.account = 'Required';
    if (!bankForm.ifsc.trim())    e.ifsc    = 'Required';
    if (!bankForm.bank.trim())    e.bank    = 'Required';
    if (Object.keys(e).length) { setBankErr(e); return; }
    setBankLoading(true);
    try {
      const result = await walletAPI.addBankAccount({
        accountName:   bankForm.name,
        accountNumber: bankForm.account,
        ifsc:          bankForm.ifsc,
        bankName:      bankForm.bank,
      });
      if (result?.success) {
        setBankAccounts(prev => [...prev, result.account]);
        setBankForm({ name:'', account:'', ifsc:'', bank:'' });
        setBankErr({});
        setShowAddBank(false);
        showToast('Bank account saved');
      }
    } catch (err) {
      showToast(err.error || 'Failed to save bank account', 'error');
    } finally {
      setBankLoading(false);
    }
  };

  const deleteBankAccount = async (id) => {
    setBankLoading(true);
    try {
      await walletAPI.deleteBankAccount(id);
      setBankAccounts(prev => prev.filter(a => a.id !== id));
      showToast('Account removed');
    } catch {
      showToast('Failed to remove account', 'error');
    } finally {
      setBankLoading(false);
    }
  };

  const setDefaultAccount = async (id) => {
    setBankLoading(true);
    try {
      await walletAPI.setDefaultAccount(id);
      setBankAccounts(prev => prev.map(a => ({ ...a, is_default: a.id === id })));
      showToast('Default account updated');
    } catch {
      showToast('Failed to update default', 'error');
    } finally {
      setBankLoading(false);
    }
  };

  // ── Download statement ────────────────────────────────────────
  const downloadStatement = async () => {
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
      const W = 210, ml = 20, tw = W - 40;
      let y = 20;

      doc.setFillColor(4, 7, 6); doc.rect(0, 0, W, 297, 'F');
      doc.setFillColor(13, 46, 31); doc.rect(0, 0, W, 36, 'F');

      doc.setTextColor(34, 197, 94); doc.setFontSize(8); doc.setFont('helvetica', 'normal');
      doc.text('ETHERTRACK · INR WALLET STATEMENT', W/2, y, { align: 'center' }); y += 7;
      doc.setFontSize(18); doc.setFont('helvetica', 'bold'); doc.setTextColor(240, 253, 244);
      doc.text('Account Statement', W/2, y, { align: 'center' }); y += 6;
      doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(134, 239, 172);
      doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')} · ${dbUser?.email || ''}`, W/2, y, { align: 'center' }); y += 14;

      // Balance summary
      doc.setFillColor(10, 15, 12); doc.roundedRect(ml, y, tw, 20, 2, 2, 'F');
      doc.setFontSize(8); doc.setTextColor(134, 239, 172);
      doc.text('CURRENT BALANCE', ml+4, y+6);
      doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.setTextColor(34, 197, 94);
      doc.text(fmtINR(balance), ml+4, y+15); y += 28;

      // Table header
      doc.setFillColor(13, 46, 31);
      doc.rect(ml, y, tw, 8, 'F');
      doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(134, 239, 172);
      ['DATE', 'REFERENCE', 'TYPE', 'METHOD', 'AMOUNT', 'STATUS'].forEach((h, i) => {
        doc.text(h, ml + [0, 32, 72, 100, 130, 160][i], y + 5.5);
      }); y += 10;

      transactions.forEach((t, idx) => {
        if (y > 260) { doc.addPage(); y = 20; doc.setFillColor(4,7,6); doc.rect(0,0,W,297,'F'); }
        if (idx % 2 === 0) { doc.setFillColor(8, 12, 10); doc.rect(ml, y-1, tw, 8, 'F'); }
        doc.setFontSize(7); doc.setFont('helvetica', 'normal'); doc.setTextColor(200, 240, 210);
        doc.text(fmtDate(t.created_at).slice(0, 12), ml, y+5);
        doc.text((t.reference || '—').slice(0, 14), ml+32, y+5);
        doc.text((t.type || '—').toUpperCase(), ml+72, y+5);
        doc.text((t.method || '—').toUpperCase(), ml+100, y+5);
        const isCredit = t.type === 'credit';
        doc.setTextColor(isCredit ? 34 : 248, isCredit ? 197 : 113, isCredit ? 94 : 113);
        doc.text(`${isCredit ? '+' : '-'}${fmtINR(t.amount)}`, ml+130, y+5);
        doc.setTextColor(200, 240, 210);
        doc.text((t.status || '—').toUpperCase(), ml+160, y+5);
        y += 8;
      });

      y += 8;
      doc.setFontSize(7); doc.setTextColor(134, 239, 172);
      doc.text('ETHERTRACK TECHNOLOGIES PVT LTD · RBI COMPLIANT · RAZORPAY POWERED', W/2, y, { align: 'center' });

      doc.save(`EtherTrack_Statement_${Date.now()}.pdf`);
      showToast('✅ Statement downloaded');
    } catch (e) {
      showToast('❌ Download failed: ' + e.message, 'error');
    }
  };

  // ── Filtered transactions ─────────────────────────────────────
  const filteredTx = transactions.filter(t => {
    if (txFilter === 'deposits')    return t.type === 'credit' && t.method !== 'system';
    if (txFilter === 'withdrawals') return t.type === 'debit'  && t.method !== 'system';
    if (txFilter === 'trades')      return t.method === 'system';
    return true;
  });

  // Balance sparkline (mock based on transactions)
  const balSpark = transactions.slice().reverse().reduce((acc, t) => {
    const last = acc[acc.length - 1] || balance;
    const next = t.type === 'credit' ? last - parseFloat(t.amount) : last + parseFloat(t.amount);
    acc.push(Math.max(0, next));
    return acc;
  }, []).concat(balance).slice(-12);

  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Syne:wght@700;800&display=swap');
    *{box-sizing:border-box;}
    .wlt{min-height:100vh;background:#040706;font-family:'DM Mono',monospace;color:#f0fdf4;position:relative;}
    .wlt::before{content:'';position:fixed;inset:0;z-index:0;pointer-events:none;
      background-image:radial-gradient(circle at 15% 50%,rgba(34,197,94,.03) 0%,transparent 50%),
      radial-gradient(circle at 85% 20%,rgba(96,165,250,.02) 0%,transparent 50%);}
    .wlt-wrap{position:relative;z-index:1;max-width:1100px;margin:0 auto;padding:32px 24px 80px;}
    /* header */
    .wlt-hdr{margin-bottom:28px;animation:wu .4s ease both;}
    .wlt-hdr-label{font-size:10px;color:#86efac66;letter-spacing:.2em;margin-bottom:6px;}
    .wlt-hdr-title{font-family:'Syne',sans-serif;font-size:28px;font-weight:800;color:#f0fdf4;margin-bottom:4px;}
    .wlt-hdr-title span{color:#22c55e;}
    .wlt-hdr-sub{font-size:10px;color:#86efac44;letter-spacing:.1em;}
    /* top grid */
    .wlt-top{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:24px;animation:wu .4s ease .05s both;}
    /* balance card */
    .wlt-bal-card{background:linear-gradient(135deg,#061408,#0a1f0d);border:1px solid #22c55e22;border-radius:16px;padding:24px 24px 20px;position:relative;overflow:hidden;grid-column:1/2;}
    .wlt-bal-card::before{content:'';position:absolute;top:-20px;right:-20px;width:120px;height:120px;border-radius:50%;background:radial-gradient(circle,rgba(34,197,94,.06),transparent 70%);pointer-events:none;}
    .wlt-bal-label{font-size:9px;color:#86efac44;letter-spacing:.16em;margin-bottom:8px;}
    .wlt-bal-amount{font-family:'Syne',sans-serif;font-size:34px;font-weight:800;color:#22c55e;letter-spacing:.01em;line-height:1;margin-bottom:4px;}
    .wlt-bal-locked{font-size:9px;color:#86efac33;letter-spacing:.08em;margin-bottom:12px;}
    .wlt-bal-spark{opacity:.6;}
    .wlt-bal-actions{display:flex;gap:8px;margin-top:14px;}
    .wlt-dep-btn{flex:1;padding:10px;border-radius:8px;border:none;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.08em;transition:opacity .2s;}
    .wlt-dep-btn:hover{opacity:.85;}
    .wlt-wd-btn{flex:1;padding:10px;border-radius:8px;border:1px solid #22c55e33;background:#0d2e1f22;color:#22c55e88;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.08em;transition:all .2s;}
    .wlt-wd-btn:hover{background:#0d2e1f;color:#22c55e;border-color:#22c55e55;}
    /* metamask card */
    .wlt-meta-card{background:#070c09;border:1px solid #0f2a1a;border-radius:16px;padding:20px 22px;}
    .wlt-meta-title{font-size:9px;color:#86efac44;letter-spacing:.16em;margin-bottom:14px;}
    .wlt-meta-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #0f2a1a18;}
    .wlt-meta-row:last-child{border-bottom:none;}
    .wlt-meta-key{font-size:9px;color:#86efac44;letter-spacing:.08em;}
    .wlt-meta-val{font-size:10px;color:#f0fdf4;font-weight:600;text-align:right;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .wlt-meta-val.green{color:#22c55e;}
    .wlt-meta-val.red{color:#f87171;}
    .wlt-meta-val.yellow{color:#facc15;}
    /* converter card */
    .wlt-conv-card{background:#070c09;border:1px solid #0f2a1a;border-radius:16px;padding:20px 22px;}
    .wlt-conv-title{font-size:9px;color:#86efac44;letter-spacing:.16em;margin-bottom:14px;}
    .wlt-conv-input{width:100%;padding:10px 12px;border-radius:7px;border:1px solid #0f2a1a;background:#040706;color:#f0fdf4;font-family:'DM Mono',monospace;font-size:14px;font-weight:700;outline:none;margin-bottom:6px;transition:border-color .2s;}
    .wlt-conv-input:focus{border-color:#22c55e33;}
    .wlt-conv-result{font-size:18px;font-weight:700;color:#22c55e;letter-spacing:.02em;margin-bottom:4px;}
    .wlt-conv-rate{font-size:9px;color:#86efac33;letter-spacing:.08em;}
    /* tabs */
    .wlt-tabs{display:flex;gap:4px;border-bottom:1px solid #0f2a1a;margin-bottom:20px;animation:wu .4s ease .1s both;}
    .wlt-tab{padding:10px 18px;border:none;border-bottom:2px solid transparent;background:transparent;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.1em;color:#86efac44;transition:all .2s;margin-bottom:-1px;}
    .wlt-tab:hover{color:#86efac88;}
    .wlt-tab.act{color:#22c55e;border-bottom-color:#22c55e;}
    /* section */
    .wlt-section{background:#070c09;border:1px solid #0f2a1a;border-radius:14px;overflow:hidden;animation:wu .4s ease .15s both;}
    .wlt-section-hdr{padding:16px 20px;border-bottom:1px solid #0f2a1a;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;}
    .wlt-section-title{font-size:10px;color:#f0fdf4;font-weight:700;letter-spacing:.1em;}
    /* tx filters */
    .wlt-tx-filters{display:flex;gap:6px;}
    .wlt-filter-btn{padding:5px 12px;border-radius:5px;border:1px solid #0f2a1a;background:transparent;color:#86efac44;cursor:pointer;font-family:'DM Mono',monospace;font-size:9px;letter-spacing:.08em;transition:all .2s;}
    .wlt-filter-btn.act{background:#0d2e1f;border-color:#22c55e33;color:#22c55e;}
    /* tx table */
    .wlt-tx-head{display:grid;grid-template-columns:140px 1fr 80px 90px 110px 80px;gap:8px;padding:10px 20px;font-size:8px;color:#86efac33;letter-spacing:.12em;border-bottom:1px solid #0f2a1a;}
    .wlt-tx-row{display:grid;grid-template-columns:140px 1fr 80px 90px 110px 80px;gap:8px;padding:12px 20px;border-bottom:1px solid #0f2a1a08;align-items:center;transition:background .15s;cursor:default;}
    .wlt-tx-row:hover{background:#0f2a1a18;}
    .wlt-tx-row:last-child{border-bottom:none;}
    .wlt-tx-empty{padding:48px;text-align:center;color:#86efac22;font-size:11px;}
    .wlt-tx-type-badge{font-size:8px;padding:2px 8px;border-radius:3px;letter-spacing:.08em;font-weight:700;}
    .wlt-tx-status{font-size:8px;padding:2px 7px;border-radius:3px;letter-spacing:.06em;}
    /* bank accounts */
    .wlt-bank-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:20px;}
    .wlt-bank-card{background:#060a07;border:1px solid #0f2a1a;border-radius:10px;padding:16px;position:relative;transition:border-color .2s;}
    .wlt-bank-card:hover{border-color:#22c55e22;}
    .wlt-bank-card.default{border-color:#22c55e33;background:#0a1a0e;}
    .wlt-bank-name{font-size:12px;color:#f0fdf4;font-weight:700;margin-bottom:4px;}
    .wlt-bank-num{font-size:10px;color:#86efac55;letter-spacing:.06em;margin-bottom:8px;}
    .wlt-bank-meta{font-size:9px;color:#86efac33;margin-bottom:10px;}
    .wlt-bank-actions{display:flex;gap:6px;}
    .wlt-bank-btn{padding:5px 12px;border-radius:5px;font-family:'DM Mono',monospace;font-size:9px;cursor:pointer;transition:all .2s;letter-spacing:.06em;}
    .wlt-default-btn{border:1px solid #22c55e33;background:#0d2e1f22;color:#22c55e88;}
    .wlt-default-btn:hover{background:#0d2e1f;color:#22c55e;}
    .wlt-delete-btn{border:1px solid #dc262633;background:transparent;color:#f8717166;}
    .wlt-delete-btn:hover{background:#450a0a;border-color:#dc2626;color:#f87171;}
    .wlt-default-badge{position:absolute;top:12px;right:12px;font-size:8px;padding:2px 8px;border-radius:3px;background:#0d2e1f;color:#22c55e;border:1px solid #22c55e33;letter-spacing:.08em;}
    /* add bank form */
    .wlt-add-bank{background:#060a07;border:1px dashed #0f2a1a;border-radius:10px;padding:20px;margin:0 20px 20px;}
    .wlt-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;}
    .wlt-inp{width:100%;padding:9px 12px;border-radius:7px;border:1px solid #0f2a1a;background:#040706;color:#f0fdf4;font-family:'DM Mono',monospace;font-size:11px;outline:none;transition:border-color .2s;}
    .wlt-inp:focus{border-color:#22c55e33;}
    .wlt-inp.err{border-color:#dc2626;}
    .wlt-inp-label{font-size:9px;color:#86efac55;letter-spacing:.1em;margin-bottom:4px;display:block;}
    .wlt-inp-err{font-size:9px;color:#f87171;margin-top:3px;}
    .wlt-save-btn{padding:10px 22px;border-radius:7px;border:none;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.08em;transition:opacity .2s;margin-right:8px;}
    .wlt-save-btn:hover{opacity:.85;}
    .wlt-cancel-btn{padding:10px 18px;border-radius:7px;border:1px solid #0f2a1a;background:transparent;color:#86efac55;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.08em;transition:all .2s;}
    .wlt-cancel-btn:hover{color:#86efac88;}
    /* kyc section */
    .wlt-kyc-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:20px;}
    .wlt-kyc-item{background:#060a07;border:1px solid #0f2a1a;border-radius:10px;padding:14px 16px;display:flex;align-items:center;gap:12px;}
    .wlt-kyc-icon{font-size:22px;flex-shrink:0;}
    .wlt-kyc-label{font-size:9px;color:#86efac44;letter-spacing:.1em;margin-bottom:4px;}
    .wlt-kyc-val{font-size:12px;font-weight:700;}
    /* modal */
    .wlt-overlay{position:fixed;inset:0;background:rgba(0,0,0,.88);backdrop-filter:blur(6px);z-index:3000;display:flex;align-items:center;justify-content:center;padding:20px;animation:wltFadeIn .2s ease;}
    .wlt-modal{background:#070c09;border:1px solid #0f2a1a;border-radius:16px;width:100%;max-width:400px;box-shadow:0 32px 80px rgba(0,0,0,.95);animation:wltSlideUp .25s ease;overflow:hidden;}
    .wlt-modal-hdr{padding:16px 20px;border-bottom:1px solid #0f2a1a;display:flex;align-items:center;justify-content:space-between;}
    .wlt-modal-title{font-size:12px;font-weight:700;color:#f0fdf4;letter-spacing:.1em;}
    .wlt-modal-close{background:none;border:none;color:#86efac44;cursor:pointer;font-size:16px;transition:color .2s;padding:0;}
    .wlt-modal-close:hover{color:#f87171;}
    .wlt-modal-body{padding:20px;}
    .wlt-modal-foot{padding:14px 20px;border-top:1px solid #0f2a1a;display:flex;gap:8px;}
    .wlt-primary-btn{flex:1;padding:11px;border-radius:8px;border:none;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.08em;transition:opacity .2s;}
    .wlt-primary-btn:hover:not(:disabled){opacity:.85;}
    .wlt-primary-btn:disabled{opacity:.4;cursor:not-allowed;}
    .wlt-secondary-btn{flex:1;padding:11px;border-radius:8px;border:1px solid #0f2a1a;background:transparent;color:#86efac55;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;letter-spacing:.08em;transition:all .2s;}
    .wlt-secondary-btn:hover{color:#86efac88;}
    .wlt-presets{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;}
    .wlt-preset{padding:5px 12px;border-radius:5px;border:1px solid #0f2a1a;background:transparent;color:#86efac55;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.06em;transition:all .2s;}
    .wlt-preset:hover,.wlt-preset.sel{background:#0d2e1f;border-color:#22c55e44;color:#22c55e;}
    .wlt-amount-wrap{position:relative;margin-bottom:6px;}
    .wlt-amount-prefix{position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:16px;color:#4ade8055;font-weight:700;}
    .wlt-amount-inp{width:100%;padding:12px 12px 12px 30px;border-radius:8px;border:1px solid #0f2a1a;background:#060a07;color:#f0fdf4;font-family:'DM Mono',monospace;font-size:22px;font-weight:800;outline:none;transition:border-color .2s;box-sizing:border-box;}
    .wlt-amount-inp:focus{border-color:#22c55e33;}
    .wlt-amount-inp::placeholder{color:#4ade8022;}
    .wlt-hint{font-size:8px;color:#86efac33;letter-spacing:.06em;margin-bottom:14px;}
    .wlt-method-list{display:flex;flex-direction:column;gap:7px;margin-bottom:12px;}
    .wlt-method{display:flex;align-items:center;gap:10px;padding:11px 13px;border-radius:8px;border:1px solid #0f2a1a;background:#060a07;cursor:pointer;transition:all .2s;}
    .wlt-method:hover{border-color:#22c55e33;}
    .wlt-method.sel{border-color:#22c55e55;background:#0d2e1f22;}
    .wlt-method-icon{font-size:18px;width:26px;text-align:center;flex-shrink:0;}
    .wlt-method-info{flex:1;}
    .wlt-method-name{font-size:10px;color:#f0fdf4;font-weight:600;letter-spacing:.06em;}
    .wlt-method-desc{font-size:8px;color:#86efac44;letter-spacing:.04em;margin-top:1px;}
    .wlt-radio{width:12px;height:12px;border-radius:50%;border:1.5px solid #0f2a1a;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:border-color .2s;}
    .wlt-method.sel .wlt-radio{border-color:#22c55e;}
    .wlt-radio-dot{width:5px;height:5px;border-radius:50%;background:#22c55e;}
    .wlt-upi-inp{width:100%;padding:9px 12px;border-radius:7px;border:1px solid #0f2a1a;background:#060a07;color:#f0fdf4;font-family:'DM Mono',monospace;font-size:11px;outline:none;transition:border-color .2s;box-sizing:border-box;margin-top:8px;}
    .wlt-upi-inp:focus{border-color:#22c55e33;}
    .wlt-upi-inp::placeholder{color:#86efac33;}
    .wlt-err{font-size:9px;color:#f87171;letter-spacing:.06em;margin-top:6px;}
    .wlt-amount-pill{padding:8px 12px;background:#060a07;border:1px solid #0f2a1a;border-radius:7px;font-size:10px;color:#86efac66;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;}
    .wlt-amount-pill strong{color:#22c55e;}
    /* processing */
    .wlt-proc{text-align:center;padding:16px 0;}
    .wlt-proc-spin{font-size:36px;animation:wltSpin 1s linear infinite;display:inline-block;margin-bottom:12px;}
    .wlt-proc-title{font-size:12px;color:#f0fdf4;font-weight:700;margin-bottom:4px;}
    .wlt-proc-sub{font-size:9px;color:#86efac44;margin-bottom:14px;}
    .wlt-prog-track{height:3px;background:#0f2a1a;border-radius:2px;overflow:hidden;margin-bottom:6px;}
    .wlt-prog-bar{height:100%;background:linear-gradient(90deg,#16a34a,#22c55e);border-radius:2px;transition:width .3s;}
    .wlt-prog-pct{font-size:9px;color:#22c55e88;letter-spacing:.1em;}
    .wlt-proc-steps{display:flex;flex-direction:column;gap:7px;margin-top:14px;text-align:left;}
    .wlt-proc-step{display:flex;align-items:center;gap:8px;}
    .wlt-proc-ic{font-size:10px;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
    .wlt-proc-ic.done{background:#0d2e1f;color:#22c55e;}
    .wlt-proc-ic.pend{background:#0f2a1a;color:#4ade8022;}
    .wlt-proc-lbl{font-size:9px;letter-spacing:.06em;}
    .wlt-proc-lbl.done{color:#4ade8077;}
    .wlt-proc-lbl.pend{color:#4ade8033;}
    /* success */
    .wlt-done{text-align:center;padding:12px 0;}
    .wlt-done-ring{width:60px;height:60px;border-radius:50%;border:2px solid #22c55e33;background:#0d2e1f22;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;animation:wltRing .4s ease;}
    .wlt-done-title{font-size:14px;color:#f0fdf4;font-weight:700;margin-bottom:4px;}
    .wlt-done-sub{font-size:9px;color:#86efac44;margin-bottom:14px;}
    .wlt-done-card{background:#060a07;border:1px solid #0f2a1a;border-radius:8px;padding:10px 14px;text-align:left;margin-bottom:14px;}
    .wlt-done-row{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid #0f2a1a18;}
    .wlt-done-row:last-child{border-bottom:none;}
    .wlt-done-key{font-size:8px;color:#86efac33;letter-spacing:.1em;}
    .wlt-done-val{font-size:10px;color:#f0fdf4;font-weight:600;}
    .wlt-done-val.g{color:#22c55e;}
    /* security */
    .wlt-security{display:flex;align-items:center;gap:5px;justify-content:center;margin-top:12px;}
    .wlt-security-text{font-size:8px;color:#86efac22;letter-spacing:.06em;}
    /* toast */
    .wlt-toast{position:fixed;bottom:24px;right:24px;z-index:9999;background:#070c09;border-radius:8px;padding:11px 18px;font-size:11px;font-family:'DM Mono',monospace;letter-spacing:.05em;box-shadow:0 8px 40px rgba(0,0,0,.7);animation:wltSlideIn .3s ease;}
    /* loading skeleton */
    .wlt-skel{background:linear-gradient(90deg,#0d2e1f22 25%,#0d2e1f44 50%,#0d2e1f22 75%);background-size:200% 100%;animation:wltShimmer 1.5s infinite;border-radius:6px;}
    /* add btn */
    .wlt-add-btn{padding:8px 16px;border-radius:7px;border:1px solid #22c55e33;background:#0d2e1f22;color:#22c55e88;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.08em;transition:all .2s;}
    .wlt-add-btn:hover{background:#0d2e1f;color:#22c55e;}
    .wlt-dl-btn{padding:8px 16px;border-radius:7px;border:1px solid #60a5fa33;background:#060e18;color:#60a5fa88;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.08em;transition:all .2s;}
    .wlt-dl-btn:hover{border-color:#60a5fa66;color:#60a5fa;}
    @keyframes wu{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}
    @keyframes wltFadeIn{from{opacity:0;}to{opacity:1;}}
    @keyframes wltSlideUp{from{opacity:0;transform:translateY(14px);}to{opacity:1;transform:translateY(0);}}
    @keyframes wltSlideIn{from{opacity:0;transform:translateX(16px);}to{opacity:1;transform:translateX(0);}}
    @keyframes wltSpin{to{transform:rotate(360deg);}}
    @keyframes wltRing{from{transform:scale(.6);opacity:0;}to{transform:scale(1);opacity:1;}}
    @keyframes wltShimmer{0%{background-position:200% 0;}100%{background-position:-200% 0;}}
    @media(max-width:900px){.wlt-top{grid-template-columns:1fr 1fr;}.wlt-bank-grid{grid-template-columns:1fr;}.wlt-kyc-grid{grid-template-columns:1fr;}}
    @media(max-width:600px){.wlt-top{grid-template-columns:1fr;}.wlt-tx-head,.wlt-tx-row{grid-template-columns:110px 1fr 70px 80px;}.wlt-tx-head>*:nth-child(n+5),.wlt-tx-row>*:nth-child(n+5){display:none;}}
  `;

  // ── Converter state ───────────────────────────────────────────
  const [convInr, setConvInr] = useState('');
  const [convDir, setConvDir] = useState('inr2eth'); // inr2eth | eth2inr
  const convResult = convDir === 'inr2eth'
    ? `${((parseFloat(convInr)||0) / ethRate).toFixed(6)} ETH`
    : `₹${((parseFloat(convInr)||0) * ethRate).toLocaleString('en-IN')}`;

  return (
    <>
      <style>{CSS}</style>
      <div className="wlt">
        <div className="wlt-wrap">

          {/* Page header */}
          <div className="wlt-hdr">
            <div className="wlt-hdr-label">ETHERTRACK · FINANCIAL HUB</div>
            <div className="wlt-hdr-title">INR <span>Wallet</span></div>
            <div className="wlt-hdr-sub">DEPOSIT · WITHDRAW · TRADE · STATEMENT · RBI COMPLIANT · RAZORPAY</div>
          </div>

          {/* Top 3-column grid */}
          <div className="wlt-top">

            {/* Balance card */}
            <div className="wlt-bal-card">
              <div className="wlt-bal-label">AVAILABLE BALANCE</div>
              {loading
                ? <div className="wlt-skel" style={{height:40,width:'60%',marginBottom:8}}/>
                : <div className="wlt-bal-amount">{fmtINR(balance)}</div>
              }
              {balanceLocked > 0 && (
                <div className="wlt-bal-locked">🔒 {fmtINR(balanceLocked)} locked in orders</div>
              )}
              <div className="wlt-bal-spark">
                <Sparkline data={balSpark} color="#22c55e" w={160} h={32}/>
              </div>
              <div className="wlt-bal-actions">
                <button className="wlt-dep-btn" onClick={() => openModal('deposit')}>＋ DEPOSIT</button>
                <button className="wlt-wd-btn"  onClick={() => openModal('withdraw')}>↑ WITHDRAW</button>
              </div>
            </div>

            {/* MetaMask / wallet status */}
            <div className="wlt-meta-card">
              <div className="wlt-meta-title">WALLET STATUS</div>
              {[
                { k:'KYC STATUS',     v: dbUser?.kyc_verified ? '✅ VERIFIED' : '⚠ PENDING',     cls: dbUser?.kyc_verified ? 'green':'yellow', action: !dbUser?.kyc_verified ? ()=>navigate('/kyc') : null },
                { k:'METAMASK',       v: '🦊 CHECK HEADER',    cls:''    },
                { k:'GSTIN',          v: dbUser?.company_gstin || '—',           cls:'' },
                { k:'COMPANY',        v: dbUser?.company_name  || '—',           cls:'' },
                { k:'INR BALANCE',    v: fmtINR(balance),                        cls:'green' },
                { k:'LAST ACTIVITY',  v: transactions[0] ? fmtDate(transactions[0].created_at).slice(0,12) : 'No activity', cls:'' },
              ].map(({ k, v, cls, action }) => (
                <div key={k} className="wlt-meta-row" onClick={action||undefined} style={action?{cursor:'pointer'}:{}}>
                  <span className="wlt-meta-key">{k}</span>
                  <span className={`wlt-meta-val${cls?' '+cls:''}`}>{v}</span>
                </div>
              ))}
            </div>

            {/* INR ↔ ETH converter */}
            <div className="wlt-conv-card">
              <div className="wlt-conv-title">INR ↔ ETH CONVERTER</div>
              <div style={{display:'flex',gap:6,marginBottom:10}}>
                {[['inr2eth','₹ → ETH'],['eth2inr','ETH → ₹']].map(([d,l])=>(
                  <button key={d} onClick={()=>{setConvDir(d);setConvInr('');}}
                    style={{flex:1,padding:'6px',borderRadius:5,border:`1px solid ${convDir===d?'#22c55e44':'#0f2a1a'}`,background:convDir===d?'#0d2e1f22':'#060a07',color:convDir===d?'#22c55e':'#86efac44',cursor:'pointer',fontFamily:'DM Mono,monospace',fontSize:9,letterSpacing:'.08em',transition:'all .2s'}}>
                    {l}
                  </button>
                ))}
              </div>
              <input
                className="wlt-conv-input"
                type="number"
                placeholder={convDir === 'inr2eth' ? 'Enter ₹ amount' : 'Enter ETH amount'}
                value={convInr}
                onChange={e => setConvInr(e.target.value)}
              />
              <div className="wlt-conv-result">{convInr ? convResult : '—'}</div>
              <div className="wlt-conv-rate">
                1 ETH = ₹{ethRate.toLocaleString('en-IN')} · Live rate via CoinGecko
              </div>
              <div style={{marginTop:12,padding:'8px 10px',background:'#060a07',border:'1px solid #0f2a1a',borderRadius:6}}>
                <div style={{fontSize:8,color:'#86efac33',letterSpacing:'.1em',marginBottom:4}}>YOUR TRADING POWER</div>
                <div style={{fontSize:13,color:'#22c55e',fontWeight:700}}>
                  {(balance / ethRate).toFixed(6)} ETH equivalent
                </div>
                <div style={{fontSize:8,color:'#86efac22',marginTop:2}}>Based on current INR balance</div>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="wlt-tabs">
            {[
              ['transactions', `TRANSACTIONS${transactions.length ? ` (${transactions.length})` : ''}`],
              ['banks',        `BANK ACCOUNTS${bankAccounts.length ? ` (${bankAccounts.length})` : ''}`],
              ['kyc',          'KYC & IDENTITY'],
            ].map(([t, l]) => (
              <button key={t} className={`wlt-tab${tab===t?' act':''}`} onClick={() => setTab(t)}>{l}</button>
            ))}
          </div>

          {/* ══ TRANSACTIONS ══ */}
          {tab === 'transactions' && (
            <div className="wlt-section">
              <div className="wlt-section-hdr">
                <span className="wlt-section-title">TRANSACTION HISTORY</span>
                <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                  <div className="wlt-tx-filters">
                    {[['all','ALL'],['deposits','DEPOSITS'],['withdrawals','WITHDRAWALS'],['trades','TRADES']].map(([f,l])=>(
                      <button key={f} className={`wlt-filter-btn${txFilter===f?' act':''}`} onClick={()=>setTxFilter(f)}>{l}</button>
                    ))}
                  </div>
                  <button className="wlt-dl-btn" onClick={downloadStatement}>↓ STATEMENT PDF</button>
                </div>
              </div>

              {loading ? (
                <div style={{padding:'20px'}}>
                  {[1,2,3,4].map(i=>(
                    <div key={i} style={{display:'flex',gap:10,padding:'12px 0',borderBottom:'1px solid #0f2a1a08'}}>
                      <div className="wlt-skel" style={{height:10,width:'15%'}}/>
                      <div className="wlt-skel" style={{height:10,width:'25%'}}/>
                      <div className="wlt-skel" style={{height:10,width:'10%'}}/>
                    </div>
                  ))}
                </div>
              ) : filteredTx.length === 0 ? (
                <div className="wlt-tx-empty">
                  {txFilter === 'all' ? '💸 No transactions yet. Deposit funds to get started.' : `No ${txFilter} found.`}
                </div>
              ) : (
                <>
                  <div className="wlt-tx-head">
                    <span>DATE</span><span>REFERENCE</span><span>TYPE</span><span>METHOD</span><span>AMOUNT</span><span>STATUS</span>
                  </div>
                  {filteredTx.map((t, i) => {
                    const isCredit = t.type === 'credit';
                    const statusColor = t.status === 'success' ? '#22c55e' : t.status === 'pending' ? '#f59e0b' : '#f87171';
                    const statusBg    = t.status === 'success' ? '#0d2e1f' : t.status === 'pending' ? '#1a0e00' : '#1a0707';
                    return (
                      <div key={t.id || i} className="wlt-tx-row">
                        <span style={{fontSize:10,color:'#86efac55'}}>{fmtDate(t.created_at)}</span>
                        <span style={{fontSize:10,color:'#86efac88',fontFamily:'monospace'}}>{t.reference || '—'}</span>
                        <span>
                          <span className="wlt-tx-type-badge" style={{
                            background: isCredit ? '#0d2e1f' : '#1a0707',
                            color:       isCredit ? '#22c55e'  : '#f87171',
                            border:     `1px solid ${isCredit ? '#22c55e33' : '#f8717133'}`,
                          }}>
                            {isCredit ? '↓ IN' : '↑ OUT'}
                          </span>
                        </span>
                        <span style={{fontSize:9,color:'#86efac55',letterSpacing:'.06em'}}>{(t.method||'—').toUpperCase()}</span>
                        <span style={{fontSize:12,fontWeight:700,color: isCredit ? '#22c55e' : '#f87171'}}>
                          {isCredit ? '+' : '-'}{fmtINR(t.amount)}
                        </span>
                        <span>
                          <span className="wlt-tx-status" style={{background:statusBg,color:statusColor,border:`1px solid ${statusColor}33`}}>
                            {(t.status||'—').toUpperCase()}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {/* ══ BANK ACCOUNTS ══ */}
          {tab === 'banks' && (
            <div className="wlt-section">
              <div className="wlt-section-hdr">
                <span className="wlt-section-title">SAVED BANK ACCOUNTS</span>
                <button className="wlt-add-btn" onClick={() => setShowAddBank(b => !b)}>
                  {showAddBank ? '✕ CANCEL' : '＋ ADD ACCOUNT'}
                </button>
              </div>

              {showAddBank && (
                <div className="wlt-add-bank">
                  <div style={{fontSize:10,color:'#86efac66',letterSpacing:'.1em',marginBottom:14}}>NEW BANK ACCOUNT</div>
                  <div className="wlt-form-grid">
                    {[
                      { key:'name',    label:'ACCOUNT HOLDER NAME', ph:'e.g. Rahul Sharma' },
                      { key:'bank',    label:'BANK NAME',            ph:'e.g. HDFC Bank' },
                      { key:'account', label:'ACCOUNT NUMBER',       ph:'e.g. 1234567890' },
                      { key:'ifsc',    label:'IFSC CODE',            ph:'e.g. HDFC0001234' },
                    ].map(f => (
                      <div key={f.key}>
                        <label className="wlt-inp-label">{f.label}</label>
                        <input
                          className={`wlt-inp${bankErr[f.key]?' err':''}`}
                          placeholder={f.ph}
                          value={bankForm[f.key]}
                          onChange={e => setBankForm(p => ({...p,[f.key]:e.target.value}))}
                        />
                        {bankErr[f.key] && <div className="wlt-inp-err">{bankErr[f.key]}</div>}
                      </div>
                    ))}
                  </div>
                  <button className="wlt-save-btn" onClick={saveBankAccount}>SAVE ACCOUNT</button>
                  <button className="wlt-cancel-btn" onClick={() => { setShowAddBank(false); setBankErr({}); }}>CANCEL</button>
                </div>
              )}

              {bankAccounts.length === 0 && !showAddBank ? (
                <div className="wlt-tx-empty">
                  🏦 No bank accounts saved yet.<br/>
                  <span style={{fontSize:9,color:'#86efac22'}}>Add your bank account for fast withdrawals.</span>
                </div>
              ) : (
                <div className="wlt-bank-grid">
                  {bankAccounts.map(acc => (
                    <div key={acc.id} className={`wlt-bank-card${acc.is_default?' default':''}`}>
                      {acc.is_default && <span className="wlt-default-badge">DEFAULT</span>}
                      <div className="wlt-bank-name">{acc.account_name}</div>
                      <div className="wlt-bank-num">···· ···· {acc.account_number.slice(-4)}</div>
                      <div className="wlt-bank-meta">{acc.bank_name} · IFSC: {acc.ifsc}</div>
                      <div className="wlt-bank-actions">
                        {!acc.is_default && (
                          <button className="wlt-bank-btn wlt-default-btn" onClick={() => setDefaultAccount(acc.id)}>SET DEFAULT</button>
                        )}
                        <button className="wlt-bank-btn wlt-delete-btn" onClick={() => deleteBankAccount(acc.id)}>DELETE</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{padding:'14px 20px',borderTop:'1px solid #0f2a1a',fontSize:9,color:'#86efac22',letterSpacing:'.06em'}}>
                🔒 Bank details stored locally on your device · Withdrawals processed via Razorpay Payouts · 1–2 business days
              </div>
            </div>
          )}

          {/* ══ KYC & IDENTITY ══ */}
          {tab === 'kyc' && (
            <div className="wlt-section">
              <div className="wlt-section-hdr">
                <span className="wlt-section-title">KYC & IDENTITY VERIFICATION</span>
                {!dbUser?.kyc_verified && (
                  <button className="wlt-add-btn" onClick={() => navigate('/kyc')}>COMPLETE KYC →</button>
                )}
              </div>
              <div className="wlt-kyc-grid">
                {[
                  { icon:'🪪', label:'KYC STATUS',      val: dbUser?.kyc_verified ? 'VERIFIED' : 'PENDING',  color: dbUser?.kyc_verified ? '#22c55e' : '#f59e0b' },
                  { icon:'🏢', label:'COMPANY',          val: dbUser?.company_name  || 'Not set',              color: '#f0fdf4' },
                  { icon:'📋', label:'GSTIN',            val: dbUser?.company_gstin || 'Not provided',         color: '#60a5fa' },
                  { icon:'🪙', label:'PAN',              val: dbUser?.company_pan   || 'Not provided',         color: '#a78bfa' },
                  { icon:'🏛', label:'CIN',              val: dbUser?.company_cin   || 'Not provided',         color: '#facc15' },
                  { icon:'📧', label:'EMAIL',            val: dbUser?.email          || '—',                   color: '#f0fdf4' },
                  { icon:'🏭', label:'INDUSTRY',         val: dbUser?.industry_sector || 'Not set',            color: '#f0fdf4' },
                  { icon:'💼', label:'COMPANY TYPE',     val: dbUser?.company_type   || 'Not set',             color: '#f0fdf4' },
                ].map(({ icon, label, val, color }) => (
                  <div key={label} className="wlt-kyc-item">
                    <span className="wlt-kyc-icon">{icon}</span>
                    <div>
                      <div className="wlt-kyc-label">{label}</div>
                      <div className="wlt-kyc-val" style={{ color }}>{val}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Wallet binding */}
              <div style={{padding:'16px 20px',borderTop:'1px solid #0f2a1a'}}>
                <div style={{fontSize:9,color:'#86efac44',letterSpacing:'.12em',marginBottom:12}}>TRADING PERMISSIONS</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
                  {[
                    { label:'INR DEPOSITS',   ok: true,                      desc:'Via UPI / Net Banking' },
                    { label:'INR WITHDRAWALS', ok: true,                      desc:'Via Bank Transfer' },
                    { label:'CREDIT TRADING', ok: !!dbUser?.kyc_verified,    desc:'Requires KYC' },
                    { label:'METAMASK BIND',  ok: !!dbUser?.wallet_address,  desc:'For on-chain signing' },
                    { label:'BRSR REPORTS',   ok: !!dbUser?.kyc_verified,    desc:'Requires KYC' },
                    { label:'CREDIT RETIRE',  ok: !!dbUser?.wallet_address && !!dbUser?.kyc_verified, desc:'Requires both' },
                  ].map(({ label, ok, desc }) => (
                    <div key={label} style={{
                      padding:'12px 14px',borderRadius:8,
                      background: ok ? '#051409' : '#0a0a0a',
                      border:`1px solid ${ok ? '#22c55e22' : '#0f2a1a'}`,
                    }}>
                      <div style={{fontSize:9,color:ok?'#22c55e':'#86efac22',fontWeight:700,letterSpacing:'.08em',marginBottom:3}}>
                        {ok ? '✓' : '○'} {label}
                      </div>
                      <div style={{fontSize:8,color:'#86efac33'}}>{desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{padding:'14px 20px',borderTop:'1px solid #0f2a1a',fontSize:9,color:'#86efac22',letterSpacing:'.06em'}}>
                🔒 KYC verified by EtherTrack compliance team · ISO 14064-3 · SEBI BRSR · RBI compliant
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ══ DEPOSIT / WITHDRAW MODAL ══ */}
      {modal && (
        <div className="wlt-overlay" onClick={e => e.target === e.currentTarget && !modalLoading && closeModal()}>
          <div className="wlt-modal">
            <div className="wlt-modal-hdr">
              <span className="wlt-modal-title">
                {modal === 'deposit' ? '🇮🇳 ADD FUNDS' : '↑ WITHDRAW FUNDS'}
              </span>
              <button className="wlt-modal-close" onClick={closeModal} disabled={modalLoading}>✕</button>
            </div>
            <div className="wlt-modal-body">

              {/* ── AMOUNT STEP ── */}
              {modalStep === 'amount' && (
                <>
                  {modal === 'withdraw' && (
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 10px',background:'#060a07',border:'1px solid #0f2a1a',borderRadius:7,marginBottom:12}}>
                      <span style={{fontSize:9,color:'#86efac44',letterSpacing:'.1em'}}>AVAILABLE</span>
                      <span style={{fontSize:13,color:'#22c55e',fontWeight:700}}>{fmtINR(balance)}</span>
                    </div>
                  )}
                  <div className="wlt-presets">
                    {(modal === 'deposit' ? [500,1000,2000,5000,10000] : [500,1000,2000,5000].filter(a=>a<=balance)).map(a => (
                      <button key={a} className={`wlt-preset${amtVal===a?' sel':''}`} onClick={() => setModalAmount(String(a))}>
                        ₹{a.toLocaleString('en-IN')}
                      </button>
                    ))}
                  </div>
                  <div className="wlt-amount-wrap">
                    <span className="wlt-amount-prefix">₹</span>
                    <input
                      className="wlt-amount-inp"
                      type="number"
                      placeholder="0"
                      value={modalAmount}
                      onChange={e => setModalAmount(e.target.value)}
                      min={100}
                      max={modal === 'withdraw' ? balance : 100000}
                    />
                  </div>
                  <div className="wlt-hint">
                    {modal === 'deposit'
                      ? 'MIN ₹100 · MAX ₹1,00,000 PER TRANSACTION'
                      : `MIN ₹100 · MAX ${fmtINR(balance)} AVAILABLE`
                    }
                  </div>
                  {modalErr && <div className="wlt-err">⚠ {modalErr}</div>}
                </>
              )}

              {/* ── METHOD STEP (deposit) ── */}
              {modalStep === 'method' && modal === 'deposit' && (
                <>
                  <div className="wlt-amount-pill">
                    <span>DEPOSITING</span>
                    <strong>₹{amtVal.toLocaleString('en-IN')}</strong>
                  </div>
                  <div className="wlt-method-list">
                    {[
                      { id:'upi',  icon:'📱', name:'UPI',          desc:'GPay · PhonePe · Paytm · BHIM' },
                      { id:'qr',   icon:'⬛', name:'Scan QR Code', desc:'Open any UPI app and scan'      },
                      { id:'bank', icon:'🏦', name:'Net Banking',  desc:'NEFT · IMPS · All banks'        },
                    ].map(m => (
                      <div key={m.id} className={`wlt-method${modalMethod===m.id?' sel':''}`} onClick={() => setModalMethod(m.id)}>
                        <span className="wlt-method-icon">{m.icon}</span>
                        <div className="wlt-method-info">
                          <div className="wlt-method-name">{m.name}</div>
                          <div className="wlt-method-desc">{m.desc}</div>
                        </div>
                        <div className="wlt-radio">{modalMethod===m.id&&<div className="wlt-radio-dot"/>}</div>
                      </div>
                    ))}
                  </div>
                  {modalErr && <div className="wlt-err">⚠ {modalErr}</div>}
                  <div className="wlt-security">
                    🔒 <span className="wlt-security-text">256-BIT ENCRYPTED · RBI COMPLIANT · RAZORPAY</span>
                  </div>
                </>
              )}

              {/* ── BANK DETAILS STEP (withdraw) ── */}
              {modalStep === 'method' && modal === 'withdraw' && (
                <>
                  <div className="wlt-amount-pill">
                    <span>WITHDRAWING</span>
                    <strong>₹{amtVal.toLocaleString('en-IN')}</strong>
                  </div>

                  {/* Saved accounts quick select */}
                  {bankAccounts.length > 0 && (
                    <div style={{marginBottom:12}}>
                      <div style={{fontSize:9,color:'#86efac44',letterSpacing:'.1em',marginBottom:6}}>SAVED ACCOUNTS</div>
                      {bankAccounts.map(acc => (
                        <div key={acc.id}
                          onClick={() => { setWdName(acc.account_name); setWdAccount(acc.account_number); setWdIfsc(acc.ifsc); }}
                          style={{
                            padding:'9px 12px',borderRadius:7,marginBottom:6,cursor:'pointer',
                            border:`1px solid ${wdAccount===acc.account_number?'#22c55e44':'#0f2a1a'}`,
                            background:wdAccount===acc.account_number?'#0d2e1f22':'#060a07',
                            display:'flex',justifyContent:'space-between',alignItems:'center',
                            transition:'all .2s',
                          }}>
                          <div>
                            <div style={{fontSize:10,color:'#f0fdf4',fontWeight:600}}>{acc.account_name}</div>
                            <div style={{fontSize:9,color:'#86efac44'}}>{acc.bank_name} · ···{acc.account_number.slice(-4)}</div>
                          </div>
                          {acc.is_default && <span style={{fontSize:8,color:'#22c55e55',letterSpacing:'.08em'}}>DEFAULT</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{fontSize:9,color:'#86efac44',letterSpacing:'.1em',marginBottom:8}}>
                    {bankAccounts.length > 0 ? 'OR ENTER MANUALLY' : 'BANK DETAILS'}
                  </div>
                  {[
                    { ph:'Account Holder Name', val:wdName,    set:setWdName    },
                    { ph:'Account Number',       val:wdAccount, set:setWdAccount },
                    { ph:'IFSC Code',            val:wdIfsc,    set:setWdIfsc    },
                  ].map(f => (
                    <input key={f.ph} className="wlt-upi-inp" placeholder={f.ph}
                      value={f.val} onChange={e => f.set(e.target.value)}
                      style={{marginBottom:8,display:'block',width:'100%'}}/>
                  ))}
                  {modalErr && <div className="wlt-err">⚠ {modalErr}</div>}
                  <div style={{fontSize:9,color:'#86efac22',marginTop:6,lineHeight:1.6}}>
                    Funds reach your account in 1–2 business days via IMPS/NEFT
                  </div>
                </>
              )}

              {/* ── DONE ── */}
              {modalStep === 'done' && modalDone && (
                <div className="wlt-done">
                  <div className="wlt-done-ring"><span style={{fontSize:28}}>✅</span></div>
                  <div className="wlt-done-title">
                    {modalDone.type === 'deposit' ? 'FUNDS ADDED!' : 'WITHDRAWAL INITIATED!'}
                  </div>
                  <div className="wlt-done-sub">
                    {modalDone.type === 'deposit'
                      ? 'Your INR wallet has been credited'
                      : 'Will reach your account in 1–2 business days'
                    }
                  </div>
                  <div className="wlt-done-card">
                    {[
                      { k: modalDone.type==='deposit'?'AMOUNT CREDITED':'AMOUNT DEBITED', v:`₹${amtVal.toLocaleString('en-IN')}`, g:true },
                      { k:'REFERENCE', v: modalDone.reference || modalDone.paymentId || '—' },
                      { k:'METHOD',    v: modalMethod.toUpperCase() },
                      { k:'STATUS',    v: modalDone.type==='deposit'?'CONFIRMED':'PROCESSING', g:true },
                    ].map(r => (
                      <div key={r.k} className="wlt-done-row">
                        <span className="wlt-done-key">{r.k}</span>
                        <span className={`wlt-done-val${r.g?' g':''}`}>{r.v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>

            {/* Modal footer buttons */}
            <div className="wlt-modal-foot">
              {modalStep === 'amount' && (
                <>
                  <button className="wlt-secondary-btn" onClick={closeModal}>CANCEL</button>
                  <button className="wlt-primary-btn"
                    onClick={() => {
                      if (!amtVal || amtVal < 100) { setModalErr('Minimum amount is ₹100'); return; }
                      if (modal === 'withdraw' && amtVal > balance) { setModalErr('Insufficient balance'); return; }
                      setModalErr(''); setModalStep('method');
                    }}>
                    NEXT →
                  </button>
                </>
              )}
              {modalStep === 'method' && (
                <>
                  <button className="wlt-secondary-btn" onClick={() => setModalStep('amount')}>← BACK</button>
                  <button className="wlt-primary-btn"
                    onClick={modal === 'deposit' ? handleDeposit : handleWithdraw}
                    disabled={modalLoading}>
                    {modalLoading ? 'PROCESSING...' : modal === 'deposit' ? 'PAY NOW →' : 'CONFIRM →'}
                  </button>
                </>
              )}
              {modalStep === 'done' && (
                <button className="wlt-primary-btn" onClick={closeModal}>DONE ✓</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="wlt-toast" style={{
          border:`1px solid ${toast.type==='error'?'#f8717144':'#22c55e33'}`,
          color: toast.type==='error'?'#f87171':'#22c55e88',
        }}>
          {toast.msg}
        </div>
      )}
    </>
  );
}