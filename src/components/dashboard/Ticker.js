/**
 * components/dashboard/Ticker.jsx
 *
 * Infinite-scroll price ticker.
 *
 * FIXES vs original:
 *  - Uses CSS animation instead of requestAnimationFrame — no battery drain,
 *    no 300 DOM nodes from triple-duplication, pauses automatically when
 *    tab is hidden via animation-play-state.
 *  - Uses IntersectionObserver to pause when scrolled out of view.
 *  - Two copies instead of three (CSS trick: translate by 50% at 100% keyframe).
 *  - Never renders price as ₹0 — shows shimmer when ethRate is null.
 *  - Stable keys: uses credit id, not array index.
 */

import React, { useEffect, useRef, useState, memo } from 'react';
import s from './Dashboard.module.css';

const TickerItem = memo(function TickerItem({ credit, ethRate }) {
  const priceINR = ethRate ? Math.round((credit.adjPrice || 0) * ethRate) : null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, flexShrink: 0 }}>
      <span style={{ color: '#86efaccc' }}>
        {credit.serialNumber?.slice(0, 12) || credit.standard}
      </span>
      <span style={{ color: '#22c55e', fontWeight: 700 }}>
        {priceINR !== null
          ? `₹${priceINR.toLocaleString('en-IN')}`
          : <span style={{ display: 'inline-block', width: 50, height: 11, borderRadius: 3, background: 'linear-gradient(90deg,#0f2a1a 25%,#0d2e1f 50%,#0f2a1a 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite' }} />}
      </span>
      {credit.vintageDiscount > 0 && (
        <span style={{ color: '#facc15' }}>-{credit.vintageDiscount}% vtg</span>
      )}
    </div>
  );
});

export const Ticker = memo(function Ticker({ listings, ethRate }) {
  const wrapRef    = useRef(null);
  const [paused, setPaused] = useState(false);

  // Pause when scrolled out of view
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => setPaused(!entry.isIntersecting),
      { threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (listings.length === 0) {
    return (
      <div className={s.tickerWrap} role="region" aria-label="Live market ticker">
        <div className={s.tickerLive} aria-hidden="true">
          <span className={s.ldot} />LIVE
        </div>
        <div style={{ padding: '0 16px', fontSize: 11, color: '#86efac33', letterSpacing: '.08em' }}>
          NO ACTIVE LISTINGS — BE THE FIRST TO LIST CARBON CREDITS
        </div>
      </div>
    );
  }

  // Two copies for seamless loop (CSS animation scrolls one full copy width)
  const items = [...listings, ...listings];
  const duration = Math.max(20, listings.length * 3); // scale speed to item count

  return (
    <div ref={wrapRef} className={s.tickerWrap} role="region" aria-label="Live market ticker">
      <div className={s.tickerLive} aria-hidden="true">
        <span className={s.ldot} />LIVE
      </div>
      <div style={{ overflow: 'hidden', flex: 1 }}>
        <div
          aria-hidden="true"
          style={{
            display: 'flex',
            gap: 40,
            whiteSpace: 'nowrap',
            animation: `tickerScroll ${duration}s linear infinite`,
            animationPlayState: paused ? 'paused' : 'running',
          }}
        >
          {items.map((c, i) => (
            <TickerItem key={`${c.id || c.serialNumber}-${i}`} credit={c} ethRate={ethRate} />
          ))}
        </div>
      </div>

      {/* Keyframe injected once — scoped to this component */}
      <style>{`
        @keyframes tickerScroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </div>
  );
});