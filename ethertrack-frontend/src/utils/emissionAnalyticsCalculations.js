// src/utils/emissionAnalyticsCalculations.js
// ── Pure, framework-free calculation functions used by EmissionAnalytics.jsx.
//    Extracted out of the component so the actual math — the numbers a
//    customer's auditor might ask "how was this derived" about — can be
//    unit-tested independent of React rendering.
// ── No side effects, no hooks, no DOM/window access. Every function takes
//    plain data in and returns plain data out. See
//    emissionAnalyticsCalculations.test.js for the invariants this is held to.

export const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/**
 * Months (by name) in `year` that have fully elapsed with zero logged
 * records. Future years return [] — nothing has happened yet, so there's
 * nothing to flag as a "gap". The in-progress current month of the current
 * year is excluded for the same reason.
 */
export function computeMissingMonths(records, year, now = new Date()) {
  const thisYear = now.getFullYear();
  if (year > thisYear) return [];
  const isCurrentYear = year === thisYear;
  const monthsToCheck = isCurrentYear ? now.getMonth() : 12;
  const present = new Set();
  records.forEach((r) => {
    const mm = parseInt((r.date || '').slice(5, 7), 10);
    if (mm) present.add(mm);
  });
  const missing = [];
  for (let m = 1; m <= monthsToCheck; m++) {
    if (!present.has(m)) missing.push(MONTHS[m - 1]);
  }
  return missing;
}

/**
 * Flags records whose co2e value is `zThreshold`+ standard deviations from
 * the mean for that same activity type. Activities with fewer than
 * `minSamples` entries are skipped — not enough data to judge statistically.
 */
export function computeAnomalies(records, { minSamples = 4, zThreshold = 2.5, limit = 8 } = {}) {
  const byActivity = {};
  records.forEach((r) => {
    if (!byActivity[r.activity]) byActivity[r.activity] = [];
    byActivity[r.activity].push(r);
  });
  const flagged = [];
  Object.values(byActivity).forEach((group) => {
    if (group.length < minSamples) return;
    const vals = group.map((r) => r.co2e);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    const sd = Math.sqrt(variance);
    if (sd === 0) return;
    group.forEach((r) => {
      const z = (r.co2e - mean) / sd;
      if (Math.abs(z) >= zThreshold) flagged.push({ ...r, zScore: z, activityMean: mean });
    });
  });
  return flagged.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore)).slice(0, limit);
}

const sumScope = (arr, sc) => arr.filter((r) => r.scope === sc).reduce((s, r) => s + (r.co2e || 0), 0);

/**
 * YoY carbon bridge: FY{year-1} total -> Scope 1/2/3 deltas -> FY{year}
 * total. Returns null with no prior-year baseline. The reconciliation
 * invariant `prevTotal + sum(deltas) === currentTotal` always holds by
 * construction — covered by a test, since this is exactly the kind of
 * arithmetic a customer's auditor could ask to see proven.
 */
export function computeWaterfall(records, prevYearEmissions, year) {
  if (!prevYearEmissions?.length) return null;

  const s1Prev = sumScope(prevYearEmissions, 1);
  const s2Prev = sumScope(prevYearEmissions, 2);
  const s3Prev = sumScope(prevYearEmissions, 3);
  const prevTotal = s1Prev + s2Prev + s3Prev;

  const s1Now = sumScope(records, 1);
  const s2Now = sumScope(records, 2);
  const s3Now = sumScope(records, 3);
  const currentTotal = s1Now + s2Now + s3Now;

  const d1 = s1Now - s1Prev;
  const d2 = s2Now - s2Prev;
  const d3 = s3Now - s3Prev;

  let running = prevTotal;
  const steps = [d1, d2, d3].map((d) => {
    const from = running;
    const to = running + d;
    running = to;
    return { from: Math.min(from, to), to: Math.max(from, to) };
  });

  return {
    prevTotal,
    currentTotal,
    deltas: [null, d1, d2, d3, null],
    labels: [`FY ${year - 1}`, 'Scope 1', 'Scope 2', 'Scope 3', `FY ${year}`],
    bars: [
      [0, prevTotal],
      [steps[0].from, steps[0].to],
      [steps[1].from, steps[1].to],
      [steps[2].from, steps[2].to],
      [0, currentTotal],
    ],
    colors: [
      '#5a7a96',
      d1 > 0 ? '#ef4444' : '#10b981',
      d2 > 0 ? '#ef4444' : '#10b981',
      d3 > 0 ? '#ef4444' : '#10b981',
      '#10b981',
    ],
  };
}

/**
 * Deterministic, template-based executive summary. Every sentence traces
 * to a number already computed elsewhere — no generative text, so it can
 * never drift from the underlying figures.
 */
export function buildNarrative({
  year, total, recordCount, yoyPct, biggestMover, profile,
  prevTotalAll, verifiedPct, missingMonths, anomalies, fmt,
}) {
  const parts = [];
  parts.push(`FY ${year} emissions total ${fmt(total)} tCO2e across ${recordCount} logged activities.`);

  if (yoyPct != null) {
    parts.push(`This is ${Math.abs(yoyPct).toFixed(1)}% ${yoyPct > 0 ? 'higher' : 'lower'} than FY ${year - 1}.`);
  }
  if (biggestMover) {
    parts.push(`${biggestMover.name} is the single largest source at ${fmt(biggestMover.share, 1)}% of the total.`);
  }
  if (profile?.net_zero_year && profile?.net_zero_target_co2e && prevTotalAll != null) {
    const yearsLeft = profile.net_zero_year - (year - 1);
    if (yearsLeft > 0) {
      const expectedThisYear = prevTotalAll - (prevTotalAll - profile.net_zero_target_co2e) / yearsLeft;
      const onPace = total <= expectedThisYear * 1.02;
      const offPct = Math.abs(((total - expectedThisYear) / expectedThisYear) * 100);
      parts.push(
        `To stay on pace for net zero by ${profile.net_zero_year}, FY ${year} emissions should be at or below ` +
        `${fmt(expectedThisYear)} tCO2e — you are ${onPace ? 'on pace' : `${fmt(offPct, 1)}% off pace`}.`
      );
    }
  }
  if (verifiedPct != null) {
    parts.push(`${fmt(verifiedPct, 1)}% of records are third-party verified.`);
  }
  if (missingMonths.length) {
    parts.push(`No activity was logged for ${missingMonths.join(', ')} — check for gaps before filing.`);
  }
  if (anomalies.length) {
    parts.push(`${anomalies.length} record${anomalies.length > 1 ? 's' : ''} flagged as statistical outlier${anomalies.length > 1 ? 's' : ''} and may need review.`);
  }
  return parts.join(' ');
}