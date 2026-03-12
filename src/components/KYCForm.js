import React, { useState, useEffect, useRef, useContext } from 'react';
import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
import { auth } from '../firebaseConfigure';
import { AuthContext } from '../App';
import { useNotifications } from '../context/NotificationContext';
import { ethers } from 'ethers';

const STEPS = ['IDENTITY', 'DOCUMENT', 'PHONE', 'REVIEW'];

const KYCForm = ({ onComplete }) => {
  const { user, setUser, handleKycComplete, dbUser } = useContext(AuthContext);
  const { addNotification, NOTIF_TYPES } = useNotifications();

  const [step, setStep] = useState(0);

  const [fullName, setFullName] = useState(dbUser?.full_name || user?.name || '');
  const [idType,   setIdType]   = useState('');
  const [idNumber, setIdNumber] = useState('');

  const [docFile,    setDocFile]    = useState(null);
  const [docPreview, setDocPreview] = useState('');

  const [phone,        setPhone]        = useState('');
  const [otp,          setOtp]          = useState('');
  const [otpSent,      setOtpSent]      = useState(false);
  const [otpVerified,  setOtpVerified]  = useState(false);
  const [confirmResult,setConfirmResult]= useState(null);
  const [sendingOtp,   setSendingOtp]   = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [otpTimer,     setOtpTimer]     = useState(0);

  const [submitting,  setSubmitting]  = useState(false);
  const [submitted,   setSubmitted]   = useState(false);
  const [submitStep,  setSubmitStep]  = useState('');
  const [submitError, setSubmitError] = useState('');

  const [errors, setErrors] = useState({});

  const recaptchaRef = useRef(null);
  const timerRef     = useRef(null);

  useEffect(() => {
    return () => {
      if (window.recaptchaVerifier) {
        try { window.recaptchaVerifier.clear(); } catch {}
        window.recaptchaVerifier = null;
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startTimer = () => {
    setOtpTimer(60);
    timerRef.current = setInterval(() => {
      setOtpTimer(prev => {
        if (prev <= 1) { clearInterval(timerRef.current); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const setupRecaptcha = () => {
    if (window.recaptchaVerifier) {
      try { window.recaptchaVerifier.clear(); } catch {}
      window.recaptchaVerifier = null;
    }
    const container = document.getElementById('recaptcha-container');
    if (container) container.innerHTML = '';
    window.recaptchaVerifier = new RecaptchaVerifier(auth, 'recaptcha-container', {
      size: 'invisible',
      callback: () => {},
      'expired-callback': () => {
        setErrors({ otp: 'reCAPTCHA expired. Please try again.' });
        window.recaptchaVerifier = null;
      },
    });
  };

  const handleSendOtp = async () => {
    const formatted  = phone.startsWith('+') ? phone : `+91${phone}`;
    const phoneRegex = /^\+91[6-9]\d{9}$/;
    if (!phone)                      { setErrors({ phone: 'Phone number is required.' }); return; }
    if (!phoneRegex.test(formatted)) { setErrors({ phone: 'Enter a valid 10-digit Indian mobile number.' }); return; }
    setSendingOtp(true); setErrors({});
    try {
      setupRecaptcha();
      const result = await signInWithPhoneNumber(auth, formatted, window.recaptchaVerifier);
      setConfirmResult(result);
      setOtpSent(true);
      startTimer();
    } catch (err) {
      let msg = 'Failed to send OTP. Please try again.';
      if (err.code === 'auth/invalid-phone-number') msg = 'Invalid phone number format.';
      if (err.code === 'auth/too-many-requests')    msg = 'Too many attempts. Please wait a few minutes.';
      if (err.code === 'auth/quota-exceeded')       msg = 'SMS quota exceeded. Try again later.';
      setErrors({ phone: msg });
    } finally { setSendingOtp(false); }
  };

  const handleVerifyOtp = async () => {
    if (!otp || otp.length !== 6) { setErrors({ otp: 'Enter the 6-digit OTP.' }); return; }
    if (!confirmResult)           { setErrors({ otp: 'Please request OTP first.' }); return; }
    setVerifyingOtp(true); setErrors({});
    try {
      await confirmResult.confirm(otp);
      setOtpVerified(true);
    } catch (err) {
      let msg = 'Invalid OTP. Please try again.';
      if (err.code === 'auth/code-expired') msg = 'OTP expired. Please resend.';
      setErrors({ otp: msg });
    } finally { setVerifyingOtp(false); }
  };

  const handleResendOtp = async () => {
    setOtp(''); setOtpSent(false); setConfirmResult(null);
    if (timerRef.current) clearInterval(timerRef.current);
    await handleSendOtp();
  };

  const handleDocUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setErrors({ doc: 'File too large. Max 5MB.' }); return; }
    setDocFile(file); setErrors({});
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (ev) => setDocPreview(ev.target.result);
      reader.readAsDataURL(file);
    } else { setDocPreview(''); }
  };

  const validateStep = () => {
    const newErrors = {};
    if (step === 0) {
      if (!fullName.trim()) newErrors.fullName = 'Full name is required.';
      if (!idType)          newErrors.idType   = 'Please select an ID type.';
      if (!idNumber.trim()) newErrors.idNumber = 'ID number is required.';
      if (idType === 'aadhaar' && !/^\d{12}$/.test(idNumber.replace(/\s/g,'')))
        newErrors.idNumber = 'Aadhaar must be 12 digits.';
      if (idType === 'pan' && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(idNumber.toUpperCase()))
        newErrors.idNumber = 'PAN format: ABCDE1234F';
    }
    if (step === 1) { if (!docFile) newErrors.doc = 'Please upload your ID document.'; }
    if (step === 2) { if (!otpVerified) newErrors.otp = 'Please verify your phone number.'; }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const nextStep = () => { if (validateStep()) setStep(s => s + 1); };
  const prevStep = () => { setStep(s => s - 1); setErrors({}); };

  // ── Upload doc to Pinata IPFS ─────────────────────────────────
  const uploadDocToIPFS = async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('pinataMetadata', JSON.stringify({
      name: `kyc_doc_${dbUser?.id || 'user'}_${Date.now()}`,
    }));
    formData.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));

    const res = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: {
        pinata_api_key:        process.env.REACT_APP_PINATA_API_KEY,
        pinata_secret_api_key: process.env.REACT_APP_PINATA_SECRET_KEY,
      },
      body: formData,
    });

    if (!res.ok) throw new Error('IPFS upload failed');
    const data = await res.json();
    return data.IpfsHash;
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError('');
    try {
      // ── Step 1: Upload doc to IPFS ────────────────────────────
      setSubmitStep('Uploading document to IPFS...');
      const docIpfsHash = await uploadDocToIPFS(docFile);

      // ── Step 2: Generate hashes (never send raw ID) ───────────
      setSubmitStep('Generating cryptographic hashes...');
      const normalizedId = idType === 'pan'
        ? idNumber.toUpperCase()
        : idNumber.replace(/\s/g, '');
      const kycDataHash = ethers.keccak256(
        ethers.toUtf8Bytes(`${idType}:${normalizedId}:${phone}:${fullName}`)
      );
      const idHash     = ethers.keccak256(ethers.toUtf8Bytes(`${idType}:${normalizedId}`));
      const aadhaarHash = idType === 'aadhaar' ? idHash : null;
      const panHash     = idType === 'pan'     ? idHash : null;

      // ── Step 3: Submit to backend ─────────────────────────────
      setSubmitStep('Submitting KYC for admin review...');
      const res = await fetch(`${process.env.REACT_APP_API_URL}/api/kyc/submit`, {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName,
          idType,
          phone:        `+91${phone}`,
          kycDataHash,
          aadhaarHash,
          panHash,
          docIpfsHash,
        }),
      });

      const data = await res.json();

      if (res.status === 409) {
        setSubmitError('These KYC credentials are already verified with another account. Contact support if this is an error.');
        setSubmitting(false); setSubmitStep('');
        return;
      }

      if (!res.ok) {
        throw new Error(data.error || 'Submission failed');
      }

      // ── Step 4: Update local state ────────────────────────────
      setSubmitStep('Finalising...');

      addNotification({
        type:    NOTIF_TYPES.KYC,
        title:   'KYC Submitted ✅',
        message: 'Your KYC is under review. You will be notified within 1-2 business days.',
      });

      setSubmitting(false);
      setSubmitStep('');
      setSubmitted(true);

    } catch (err) {
      console.error('KYC submit error:', err);
      setSubmitError(err.message || 'Submission failed. Please try again.');
      setSubmitting(false);
      setSubmitStep('');
    }
  };

  const progress = ((step + 1) / STEPS.length) * 100;

  // ── Submitted — Under Review Screen ──────────────────────────
  if (submitted) {
    return (
      <div style={S.page}>
        <div style={S.card}>
          <div style={{ textAlign:'center', padding:'8px 0 24px' }}>
            <div style={{ fontSize:56, marginBottom:16 }}>⏳</div>
            <div style={{ fontSize:9, color:'#facc1577', letterSpacing:'.2em', marginBottom:8 }}>
              KYC SUBMITTED SUCCESSFULLY
            </div>
            <div style={{ fontSize:22, fontWeight:500, color:'#f0fdf4', marginBottom:12, letterSpacing:'.02em' }}>
              Under <span style={{ color:'#facc15' }}>Review</span>
            </div>
            <div style={{ fontSize:11, color:'#86efac77', lineHeight:1.9, marginBottom:24 }}>
              Your KYC submission has been received.<br/>
              Our compliance team will verify your details<br/>
              within <span style={{ color:'#facc15' }}>1–2 business days</span>.
            </div>

            {/* Status steps */}
            {[
              { icon:'✅', label:'KYC Submitted',        done: true  },
              { icon:'🔍', label:'Admin Verification',   done: false },
              { icon:'📧', label:'Email Notification',   done: false },
              { icon:'🚀', label:'Portfolio Unlocked',   done: false },
            ].map(({ icon, label, done }) => (
              <div key={label} style={{
                display:'flex', alignItems:'center', gap:12,
                padding:'10px 14px', marginBottom:6,
                background: done ? '#0d2e1f22' : '#0a0f0c',
                border: `1px solid ${done ? '#22c55e33' : '#0f2a1a'}`,
                borderRadius:8, textAlign:'left',
              }}>
                <span style={{ fontSize:16 }}>{icon}</span>
                <span style={{ fontSize:11, color: done ? '#22c55e' : '#86efac44', flex:1 }}>{label}</span>
                {done
                  ? <span style={{ fontSize:9, color:'#22c55e77', letterSpacing:'.08em' }}>DONE</span>
                  : <span style={{ fontSize:9, color:'#86efac33', letterSpacing:'.08em' }}>PENDING</span>
                }
              </div>
            ))}

            <div style={{
              marginTop:20, padding:'12px 16px', borderRadius:8,
              background:'#040706', border:'1px solid #0f2a1a',
              fontSize:10, color:'#86efac55', lineHeight:1.8,
            }}>
              📧 You'll receive an email at <span style={{ color:'#86efac88' }}>
                {dbUser?.email || user?.email}
              </span> once verified.<br/>
              Until then, some features will remain locked.
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <div id="recaptcha-container" ref={recaptchaRef} />
      <div style={S.card}>
        <div style={S.label}>KYC VERIFICATION · ETHERTRACK</div>
        <div style={S.title}>
          {step === 0 && 'Identity Details'}
          {step === 1 && 'Upload Document'}
          {step === 2 && 'Verify Phone'}
          {step === 3 && 'Review & Submit'}
        </div>
        <div style={S.sub}>Step {step + 1} of {STEPS.length}</div>

        <div style={S.progressBg}>
          <div style={{ ...S.progressFill, width:`${progress}%` }}/>
        </div>

        <div style={S.steps}>
          {STEPS.map((s, i) => (
            <div key={s} style={{ ...S.stepDot, ...(i <= step ? S.stepDotActive : {}) }}>
              {i < step ? '✓' : i + 1}
            </div>
          ))}
        </div>

        {/* ── STEP 0: Identity ── */}
        {step === 0 && (
          <div style={S.fields}>
            <div style={S.field}>
              <label style={S.fieldLabel}>FULL NAME</label>
              <input style={{ ...S.input, ...(errors.fullName ? S.inputError : {}) }}
                placeholder="As on your government ID"
                value={fullName} onChange={e => setFullName(e.target.value)}/>
              {errors.fullName && <div style={S.errMsg}>{errors.fullName}</div>}
            </div>
            <div style={S.field}>
              <label style={S.fieldLabel}>ID TYPE</label>
              <select style={{ ...S.input, ...(errors.idType ? S.inputError : {}) }}
                value={idType} onChange={e => { setIdType(e.target.value); setIdNumber(''); }}>
                <option value="">Select ID type</option>
                <option value="aadhaar">Aadhaar Card</option>
                <option value="pan">PAN Card</option>
                <option value="passport">Passport</option>
                <option value="driving">Driving License</option>
                <option value="voter">Voter ID</option>
              </select>
              {errors.idType && <div style={S.errMsg}>{errors.idType}</div>}
            </div>
            <div style={S.field}>
              <label style={S.fieldLabel}>ID NUMBER</label>
              <input style={{ ...S.input, ...(errors.idNumber ? S.inputError : {}) }}
                placeholder={
                  idType==='aadhaar' ? 'XXXX XXXX XXXX (12 digits)' :
                  idType==='pan'     ? 'ABCDE1234F' :
                  idType==='passport'? 'A1234567' : 'Enter ID number'
                }
                value={idNumber}
                onChange={e => setIdNumber(
                  idType === 'pan' ? e.target.value.toUpperCase() : e.target.value
                )}/>
              {errors.idNumber && <div style={S.errMsg}>{errors.idNumber}</div>}
              <div style={{ fontSize:9, color:'#86efac33', marginTop:4, lineHeight:1.6 }}>
                🔒 Your ID number is never stored — only a one-way cryptographic hash is recorded.
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 1: Document ── */}
        {step === 1 && (
          <div style={S.fields}>
            <div style={S.field}>
              <label style={S.fieldLabel}>UPLOAD DOCUMENT</label>
              <div style={{ ...S.uploadBox, ...(errors.doc ? S.inputError : {}) }}>
                {docPreview ? (
                  <img src={docPreview} alt="doc" style={{ maxHeight:140, borderRadius:6, objectFit:'contain' }}/>
                ) : (
                  <>
                    <div style={{ fontSize:32, marginBottom:8 }}>📄</div>
                    <div style={{ fontSize:11, color:'#4ade8066', marginBottom:4 }}>
                      {docFile ? docFile.name : 'Click or drag to upload'}
                    </div>
                    <div style={{ fontSize:10, color:'#4ade8033' }}>JPG, PNG, PDF — max 5MB</div>
                  </>
                )}
                <input type="file" accept="image/*,.pdf" onChange={handleDocUpload}
                  style={{ position:'absolute', inset:0, opacity:0, cursor:'pointer' }}/>
              </div>
              {errors.doc && <div style={S.errMsg}>{errors.doc}</div>}
              {docFile && <div style={{ fontSize:10, color:'#22c55e', marginTop:6 }}>✓ {docFile.name}</div>}
              <div style={{ fontSize:9, color:'#86efac33', lineHeight:1.6, marginTop:4 }}>
                📤 Document will be securely stored on IPFS. Only our compliance team can view it for verification.
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 2: Phone OTP ── */}
        {step === 2 && (
          <div style={S.fields}>
            <div style={S.field}>
              <label style={S.fieldLabel}>MOBILE NUMBER</label>
              <div style={{ display:'flex', gap:8 }}>
                <div style={{ ...S.input, width:60, textAlign:'center', flexShrink:0, color:'#22c55e' }}>+91</div>
                <input style={{ ...S.input, flex:1, ...(errors.phone ? S.inputError : {}) }}
                  placeholder="10-digit mobile number" value={phone}
                  onChange={e => setPhone(e.target.value.replace(/\D/g,'').slice(0,10))}
                  maxLength={10} disabled={otpSent && !otpVerified}/>
              </div>
              {errors.phone && <div style={S.errMsg}>{errors.phone}</div>}
            </div>
            {!otpSent && (
              <button style={{ ...S.btn, opacity:sendingOtp?0.6:1 }}
                onClick={handleSendOtp} disabled={sendingOtp}>
                {sendingOtp ? 'SENDING OTP...' : 'SEND OTP →'}
              </button>
            )}
            {otpSent && !otpVerified && (
              <div style={S.field}>
                <label style={S.fieldLabel}>
                  ENTER OTP
                  {otpTimer > 0 && <span style={{ color:'#facc15', marginLeft:8 }}>({otpTimer}s)</span>}
                </label>
                <input style={{ ...S.input, letterSpacing:'0.3em', textAlign:'center', fontSize:18, ...(errors.otp?S.inputError:{}) }}
                  placeholder="• • • • • •" value={otp}
                  onChange={e => setOtp(e.target.value.replace(/\D/g,'').slice(0,6))}
                  maxLength={6}/>
                {errors.otp && <div style={S.errMsg}>{errors.otp}</div>}
                <div style={{ display:'flex', gap:8, marginTop:10 }}>
                  <button style={{ ...S.btn, flex:1, opacity:verifyingOtp?0.6:1 }}
                    onClick={handleVerifyOtp} disabled={verifyingOtp}>
                    {verifyingOtp ? 'VERIFYING...' : 'VERIFY OTP'}
                  </button>
                  <button style={{ ...S.btnOutline, flex:1, opacity:otpTimer>0?0.4:1 }}
                    onClick={handleResendOtp} disabled={otpTimer>0}>
                    {otpTimer>0 ? `RESEND (${otpTimer}s)` : 'RESEND OTP'}
                  </button>
                </div>
              </div>
            )}
            {otpVerified && <div style={S.verifiedBadge}>✅ Phone number verified successfully!</div>}
          </div>
        )}

        {/* ── STEP 3: Review ── */}
        {step === 3 && (
          <div style={S.fields}>
            <div style={S.reviewCard}>
              {[
                { label:'FULL NAME',    value: fullName },
                { label:'ID TYPE',      value: idType.toUpperCase() },
                { label:'ID NUMBER',    value: idType === 'aadhaar'
                    ? `${'•'.repeat(8)}${idNumber.slice(-4)}`
                    : idNumber },
                { label:'DOCUMENT',     value: docFile?.name || '—' },
                { label:'PHONE',        value: `+91 ${phone}` },
                { label:'PHONE STATUS', value: otpVerified ? '✅ VERIFIED' : '❌ NOT VERIFIED' },
              ].map(({ label, value }) => (
                <div key={label} style={S.reviewRow}>
                  <span style={S.reviewLabel}>{label}</span>
                  <span style={S.reviewValue}>{value}</span>
                </div>
              ))}
            </div>

            {/* Admin review notice */}
            <div style={{
              background:'#0a1628', border:'1px solid #60a5fa22',
              borderRadius:8, padding:'14px 16px',
            }}>
              <div style={{ fontSize:9, color:'#60a5fa88', letterSpacing:'.12em', marginBottom:8 }}>
                WHAT HAPPENS NEXT
              </div>
              {[
                '📤 Your document is securely uploaded to IPFS',
                '🔍 Our compliance team reviews your details',
                '📧 You receive an email once approved (1–2 business days)',
                '🚀 Portfolio, Market and Emissions pages unlock',
              ].map(t => (
                <div key={t} style={{ fontSize:10, color:'#86efac66', marginBottom:6, lineHeight:1.6 }}>{t}</div>
              ))}
            </div>

            {submitError && (
              <div style={{
                fontSize:10, color:'#f87171', padding:'10px 12px',
                background:'#1a0a0a', borderRadius:6, border:'1px solid #f8717122', lineHeight:1.6,
              }}>
                ⚠️ {submitError}
              </div>
            )}

            {submitting && submitStep && (
              <div style={{
                display:'flex', alignItems:'center', gap:10,
                padding:'10px 14px', background:'#0d2e1f22',
                border:'1px solid #22c55e22', borderRadius:8,
              }}>
                <div style={{
                  width:14, height:14, border:'2px solid #22c55e22',
                  borderTopColor:'#22c55e', borderRadius:'50%',
                  animation:'kycSpin 1s linear infinite', flexShrink:0,
                }}/>
                <span style={{ fontSize:11, color:'#22c55e88' }}>{submitStep}</span>
              </div>
            )}

            <div style={{ fontSize:10, color:'#4ade8055', textAlign:'center', lineHeight:1.7 }}>
              By submitting, you confirm all details are accurate and authentic.<br/>
              🔒 Raw ID numbers are never stored — only cryptographic hashes.
            </div>
            <style>{`@keyframes kycSpin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        <div style={{ display:'flex', gap:10, marginTop:24 }}>
          {step > 0 && (
            <button style={{ ...S.btnOutline, flex:1 }} onClick={prevStep} disabled={submitting}>
              ← BACK
            </button>
          )}
          {step < 3 ? (
            <button style={{ ...S.btn, flex:1 }} onClick={nextStep}>
              NEXT →
            </button>
          ) : (
            <button
              style={{ ...S.btn, flex:1, opacity:submitting?0.6:1 }}
              onClick={handleSubmit}
              disabled={submitting}
            >
              {submitting ? `⟳ ${submitStep||'PROCESSING...'}` : 'SUBMIT FOR REVIEW →'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const S = {
  page: { minHeight:'100vh', background:'#080c0a', fontFamily:"'DM Mono', monospace", display:'flex', alignItems:'center', justifyContent:'center', padding:'40px 16px', backgroundImage:'linear-gradient(rgba(34,197,94,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(34,197,94,0.03) 1px,transparent 1px)', backgroundSize:'40px 40px' },
  card: { background:'#0a0f0c', border:'1px solid #0f2a1a', borderRadius:14, padding:'40px 36px', maxWidth:480, width:'100%', boxShadow:'0 24px 64px rgba(0,0,0,0.6)' },
  label: { fontSize:10, color:'#4ade8044', letterSpacing:'.15em', marginBottom:6 },
  title: { fontSize:22, fontWeight:700, color:'#f0fdf4', marginBottom:4 },
  sub: { fontSize:11, color:'#4ade8055', marginBottom:20, letterSpacing:'.06em' },
  progressBg: { height:3, background:'#0f2a1a', borderRadius:2, marginBottom:16 },
  progressFill: { height:'100%', background:'linear-gradient(90deg,#16a34a,#22c55e)', borderRadius:2, transition:'width .4s ease' },
  steps: { display:'flex', justifyContent:'space-between', marginBottom:28 },
  stepDot: { width:28, height:28, borderRadius:'50%', border:'1px solid #0f2a1a', background:'#060a07', color:'#4ade8033', fontSize:11, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center' },
  stepDotActive: { background:'#0d2e1f', border:'1px solid #22c55e', color:'#22c55e' },
  fields: { display:'flex', flexDirection:'column', gap:16 },
  field: { display:'flex', flexDirection:'column', gap:6 },
  fieldLabel: { fontSize:10, color:'#4ade8055', letterSpacing:'.12em' },
  input: { padding:'11px 14px', borderRadius:7, border:'1px solid #0f2a1a', background:'#060a07', color:'#f0fdf4', fontFamily:"'DM Mono', monospace", fontSize:12, letterSpacing:'.04em', outline:'none', transition:'border-color .2s', width:'100%', boxSizing:'border-box' },
  inputError: { borderColor:'#dc2626' },
  errMsg: { fontSize:10, color:'#f87171', letterSpacing:'.04em' },
  uploadBox: { position:'relative', border:'1px dashed #0f2a1a', borderRadius:8, padding:'28px 16px', textAlign:'center', background:'#060a07', cursor:'pointer', transition:'border-color .2s', display:'flex', flexDirection:'column', alignItems:'center' },
  btn: { padding:'13px', borderRadius:8, border:'none', background:'linear-gradient(135deg,#16a34a,#15803d)', color:'#fff', cursor:'pointer', fontFamily:"'DM Mono', monospace", fontSize:12, fontWeight:700, letterSpacing:'.1em', transition:'opacity .2s' },
  btnOutline: { padding:'13px', borderRadius:8, border:'1px solid #0f2a1a', background:'transparent', color:'#4ade8077', cursor:'pointer', fontFamily:"'DM Mono', monospace", fontSize:12, letterSpacing:'.08em', transition:'all .2s' },
  verifiedBadge: { padding:'12px 16px', borderRadius:8, background:'#0d2e1f', border:'1px solid #22c55e33', color:'#22c55e', fontSize:12, textAlign:'center', letterSpacing:'.04em' },
  reviewCard: { background:'#060a07', border:'1px solid #0f2a1a', borderRadius:8, overflow:'hidden' },
  reviewRow: { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 14px', borderBottom:'1px solid #0f2a1a18' },
  reviewLabel: { fontSize:10, color:'#4ade8044', letterSpacing:'.1em' },
  reviewValue: { fontSize:11, color:'#f0fdf4', fontWeight:700, maxWidth:220, textAlign:'right', wordBreak:'break-all' },
};

export default KYCForm;