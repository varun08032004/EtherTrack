import React, { useState } from 'react';

const Settings = () => {
  const [notifications, setNotifications] = useState({
    tradeConfirm:   true,
    priceAlerts:    true,
    emissionAlerts: false,
    newsletter:     false,
    kycUpdates:     true,
  });

  const [preferences, setPreferences] = useState({
    currency:    'INR',
    language:    'English',
    timezone:    'Asia/Kolkata',
    priceFormat: 'Indian',
  });

  const [security, setSecurity] = useState({
    twoFactor:       false,
    sessionTimeout:  '30',
    loginAlerts:     true,
  });

  const [saved, setSaved] = useState('');

  const showSaved = (msg) => {
    setSaved(msg);
    setTimeout(() => setSaved(''), 3000);
  };

  const toggleNotif = (key) =>
    setNotifications(prev => ({ ...prev, [key]: !prev[key] }));

  const toggleSecurity = (key) =>
    setSecurity(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');

        .et-set { min-height: 100vh; background: #080c0a; font-family: 'DM Mono', monospace; position: relative; }
        .et-set::before {
          content: ''; position: fixed; inset: 0; z-index: 0;
          background-image:
            linear-gradient(rgba(34,197,94,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(34,197,94,0.03) 1px, transparent 1px);
          background-size: 40px 40px; pointer-events: none;
        }
        .et-set-wrap { position: relative; z-index: 1; max-width: 820px; margin: 0 auto; padding: 40px 24px; }

        .et-set-label { font-size: 10px; color: #4ade8066; letter-spacing: .15em; margin-bottom: 8px; }
        .et-set-title { font-size: 26px; font-weight: 700; color: #f0fdf4; margin-bottom: 4px; }
        .et-set-title span { color: #22c55e; }
        .et-set-sub   { font-size: 11px; color: #4ade8044; letter-spacing: .08em; margin-bottom: 32px; }

        /* Saved toast */
        .et-set-toast {
          position: fixed; top: 80px; right: 24px; z-index: 999;
          padding: 12px 20px; border-radius: 8px;
          background: #0d2e1f; border: 1px solid #16a34a44;
          color: #22c55e; font-size: 12px;
          box-shadow: 0 8px 32px rgba(0,0,0,.4);
          animation: slideIn .3s ease;
        }
        @keyframes slideIn { from{transform:translateX(20px);opacity:0;} to{transform:translateX(0);opacity:1;} }

        /* Card */
        .et-set-card {
          background: #0a0f0c; border: 1px solid #0f2a1a;
          border-radius: 12px; padding: 24px; margin-bottom: 16px;
          animation: fadeUp .4s ease both;
        }
        .et-set-card:nth-child(2) { animation-delay: .05s; }
        .et-set-card:nth-child(3) { animation-delay: .10s; }
        .et-set-card:nth-child(4) { animation-delay: .15s; }

        .et-set-card-header {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid #0f2a1a;
        }
        .et-set-card-title { font-size: 11px; color: #4ade8088; letter-spacing: .14em; }
        .et-set-card-icon  { font-size: 16px; }

        /* Toggle row */
        .et-set-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 12px 0; border-bottom: 1px solid #0f2a1a18;
        }
        .et-set-row:last-child { border-bottom: none; padding-bottom: 0; }
        .et-set-row-info { flex: 1; }
        .et-set-row-label { font-size: 12px; color: #e2e8e4; margin-bottom: 2px; }
        .et-set-row-desc  { font-size: 10px; color: #4ade8044; letter-spacing: .04em; }

        /* Toggle switch */
        .et-toggle {
          position: relative; width: 40px; height: 22px;
          flex-shrink: 0; cursor: pointer;
        }
        .et-toggle input { opacity: 0; width: 0; height: 0; }
        .et-toggle-slider {
          position: absolute; inset: 0; border-radius: 22px;
          background: #0f2a1a; border: 1px solid #16a34a22;
          transition: all .3s;
        }
        .et-toggle-slider::before {
          content: ''; position: absolute;
          width: 14px; height: 14px; border-radius: 50%;
          left: 3px; top: 3px;
          background: #4ade8044; transition: all .3s;
        }
        .et-toggle input:checked + .et-toggle-slider { background: #16a34a; border-color: #22c55e44; }
        .et-toggle input:checked + .et-toggle-slider::before { transform: translateX(18px); background: #fff; }

        /* Select / Input */
        .et-set-select, .et-set-input {
          padding: 8px 12px; border-radius: 6px;
          background: #060a07; border: 1px solid #0f2a1a;
          color: #e2e8e4; font-family: 'DM Mono', monospace; font-size: 12px;
          outline: none; transition: border-color .2s; min-width: 140px;
        }
        .et-set-select:focus, .et-set-input:focus { border-color: #22c55e44; }

        /* Pref grid */
        .et-set-pref-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .et-set-pref-group { display: flex; flex-direction: column; gap: 6px; }
        .et-set-pref-label { font-size: 10px; color: #4ade8088; letter-spacing: .12em; }

        /* Danger zone */
        .et-set-danger { border-color: #dc262622; }
        .et-set-danger .et-set-card-title { color: #f8717166; }
        .et-set-danger-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 14px 0; border-bottom: 1px solid #dc262611;
        }
        .et-set-danger-row:last-child { border-bottom: none; }
        .et-set-danger-label { font-size: 12px; color: #e2e8e4; }
        .et-set-danger-desc  { font-size: 10px; color: #4ade8033; margin-top: 2px; }
        .et-set-btn-danger {
          padding: 8px 16px; border-radius: 6px;
          border: 1px solid #dc262633; background: transparent;
          color: #f8717166; cursor: pointer; font-family: 'DM Mono', monospace;
          font-size: 11px; letter-spacing: .08em; transition: all .2s; white-space: nowrap;
        }
        .et-set-btn-danger:hover { background: #450a0a; border-color: #dc2626; color: #f87171; }

        /* Save button */
        .et-set-save-row { display: flex; justify-content: flex-end; margin-top: 8px; }
        .et-set-btn-save {
          padding: 11px 28px; border-radius: 7px; border: none;
          background: linear-gradient(135deg, #16a34a, #15803d);
          color: #fff; cursor: pointer; font-family: 'DM Mono', monospace;
          font-size: 12px; font-weight: 700; letter-spacing: .1em;
          transition: opacity .2s, transform .1s;
        }
        .et-set-btn-save:hover { opacity: .88; transform: translateY(-1px); }

        @keyframes fadeUp { from{opacity:0;transform:translateY(12px);} to{opacity:1;transform:translateY(0);} }
        @media(max-width:600px) { .et-set-pref-grid { grid-template-columns: 1fr; } }
      `}</style>

      {saved && <div className="et-set-toast">{saved}</div>}

      <div className="et-set">
        <div className="et-set-wrap">

          <div className="et-set-label">ACCOUNT CONFIGURATION</div>
          <div className="et-set-title">Account <span>Settings</span></div>
          <div className="et-set-sub">MANAGE YOUR PREFERENCES AND SECURITY</div>

          {/* Notifications */}
          <div className="et-set-card">
            <div className="et-set-card-header">
              <span className="et-set-card-title">🔔 NOTIFICATION PREFERENCES</span>
            </div>
            {[
              { key: 'tradeConfirm',   label: 'Trade Confirmations',    desc: 'Get notified when a trade is executed'         },
              { key: 'priceAlerts',    label: 'Price Alerts',           desc: 'Alerts when credits hit your target price'     },
              { key: 'emissionAlerts', label: 'Emission Reminders',     desc: 'Monthly reminders to log emission data'        },
              { key: 'kycUpdates',     label: 'KYC Status Updates',     desc: 'Updates on your verification status'          },
              { key: 'newsletter',     label: 'Market Newsletter',      desc: 'Weekly carbon market insights and news'        },
            ].map(({ key, label, desc }) => (
              <div key={key} className="et-set-row">
                <div className="et-set-row-info">
                  <div className="et-set-row-label">{label}</div>
                  <div className="et-set-row-desc">{desc}</div>
                </div>
                <label className="et-toggle">
                  <input type="checkbox" checked={notifications[key]}
                    onChange={() => toggleNotif(key)} />
                  <span className="et-toggle-slider" />
                </label>
              </div>
            ))}
          </div>

          {/* Preferences */}
          <div className="et-set-card">
            <div className="et-set-card-header">
              <span className="et-set-card-title">⚙️ PLATFORM PREFERENCES</span>
            </div>
            <div className="et-set-pref-grid">
              <div className="et-set-pref-group">
                <label className="et-set-pref-label">CURRENCY</label>
                <select className="et-set-select" value={preferences.currency}
                  onChange={e => setPreferences(p => ({ ...p, currency: e.target.value }))}>
                  <option value="INR">INR (₹)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                </select>
              </div>
              <div className="et-set-pref-group">
                <label className="et-set-pref-label">LANGUAGE</label>
                <select className="et-set-select" value={preferences.language}
                  onChange={e => setPreferences(p => ({ ...p, language: e.target.value }))}>
                  <option value="English">English</option>
                  <option value="Hindi">Hindi</option>
                  <option value="Marathi">Marathi</option>
                </select>
              </div>
              <div className="et-set-pref-group">
                <label className="et-set-pref-label">TIMEZONE</label>
                <select className="et-set-select" value={preferences.timezone}
                  onChange={e => setPreferences(p => ({ ...p, timezone: e.target.value }))}>
                  <option value="Asia/Kolkata">IST (Asia/Kolkata)</option>
                  <option value="UTC">UTC</option>
                </select>
              </div>
              <div className="et-set-pref-group">
                <label className="et-set-pref-label">PRICE FORMAT</label>
                <select className="et-set-select" value={preferences.priceFormat}
                  onChange={e => setPreferences(p => ({ ...p, priceFormat: e.target.value }))}>
                  <option value="Indian">Indian (1,00,000)</option>
                  <option value="International">International (100,000)</option>
                </select>
              </div>
            </div>
            <div className="et-set-save-row" style={{ marginTop: 20 }}>
              <button className="et-set-btn-save"
                onClick={() => showSaved('✅ Preferences saved!')}>
                SAVE PREFERENCES →
              </button>
            </div>
          </div>

          {/* Security */}
          <div className="et-set-card">
            <div className="et-set-card-header">
              <span className="et-set-card-title">🔐 SECURITY SETTINGS</span>
            </div>
            {[
              { key: 'twoFactor',   label: '2-Factor Authentication', desc: 'Add an extra layer of login security'     },
              { key: 'loginAlerts', label: 'Login Alerts',             desc: 'Email alerts on new device logins'       },
            ].map(({ key, label, desc }) => (
              <div key={key} className="et-set-row">
                <div className="et-set-row-info">
                  <div className="et-set-row-label">{label}</div>
                  <div className="et-set-row-desc">{desc}</div>
                </div>
                <label className="et-toggle">
                  <input type="checkbox" checked={security[key]}
                    onChange={() => toggleSecurity(key)} />
                  <span className="et-toggle-slider" />
                </label>
              </div>
            ))}
            <div className="et-set-row">
              <div className="et-set-row-info">
                <div className="et-set-row-label">Session Timeout</div>
                <div className="et-set-row-desc">Auto logout after inactivity</div>
              </div>
              <select className="et-set-select"
                value={security.sessionTimeout}
                onChange={e => setSecurity(s => ({ ...s, sessionTimeout: e.target.value }))}>
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="60">1 hour</option>
                <option value="0">Never</option>
              </select>
            </div>
            <div className="et-set-save-row" style={{ marginTop: 16 }}>
              <button className="et-set-btn-save"
                onClick={() => showSaved('✅ Security settings saved!')}>
                SAVE SECURITY →
              </button>
            </div>
          </div>

          {/* Danger Zone */}
          <div className="et-set-card et-set-danger">
            <div className="et-set-card-header">
              <span className="et-set-card-title">⚠️ DANGER ZONE</span>
            </div>
            <div className="et-set-danger-row">
              <div>
                <div className="et-set-danger-label">Reset KYC Verification</div>
                <div className="et-set-danger-desc">Re-submit your identity documents</div>
              </div>
              <button className="et-set-btn-danger"
                onClick={() => showSaved('KYC reset initiated.')}>RESET KYC</button>
            </div>
            <div className="et-set-danger-row">
              <div>
                <div className="et-set-danger-label">Deactivate Account</div>
                <div className="et-set-danger-desc">Temporarily disable your trading account</div>
              </div>
              <button className="et-set-btn-danger">DEACTIVATE</button>
            </div>
            <div className="et-set-danger-row">
              <div>
                <div className="et-set-danger-label">Delete Account</div>
                <div className="et-set-danger-desc">Permanently delete all your data</div>
              </div>
              <button className="et-set-btn-danger">DELETE ACCOUNT</button>
            </div>
          </div>

        </div>
      </div>
    </>
  );
};

export default Settings;