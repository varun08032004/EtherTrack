import React, { useState, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthContext } from '../App';

const EditProfile = () => {
  const { user, setUser } = useContext(AuthContext);
  const [name, setName]                     = useState(user?.name || '');
  const [email, setEmail]                   = useState(user?.email || '');
  const [profilePicture, setProfilePicture] = useState(user?.profilePicture || '');
  const [preview, setPreview]               = useState(user?.profilePicture || '');
  const [error, setError]                   = useState('');
  const [success, setSuccess]               = useState('');
  const navigate = useNavigate();

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => { setProfilePicture(reader.result); setPreview(reader.result); };
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    if (!name.trim())  { setError('Name is required.'); return; }
    if (!email.trim()) { setError('Email is required.'); return; }
    if (!/\S+@\S+\.\S+/.test(email)) { setError('Invalid email format.'); return; }
    const updatedUser = { ...user, name, email, profilePicture };
    setUser(updatedUser);
    localStorage.setItem('user', JSON.stringify(updatedUser));
    setSuccess('✅ Profile updated successfully!');
    setTimeout(() => navigate('/profile'), 1200);
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
        .et-ep { min-height: 100vh; background: #080c0a; font-family: 'DM Mono', monospace; position: relative; }
        .et-ep::before {
          content: ''; position: fixed; inset: 0; z-index: 0;
          background-image: linear-gradient(rgba(34,197,94,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(34,197,94,0.03) 1px, transparent 1px);
          background-size: 40px 40px; pointer-events: none;
        }
        .et-ep-wrap { position: relative; z-index: 1; max-width: 560px; margin: 0 auto; padding: 40px 24px; }
        .et-ep-label { font-size: 10px; color: #4ade8066; letter-spacing: .15em; margin-bottom: 8px; }
        .et-ep-title { font-size: 26px; font-weight: 700; color: #f0fdf4; margin-bottom: 28px; }
        .et-ep-title span { color: #22c55e; }

        .et-ep-card { background: #0a0f0c; border: 1px solid #0f2a1a; border-radius: 12px; padding: 28px; animation: fadeUp .4s ease both; }
        .et-ep-card-title { font-size: 11px; color: #4ade8088; letter-spacing: .14em; margin-bottom: 24px; }

        /* Avatar section */
        .et-ep-avatar-section { display: flex; align-items: center; gap: 20px; margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1px solid #0f2a1a; }
        .et-ep-avatar {
          width: 72px; height: 72px; border-radius: 50%;
          border: 2px solid #22c55e33; overflow: hidden;
          background: #0d2e1f; display: flex; align-items: center;
          justify-content: center; font-size: 24px; color: #22c55e; flex-shrink: 0;
        }
        .et-ep-avatar img { width: 100%; height: 100%; object-fit: cover; }
        .et-ep-avatar-info { flex: 1; }
        .et-ep-avatar-name { font-size: 14px; color: #f0fdf4; margin-bottom: 4px; }
        .et-ep-avatar-hint { font-size: 10px; color: #4ade8044; letter-spacing: .06em; margin-bottom: 10px; }
        .et-ep-upload-btn {
          padding: 7px 14px; border-radius: 6px;
          border: 1px solid #0f2a1a; background: #060a07;
          color: #4ade8088; cursor: pointer; font-family: 'DM Mono', monospace;
          font-size: 11px; letter-spacing: .06em; transition: all .2s;
          display: inline-block;
        }
        .et-ep-upload-btn:hover { border-color: #22c55e44; color: #22c55e; }

        .et-ep-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
        .et-ep-label-sm { font-size: 10px; color: #4ade8088; letter-spacing: .12em; }
        .et-ep-input {
          padding: 11px 14px; border-radius: 7px;
          background: #060a07; border: 1px solid #0f2a1a;
          color: #e2e8e4; font-family: 'DM Mono', monospace; font-size: 13px;
          outline: none; transition: border-color .2s, box-shadow .2s;
        }
        .et-ep-input:focus { border-color: #22c55e44; box-shadow: 0 0 0 3px rgba(34,197,94,.06); }
        .et-ep-input::placeholder { color: #4ade8033; }

        .et-ep-error   { padding: 10px 14px; background: #450a0a; border: 1px solid #dc262644; border-radius: 6px; color: #f87171; font-size: 12px; margin-bottom: 16px; }
        .et-ep-success { padding: 10px 14px; background: #0d2e1f; border: 1px solid #16a34a44; border-radius: 6px; color: #22c55e; font-size: 12px; margin-bottom: 16px; }

        .et-ep-btn-row { display: flex; gap: 10px; margin-top: 8px; }
        .et-ep-btn-save {
          flex: 1; padding: 12px; border-radius: 7px; border: none;
          background: linear-gradient(135deg,#16a34a,#15803d); color: #fff;
          cursor: pointer; font-family: 'DM Mono',monospace; font-size: 12px;
          font-weight: 700; letter-spacing: .1em; transition: opacity .2s;
        }
        .et-ep-btn-save:hover { opacity: .85; }
        .et-ep-btn-cancel {
          padding: 12px 20px; border-radius: 7px;
          border: 1px solid #0f2a1a; background: transparent;
          color: #4ade8066; cursor: pointer; font-family: 'DM Mono',monospace;
          font-size: 12px; letter-spacing: .1em; transition: all .2s;
        }
        .et-ep-btn-cancel:hover { border-color: #22c55e44; color: #22c55e; }

        @keyframes fadeUp { from{opacity:0;transform:translateY(12px);} to{opacity:1;transform:translateY(0);} }
      `}</style>

      <div className="et-ep">
        <div className="et-ep-wrap">
          <div className="et-ep-label">ACCOUNT SETTINGS</div>
          <div className="et-ep-title">Edit <span>Profile</span></div>

          <div className="et-ep-card">
            <div className="et-ep-card-title">UPDATE YOUR INFORMATION</div>

            {/* Avatar */}
            <div className="et-ep-avatar-section">
              <div className="et-ep-avatar">
                {preview ? <img src={preview} alt="Preview" /> : '👤'}
              </div>
              <div className="et-ep-avatar-info">
                <div className="et-ep-avatar-name">{name || 'Your Name'}</div>
                <div className="et-ep-avatar-hint">JPG, PNG up to 5MB</div>
                <label className="et-ep-upload-btn" htmlFor="avatarInput">
                  UPLOAD PHOTO
                  <input id="avatarInput" type="file" accept="image/*"
                    onChange={handleImageChange} style={{ display: 'none' }} />
                </label>
              </div>
            </div>

            {error   && <div className="et-ep-error">{error}</div>}
            {success && <div className="et-ep-success">{success}</div>}

            <div className="et-ep-field">
              <label className="et-ep-label-sm">FULL NAME</label>
              <input className="et-ep-input" type="text" placeholder="Your full name"
                value={name} onChange={e => { setName(e.target.value); setError(''); }} />
            </div>

            <div className="et-ep-field">
              <label className="et-ep-label-sm">EMAIL ADDRESS</label>
              <input className="et-ep-input" type="email" placeholder="your@email.com"
                value={email} onChange={e => { setEmail(e.target.value); setError(''); }} />
            </div>

            <div className="et-ep-btn-row">
              <button className="et-ep-btn-cancel" onClick={() => navigate('/profile')}>CANCEL</button>
              <button className="et-ep-btn-save"   onClick={handleSave}>SAVE CHANGES →</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default EditProfile;