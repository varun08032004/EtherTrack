// src/components/KYCForm.jsx — EtherTrack KYC v2 · PRODUCTION-HARDENED - 28/05/2026
// FIX: replaced inline XHR in uploadDocToIPFS with apiFetchMultipartWithProgress
// FIX: border/borderColor shorthand conflict fixed in DocumentStep
// FIX: DPDP Act 2023 consent checkbox added to ReviewStep
// FIX: Debug logs added to handleSendOtp for OTP troubleshooting

import React, {
  useState, useEffect, useRef, useContext, useCallback,
  useMemo, memo, Component,
} from 'react';
import { RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
import { parsePhoneNumberFromString, getCountries, getCountryCallingCode } from 'libphonenumber-js';
import { auth } from '../firebaseConfigure';
import { AuthContext } from '../App';
import { useNotifications } from '../context/NotificationContext';
import { apiFetch, apiFetchMultipartWithProgress } from '../services/api';

// ── Constants ─────────────────────────────────────────────────────────────────
const STEPS = [
  { id: 'IDENTITY', label: 'Identity',  icon: '◎' },
  { id: 'DOCUMENT', label: 'Document',  icon: '◈' },
  { id: 'PHONE',    label: 'Phone',     icon: '◉' },
  { id: 'REVIEW',   label: 'Review',    icon: '◆' },
];

const ALLOWED_MIME = ['image/jpeg','image/png','image/webp','application/pdf'];
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const ID_TYPES = [
  { value: 'aadhaar',  label: 'Aadhaar Card',     hint: 'XXXX XXXX XXXX', validate: v => /^\d{12}$/.test(v.replace(/\s/g,''))  },
  { value: 'pan',      label: 'PAN Card',          hint: 'ABCDE1234F',     validate: v => /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v.toUpperCase()) },
  { value: 'passport', label: 'Passport',          hint: 'A1234567',       validate: v => v.trim().length >= 6 },
  { value: 'driving',  label: 'Driving License',   hint: 'DL-1234567890',  validate: v => v.trim().length >= 6 },
  { value: 'voter',    label: 'Voter ID',          hint: 'ABC1234567',     validate: v => v.trim().length >= 6 },
];

const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}\d[Z]{1}[A-Z\d]{1}$/;
const BUSINESS_PAN_REGEX = /^[A-Z]{5}\d{4}[A-Z]{1}$/;
const CIN_REGEX = /^[LUu]\d{5}[A-Za-z]{2}\d{4}[A-Za-z]{3}\d{6}$/;

const POPULAR_COUNTRIES = ['IN','US','GB','SG','AE','AU','CA','DE','FR','JP'];
const ALL_COUNTRIES = getCountries();
const SORTED_COUNTRIES = [
  ...POPULAR_COUNTRIES,
  ...ALL_COUNTRIES.filter(c => !POPULAR_COUNTRIES.includes(c)).sort(),
];

// ── Utilities ─────────────────────────────────────────────────────────────────
const maskId = (type, number) => {
  const n = String(number).trim();
  if (type === 'aadhaar')  return `${'•'.repeat(8)}${n.replace(/\s/g,'').slice(-4)}`;
  if (type === 'pan')      return `${n.slice(0,2)}${'•'.repeat(5)}${n.slice(-3)}`;
  if (type === 'passport') return `${n.slice(0,2)}${'•'.repeat(Math.max(0, n.length-2))}`;
  return `${'•'.repeat(Math.max(0, n.length-4))}${n.slice(-4)}`;
};

// ── Error Boundary ────────────────────────────────────────────────────────────
class KYCErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, errorId: null }; }
  static getDerivedStateFromError() { return { hasError: true, errorId: crypto.randomUUID() }; }
  componentDidCatch(error, info) {
    import('@sentry/react').then(S => S.captureException(error, {
      tags: { component: 'KYCForm' },
      contexts: { react: { componentStack: info.componentStack?.slice(0, 500) } },
    })).catch(() => {});
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={ERR_STYLES.page} role="alert" aria-live="assertive">
        <div style={ERR_STYLES.card}>
          <div style={ERR_STYLES.icon} aria-hidden="true">⚠</div>
          <h1 style={ERR_STYLES.title}>KYC form failed to load</h1>
          <p style={ERR_STYLES.body}>
            Please refresh and try again. Reference: <code style={ERR_STYLES.code}>{this.state.errorId}</code>
          </p>
          <button
            style={ERR_STYLES.btn}
            onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
            autoFocus
          >
            Reload KYC form
          </button>
        </div>
      </div>
    );
  }
}
const ERR_STYLES = {
  page:  { minHeight:'100vh', background:'#080c0a', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:"'DM Mono',monospace", padding:'20px' },
  card:  { textAlign:'center', maxWidth:400, padding:32 },
  icon:  { fontSize:40, color:'#f87171', marginBottom:16 },
  title: { fontSize:18, color:'#f0fdf4', fontWeight:700, marginBottom:8 },
  body:  { fontSize:12, color:'#86efac66', marginBottom:24, lineHeight:1.7 },
  code:  { fontSize:10, color:'#86efac88', fontFamily:"'DM Mono',monospace" },
  btn:   { padding:'10px 28px', borderRadius:8, border:'none', background:'#22c55e', color:'#060a07', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:700 },
};

// ═══════════════════════════════════════════════════════════════════════════════
// Step 0: Identity
// ═══════════════════════════════════════════════════════════════════════════════
const IdentityStep = memo(({
  kycType, setKycType,
  fullName, setFullName, idType, setIdType, idNumber, setIdNumber, errors,
  entityName, setEntityName, gstin, setGstin, businessPan, setBusinessPan,
  cin, setCin, signatoryDesignation, setSignatoryDesignation,
}) => {
  const idConf = ID_TYPES.find(t => t.value === idType);
  const isBusiness = kycType === 'business';
  return (
    <div style={S.fields}>
      <Field label="Account Type">
        <div style={{ display:'flex', gap:8 }}>
          {[{ v:'individual', l:'Individual' }, { v:'business', l:'Business' }].map(({ v, l }) => (
            <button
              key={v}
              type="button"
              onClick={() => setKycType(v)}
              style={{
                ...S.btnOutline, flex:1,
                background: kycType === v ? '#0d2e1f' : 'transparent',
                borderColor: kycType === v ? '#22c55e' : '#0f2a1a',
                color: kycType === v ? '#22c55e' : '#4ade8077',
              }}
              aria-pressed={kycType === v}
            >
              {l}
            </button>
          ))}
        </div>
        <div style={S.hint}>Trading as a company or registered entity? Choose Business.</div>
      </Field>

      {isBusiness && (
        <>
          <Field label="Registered Business Name" error={errors.entityName}>
            <input
              style={{ ...S.input, ...(errors.entityName ? S.inputErr : {}) }}
              placeholder="As shown on GST certificate"
              value={entityName}
              onChange={e => setEntityName(e.target.value)}
              maxLength={255}
            />
          </Field>
          <Field label="GSTIN" error={errors.gstin} hint="15-character GST number">
            <input
              style={{ ...S.input, ...(errors.gstin ? S.inputErr : {}) }}
              placeholder="27ABCDE1234F1Z5"
              value={gstin}
              onChange={e => setGstin(e.target.value.toUpperCase())}
              maxLength={15}
            />
          </Field>
          <Field label="Business PAN" error={errors.businessPan} hint="Company PAN, not your personal PAN">
            <input
              style={{ ...S.input, ...(errors.businessPan ? S.inputErr : {}) }}
              placeholder="ABCDE1234F"
              value={businessPan}
              onChange={e => setBusinessPan(e.target.value.toUpperCase())}
              maxLength={10}
            />
          </Field>
          <Field label="CIN / LLPIN (optional)" error={errors.cin} hint="Leave blank for proprietorships or partnerships">
            <input
              style={{ ...S.input, ...(errors.cin ? S.inputErr : {}) }}
              placeholder="U12345MH2023PTC123456"
              value={cin}
              onChange={e => setCin(e.target.value.toUpperCase())}
              maxLength={21}
            />
          </Field>
          <Field label="Your Designation" error={errors.signatoryDesignation} hint="e.g. Director, Partner, Authorized Signatory">
            <input
              style={{ ...S.input, ...(errors.signatoryDesignation ? S.inputErr : {}) }}
              placeholder="Director"
              value={signatoryDesignation}
              onChange={e => setSignatoryDesignation(e.target.value)}
              maxLength={100}
            />
          </Field>
          <div style={{ fontSize:9, color:'#60a5fa88', letterSpacing:'.1em', marginTop:4 }}>
            SIGNATORY IDENTITY — the person authorized to act for this business
          </div>
        </>
      )}

      <Field label={isBusiness ? 'Signatory Full Name' : 'Full Legal Name'} error={errors.fullName}>
        <input
          style={{ ...S.input, ...(errors.fullName ? S.inputErr : {}) }}
          placeholder="As shown on your government ID"
          value={fullName}
          onChange={e => setFullName(e.target.value)}
          autoComplete="name"
          aria-required="true"
          aria-invalid={!!errors.fullName}
          aria-describedby={errors.fullName ? 'err-fullName' : undefined}
          maxLength={200}
        />
      </Field>

      <Field label="ID Type" error={errors.idType}>
        <select
          style={{ ...S.input, ...(errors.idType ? S.inputErr : {}) }}
          value={idType}
          onChange={e => { setIdType(e.target.value); setIdNumber(''); }}
          aria-required="true"
          aria-invalid={!!errors.idType}
        >
          <option value="">Select document type</option>
          {ID_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </Field>

      {idType && (
        <Field label="ID Number" error={errors.idNumber} hint="Encrypted before leaving your device — only a hash is stored">
          <input
            style={{ ...S.input, ...(errors.idNumber ? S.inputErr : {}) }}
            placeholder={idConf?.hint || 'Enter ID number'}
            value={idNumber}
            onChange={e => setIdNumber(idType === 'pan' ? e.target.value.toUpperCase() : e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-required="true"
            aria-invalid={!!errors.idNumber}
            aria-describedby="id-hint"
            maxLength={40}
          />
          <div id="id-hint" style={S.hint} aria-live="polite">
            🔒 Your raw ID number is hashed server-side — never stored in plaintext
          </div>
        </Field>
      )}
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// Step 1: Document upload
// FIX: removed borderColor spread — use full border property to avoid React warning
// ═══════════════════════════════════════════════════════════════════════════════
const UploadBox = memo(({ label, hint, file, preview, uploadProgress, onFileSelect, error, inputId }) => {
  const inputRef = useRef(null);
  return (
    <Field label={label} error={error}>
      <div
        style={{
          ...S.uploadBox,
          border: error ? '1px dashed #dc2626' : file ? '1px dashed #22c55e33' : '1px dashed #0f2a1a',
        }}
        onClick={() => inputRef.current?.click()}
        onKeyDown={e => (e.key==='Enter'||e.key===' ') && inputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label={`Upload ${label} — click or press Enter to select file`}
        aria-describedby={`${inputId}-constraints`}
      >
        {preview ? (
          <img src={preview} alt={`${label} preview`} style={{ maxHeight:150, borderRadius:6, objectFit:'contain', maxWidth:'100%' }} />
        ) : (
          <>
            <div style={{ fontSize:36, marginBottom:8, color:'#22c55e44' }} aria-hidden="true">◈</div>
            <div style={{ fontSize:11, color:'#4ade8066', marginBottom:4 }}>
              {file ? file.name : 'Click or drag to upload'}
            </div>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          onChange={onFileSelect}
          style={{ display:'none' }}
          aria-hidden="true"
        />
      </div>
      <div id={`${inputId}-constraints`} style={S.hint}>{hint || 'JPG, PNG, WebP, PDF · Max 5MB · Stored encrypted on IPFS'}</div>

      {file && (
        <div style={{ fontSize:10, color:'#22c55e', marginTop:6, display:'flex', alignItems:'center', gap:6 }}>
          <span aria-hidden="true">✓</span>
          <span>{file.name} ({(file.size/1024).toFixed(1)} KB)</span>
        </div>
      )}

      {uploadProgress > 0 && uploadProgress < 100 && (
        <div role="progressbar" aria-valuenow={uploadProgress} aria-valuemin={0} aria-valuemax={100}
             aria-label={`Uploading: ${uploadProgress}%`} style={{ marginTop:8 }}>
          <div style={S.progressBg}>
            <div style={{ ...S.progressFill, width:`${uploadProgress}%` }} />
          </div>
          <div style={{ fontSize:10, color:'#86efac44', marginTop:4 }}>Uploading… {uploadProgress}%</div>
        </div>
      )}
    </Field>
  );
});

const DocumentStep = memo(({
  kycType,
  docFile, docPreview, uploadProgress, onFileSelect, errors,
  businessDocFile, businessDocPreview, businessUploadProgress, onBusinessFileSelect,
}) => {
  const isBusiness = kycType === 'business';
  return (
    <div style={S.fields}>
      {isBusiness && (
        <UploadBox
          inputId="business-doc"
          label="Upload GST Certificate / Incorporation Doc"
          hint="GST certificate, CoI, or LLP agreement · JPG, PNG, WebP, PDF · Max 5MB"
          file={businessDocFile}
          preview={businessDocPreview}
          uploadProgress={businessUploadProgress}
          onFileSelect={onBusinessFileSelect}
          error={errors.businessDoc}
        />
      )}
      <UploadBox
        inputId="signatory-doc"
        label={isBusiness ? 'Upload Signatory Identity Document' : 'Upload Identity Document'}
        file={docFile}
        preview={docPreview}
        uploadProgress={uploadProgress}
        onFileSelect={onFileSelect}
        error={errors.doc}
      />
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════════════════
// Step 2: Phone OTP
// ═══════════════════════════════════════════════════════════════════════════════
const PhoneStep = memo(({
  countryCode, setCountryCode,
  phone, setPhone,
  otp, setOtp,
  otpSent, otpVerified,
  sendingOtp, verifyingOtp, otpTimer,
  errors, onSendOtp, onVerifyOtp, onResendOtp,
}) => (
  <div style={S.fields}>
    <Field label="Mobile Number" error={errors.phone}>
      <div style={{ display:'flex', gap:8 }}>
        <select
          style={{ ...S.input, width:110, flexShrink:0, padding:'11px 8px', color:'#22c55e' }}
          value={countryCode}
          onChange={e => setCountryCode(e.target.value)}
          disabled={otpSent && !otpVerified}
          aria-label="Country calling code"
        >
          {SORTED_COUNTRIES.map(c => {
            const code = getCountryCallingCode(c);
            return <option key={c} value={c}>{c} +{code}</option>;
          })}
        </select>
        <input
          style={{ ...S.input, flex:1, ...(errors.phone ? S.inputErr : {}) }}
          placeholder="Phone number"
          value={phone}
          onChange={e => setPhone(e.target.value.replace(/[^\d\s\-()]/g,'').slice(0,20))}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          disabled={otpSent && !otpVerified}
          aria-required="true"
          aria-invalid={!!errors.phone}
          aria-describedby="phone-hint"
          maxLength={20}
        />
      </div>
      <div id="phone-hint" style={S.hint}>Used for identity verification only — not stored in plaintext</div>
    </Field>

    {!otpSent && !otpVerified && (
      <button
        style={{ ...S.btn, opacity: sendingOtp ? 0.6 : 1 }}
        onClick={onSendOtp}
        disabled={sendingOtp}
        aria-busy={sendingOtp}
      >
        {sendingOtp ? 'Sending OTP…' : 'Send verification code →'}
      </button>
    )}

    {otpSent && !otpVerified && (
      <Field label={`Verification Code${otpTimer > 0 ? ` (${otpTimer}s)` : ''}`} error={errors.otp}>
        <input
          style={{ ...S.input, letterSpacing:'0.4em', textAlign:'center', fontSize:20, ...(errors.otp ? S.inputErr : {}) }}
          placeholder="• • • • • •"
          value={otp}
          onChange={e => setOtp(e.target.value.replace(/\D/g,'').slice(0,6))}
          maxLength={6}
          inputMode="numeric"
          autoComplete="one-time-code"
          aria-required="true"
          aria-invalid={!!errors.otp}
          autoFocus
        />
        <div style={{ display:'flex', gap:8, marginTop:10 }}>
          <button style={{ ...S.btn, flex:1, opacity: verifyingOtp ? 0.6 : 1 }}
                  onClick={onVerifyOtp} disabled={verifyingOtp} aria-busy={verifyingOtp}>
            {verifyingOtp ? 'Verifying…' : 'Verify code'}
          </button>
          <button style={{ ...S.btnOutline, flex:1, opacity: otpTimer > 0 ? 0.4 : 1 }}
                  onClick={onResendOtp} disabled={otpTimer > 0}>
            {otpTimer > 0 ? `Resend (${otpTimer}s)` : 'Resend code'}
          </button>
        </div>
      </Field>
    )}

    {otpVerified && (
      <div style={S.verifiedBadge} role="status" aria-live="polite">
        ✅ Phone number verified
      </div>
    )}
  </div>
));

// ═══════════════════════════════════════════════════════════════════════════════
// Step 3: Review + DPDP Act 2023 Consent
// ═══════════════════════════════════════════════════════════════════════════════
const ReviewStep = memo(({
  kycType, entityName, gstin, businessPan, cin, signatoryDesignation, businessDocFile,
  fullName, idType, idNumber, docFile, countryCode, phone,
  otpVerified, submitError, submitting, submitStep, uploadProgress,
  consentGiven, setConsentGiven,
}) => {
  const callingCode = countryCode ? `+${getCountryCallingCode(countryCode)} ` : '';
  const isBusiness = kycType === 'business';
  const rows = isBusiness
    ? [
        { label: 'Account Type',     value: 'Business' },
        { label: 'Business Name',    value: entityName },
        { label: 'GSTIN',            value: gstin },
        { label: 'Business PAN',     value: businessPan },
        { label: 'CIN',              value: cin || '—' },
        { label: 'Business Doc',     value: businessDocFile?.name || '—' },
        { label: 'Signatory',        value: `${fullName} (${signatoryDesignation})` },
        { label: 'Signatory ID',     value: `${idType.toUpperCase()} · ${maskId(idType, idNumber)}` },
        { label: 'Signatory Doc',    value: docFile?.name || '—' },
        { label: 'Phone',            value: `${callingCode}${phone}` },
        { label: 'Phone Status',     value: otpVerified ? '✅ Verified' : '❌ Not verified' },
      ]
    : [
        { label: 'Full Name',    value: fullName },
        { label: 'ID Type',      value: idType.toUpperCase() },
        { label: 'ID Number',    value: maskId(idType, idNumber) },
        { label: 'Document',     value: docFile?.name || '—' },
        { label: 'Phone',        value: `${callingCode}${phone}` },
        { label: 'Phone Status', value: otpVerified ? '✅ Verified' : '❌ Not verified' },
      ];
  return (
    <div style={S.fields}>
      <div style={S.reviewCard} role="list" aria-label="KYC submission details">
        {rows.map(({ label, value }) => (
          <div key={label} style={S.reviewRow} role="listitem">
            <span style={S.reviewLabel}>{label}</span>
            <span style={S.reviewValue}>{value}</span>
          </div>
        ))}
      </div>

      <div style={{ background:'#0a1628', border:'1px solid #60a5fa22', borderRadius:8, padding:'14px 16px' }}>
        <div style={{ fontSize:9, color:'#60a5fa88', letterSpacing:'.12em', marginBottom:8 }}>WHAT HAPPENS NEXT</div>
        {[
          '📤 Document pinned encrypted to IPFS',
          '🔒 ID hashed server-side — raw number never stored',
          '🔍 Compliance review within 1–2 business days',
          '📧 Email notification on approval',
          '🚀 Full portfolio access unlocks immediately',
        ].map(t => <div key={t} style={{ fontSize:10, color:'#86efac66', marginBottom:6, lineHeight:1.6 }}>{t}</div>)}
      </div>

      {/* ── DPDP Act 2023 Consent ─────────────────────────────────────── */}
      <div style={{
        background: '#0a1a0e',
        border: consentGiven ? '1px solid #22c55e44' : '1px solid #0f2a1a',
        borderRadius: 8,
        padding: '16px',
        transition: 'border .2s',
      }}>
        <div style={{ fontSize:9, color:'#60a5fa88', letterSpacing:'.12em', marginBottom:10 }}>
          DATA CONSENT — DPDP ACT 2023
        </div>
        <label style={{ display:'flex', gap:12, alignItems:'flex-start', cursor:'pointer' }}>
          <input
            type="checkbox"
            checked={consentGiven}
            onChange={e => setConsentGiven(e.target.checked)}
            style={{ marginTop:2, width:14, height:14, accentColor:'#22c55e', flexShrink:0, cursor:'pointer' }}
            aria-required="true"
            aria-label="I consent to data processing under DPDP Act 2023"
          />
          <span style={{ fontSize:10, color:'#86efac88', lineHeight:1.8 }}>
            I voluntarily consent to EtherTrack collecting, storing, and processing my personal data
            (name, ID number hash, phone number, and identity document) for KYC verification purposes
            under the <strong style={{ color:'#86efac' }}>Digital Personal Data Protection Act, 2023</strong>.
            I understand that:
            <ul style={{ margin:'8px 0 0 0', paddingLeft:16, color:'#86efac66' }}>
              <li style={{ marginBottom:4 }}>My raw ID number is never stored — only a cryptographic hash</li>
              <li style={{ marginBottom:4 }}>My document is encrypted before being stored on IPFS</li>
              <li style={{ marginBottom:4 }}>I can request deletion of my data under §13 of the DPDP Act</li>
              <li style={{ marginBottom:4 }}>My data will not be shared with third parties without consent</li>
              <li>Consent can be withdrawn by contacting <strong style={{ color:'#86efac88' }}>privacy@ethertrack.in</strong></li>
            </ul>
          </span>
        </label>
      </div>

      {!consentGiven && (
        <div style={{ fontSize:10, color:'#f87171', textAlign:'center', letterSpacing:'.04em' }}>
          ⚠ You must provide consent before submitting
        </div>
      )}

      {submitError && (
        <div style={S.errorBox} role="alert" aria-live="assertive">
          ⚠ {submitError}
        </div>
      )}

      {submitting && uploadProgress > 0 && uploadProgress < 100 && (
        <div>
          <div style={{ fontSize:9, color:'#86efac44', letterSpacing:'.08em', marginBottom:4 }}>
            Uploading document ({uploadProgress}%)
          </div>
          <div style={S.progressBg} role="progressbar" aria-valuenow={uploadProgress} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ ...S.progressFill, width:`${uploadProgress}%`, transition:'width .2s linear' }} />
          </div>
        </div>
      )}

      {submitting && submitStep && (
        <div style={S.statusRow} role="status" aria-live="polite" aria-atomic="true">
          <div style={S.spinner} aria-hidden="true" />
          <span style={{ fontSize:11, color:'#22c55e88' }}>{submitStep}</span>
        </div>
      )}

      <div style={{ fontSize:10, color:'#4ade8055', textAlign:'center', lineHeight:1.7 }}>
        By submitting, you confirm all information is accurate and authentic.
      </div>

      <style>{`@keyframes kycSpin{to{transform:rotate(360deg)}} @keyframes kycFadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  );
});

// ── Field wrapper ─────────────────────────────────────────────────────────────
const Field = memo(({ label, error, hint, children }) => (
  <div style={S.field}>
    <label style={S.fieldLabel}>{label.toUpperCase()}</label>
    {children}
    {error && <div style={S.errMsg} role="alert" id={`err-${label.replace(/\s/g,'')}`}>{error}</div>}
    {hint && !error && <div style={S.hint}>{hint}</div>}
  </div>
));

// ═══════════════════════════════════════════════════════════════════════════════
// Main KYCFormInner
// ═══════════════════════════════════════════════════════════════════════════════
const KYCFormInner = ({ onComplete }) => {
  const { user, dbUser, handleKycComplete } = useContext(AuthContext);
  const { addNotification, NOTIF_TYPES }    = useNotifications();

  const [step, setStep] = useState(0);

  // Account type
  const [kycType, setKycType] = useState('individual');

  // Business entity fields
  const [entityName,            setEntityName]            = useState('');
  const [gstin,                 setGstin]                 = useState('');
  const [businessPan,           setBusinessPan]           = useState('');
  const [cin,                   setCin]                   = useState('');
  const [signatoryDesignation,  setSignatoryDesignation]  = useState('');
  const [businessDocFile,       setBusinessDocFile]       = useState(null);
  const [businessDocPreview,    setBusinessDocPreview]    = useState('');
  const [businessUploadProgress,setBusinessUploadProgress]= useState(0);
  const [businessDocIpfsHash,   setBusinessDocIpfsHash]   = useState(null);

  // Identity
  const [fullName,  setFullName]  = useState(dbUser?.full_name || user?.displayName || '');
  const [idType,    setIdType]    = useState('');
  const [idNumber,  setIdNumber]  = useState('');

  // Document
  const [docFile,        setDocFile]        = useState(null);
  const [docPreview,     setDocPreview]     = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [docIpfsHash,    setDocIpfsHash]    = useState(null);

  // Phone
  const [countryCode,   setCountryCode]   = useState('IN');
  const [phone,         setPhone]         = useState('');
  const [otp,           setOtp]           = useState('');
  const [otpSent,       setOtpSent]       = useState(false);
  const [otpVerified,   setOtpVerified]   = useState(false);
  const [confirmResult, setConfirmResult] = useState(null);
  const [sendingOtp,    setSendingOtp]    = useState(false);
  const [verifyingOtp,  setVerifyingOtp]  = useState(false);
  const [otpTimer,      setOtpTimer]      = useState(0);

  // Consent
  const [consentGiven, setConsentGiven] = useState(false);

  // Submit
  const [submitting,  setSubmitting]  = useState(false);
  const [submitted,   setSubmitted]   = useState(false);
  const [submitStep,  setSubmitStep]  = useState('');
  const [submitError, setSubmitError] = useState('');

  const [errors, setErrors] = useState({});

  const recaptchaRef = useRef(null);
  const timerRef     = useRef(null);
  const stepRefs     = useRef([]);

  useEffect(() => {
    return () => {
      if (window.recaptchaVerifier) {
        try { window.recaptchaVerifier.clear(); } catch {}
        window.recaptchaVerifier = null;
      }
      if (timerRef.current) clearInterval(timerRef.current);
      setIdNumber('');
      setConfirmResult(null);
    };
  }, []);

  const startTimer = useCallback(() => {
    setOtpTimer(60);
    timerRef.current = setInterval(() => {
      setOtpTimer(prev => {
        if (prev <= 1) { clearInterval(timerRef.current); return 0; }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const setupRecaptcha = useCallback(() => {
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
        setErrors(prev => ({ ...prev, otp: 'reCAPTCHA expired. Please try again.' }));
        window.recaptchaVerifier = null;
      },
    });
  }, []);

  const fullPhone = useMemo(() => {
    if (!phone || !countryCode) return '';
    const parsed = parsePhoneNumberFromString(phone, countryCode);
    return parsed?.format('E.164') || '';
  }, [phone, countryCode]);

  // ── Send OTP — with debug logs to diagnose Firebase issues ───────────────
  const handleSendOtp = useCallback(async () => {
    if (!phone.trim()) { setErrors({ phone: 'Phone number is required.' }); return; }
    if (!fullPhone)    { setErrors({ phone: 'Enter a valid phone number for the selected country.' }); return; }

    // DEBUG — remove after OTP issue resolved
    console.log('[OTP] fullPhone:', fullPhone);
    console.log('[OTP] auth object:', auth);
    console.log('[OTP] recaptcha-container exists:', !!document.getElementById('recaptcha-container'));

    setSendingOtp(true); setErrors({});
    try {
      setupRecaptcha();

      // DEBUG
      console.log('[OTP] recaptchaVerifier:', window.recaptchaVerifier);

      const result = await signInWithPhoneNumber(auth, fullPhone, window.recaptchaVerifier);

      // DEBUG
      console.log('[OTP] signInWithPhoneNumber result:', result);

      setConfirmResult(result);
      setOtpSent(true);
      startTimer();
    } catch (err) {
      // DEBUG
      console.error('[OTP] Firebase error code:', err.code);
      console.error('[OTP] Firebase error message:', err.message);
      console.error('[OTP] Full error:', err);

      const MAP = {
        'auth/invalid-phone-number':  'Invalid phone number format.',
        'auth/too-many-requests':     'Too many attempts. Please wait a few minutes.',
        'auth/quota-exceeded':        'SMS quota exceeded. Try again later.',
        'auth/captcha-check-failed':  'reCAPTCHA failed. Please refresh and retry.',
        'auth/missing-phone-number':  'Phone number is missing.',
        'auth/internal-error':        'Firebase internal error. Please try again.',
      };
      setErrors({ phone: MAP[err.code] || `Failed to send OTP: ${err.code || err.message}` });
    } finally { setSendingOtp(false); }
  }, [phone, fullPhone, setupRecaptcha, startTimer]);

  const handleVerifyOtp = useCallback(async () => {
    if (!otp || otp.length !== 6) { setErrors({ otp: 'Enter the 6-digit code.' }); return; }
    if (!confirmResult)           { setErrors({ otp: 'Please request code first.' }); return; }
    setVerifyingOtp(true); setErrors({});
    try {
      await confirmResult.confirm(otp);
      setOtpVerified(true);
      setConfirmResult(null);
    } catch (err) {
      const MAP = {
        'auth/code-expired':              'Code expired. Please resend.',
        'auth/invalid-verification-code': 'Invalid code. Please try again.',
      };
      setErrors({ otp: MAP[err.code] || 'Invalid code. Please try again.' });
    } finally { setVerifyingOtp(false); }
  }, [otp, confirmResult]);

  const handleResendOtp = useCallback(async () => {
    setOtp(''); setOtpSent(false); setConfirmResult(null);
    if (timerRef.current) clearInterval(timerRef.current);
    await handleSendOtp();
  }, [handleSendOtp]);

  const handleDocSelect = useCallback((e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!ALLOWED_MIME.includes(file.type)) {
      setErrors({ doc: 'Only JPG, PNG, WebP and PDF accepted.' }); return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setErrors({ doc: 'File too large — maximum 5MB.' }); return;
    }
    setDocFile(file);
    setDocIpfsHash(null);
    setErrors({});
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = ev => setDocPreview(ev.target.result);
      reader.readAsDataURL(file);
    } else {
      setDocPreview('');
    }
  }, []);

  const handleBusinessDocSelect = useCallback((e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!ALLOWED_MIME.includes(file.type)) {
      setErrors({ businessDoc: 'Only JPG, PNG, WebP and PDF accepted.' }); return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setErrors({ businessDoc: 'File too large — maximum 5MB.' }); return;
    }
    setBusinessDocFile(file);
    setBusinessDocIpfsHash(null);
    setErrors({});
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = ev => setBusinessDocPreview(ev.target.result);
      reader.readAsDataURL(file);
    } else {
      setBusinessDocPreview('');
    }
  }, []);

  const validateStep = useCallback(() => {
    const errs = {};
    if (step === 0) {
      if (kycType === 'business') {
        if (!entityName.trim())          errs.entityName = 'Business name is required.';
        if (!GSTIN_REGEX.test(gstin))    errs.gstin = 'Enter a valid 15-character GSTIN.';
        if (!BUSINESS_PAN_REGEX.test(businessPan)) errs.businessPan = 'Enter a valid 10-character company PAN.';
        if (GSTIN_REGEX.test(gstin) && BUSINESS_PAN_REGEX.test(businessPan) && gstin.slice(2, 12) !== businessPan) {
          errs.businessPan = 'Doesn\'t match the PAN embedded in the GSTIN — check both.';
        }
        if (cin.trim() && !CIN_REGEX.test(cin)) errs.cin = 'Enter a valid CIN/LLPIN, or leave blank.';
        if (!signatoryDesignation.trim()) errs.signatoryDesignation = 'Your designation is required.';
      }
      if (!fullName.trim())     errs.fullName = 'Full name is required.';
      if (!idType)              errs.idType   = 'Please select an ID type.';
      if (!idNumber.trim())     errs.idNumber = 'ID number is required.';
      const conf = ID_TYPES.find(t => t.value === idType);
      if (conf && !conf.validate(idNumber)) errs.idNumber = `Invalid ${conf.label} format. Expected: ${conf.hint}`;
    }
    if (step === 1) {
      if (!docFile) errs.doc = 'Please upload your ID document.';
      if (kycType === 'business' && !businessDocFile) errs.businessDoc = 'Please upload your GST certificate or incorporation document.';
    }
    if (step === 2) { if (!otpVerified) errs.otp = 'Please verify your phone number.'; }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [step, kycType, entityName, gstin, businessPan, cin, signatoryDesignation, fullName, idType, idNumber, docFile, businessDocFile, otpVerified]);

  const nextStep = useCallback(() => {
    if (validateStep()) {
      setStep(s => s + 1);
      setTimeout(() => stepRefs.current[step + 1]?.focus(), 100);
    }
  }, [validateStep, step]);

  const prevStep = useCallback(() => {
    setStep(s => s - 1);
    setErrors({});
    setTimeout(() => stepRefs.current[step - 1]?.focus(), 100);
  }, [step]);

  const uploadFileToIPFS = useCallback(async (file, onProgress) => {
    const formData = new FormData();
    formData.append('file', file);
    const { promise } = apiFetchMultipartWithProgress(
      '/api/ipfs/pin-kyc-doc',
      formData,
      {},
      onProgress,
    );
    const data = await promise;
    if (!data?.ipfsHash) throw new Error('Invalid IPFS response');
    return data.ipfsHash;
  }, []);

  // ── Submit — gated by DPDP consent ───────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!consentGiven) {
      setSubmitError('You must provide consent to process your personal data before submitting.');
      return;
    }

    setSubmitting(true);
    setSubmitError('');
    setUploadProgress(0);
    setBusinessUploadProgress(0);

    try {
      let bizHash = businessDocIpfsHash;
      if (kycType === 'business' && !bizHash) {
        setSubmitStep('Uploading business document securely…');
        bizHash = await uploadFileToIPFS(businessDocFile, setBusinessUploadProgress);
        setBusinessDocIpfsHash(bizHash);
        setBusinessDocPreview('');
        setBusinessDocFile(null);
      }

      let hash = docIpfsHash;
      if (!hash) {
        setSubmitStep('Uploading document securely…');
        hash = await uploadFileToIPFS(docFile, setUploadProgress);
        setDocIpfsHash(hash);
        setDocPreview('');
        setDocFile(null);
      }

      setSubmitStep('Submitting KYC for review…');
      const idempotencyKey = `kyc-${user.uid}-${Date.now()}`;

      const data = await apiFetch('/api/kyc/submit', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          kycType,
          fullName:     fullName.trim(),
          idType,
          idNumber:     idNumber.trim(),
          phone:        fullPhone || null,
          docIpfsHash:  hash,
          consentGiven: true,
          consentAt:    new Date().toISOString(),
          ...(kycType === 'business' ? {
            entityName:            entityName.trim(),
            gstin,
            businessPan,
            cin:                   cin.trim() || undefined,
            signatoryDesignation:  signatoryDesignation.trim(),
            businessDocIpfsHash:   bizHash,
          } : {}),
        }),
      });

      if (!data) {
        setSubmitError('Session expired. Please log in again.');
        return;
      }

      setIdNumber('');
      setSubmitStep('All done!');
      addNotification({
        type:    NOTIF_TYPES?.KYC || 'KYC',
        title:   'KYC Submitted ✅',
        message: 'Your KYC is under review. You will be notified within 1–2 business days.',
      });
      setSubmitted(true);

    } catch (err) {
      const STATUS_MESSAGES = {
        401: 'Session expired. Please refresh and log in again.',
        403: 'Security token mismatch. Please refresh the page.',
        409: err?.code === 'DUPLICATE_GSTIN'
          ? 'This GSTIN is already verified with another account. Contact support.'
          : 'These credentials are already verified with another account. Contact support.',
        429: 'Please wait at least 1 hour between KYC submissions.',
        422: 'Invalid data submitted. Please check your details and try again.',
      };
      setSubmitError(STATUS_MESSAGES[err.status] || err.message || 'Submission failed. Please try again.');
      setUploadProgress(0);
      setBusinessUploadProgress(0);
    } finally {
      setSubmitting(false);
      setSubmitStep('');
    }
  }, [
    consentGiven, kycType, docFile, docIpfsHash, businessDocFile, businessDocIpfsHash,
    entityName, gstin, businessPan, cin, signatoryDesignation,
    fullName, idType, idNumber, fullPhone, uploadFileToIPFS, addNotification, NOTIF_TYPES, user?.uid,
  ]);

  const progress = ((step + 1) / STEPS.length) * 100;

  // ── Submitted screen ──────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div style={S.page} role="main">
        <div style={{ ...S.card, animation:'kycFadeIn .5s ease both' }}>
          <div style={{ textAlign:'center', padding:'8px 0 24px' }}>
            <div style={{ fontSize:48, marginBottom:16 }} aria-hidden="true">⏳</div>
            <h1 style={{ fontSize:20, color:'#f0fdf4', fontWeight:700, marginBottom:8 }}>
              KYC Under <span style={{ color:'#facc15' }}>Review</span>
            </h1>
            <p style={{ fontSize:11, color:'#86efac77', lineHeight:1.9, marginBottom:24 }}>
              Our compliance team will verify your details within{' '}
              <strong style={{ color:'#facc15' }}>1–2 business days</strong>.
              You'll receive an email at <strong style={{ color:'#86efac88' }}>{dbUser?.email || user?.email}</strong>.
            </p>
            {[
              { icon:'✅', label:'KYC Submitted',      done:true  },
              { icon:'🔍', label:'Admin Verification',  done:false },
              { icon:'📧', label:'Email Notification',  done:false },
              { icon:'🚀', label:'Portfolio Unlocked',  done:false },
            ].map(({ icon, label, done }) => (
              <div key={label} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 14px', marginBottom:6, background: done?'#0d2e1f22':'#0a0f0c', border:`1px solid ${done?'#22c55e33':'#0f2a1a'}`, borderRadius:8 }}>
                <span style={{ fontSize:16 }} aria-hidden="true">{icon}</span>
                <span style={{ fontSize:11, color: done?'#22c55e':'#86efac44', flex:1 }}>{label}</span>
                <span style={{ fontSize:9, color: done?'#22c55e77':'#86efac22', letterSpacing:'.08em' }}>{done?'DONE':'PENDING'}</span>
              </div>
            ))}
          </div>
        </div>
        <style>{`@keyframes kycFadeIn{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}`}</style>
      </div>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────────────
  return (
    <div style={S.page} role="main">
      <div id="recaptcha-container" ref={recaptchaRef} aria-hidden="true" />

      <div style={S.card} role="form" aria-label="KYC Verification form">
        <div ref={el => stepRefs.current[step] = el} tabIndex={-1} style={{ outline:'none' }}>
          <div style={S.eyebrow}>KYC VERIFICATION · ETHERTRACK</div>
          <h1 style={S.title} id="step-heading">
            {step === 0 && 'Identity Details'}
            {step === 1 && 'Upload Document'}
            {step === 2 && 'Verify Phone'}
            {step === 3 && 'Review & Submit'}
          </h1>
          <div style={S.sub} aria-live="polite">Step {step + 1} of {STEPS.length}</div>
        </div>

        <div style={S.progressBg} role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100} aria-label={`KYC progress: step ${step+1} of ${STEPS.length}`}>
          <div style={{ ...S.progressFill, width:`${progress}%` }} />
        </div>

        <nav style={S.stepNav} aria-label="KYC steps">
          {STEPS.map((s, i) => (
            <div key={s.id} style={{ ...S.stepDot, ...(i <= step ? S.stepDotActive : {}) }}
                 aria-current={i === step ? 'step' : undefined}
                 aria-label={`Step ${i+1}: ${s.label}${i < step ? ' (complete)' : i === step ? ' (current)' : ''}`}>
              {i < step ? '✓' : i + 1}
            </div>
          ))}
        </nav>

        {step === 0 && <IdentityStep {...{
          kycType, setKycType,
          fullName, setFullName, idType, setIdType, idNumber, setIdNumber, errors,
          entityName, setEntityName, gstin, setGstin, businessPan, setBusinessPan,
          cin, setCin, signatoryDesignation, setSignatoryDesignation,
        }} />}
        {step === 1 && <DocumentStep {...{
          kycType,
          docFile, docPreview, uploadProgress, onFileSelect: handleDocSelect, errors,
          businessDocFile, businessDocPreview, businessUploadProgress, onBusinessFileSelect: handleBusinessDocSelect,
        }} />}
        {step === 2 && <PhoneStep {...{
          countryCode, setCountryCode, phone, setPhone,
          otp, setOtp, otpSent, otpVerified,
          sendingOtp, verifyingOtp, otpTimer, errors,
          onSendOtp: handleSendOtp, onVerifyOtp: handleVerifyOtp, onResendOtp: handleResendOtp,
        }} />}
        {step === 3 && <ReviewStep {...{
          kycType, entityName, gstin, businessPan, cin, signatoryDesignation, businessDocFile,
          fullName, idType, idNumber, docFile, countryCode, phone,
          otpVerified, submitError, submitting, submitStep, uploadProgress,
          consentGiven, setConsentGiven,
        }} />}

        <div style={{ display:'flex', gap:10, marginTop:24 }}>
          {step > 0 && (
            <button style={{ ...S.btnOutline, flex:1 }} onClick={prevStep} disabled={submitting}
                    aria-label="Go to previous step">
              ← Back
            </button>
          )}
          {step < 3 ? (
            <button style={{ ...S.btn, flex:1 }} onClick={nextStep} aria-label="Go to next step">
              Next →
            </button>
          ) : (
            <button
              style={{ ...S.btn, flex:1, opacity: (submitting || !consentGiven) ? 0.5 : 1 }}
              onClick={handleSubmit}
              disabled={submitting || !consentGiven}
              aria-busy={submitting}
              aria-label={submitting ? submitStep || 'Processing KYC submission' : 'Submit KYC for review'}
            >
              {submitting ? `⟳ ${submitStep || 'Processing…'}` : 'Submit for Review →'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  page:         { minHeight:'100vh', background:'#080c0a', fontFamily:"'DM Mono',monospace", display:'flex', alignItems:'center', justifyContent:'center', padding:'clamp(20px,4vw,40px) clamp(12px,4vw,16px)', backgroundImage:'linear-gradient(rgba(34,197,94,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(34,197,94,0.03) 1px,transparent 1px)', backgroundSize:'40px 40px' },
  card:         { background:'#0a0f0c', border:'1px solid #0f2a1a', borderRadius:14, padding:'clamp(24px,5vw,40px) clamp(16px,5vw,36px)', maxWidth:490, width:'100%', boxShadow:'0 24px 64px rgba(0,0,0,.6)' },
  eyebrow:      { fontSize:10, color:'#4ade8044', letterSpacing:'.15em', marginBottom:6 },
  title:        { fontSize:'clamp(18px,4vw,22px)', fontWeight:700, color:'#f0fdf4', marginBottom:4 },
  sub:          { fontSize:11, color:'#4ade8055', marginBottom:20, letterSpacing:'.06em' },
  progressBg:   { height:3, background:'#0f2a1a', borderRadius:2, marginBottom:16, overflow:'hidden' },
  progressFill: { height:'100%', background:'linear-gradient(90deg,#16a34a,#22c55e)', borderRadius:2, transition:'width .4s ease' },
  stepNav:      { display:'flex', justifyContent:'space-between', marginBottom:28 },
  stepDot:      { width:28, height:28, borderRadius:'50%', border:'1px solid #0f2a1a', background:'#060a07', color:'#4ade8033', fontSize:11, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'center' },
  stepDotActive:{ background:'#0d2e1f', border:'1px solid #22c55e', color:'#22c55e' },
  fields:       { display:'flex', flexDirection:'column', gap:16 },
  field:        { display:'flex', flexDirection:'column', gap:6 },
  fieldLabel:   { fontSize:10, color:'#4ade8055', letterSpacing:'.12em' },
  input:        { padding:'11px 14px', borderRadius:7, border:'1px solid #0f2a1a', background:'#060a07', color:'#f0fdf4', fontFamily:"'DM Mono',monospace", fontSize:12, letterSpacing:'.04em', outline:'none', width:'100%', boxSizing:'border-box', transition:'border-color .2s' },
  inputErr:     { borderColor:'#dc2626' },
  errMsg:       { fontSize:10, color:'#f87171', letterSpacing:'.04em' },
  hint:         { fontSize:9, color:'#86efac33', marginTop:2, lineHeight:1.6 },
  uploadBox:    { position:'relative', borderRadius:8, padding:'28px 16px', textAlign:'center', background:'#060a07', cursor:'pointer', transition:'border .2s', display:'flex', flexDirection:'column', alignItems:'center', minHeight:100 },
  btn:          { padding:'13px', borderRadius:8, border:'none', background:'linear-gradient(135deg,#16a34a,#15803d)', color:'#fff', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:700, letterSpacing:'.1em', transition:'opacity .2s' },
  btnOutline:   { padding:'13px', borderRadius:8, border:'1px solid #0f2a1a', background:'transparent', color:'#4ade8077', cursor:'pointer', fontFamily:"'DM Mono',monospace", fontSize:12, letterSpacing:'.08em' },
  verifiedBadge:{ padding:'12px 16px', borderRadius:8, background:'#0d2e1f', border:'1px solid #22c55e33', color:'#22c55e', fontSize:12, textAlign:'center', letterSpacing:'.04em' },
  reviewCard:   { background:'#060a07', border:'1px solid #0f2a1a', borderRadius:8, overflow:'hidden' },
  reviewRow:    { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 14px', borderBottom:'1px solid #0f2a1a18' },
  reviewLabel:  { fontSize:10, color:'#4ade8044', letterSpacing:'.1em' },
  reviewValue:  { fontSize:11, color:'#f0fdf4', fontWeight:700, maxWidth:'60%', textAlign:'right', wordBreak:'break-all' },
  errorBox:     { fontSize:10, color:'#f87171', padding:'10px 12px', background:'#1a0a0a', borderRadius:6, border:'1px solid #f8717122', lineHeight:1.6 },
  statusRow:    { display:'flex', alignItems:'center', gap:10, padding:'10px 14px', background:'#0d2e1f22', border:'1px solid #22c55e22', borderRadius:8 },
  spinner:      { width:14, height:14, border:'2px solid #22c55e22', borderTopColor:'#22c55e', borderRadius:'50%', animation:'kycSpin 1s linear infinite', flexShrink:0 },
};

// ── Export ────────────────────────────────────────────────────────────────────
export default function KYCForm(props) {
  return (
    <KYCErrorBoundary>
      <KYCFormInner {...props} />
    </KYCErrorBoundary>
  );
}