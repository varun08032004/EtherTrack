// src/hooks/usePortfolioActions.js
// Extracts all async action handlers from PortfolioV3 into a testable hook.
// Covers: register credit, list/delist, retire, CSV export, refresh.

import { useCallback, useState } from 'react';
import { apiFetch } from '../services/api';

/**
 * @param {object} deps — injected from PortfolioV3
 */
export function usePortfolioActions({
  can,
  org,
  dbUser,
  user,
  walletAddress,
  isKYCVerified,
  planLimit,
  creditLimitReached,
  ethPriceInr,
  listCredit,
  delistCredit,
  retireCredit,
  loadMyCredits,
  refreshRetirements,
  refreshBoughtCredits,
  loadPendingCredits,
  loadEmissionsData,
  allCredits,
  showToast,
  setActiveTab,
  setShowList,
  setShowRetire,
  setShowForm,
  setRetireSteps,
  setTxPending,
  setSubmitting,
  txPending,
}) {

  // ── Register / Tokenize ──────────────────────────────────────

  /**
   * Uploads ownership doc to IPFS via backend proxy (not direct — no keys exposed).
   * Backend route: POST /api/ipfs/pin  (see backend/routes/ipfs.js)
   */
  const uploadDocToIPFS = useCallback(async (file) => {
    const fd = new FormData();
    fd.append('file', file);
    // apiFetch handles auth headers; Content-Type left unset so browser sets multipart boundary
    const res = await apiFetch('/api/ipfs/pin', {
      method: 'POST',
      body: fd,
      skipContentType: true, // tell apiFetch not to set application/json
    });
    if (!res?.ipfsHash) throw new Error('IPFS upload failed — no hash returned');
    return res.ipfsHash;
  }, []);

  const handleRegister = useCallback(async (form, setFormErrors, resetForm) => {
    if (!isKYCVerified)                      { showToast('❌ Complete KYC first', 'error');                             return; }
    if (!can('portfolio:submit_credit'))      { showToast('❌ No permission to submit credits', 'error');               return; }
    if (creditLimitReached)                  { showToast(`❌ Credit limit reached (${planLimit.credits})`, 'error');   return; }

    // Validate
    const e = {};
    if (!form.projectName.trim())                    e.projectName  = 'Required';
    if (!form.location.trim())                       e.location     = 'Required';
    if (!form.country.trim())                        e.country      = 'Required';
    if (!form.projectType)                           e.projectType  = 'Required';
    if (!form.developer.trim())                      e.developer    = 'Required';
    if (!form.credits || +form.credits <= 0)         e.credits      = 'Enter valid amount';
    if (!form.vintageYear || isNaN(form.vintageYear))e.vintageYear  = 'Required';
    if (!form.expiryDate)                            e.expiryDate   = 'Required';
    if (!form.serialNumber.trim())                   e.serialNumber = 'Required';
    if (!form.projectId.trim())                      e.projectId    = 'Required';
    if (!form.docFile)                               e.docFile      = 'Ownership proof required';
    if (form.standard === 'GS' && form.sdgTags.length === 0)
      e.sdgTags = 'Gold Standard requires at least 1 SDG tag';

    if (Object.keys(e).length > 0) { setFormErrors(e); return; }

    setSubmitting(true);
    setTxPending('Uploading to IPFS…');
    try {
      const docIpfsHash = await uploadDocToIPFS(form.docFile);
      setTxPending('Submitting for admin verification…');
      await apiFetch('/api/portfolio/submit-credit', {
        method: 'POST',
        body: JSON.stringify({
          projectName: form.projectName, projectLocation: form.location,
          country: form.country, standard: form.standard, projectId: form.projectId,
          projectType: form.projectType, developer: form.developer,
          quantity: parseInt(form.credits), vintageYear: parseInt(form.vintageYear),
          expiryDate: form.expiryDate, registrySerial: form.serialNumber,
          docIpfsHash, creditType: form.creditType, cbamEligible: form.cbamEligible,
          acvaName: form.acvaName, acvaDate: form.acvaDate, acvaStatus: form.acvaStatus,
          sdgTags: form.sdgTags, correspondingAdjustment: form.correspondingAdjustment,
          icvcmCcpEligible: form.icvcmCcpEligible, icvcmCcpLabel: form.icvcmCcpLabel,
          icvcmCcpDate: form.icvcmCcpDate, registryLink: form.registryLink,
          methodologyId: form.methodologyId, additionalityType: form.additionalityType,
          permanenceRating: form.permanenceRating, coBenefitsVerified: form.coBenefitsVerified,
          orgId: org?.id,
        }),
      });
      setShowForm(false);
      resetForm();
      showToast('✅ Submitted! Approval 1–2 business days.');
      await loadPendingCredits();
    } catch (err) {
      console.error('[handleRegister]', err);
      showToast(`❌ ${err.message || 'Submission failed'}`, 'error');
    } finally {
      setSubmitting(false);
      setTxPending('');
    }
  }, [
    isKYCVerified, can, creditLimitReached, planLimit,
    uploadDocToIPFS, org, loadPendingCredits,
    showToast, setSubmitting, setTxPending, setShowForm,
  ]);

  // ── Cancel submission ────────────────────────────────────────

  const handleCancelSubmission = useCallback(async (id) => {
    try {
      await apiFetch(`/api/portfolio/submissions/${id}`, { method: 'DELETE' });
      showToast('Submission cancelled.');
      await loadPendingCredits();
    } catch (err) {
      console.error('[handleCancelSubmission]', err);
      showToast(`❌ ${err.message || 'Could not cancel'}`, 'error');
    }
  }, [loadPendingCredits, showToast]);

  // ── List / Delist ────────────────────────────────────────────

  const handleListForSale = useCallback(async (credit, listPrice, listQty, resetList) => {
    if (!can('portfolio:list'))                        { showToast('❌ No permission to list credits', 'error'); return; }
    if (!credit.tokenId || credit.isOnChain === false) { showToast('❌ Credit not yet minted', 'error');        return; }
    if (!listPrice || isNaN(listPrice) || +listPrice <= 0) { showToast('❌ Enter a valid price', 'error');      return; }
    const qty = parseInt(listQty) || credit.credits;
    if (qty <= 0 || qty > credit.credits) { showToast(`❌ Quantity must be 1–${credit.credits}`, 'error');     return; }
    try {
      setTxPending(`Listing "${credit.projectName}"…`);
      const rate = ethPriceInr || 210000;
      await listCredit(credit.tokenId, qty, (+listPrice / rate).toFixed(6));
      resetList();
      setActiveTab('LISTED');
      showToast('📈 Listed on blockchain!');
    } catch (err) {
      console.error('[handleListForSale]', err);
      showToast(`❌ ${err.reason || err.message || 'Transaction failed'}`, 'error');
    } finally {
      setTxPending('');
    }
  }, [can, ethPriceInr, listCredit, showToast, setTxPending, setActiveTab]);

  const handleDelist = useCallback(async (credit) => {
    if (!can('portfolio:list')) { showToast('❌ No permission', 'error'); return; }
    try {
      setTxPending('Cancelling listing…');
      await delistCredit(credit.listingId);
      showToast('Credit removed from marketplace.');
    } catch (err) {
      console.error('[handleDelist]', err);
      showToast(`❌ ${err.reason || err.message || 'Transaction failed'}`, 'error');
    } finally {
      setTxPending('');
    }
  }, [can, delistCredit, showToast, setTxPending]);

  // ── Retire ───────────────────────────────────────────────────

  const handleRetireConfirm = useCallback(async (credit, qty, scope, corporateData) => {
    try {
      setTxPending('Verifying serial…');
      const dupCheck = await apiFetch(
        `/api/portfolio/check-duplicate-retirement?serial=${encodeURIComponent(credit.serialNumber)}`
      );
      if (dupCheck?.found) {
        showToast('❌ Serial already retired.', 'error');
        setTxPending('');
        return;
      }
      setTxPending('Burning on blockchain…');
      const result = await retireCredit(credit.tokenId ?? credit.id, qty);
      const retiredAt  = Date.now();
      const rawTokenId = credit.tokenId != null
        ? String(credit.tokenId).padStart(8, '0')
        : 'XXXXXXXX';
      let certId = `CERT-${rawTokenId}-${retiredAt.toString(36).toUpperCase().slice(-6)}`;

      try {
        const { txAPI } = await import('../services/api');
        const retirementRes = await txAPI.recordRetirement({
          tokenId: credit.tokenHex || credit.tokenId,
          projectName: credit.projectName, standard: credit.standard,
          credits: qty, vintageYear: credit.vintageYear,
          serialNumber: credit.serialNumber, developer: credit.developer,
          location: credit.location, country: credit.country,
          projectType: credit.projectType, txHash: result.txHash,
          blockNumber: result.blockNumber || null,
          beneficiary: user?.email || walletAddress,
          retireScope: scope,
          correspondingAdjustment: credit.correspondingAdjustment,
          walletAddress,
          beneficiaryName:     corporateData?.beneficiaryName     || '',
          beneficiaryEntity:   corporateData?.beneficiaryEntity   || '',
          beneficiaryGstin:    corporateData?.beneficiaryGstin    || '',
          reportingStandard:   corporateData?.reportingStandard   || 'GHG_PROTOCOL',
          purpose:             corporateData?.purpose             || 'voluntary_offset',
          orgId: org?.id, approvedBy: dbUser?.id,
        });
        if (retirementRes?.certId) certId = retirementRes.certId;
      } catch (syncErr) {
        // Backend sync failed — retirement is on-chain but cert may be pending.
        // Log for ops team visibility, don't block user.
        console.error('[retirement backend sync failed]', syncErr?.message);
      }

      setShowRetire(null);
      setRetireSteps({ show: true, qty, scope, credit, txHash: result.txHash, certId, retiredAt, corporateData });
      await loadEmissionsData();
      await loadMyCredits();
      if (refreshRetirements) await refreshRetirements();
    } catch (err) {
      console.error('[handleRetireConfirm]', err);
      showToast(`❌ ${err.reason || err.message || 'Transaction failed'}`, 'error');
    } finally {
      setTxPending('');
    }
  }, [
    retireCredit, user, walletAddress, org, dbUser,
    loadEmissionsData, loadMyCredits, refreshRetirements,
    showToast, setTxPending, setShowRetire, setRetireSteps,
  ]);

  // ── CSV Export ───────────────────────────────────────────────

  const handleExportCSV = useCallback(() => {
    if (!can('portfolio:export')) { showToast('❌ No export permission', 'error'); return; }
    const headers = [
      'Project Name', 'Standard', 'Credit Type', 'Project Type', 'Country',
      'Credits (tCO₂)', 'Vintage', 'Status', 'Serial', 'CBAM',
      'Developer', 'Methodology', 'CA Status',
    ];
    const rows = allCredits.map(c => [
      `"${c.projectName}"`, c.standard, c.creditType || 'voluntary',
      c.projectType, c.country, c.credits, c.vintageYear,
      c.isPending ? (c.isRejected ? 'REJECTED' : 'PENDING') : c.status,
      c.serialNumber, c.cbamEligible ? 'YES' : 'NO',
      `"${c.developer || ''}"`, c.methodologyId || '', c.correspondingAdjustment || 'none',
    ]);
    const csv  = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `ethertrack_portfolio_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('✅ Portfolio exported as CSV');
  }, [can, allCredits, showToast]);

  // ── Refresh ──────────────────────────────────────────────────

  const handleRefresh = useCallback(async () => {
    try {
      await Promise.all([
        loadMyCredits(),
        loadPendingCredits(),
        loadEmissionsData(),
        refreshBoughtCredits?.(),
      ]);
      showToast('✅ Portfolio refreshed');
    } catch (err) {
      console.error('[handleRefresh]', err);
      showToast('❌ Refresh failed', 'error');
    }
  }, [loadMyCredits, loadPendingCredits, loadEmissionsData, refreshBoughtCredits, showToast]);

  return {
    handleRegister,
    handleCancelSubmission,
    handleListForSale,
    handleDelist,
    handleRetireConfirm,
    handleExportCSV,
    handleRefresh,
  };
}