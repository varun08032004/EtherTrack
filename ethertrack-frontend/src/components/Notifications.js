import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../context/NotificationContext';

const FILTERS = ['ALL', 'TRADE', 'WALLET', 'KYC', 'CREDIT', 'EMISSION', 'TEAM', 'COMPLIANCE', 'SYSTEM'];

const Notifications = () => {
  const navigate = useNavigate();
  const {
    notifications, unreadCount, loading,
    markRead, markAllRead, deleteOne, clearAll,
    getTypeMeta, timeAgo, refresh,
  } = useNotifications();

  const [activeFilter, setActiveFilter] = useState('ALL');

  const filtered = activeFilter === 'ALL'
    ? notifications
    : notifications.filter(n => n.type === activeFilter);

  const filterCount = (f) => f === 'ALL'
    ? notifications.length
    : notifications.filter(n => n.type === f).length;

  const handleClick = (n) => {
    markRead(n.id);
    if (n.link) navigate(n.link);
  };

  const CSS = `
    @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&display=swap');
    .et-notif{min-height:100vh;background:#080c0a;font-family:'DM Mono',monospace;position:relative;}
    .et-notif::before{content:'';position:fixed;inset:0;z-index:0;
      background-image:linear-gradient(rgba(34,197,94,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(34,197,94,0.03) 1px,transparent 1px);
      background-size:40px 40px;pointer-events:none;}
    .et-notif-wrap{position:relative;z-index:1;max-width:760px;margin:0 auto;padding:40px 24px 80px;}
    .et-notif-label{font-size:10px;color:#4ade8066;letter-spacing:.15em;margin-bottom:8px;}
    .et-notif-title{font-size:26px;font-weight:700;color:#f0fdf4;margin-bottom:4px;}
    .et-notif-title span{color:#22c55e;}
    .et-notif-sub{font-size:11px;color:#4ade8044;letter-spacing:.08em;margin-bottom:28px;}
    /* Top bar */
    .et-notif-topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px;animation:fadeUp .4s ease both;}
    .et-notif-count{font-size:11px;color:#4ade8066;letter-spacing:.08em;}
    .et-notif-count span{color:#22c55e;}
    .et-notif-actions{display:flex;gap:8px;align-items:center;}
    .et-notif-action-btn{padding:7px 14px;border-radius:6px;border:1px solid #0f2a1a;background:transparent;color:#4ade8066;cursor:pointer;font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.08em;transition:all .2s;}
    .et-notif-action-btn:hover{border-color:#22c55e44;color:#22c55e;background:#0d2e1f;}
    .et-notif-action-btn.danger:hover{border-color:#dc262644;color:#f87171;background:#450a0a;}
    .et-notif-refresh{padding:7px 10px;border-radius:6px;border:1px solid #0f2a1a;background:transparent;color:#4ade8044;cursor:pointer;font-size:12px;transition:all .2s;}
    .et-notif-refresh:hover{border-color:#22c55e33;color:#22c55e;}
    .et-notif-refresh.spin{animation:spinIcon .6s linear;}
    /* Filters */
    .et-notif-filters{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px;animation:fadeUp .4s ease .05s both;}
    .et-notif-filter{padding:6px 12px;border-radius:5px;font-size:10px;letter-spacing:.08em;border:1px solid #0f2a1a;background:transparent;cursor:pointer;font-family:'DM Mono',monospace;color:#4ade8055;transition:all .2s;display:flex;align-items:center;gap:5px;}
    .et-notif-filter:hover{border-color:#22c55e44;color:#22c55e;background:#0d2e1f;}
    .et-notif-filter.active{border-color:#22c55e;color:#22c55e;background:#0d2e1f;}
    .et-notif-filter-cnt{font-size:8px;background:#0f2a1a;color:#86efac44;padding:1px 5px;border-radius:3px;}
    .et-notif-filter.active .et-notif-filter-cnt{background:#22c55e22;color:#22c55e;}
    /* List */
    .et-notif-list{display:flex;flex-direction:column;gap:8px;animation:fadeUp .4s ease .1s both;}
    /* Item */
    .et-notif-item{display:flex;align-items:flex-start;gap:14px;padding:16px 18px;border-radius:10px;background:#0a0f0c;border:1px solid #0f2a1a;cursor:pointer;transition:border-color .2s,background .2s;position:relative;}
    .et-notif-item:hover{border-color:#22c55e22;background:#0d2e1f22;}
    .et-notif-item.unread{border-color:#16a34a22;background:#0d2e1f33;}
    .et-notif-item.has-link:hover{border-color:#22c55e55;}
    .et-notif-item-icon{width:40px;height:40px;border-radius:10px;flex-shrink:0;background:#060a07;border:1px solid #0f2a1a;display:flex;align-items:center;justify-content:center;font-size:18px;}
    .et-notif-item-body{flex:1;min-width:0;padding-right:80px;}
    .et-notif-item-row{display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;}
    .et-notif-item-title{font-size:13px;color:#f0fdf4;font-weight:700;letter-spacing:.03em;}
    .et-notif-item-badge{font-size:9px;padding:2px 8px;border-radius:3px;letter-spacing:.08em;border:1px solid transparent;}
    .et-notif-item-link-badge{font-size:8px;color:#60a5fa66;letter-spacing:.06em;margin-left:auto;}
    .et-notif-item-msg{font-size:12px;color:#4ade8077;line-height:1.6;letter-spacing:.02em;}
    .et-notif-item-time{font-size:10px;color:#4ade8033;margin-top:6px;letter-spacing:.06em;}
    .et-notif-item-unread-dot{width:8px;height:8px;border-radius:50%;background:#22c55e;flex-shrink:0;margin-top:6px;}
    .et-notif-item-actions{display:flex;gap:6px;opacity:0;transition:opacity .2s;position:absolute;top:14px;right:14px;}
    .et-notif-item:hover .et-notif-item-actions{opacity:1;}
    .et-notif-item-act{padding:4px 10px;border-radius:4px;font-size:9px;letter-spacing:.08em;border:1px solid #0f2a1a;background:#060a07;cursor:pointer;font-family:'DM Mono',monospace;color:#4ade8055;transition:all .2s;}
    .et-notif-item-act:hover{border-color:#22c55e44;color:#22c55e;}
    .et-notif-item-act.del:hover{border-color:#dc262644;color:#f87171;background:#450a0a;}
    /* Loading skeleton */
    .et-notif-skel{height:80px;border-radius:10px;background:linear-gradient(90deg,#0a0f0c 25%,#0d2e1f22 50%,#0a0f0c 75%);background-size:200% 100%;animation:shimmer 1.5s infinite;border:1px solid #0f2a1a;}
    /* Empty state */
    .et-notif-empty{text-align:center;padding:64px 24px;background:#0a0f0c;border:1px solid #0f2a1a;border-radius:12px;}
    .et-notif-empty-icon{font-size:40px;margin-bottom:16px;}
    .et-notif-empty-title{font-size:14px;color:#f0fdf4;font-weight:700;margin-bottom:8px;letter-spacing:.06em;}
    .et-notif-empty-sub{font-size:11px;color:#4ade8033;letter-spacing:.06em;}
    /* Live indicator */
    .et-notif-live{display:flex;align-items:center;gap:5px;font-size:9px;color:#22c55e66;letter-spacing:.1em;}
    .et-notif-live-dot{width:5px;height:5px;border-radius:50%;background:#22c55e;animation:livePulse 1.5s infinite;}
    @keyframes fadeUp{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}
    @keyframes shimmer{0%{background-position:200% 0;}100%{background-position:-200% 0;}}
    @keyframes spinIcon{to{transform:rotate(360deg);}}
    @keyframes livePulse{0%,100%{box-shadow:0 0 0 0 rgba(34,197,94,.4);}50%{box-shadow:0 0 0 3px rgba(34,197,94,0);}}
    @media(max-width:600px){.et-notif-topbar{flex-direction:column;align-items:flex-start;}.et-notif-item-body{padding-right:0;}.et-notif-item-actions{position:static;opacity:1;margin-top:8px;}}
  `;

  return (
    <>
      <style>{CSS}</style>
      <div className="et-notif">
        <div className="et-notif-wrap">

          <div className="et-notif-label">ACTIVITY FEED</div>
          <div className="et-notif-title">My <span>Notifications</span></div>
          <div className="et-notif-sub">TRADES · WALLET · KYC · CREDITS · EMISSIONS · TEAM</div>

          {/* Top bar */}
          <div className="et-notif-topbar">
            <div style={{ display:'flex', alignItems:'center', gap:12 }}>
              <div className="et-notif-count">
                {filtered.length} notification{filtered.length !== 1 ? 's' : ''}
                {unreadCount > 0 && <> · <span>{unreadCount} unread</span></>}
              </div>
              <div className="et-notif-live">
                <span className="et-notif-live-dot"/>LIVE
              </div>
            </div>
            <div className="et-notif-actions">
              <button className="et-notif-refresh" onClick={refresh} title="Refresh">🔄</button>
              {unreadCount > 0 && (
                <button className="et-notif-action-btn" onClick={markAllRead}>MARK ALL READ</button>
              )}
              {notifications.length > 0 && (
                <button className="et-notif-action-btn danger" onClick={clearAll}>CLEAR ALL</button>
              )}
            </div>
          </div>

          {/* Filters */}
          <div className="et-notif-filters">
            {FILTERS.map(f => {
              const cnt = filterCount(f);
              if (f !== 'ALL' && cnt === 0) return null;
              return (
                <button
                  key={f}
                  className={`et-notif-filter${activeFilter === f ? ' active' : ''}`}
                  onClick={() => setActiveFilter(f)}>
                  {f}
                  <span className="et-notif-filter-cnt">{cnt}</span>
                </button>
              );
            })}
          </div>

          {/* List */}
          <div className="et-notif-list">
            {loading && notifications.length === 0 ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="et-notif-skel"/>
              ))
            ) : filtered.length === 0 ? (
              <div className="et-notif-empty">
                <div className="et-notif-empty-icon">
                  {activeFilter === 'ALL' ? '🎉' : getTypeMeta(activeFilter).icon}
                </div>
                <div className="et-notif-empty-title">All caught up!</div>
                <div className="et-notif-empty-sub">
                  No {activeFilter === 'ALL' ? '' : activeFilter.toLowerCase()} notifications yet
                </div>
              </div>
            ) : filtered.map(n => {
              const meta   = getTypeMeta(n.type);
              const isRead = n.read;
              return (
                <div
                  key={n.id}
                  className={`et-notif-item${!isRead ? ' unread' : ''}${n.link ? ' has-link' : ''}`}
                  onClick={() => handleClick(n)}>
                  <div className="et-notif-item-icon">{meta.icon}</div>
                  <div className="et-notif-item-body">
                    <div className="et-notif-item-row">
                      <span className="et-notif-item-title">{n.title}</span>
                      <span className="et-notif-item-badge" style={{
                        color: meta.color,
                        borderColor: `${meta.color}33`,
                        background:  `${meta.color}11`,
                      }}>
                        {meta.label}
                      </span>
                      {n.link && (
                        <span className="et-notif-item-link-badge">VIEW →</span>
                      )}
                    </div>
                    <div className="et-notif-item-msg">{n.message}</div>
                    <div className="et-notif-item-time">{timeAgo(n.created_at || n.time)}</div>
                  </div>
                  {!isRead && <div className="et-notif-item-unread-dot"/>}
                  <div className="et-notif-item-actions">
                    {!isRead && (
                      <button className="et-notif-item-act"
                        onClick={e => { e.stopPropagation(); markRead(n.id); }}>
                        MARK READ
                      </button>
                    )}
                    <button className="et-notif-item-act del"
                      onClick={e => { e.stopPropagation(); deleteOne(n.id); }}>
                      DELETE
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      </div>
    </>
  );
};

export default Notifications;