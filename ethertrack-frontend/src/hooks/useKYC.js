import { useState, useCallback } from 'react';
import { ethers } from 'ethers';
import { useContracts } from './useContracts';

/**
 * useKYC
 * Replaces: AuthContext kycCompleted, localStorage kyc_{email}
 * Reads KYC status directly from KYCRegistry smart contract.
 *
 * BEFORE (context):
 *   const { kycCompleted } = useContext(AuthContext);
 *
 * AFTER (blockchain):
 *   const { isVerified, kycRecord, checkKYC } = useKYC();
 */
export function useKYC() {
  const { getContracts } = useContracts();

  const [isVerified,  setIsVerified]  = useState(false);
  const [kycRecord,   setKycRecord]   = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');

  // ── Check KYC status for a wallet ──────────────────────
  // Replaces: localStorage.getItem(`kyc_${email}`) === 'true'
  const checkKYC = useCallback(async (walletAddress) => {
    if (!walletAddress) return false;
    setLoading(true);
    setError('');
    try {
      const { kycRegistryRead } = await getContracts();
      const verified = await kycRegistryRead.isKYCVerified(walletAddress);
      setIsVerified(verified);

      if (verified) {
        const record = await kycRegistryRead.getKYCRecord(walletAddress);
        setKycRecord({
          verified:    record.verified,
          verifiedAt:  new Date(Number(record.verifiedAt) * 1000).toLocaleDateString('en-IN'),
          expiresAt:   new Date(Number(record.expiresAt)  * 1000).toLocaleDateString('en-IN'),
          kycDataHash: record.kycDataHash,
          verifiedBy:  record.verifiedBy,
        });
      }
      return verified;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [getContracts]);

  // ── Submit KYC to backend → backend calls verifyKYC() on contract ──
  // Replaces: handleKycComplete() in App.js
  // Flow: Frontend submits KYC form → Backend verifies docs
  //       → Backend wallet calls KYCRegistry.verifyKYC(userWallet, hash)
  //       → Frontend polls checkKYC() to confirm
  const submitKYCToBackend = useCallback(async (kycData, walletAddress) => {
    setLoading(true);
    setError('');
    try {
      // Hash the KYC data locally before sending — PII never goes on-chain
      const dataString = `${kycData.fullName}|${kycData.idType}|${kycData.idNumber}|${kycData.phone}`;
      const kycDataHash = ethers.keccak256(ethers.toUtf8Bytes(dataString));

      // POST to backend — backend wallet calls KYCRegistry.verifyKYC()
      const response = await fetch('/api/kyc/verify', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress,
          kycDataHash,
          fullName:   kycData.fullName,
          phone:      kycData.phone,
          idType:     kycData.idType,
          idNumber:   kycData.idNumber,
          // Document stored in Firebase Storage, only URL sent to backend
          documentUrl: kycData.documentUrl,
        }),
      });

      if (!response.ok) throw new Error('KYC submission failed');

      // Poll contract until verified (backend tx confirms)
      let attempts = 0;
      while (attempts < 10) {
        await new Promise(r => setTimeout(r, 3000)); // wait 3s per attempt
        const verified = await checkKYC(walletAddress);
        if (verified) return true;
        attempts++;
      }

      throw new Error('KYC verification timeout — please check status later');
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [checkKYC]);

  return {
    isVerified,
    kycRecord,
    loading,
    error,
    checkKYC,
    submitKYCToBackend,
  };
}
