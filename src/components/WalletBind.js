import React, { useState, useContext } from 'react';
import { AuthContext } from '../App';
import { walletAPI } from '../services/api';

export default function WalletBind({ onComplete }) {
  const { dbUser, setDbUser } = useContext(AuthContext);
  const [step,    setStep]    = useState(1); // 1=connect, 2=sign, 3=done
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [wallet,  setWallet]  = useState('');

  const handleConnect = async () => {
    setError('');
    if (!window.ethereum) {
      setError('MetaMask not found. Install it from metamask.io');
      return;
    }
    try {
      setLoading(true);
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      if (!accounts || !accounts.length) {
        setError('No accounts found. Unlock MetaMask and try again.');
        return;
      }
      setWallet(accounts[0]);
      setStep(2);
    } catch (e) {
      setError(e?.message || 'Failed to connect wallet');
    } finally {
      setLoading(false);
    }
  };

  const handleSign = async () => {
    setError('');
    try {
      setLoading(true);

      // Step 1: get challenge message from backend
      let challengeRes;
      try {
        challengeRes = await walletAPI.challenge(wallet);
      } catch (e) {
        setError('Could not reach backend. Check your connection.');
        return;
      }

      // ── Safe extraction — handle any response shape ───────
      const message = challengeRes?.message || challengeRes?.data?.message || null;
      if (!message) {
        setError('Invalid challenge from server. Try again.');
        return;
      }

      // Step 2: sign the message with MetaMask
      let signature;
      try {
        signature = await window.ethereum.request({
          method: 'personal_sign',
          params: [message, wallet],
        });
      } catch (e) {
        if (e?.code === 4001) {
          setError('Signature rejected. Please approve in MetaMask.');
        } else {
          setError(e?.message || 'Signing failed');
        }
        return;
      }

      // Step 3: send signature to backend to bind wallet
      let bindRes;
      try {
        bindRes = await walletAPI.bind({ walletAddress: wallet, signature, message });
      } catch (e) {
        setError(e?.message || 'Failed to bind wallet to account');
        return;
      }

      // Update dbUser in context
      if (bindRes?.user) {
        setDbUser?.(bindRes.user);
      }

      setStep(3);
    } catch (e) {
      setError(e?.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        .wb-overlay{position:fixed;inset:0;background:rgba(0,0,0,.88);backdrop-filter:blur(8px);z-index:9000;display:flex;align-items:center;justify-content:center;padding:24px;animation:wbFade .2s ease;}
        .wb-modal{background:#0a0f0c;border:1px solid #22c55e22;border-radius:16px;width:100%;max-width:420px;padding:32px;box-shadow:0 32px 80px rgba(0,0,0,.9);animation:wbUp .25s ease;font-family:'DM Mono',monospace;}
        .wb-title{font-size:16px;font-weight:700;color:#f0fdf4;margin-bottom:6px;letter-spacing:.06em;}
        .wb-sub{font-size:10px;color:#86efac55;letter-spacing:.1em;margin-bottom:28px;line-height:1.6;}
        .wb-steps{display:flex;gap:6px;margin-bottom:28px;}
        .wb-step{flex:1;height:3px;border-radius:2px;transition:background .3s;}
        .wb-wallet{background:#060a07;border:1px solid #0f2a1a;border-radius:8px;padding:12px 14px;font-size:10px;color:#22c55e;font-family:monospace;word-break:break-all;margin-bottom:16px;}
        .wb-btn{width:100%;padding:13px;border-radius:8px;border:none;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;cursor:pointer;font-family:'DM Mono',monospace;font-size:11px;font-weight:700;letter-spacing:.1em;transition:opacity .2s;margin-bottom:10px;}
        .wb-btn:hover:not(:disabled){opacity:.85;}
        .wb-btn:disabled{opacity:.4;cursor:not-allowed;}
        .wb-skip{width:100%;padding:10px;border-radius:8px;border:1px solid #0f2a1a;background:transparent;color:#86efac33;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.08em;transition:all .2s;}
        .wb-skip:hover{border-color:#22c55e22;color:#86efac66;}
        .wb-err{background:#1a0a0a;border:1px solid #f8717133;border-radius:6px;padding:10px 12px;font-size:10px;color:#f87171;margin-bottom:14px;line-height:1.5;}
        .wb-done{text-align:center;padding:16px 0;}
        .wb-spinner{width:16px;height:16px;border:2px solid #22c55e22;border-top-color:#22c55e;border-radius:50%;animation:wbSpin 1s linear infinite;display:inline-block;margin-right:8px;vertical-align:middle;}
        @keyframes wbFade{from{opacity:0;}to{opacity:1;}}
        @keyframes wbUp{from{opacity:0;transform:translateY(16px);}to{opacity:1;transform:translateY(0);}}
        @keyframes wbSpin{to{transform:rotate(360deg);}}
      `}</style>

      <div className="wb-overlay">
        <div className="wb-modal">
          <div className="wb-title">🔗 Bind Your Wallet</div>
          <div className="wb-sub">
            Link your MetaMask wallet to your EtherTrack account.<br/>
            This lets you trade, tokenize, and retire credits.
          </div>

          {/* Step indicators */}
          <div className="wb-steps">
            {[1,2,3].map(s => (
              <div key={s} className="wb-step" style={{
                background: step >= s ? '#22c55e' : '#0f2a1a'
              }}/>
            ))}
          </div>

          {error && <div className="wb-err">⚠️ {error}</div>}

          {step === 1 && (
            <>
              <div style={{fontSize:11,color:'#86efac66',marginBottom:20,lineHeight:1.7}}>
                Click below to connect MetaMask. Make sure it's unlocked and on <strong style={{color:'#22c55e88'}}>Sepolia testnet</strong>.
              </div>
              <button className="wb-btn" onClick={handleConnect} disabled={loading}>
                {loading ? <><span className="wb-spinner"/>Connecting...</> : '🦊 CONNECT METAMASK'}
              </button>
              <button className="wb-skip" onClick={onComplete}>SKIP FOR NOW</button>
            </>
          )}

          {step === 2 && (
            <>
              <div className="wb-wallet">
                <div style={{fontSize:8,color:'#86efac55',letterSpacing:'.12em',marginBottom:4}}>CONNECTED WALLET</div>
                {wallet}
              </div>
              <div style={{fontSize:10,color:'#86efac55',marginBottom:16,lineHeight:1.7}}>
                Sign a message to prove ownership. This does <strong style={{color:'#f0fdf4'}}>not</strong> cost gas and doesn't send any transaction.
              </div>
              <button className="wb-btn" onClick={handleSign} disabled={loading}>
                {loading ? <><span className="wb-spinner"/>Signing...</> : '✍️ SIGN & BIND WALLET'}
              </button>
              <button className="wb-skip" onClick={onComplete} disabled={loading}>SKIP FOR NOW</button>
            </>
          )}

          {step === 3 && (
            <div className="wb-done">
              <div style={{fontSize:40,marginBottom:16}}>✅</div>
              <div style={{fontSize:14,color:'#f0fdf4',fontWeight:700,marginBottom:8}}>Wallet Bound!</div>
              <div style={{fontSize:10,color:'#86efac55',marginBottom:24,lineHeight:1.7}}>
                <span style={{color:'#22c55e',fontFamily:'monospace',fontSize:10}}>
                  {wallet.slice(0,6)}...{wallet.slice(-4)}
                </span>
                <br/>is now linked to your account.
              </div>
              <button className="wb-btn" onClick={onComplete}>CONTINUE TO DASHBOARD →</button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}