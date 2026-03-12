import { useState, useCallback } from 'react';
import { useContracts } from './useContracts';

/**
 * useEmissions
 * Replaces: EmissionTracking.js local state
 *
 * BEFORE (local):              AFTER (blockchain):
 *   calcEmissions()  →  emissionRegistry.calculateEmissions() (pure, no gas)
 *   logEmission()    →  emissionRegistry.logEmission() (writes to chain)
 *   emissionHistory  →  emissionRegistry.getUserEmissionLogs()
 */
export function useEmissions() {
  const { getContracts } = useContracts();

  const [emissionLogs, setEmissionLogs] = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [txPending,    setTxPending]    = useState(false);
  const [error,        setError]        = useState('');

  // ── Calculate emissions (no gas — pure function) ────────
  // Replaces: local calcEmissions() in EmissionTracking.js
  const calculateEmissions = useCallback(async (energyKWh, transportKm, wasteKg) => {
    try {
      const { emissionRead } = await getContracts();
      const [totalCO2e, creditsNeeded] = await emissionRead.calculateEmissions(
        energyKWh, transportKm, wasteKg
      );
      return {
        totalCO2e:    Number(totalCO2e) / 1000,  // convert g → kg
        creditsNeeded: Number(creditsNeeded),
      };
    } catch (err) {
      // Fallback to local calc if contract not yet deployed
      const e = energyKWh   * 0.82;
      const t = transportKm * 0.21;
      const w = wasteKg     * 0.05;
      const totalCO2e = +(e + t + w).toFixed(2);
      return { totalCO2e, creditsNeeded: Math.ceil(totalCO2e) };
    }
  }, [getContracts]);

  // ── Log emission on-chain ────────────────────────────────
  // Replaces: local state update in EmissionTracking.js
  const logEmission = useCallback(async (walletAddress, emissionData) => {
    setTxPending(true);
    setError('');
    try {
      const { emissionRegistry } = await getContracts();

      const periodTimestamp = Math.floor(new Date(emissionData.period || Date.now()).getTime() / 1000);

      const tx = await emissionRegistry.logEmission(
        periodTimestamp,
        emissionData.energyKWh   || 0,
        emissionData.transportKm || 0,
        emissionData.wasteKg     || 0,
        emissionData.scope       || 0, // SCOPE_1
        emissionData.notes       || '',
      );
      const receipt = await tx.wait();
      await fetchEmissionLogs(walletAddress);
      return { success: true, txHash: receipt.hash };
    } catch (err) {
      const msg = err.reason || err.message;
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setTxPending(false);
    }
  }, [getContracts]);

  // ── Fetch emission history ──────────────────────────────
  const fetchEmissionLogs = useCallback(async (walletAddress) => {
    if (!walletAddress) return;
    setLoading(true);
    try {
      const { emissionRead } = await getContracts();
      const logIds = await emissionRead.getUserEmissionLogs(walletAddress);

      const logs = await Promise.all(
        logIds.map(async (id) => {
          const log = await emissionRead.getEmissionLog(Number(id));
          return {
            logId:         Number(id),
            loggedAt:      new Date(Number(log.loggedAt) * 1000).toLocaleDateString('en-IN'),
            energyKWh:     Number(log.energyKWh),
            transportKm:   Number(log.transportKm),
            wasteKg:       Number(log.wasteKg),
            totalCO2e:     Number(log.totalCO2e) / 1000, // g → kg
            creditsNeeded: Number(log.creditsNeeded),
            scope:         ['Scope 1', 'Scope 2', 'Scope 3'][log.scope] || 'Scope 1',
            notes:         log.notes,
          };
        })
      );

      setEmissionLogs(logs.reverse());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [getContracts]);

  // ── Get net emissions (emitted - offset) ───────────────
  const getNetEmissions = useCallback(async (walletAddress) => {
    try {
      const { emissionRead } = await getContracts();
      const net = await emissionRead.getNetEmissions(walletAddress);
      return Number(net) / 1000; // g → kg
    } catch { return 0; }
  }, [getContracts]);

  return {
    emissionLogs,
    loading,
    txPending,
    error,
    calculateEmissions,
    logEmission,
    fetchEmissionLogs,
    getNetEmissions,
  };
}
