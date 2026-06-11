// services/scheduler.js — EtherTrack
'use strict';

let _started = false;

const start = () => {
  if (_started) return;
  _started = true;
  // TODO: add real scheduled jobs here, e.g.:
  // setInterval(refreshRates,      5 * 60 * 1000);
  // setInterval(cacheStats,       15 * 60 * 1000);
  // setInterval(triggerAlerts,    30 * 60 * 1000);
  // setInterval(reconcileCERC,    60 * 60 * 1000);
};

const stop = () => {
  _started = false;
};

module.exports = { start, stop };