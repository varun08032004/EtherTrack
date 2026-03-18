import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { ethers } from 'ethers';

const ADDRESSES = {
  CarbonCreditToken: process.env.REACT_APP_CARBON_CREDIT_TOKEN_ADDRESS,
  Marketplace:       process.env.REACT_APP_MARKETPLACE_ADDRESS,
  EmissionRegistry:  process.env.REACT_APP_EMISSION_REGISTRY_ADDRESS,
  Treasury:          process.env.REACT_APP_TREASURY_ADDRESS,
  AMMPool:           process.env.REACT_APP_AMM_POOL_ADDRESS,
};

const API            = process.env.REACT_APP_API_URL || 'http://localhost:5000';
const SEPOLIA_CHAIN_ID = '0xaa36a7';

const ABI = {
  CarbonCreditToken: [
    'function mintCredit((address to,uint256 amount,string projectName,string location,uint8 standard,string projectType,string developer,uint256 vintageYear,uint256 expiryDate,string serialNumber,string metadataURI) p) returns (uint256)',
    'function retireCredit(uint256 tokenId, uint256 amount)',
    'function balanceOf(address account, uint256 id) view returns (uint256)',
    'function getCreditMetadata(uint256 tokenId) view returns (tuple(string projectName,string location,uint8 standard,string projectType,string developer,uint256 vintageYear,uint256 expiryDate,string serialNumber,string metadataURI,bool active,address registeredBy,uint256 registeredAt))',
    'function getNextTokenId() view returns (uint256)',
    'function getTotalRetired(uint256 tokenId) view returns (uint256)',
    'function setApprovalForAll(address operator, bool approved)',
    'function isApprovedForAll(address account, address operator) view returns (bool)',
    'function isExpired(uint256 tokenId) view returns (bool)',
    'event CreditMinted(uint256 indexed tokenId, address indexed to, uint256 amount, string projectName, uint8 standard, string serialNumber)',
    'event CreditRetired(uint256 indexed tokenId, address indexed retiredBy, uint256 amount, string projectName)',
  ],
  Marketplace: [
    'function listCredit(uint256 tokenId, uint256 amount, uint256 pricePerUnit, uint256 duration) returns (uint256)',
    'function cancelListing(uint256 listingId)',
    'function updateListingPrice(uint256 listingId, uint256 newPrice)',
    'function buyCredit(uint256 listingId, uint256 amount) payable',
    'function placeBuyOrder(uint256 tokenId, uint256 amount, uint256 limitPrice, uint256 duration) payable returns (uint256)',
    'function cancelBuyOrder(uint256 orderId)',
    'function getActiveListings() view returns (tuple(uint256 listingId,address seller,uint256 tokenId,uint256 amount,uint256 amountRemaining,uint256 pricePerUnit,uint256 listedAt,uint256 expiresAt,bool active)[])',
    'function getOpenBuyOrders() view returns (tuple(uint256 orderId,address buyer,uint256 tokenId,uint256 amount,uint256 amountFilled,uint256 limitPrice,uint256 ethEscrowed,uint8 status,uint256 createdAt,uint256 expiresAt)[])',
    'function getBuyOrdersForToken(uint256 tokenId) view returns (tuple(uint256 orderId,address buyer,uint256 tokenId,uint256 amount,uint256 amountFilled,uint256 limitPrice,uint256 ethEscrowed,uint8 status,uint256 createdAt,uint256 expiresAt)[])',
    'function getOrderBook(uint256 tokenId) view returns (tuple(uint256 listingId,address seller,uint256 tokenId,uint256 amount,uint256 amountRemaining,uint256 pricePerUnit,uint256 listedAt,uint256 expiresAt,bool active)[] asks, tuple(uint256 orderId,address buyer,uint256 tokenId,uint256 amount,uint256 amountFilled,uint256 limitPrice,uint256 ethEscrowed,uint8 status,uint256 createdAt,uint256 expiresAt)[] bids)',
    'function getSellerListings(address seller) view returns (uint256[])',
    'function getBuyerOrders(address buyer) view returns (uint256[])',
    'function listings(uint256) view returns (tuple(uint256 listingId,address seller,uint256 tokenId,uint256 amount,uint256 amountRemaining,uint256 pricePerUnit,uint256 listedAt,uint256 expiresAt,bool active))',
    'function calculateFee(uint256 amount, uint256 pricePerUnit) view returns (uint256 fee, uint256 total)',
    'function shouldUseAMM(uint256 amount) view returns (bool)',
    'function ammThreshold() view returns (uint256)',
    'event CreditTraded(uint256 indexed tradeId,uint256 indexed listingId,uint256 indexed buyOrderId,address buyer,address seller,uint256 tokenId,uint256 amount,uint256 pricePerUnit,uint256 totalPrice,uint256 fee,bool isAMM)',
    'event CreditListed(uint256 indexed listingId,address indexed seller,uint256 indexed tokenId,uint256 amount,uint256 pricePerUnit)',
    'event BuyOrderPlaced(uint256 indexed orderId,address indexed buyer,uint256 indexed tokenId,uint256 amount,uint256 limitPrice,uint256 ethEscrowed)',
    'event MatchExecuted(uint256 listingId,uint256 buyOrderId,uint256 amount,uint256 price)',
    'event ListingCancelled(uint256 indexed listingId,address indexed seller)',
    'event BuyOrderCancelled(uint256 indexed orderId,address indexed buyer,uint256 ethRefunded)',
  ],
  AMMPool: [
    'function swapETHForCredits(uint256 poolId, uint256 minCredits) payable returns (uint256)',
    'function swapCreditsForETH(uint256 poolId, uint256 credits, uint256 minEth) returns (uint256)',
    'function addLiquidity(uint256 poolId, uint256 creditAmount) payable returns (uint256)',
    'function removeLiquidity(uint256 poolId, uint256 shares) returns (uint256, uint256)',
    'function quoteETHForCredits(uint256 poolId, uint256 ethIn) view returns (uint256 creditOut, uint256 fee)',
    'function quoteCreditsForETH(uint256 poolId, uint256 credits) view returns (uint256 ethOut, uint256 fee)',
    'function getPrice(uint256 poolId) view returns (uint256)',
    'function getPool(uint256 poolId) view returns (tuple(uint256 tokenId,uint256 creditReserve,uint256 ethReserve,uint256 totalShares,bool active,string name))',
    'function getLPPosition(uint256 poolId, address lp) view returns (tuple(uint256 shares,uint256 creditDeposited,uint256 ethDeposited,uint256 depositedAt))',
    'function totalPools() view returns (uint256)',
    'event Swapped(uint256 indexed poolId,address indexed trader,bool creditIn,uint256 amountIn,uint256 amountOut,uint256 fee)',
  ],
};

export const STANDARD_ENUM      = { VCS:0, GS:1, CDM:2, ACR:3 };
export const STANDARD_FROM_ENUM = { 0:'VCS', 1:'GS', 2:'CDM', 3:'ACR' };

export const vintagePenalty = (year) => {
  const age = new Date().getFullYear() - year;
  if (age <= 1) return 0;
  if (age <= 2) return 3;
  if (age <= 3) return 8;
  if (age <= 4) return 15;
  return 25;
};

const ETH_INR_RATE = 280000;

// ── Authenticated API helper ──────────────────────────────────────
const authFetch = async (path, opts = {}) => {
  const token = localStorage.getItem('et_access');
  const res = await fetch(`${API}${path}`, {
    credentials: 'include',
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
};

// ── KYC: DB only, not contract ────────────────────────────────────
const fetchDBKycStatus = async () => {
  try {
    const data = await authFetch('/api/auth/me');
    return !!(data.kyc_verified || data.kyc_status === 'verified');
  } catch { return false; }
};

// ── Bound wallet from backend ─────────────────────────────────────
const fetchBoundWallet = async () => {
  try {
    const data = await authFetch('/api/wallet/status');
    return data.walletAddress?.toLowerCase() || null;
  } catch { return null; }
};

// ── ✅ NEW: fetch DB-approved credits (not yet / already on-chain) ─
const fetchDBCredits = async () => {
  try {
    const data = await authFetch('/api/portfolio/my-credits');
    return data.credits || [];
  } catch (e) {
    console.warn('fetchDBCredits failed:', e.message);
    return [];
  }
};

// ── ✅ NEW: fetch retirement history from retirements table ────────
const fetchMyRetirements = async () => {
  try {
    // First try the retirements table (used by verify.js)
    const data = await authFetch('/api/transactions/retirements');
    return data.retirements || [];
  } catch (e) {
    console.warn('fetchMyRetirements failed:', e.message);
    return [];
  }
};

const PortfolioContext = createContext(null);

export function PortfolioProvider({ children }) {
  const [provider,      setProvider]      = useState(null);
  const [signer,        setSigner]        = useState(null);
  const [walletAddress, setWalletAddress] = useState('');
  const [contracts,     setContracts]     = useState(null);
  const [isKYCVerified, setIsKYCVerified] = useState(false);
  const [chainOk,       setChainOk]       = useState(false);

  const [walletMismatch,     setWalletMismatch]     = useState(false);
  const [walletMismatchInfo, setWalletMismatchInfo] = useState(null);

  const [myCredits,    setMyCredits]    = useState([]);
  const [myRetirements,setMyRetirements]= useState([]); // ✅ retirement history
  const [listings,     setListings]     = useState([]);
  const [buyOrders,    setBuyOrders]    = useState([]);
  const [tradeHistory, setTradeHistory] = useState([]);
  const [ammPools,     setAmmPools]     = useState([]);

  const [loading, setLoading] = useState({ credits:false, listings:false, buyOrders:false, tx:false });
  const [error,   setError]   = useState('');

  const listenersRef = useRef([]);

  const checkChain = async () => {
    if (!window.ethereum) return false;
    const cid = await window.ethereum.request({ method: 'eth_chainId' });
    return cid === SEPOLIA_CHAIN_ID;
  };

  const buildContracts = (_signer) => ({
    token:  new ethers.Contract(ADDRESSES.CarbonCreditToken, ABI.CarbonCreditToken, _signer),
    market: new ethers.Contract(ADDRESSES.Marketplace,       ABI.Marketplace,       _signer),
    amm:    ADDRESSES.AMMPool ? new ethers.Contract(ADDRESSES.AMMPool, ABI.AMMPool, _signer) : null,
  });

  const init = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      if (!accounts.length) {
        setWalletAddress(''); setContracts(null);
        setIsKYCVerified(false); setChainOk(false);
        setWalletMismatch(false); setWalletMismatchInfo(null);
        return;
      }

      const metamaskWallet = accounts[0].toLowerCase();

      const boundWallet = await fetchBoundWallet();
      if (boundWallet && boundWallet !== metamaskWallet) {
        setWalletMismatch(true);
        setWalletMismatchInfo({ metamaskWallet, boundWallet });
        setWalletAddress(''); setContracts(null);
        setIsKYCVerified(false); setChainOk(false);
        setMyCredits([]);
        setError(
          `Wrong wallet connected. Your account is bound to ${boundWallet.slice(0,6)}...${boundWallet.slice(-4)}. ` +
          `Please switch to that wallet in MetaMask.`
        );
        return;
      }

      setWalletMismatch(false); setWalletMismatchInfo(null); setError('');

      const ok = await checkChain();
      setChainOk(ok);
      if (!ok) {
        setContracts(null); setIsKYCVerified(false);
        setError('Please switch MetaMask to Ethereum Sepolia');
        return;
      }

      const _provider = new ethers.BrowserProvider(window.ethereum);
      const _signer   = await _provider.getSigner();
      const _address  = await _signer.getAddress();
      setProvider(_provider);
      setSigner(_signer);
      setWalletAddress(_address);

      const c = buildContracts(_signer);
      setContracts(c);

      const verified = await fetchDBKycStatus();
      setIsKYCVerified(verified);

      _setupListeners(c, _address);
    } catch (e) {
      console.error('Wallet init error:', e);
    }
  }, []);

  const _setupListeners = (c, address) => {
    listenersRef.current.forEach(({ contract, event, handler }) => {
      try { contract.off(event, handler); } catch {}
    });
    listenersRef.current = [];
    const addr = address.toLowerCase();

    const onTraded = (tradeId, listingId, buyOrderId, buyer, seller, tokenId, amount, price, total, fee, isAMM) => {
      const isBuyer  = buyer?.toLowerCase()  === addr;
      const isSeller = seller?.toLowerCase() === addr;
      if (isBuyer || isSeller) {
        setTimeout(() => { loadMyCredits(c, address); loadListings(c); loadBuyOrders(c); }, 2500);
        setTradeHistory(prev => [{
          id: `TXN-${Date.now()}`, type: isBuyer ? 'Buy' : 'Sell',
          tradeId: Number(tradeId), listingId: Number(listingId),
          amount: Number(amount), totalEth: ethers.formatEther(total),
          time: new Date().toLocaleTimeString(), status: 'Confirmed', isAMM,
        }, ...prev.slice(0, 49)]);
      } else {
        setTimeout(() => { loadListings(c); loadBuyOrders(c); }, 2000);
      }
    };
    const onMatch            = () => { setTimeout(() => { loadListings(c); loadBuyOrders(c); }, 1500); };
    const onListed           = () => { setTimeout(() => loadListings(c), 1500); };
    const onBidPlaced        = () => { setTimeout(() => loadBuyOrders(c), 1500); };
    const onListingCancelled = () => { setTimeout(() => loadListings(c), 1500); };
    const onBidCancelled     = () => { setTimeout(() => loadBuyOrders(c), 1500); };

    c.market.on('CreditTraded',      onTraded);
    c.market.on('MatchExecuted',     onMatch);
    c.market.on('CreditListed',      onListed);
    c.market.on('BuyOrderPlaced',    onBidPlaced);
    c.market.on('ListingCancelled',  onListingCancelled);
    c.market.on('BuyOrderCancelled', onBidCancelled);

    listenersRef.current = [
      { contract:c.market, event:'CreditTraded',      handler:onTraded           },
      { contract:c.market, event:'MatchExecuted',     handler:onMatch            },
      { contract:c.market, event:'CreditListed',      handler:onListed           },
      { contract:c.market, event:'BuyOrderPlaced',    handler:onBidPlaced        },
      { contract:c.market, event:'ListingCancelled',  handler:onListingCancelled },
      { contract:c.market, event:'BuyOrderCancelled', handler:onBidCancelled     },
    ];
  };

  // Always check KYC from DB on mount
  useEffect(() => {
    fetchDBKycStatus().then(v => { if (v) setIsKYCVerified(true); });
  }, []);

  useEffect(() => {
    init();
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', init);
      window.ethereum.on('chainChanged',    init);
    }
    return () => {
      if (window.ethereum) {
        window.ethereum.removeListener('accountsChanged', init);
        window.ethereum.removeListener('chainChanged',    init);
      }
      listenersRef.current.forEach(({ contract, event, handler }) => {
        try { contract.off(event, handler); } catch {}
      });
    };
  }, [init]);

  useEffect(() => {
    if (contracts && walletAddress && chainOk && !walletMismatch) {
      loadMyCredits(contracts, walletAddress);
      loadListings(contracts);
      loadBuyOrders(contracts);
      if (contracts.amm) loadAMMPools(contracts);
    }
    // ✅ Always fetch retirements (DB-based, no wallet needed)
    fetchMyRetirements().then(setMyRetirements);
  }, [contracts, walletAddress, chainOk, walletMismatch]);

  const refreshKYC = useCallback(async () => {
    try {
      const v = await fetchDBKycStatus();
      setIsKYCVerified(v);
      return v;
    } catch { return false; }
  }, []);

  // ── ✅ FIXED loadMyCredits ────────────────────────────────────────
  // Loads on-chain tokens AND merges DB-approved credits that are not
  // yet tokenised, so approved credits show as HELD immediately.
  const loadMyCredits = useCallback(async (c, addr) => {
    const _c    = c    || contracts;
    const _addr = addr || walletAddress;
    if (!_addr || walletMismatch) return;

    setLoading(l => ({ ...l, credits: true }));
    try {

      // ── 1. Fetch DB-approved credits (includes pre-mint and tokenised) ──
      const dbCredits = await fetchDBCredits();

      // ── 2. Fetch on-chain tokens (only if wallet + contracts ready) ──
      let onChainCredits = [];

      if (_c) {
        try {
          const nextId         = await _c.token.getNextTokenId();
          const total          = Number(nextId);
          const sellerIds      = await _c.market.getSellerListings(_addr);
          const sellerListings = await Promise.all(sellerIds.map(lid => _c.market.listings(lid)));

          for (let tokenId = 0; tokenId < total; tokenId++) {
            const bal     = await _c.token.balanceOf(_addr, tokenId);
            const heldBal = Number(bal);

            let listingId    = null;
            let listingPrice = 0;
            let listedBal    = 0;
            for (let i = 0; i < sellerListings.length; i++) {
              const l = sellerListings[i];
              if (Number(l.tokenId) === tokenId && l.active) {
                listingId    = Number(sellerIds[i]);
                listingPrice = parseFloat(ethers.formatEther(l.pricePerUnit));
                listedBal    = Number(l.amountRemaining);
                break;
              }
            }

            const totalBal = heldBal + listedBal;
            if (totalBal === 0) continue;

            const meta    = await _c.token.getCreditMetadata(tokenId);
            const retired = await _c.token.getTotalRetired(tokenId);
            const dep     = vintagePenalty(Number(meta.vintageYear));
            const stdStr  = STANDARD_FROM_ENUM[Number(meta.standard)] || 'VCS';
            const priceInr = listingPrice > 0 ? listingPrice * ETH_INR_RATE : 850;

            onChainCredits.push({
              id:                 tokenId,
              tokenId:            tokenId,
              tokenHex:           `0x${tokenId.toString(16).padStart(8, '0').toUpperCase()}`,
              projectId:          meta.serialNumber,
              projectName:        meta.projectName,
              location:           meta.location,
              country:            meta.location.split(',').pop().trim(),
              standard:           stdStr,
              projectType:        meta.projectType,
              developer:          meta.developer,
              vintageYear:        Number(meta.vintageYear),
              expiryDate:         new Date(Number(meta.expiryDate) * 1000).toISOString().slice(0, 10),
              serialNumber:       meta.serialNumber,
              credits:            totalBal,
              heldCredits:        heldBal,
              listedCredits:      listedBal,
              totalRetired:       Number(retired),
              active:             meta.active,
              registeredBy:       meta.registeredBy,
              registeredAt:       new Date(Number(meta.registeredAt) * 1000).toISOString().slice(0, 10),
              ownerWallet:        _addr,
              verificationStatus: meta.active ? 'Verified' : 'Retired',
              status:             !meta.active ? 'RETIRED' : listedBal > 0 ? 'LISTED' : 'HELD',
              pricePerCredit:     priceInr,
              pricePerCreditEth:  listingPrice,
              listingId,
              vintageDiscount:    dep,
              admin_status:       'approved',
              isOnChain:          true,
            });
          }
        } catch (e) {
          console.warn('On-chain load failed, using DB only:', e.message);
        }
      }

      // ── 3. Merge: DB credits not already represented on-chain ──────
      // A DB credit is "on-chain" if token_id is set AND exists in onChainCredits
      const onChainSerials = new Set(onChainCredits.map(c => c.serialNumber));

      const dbOnlyCredits = dbCredits
        .filter(db => !onChainSerials.has(db.registry_serial || db.serialNumber))
        .map(db => ({
          // Use DB id as string so it doesn't clash with numeric tokenIds
          id:             `db-${db.id}`,
          tokenId:        db.token_id || null,
          tokenHex:       db.token_id
            ? `0x${Number(db.token_id).toString(16).padStart(8, '0').toUpperCase()}`
            : null,
          projectId:      db.project_id || db.projectId || '',
          projectName:    db.project_name || db.projectName,
          location:       db.project_location || db.location || '',
          country:        db.country || '',
          standard:       db.standard || 'VCS',
          projectType:    db.project_type || db.projectType || '',
          developer:      db.developer || '',
          vintageYear:    db.vintage_year || db.vintageYear,
          expiryDate:     db.expiry_date || db.expiryDate || '',
          serialNumber:   db.registry_serial || db.serialNumber,
          credits:        db.available_credits ?? db.quantity ?? 0,
          heldCredits:    db.available_credits ?? db.quantity ?? 0,
          listedCredits:  0,
          totalRetired:   db.retired_credits || 0,
          active:         true,
          ownerWallet:    _addr,
          // ✅ Map DB batch_status enum → frontend status
          status: (() => {
            switch (db.status) {
              case 'tokenised':  return 'HELD';
              case 'exhausted':  return 'RETIRED';
              case 'expired':    return 'RETIRED';
              default:           return 'HELD'; // 'approved' → HELD
            }
          })(),
          pricePerCredit:    850,
          pricePerCreditEth: 0,
          listingId:         null,
          vintageDiscount:   vintagePenalty(db.vintage_year || db.vintageYear || 0),
          admin_status:      db.admin_status || 'approved',
          // Extra DB fields for the certificate / detail view
          creditType:             db.credit_type || 'voluntary',
          cbamEligible:           db.cbam_eligible || false,
          acvaName:               db.acva_name || '',
          acvaDate:               db.acva_date || '',
          acvaStatus:             db.acva_status || 'pending',
          icmRegistryId:          db.icm_registry_id || '',
          bankingStatus:          db.banking_status || 'available',
          correspondingAdjustment:db.corresponding_adjustment || 'none',
          sdgTags:                db.sdg_tags || [],
          isOnChain:              false, // not yet minted
          doc_ipfs_hash:          db.doc_ipfs_hash || '',
        }));

      // ── 4. Combine and set ─────────────────────────────────────────
      const merged = [...onChainCredits, ...dbOnlyCredits];
      setMyCredits(merged);

      try {
        localStorage.setItem(`et_credits_${_addr}`, JSON.stringify(merged));
      } catch {}

    } catch (e) {
      console.error('loadMyCredits error:', e);
      // Fall back to cache
      try {
        const cached = localStorage.getItem(`et_credits_${walletAddress}`);
        if (cached) setMyCredits(JSON.parse(cached));
      } catch {}
    } finally {
      setLoading(l => ({ ...l, credits: false }));
    }
  }, [contracts, walletAddress, walletMismatch]);

  const loadListings = useCallback(async (c) => {
    const _c = c || contracts;
    if (!_c) return;
    setLoading(l => ({ ...l, listings: true }));
    try {
      const raw = await _c.market.getActiveListings();
      const enriched = await Promise.all(raw.map(async (l) => {
        const tokenId = Number(l.tokenId);
        let meta;
        try { meta = await _c.token.getCreditMetadata(tokenId); } catch { return null; }
        const dep       = vintagePenalty(Number(meta.vintageYear));
        const basePrice = parseFloat(ethers.formatEther(l.pricePerUnit));
        return {
          listingId:       Number(l.listingId),
          seller:          l.seller,
          tokenId,
          amount:          Number(l.amountRemaining),
          pricePerUnit:    basePrice,
          adjPrice:        +(basePrice * (1 - dep / 100)).toFixed(8),
          listedAt:        Number(l.listedAt),
          expiresAt:       Number(l.expiresAt),
          projectName:     meta.projectName,
          location:        meta.location,
          country:         meta.location.split(',').pop().trim(),
          standard:        STANDARD_FROM_ENUM[Number(meta.standard)] || 'VCS',
          projectType:     meta.projectType,
          developer:       meta.developer,
          vintageYear:     Number(meta.vintageYear),
          serialNumber:    meta.serialNumber,
          vintageDiscount: dep,
          active:          l.active,
        };
      }));
      const nowSec = Math.floor(Date.now() / 1000);
      setListings(enriched.filter(l => l && l.active && l.expiresAt > nowSec));
    } catch (e) {
      console.error('loadListings error:', e);
      setListings([]);
    } finally {
      setLoading(l => ({ ...l, listings: false }));
    }
  }, [contracts]);

  const loadBuyOrders = useCallback(async (c) => {
    const _c = c || contracts;
    if (!_c) return;
    setLoading(l => ({ ...l, buyOrders: true }));
    try {
      const raw    = await _c.market.getOpenBuyOrders();
      const orders = raw.map(o => ({
        orderId:      Number(o.orderId),
        buyer:        o.buyer,
        tokenId:      Number(o.tokenId),
        amount:       Number(o.amount),
        amountFilled: Number(o.amountFilled),
        remaining:    Number(o.amount) - Number(o.amountFilled),
        limitPrice:   parseFloat(ethers.formatEther(o.limitPrice)),
        ethEscrowed:  parseFloat(ethers.formatEther(o.ethEscrowed)),
        status:       Number(o.status),
        createdAt:    Number(o.createdAt),
        expiresAt:    Number(o.expiresAt),
      }));
      setBuyOrders(orders);
    } catch (e) {
      console.error('loadBuyOrders error:', e);
      setBuyOrders([]);
    } finally {
      setLoading(l => ({ ...l, buyOrders: false }));
    }
  }, [contracts]);

  const loadAMMPools = useCallback(async (c) => {
    const _c = c || contracts;
    if (!_c?.amm) return;
    try {
      const total = Number(await _c.amm.totalPools());
      const pools = [];
      for (let i = 1; i <= total; i++) {
        const pool  = await _c.amm.getPool(i);
        const price = await _c.amm.getPrice(i);
        pools.push({
          poolId:        i,
          tokenId:       Number(pool.tokenId),
          name:          pool.name,
          creditReserve: Number(pool.creditReserve),
          ethReserve:    parseFloat(ethers.formatEther(pool.ethReserve)),
          totalShares:   Number(pool.totalShares),
          active:        pool.active,
          priceEth:      parseFloat(ethers.formatEther(price)),
          priceInr:      parseFloat(ethers.formatEther(price)) * ETH_INR_RATE,
        });
      }
      setAmmPools(pools);
    } catch (e) {
      console.error('loadAMMPools error:', e);
    }
  }, [contracts]);

  const registerCredit = useCallback(async (formData) => {
    if (!contracts) throw new Error('Wallet not connected');
    if (walletMismatch) throw new Error('Wrong wallet connected');
    setLoading(l => ({ ...l, tx: true }));
    try {
      const params = {
        to:           walletAddress,
        amount:       parseInt(formData.credits),
        projectName:  formData.projectName,
        location:     formData.location,
        standard:     STANDARD_ENUM[formData.standard] ?? 0,
        projectType:  formData.projectType,
        developer:    formData.developer,
        vintageYear:  parseInt(formData.vintageYear),
        expiryDate:   Math.floor(new Date(formData.expiryDate).getTime() / 1000),
        serialNumber: formData.serialNumber,
        metadataURI:  '',
      };
      const tx      = await contracts.token.mintCredit(params);
      const receipt = await tx.wait();
      const event   = receipt.logs.find(l => {
        try { return contracts.token.interface.parseLog(l)?.name === 'CreditMinted'; } catch { return false; }
      });
      const tokenId = event ? Number(contracts.token.interface.parseLog(event).args.tokenId) : null;
      await loadMyCredits();
      return { success: true, tokenId, txHash: tx.hash };
    } catch (e) { throw e; }
    finally { setLoading(l => ({ ...l, tx: false })); }
  }, [contracts, walletAddress, walletMismatch, loadMyCredits]);

  const listCredit = useCallback(async (tokenId, amount, priceInEth, durationDays = 30) => {
    if (!contracts) throw new Error('Wallet not connected');
    if (walletMismatch) throw new Error('Wrong wallet connected');
    setLoading(l => ({ ...l, tx: true }));
    try {
      const approved = await contracts.token.isApprovedForAll(walletAddress, ADDRESSES.Marketplace);
      if (!approved) {
        const tx = await contracts.token.setApprovalForAll(ADDRESSES.Marketplace, true);
        await tx.wait();
      }
      const tx = await contracts.market.listCredit(
        tokenId, amount,
        ethers.parseEther(priceInEth.toString()),
        durationDays * 86400
      );
      await tx.wait();
      await loadMyCredits();
      return { success: true, txHash: tx.hash };
    } catch (e) { throw e; }
    finally { setLoading(l => ({ ...l, tx: false })); }
  }, [contracts, walletAddress, walletMismatch, loadMyCredits]);

  const delistCredit = useCallback(async (listingId) => {
    if (!contracts) throw new Error('Wallet not connected');
    if (walletMismatch) throw new Error('Wrong wallet connected');
    setLoading(l => ({ ...l, tx: true }));
    try {
      const tx = await contracts.market.cancelListing(listingId);
      await tx.wait();
      await loadMyCredits();
      return { success: true, txHash: tx.hash };
    } catch (e) { throw e; }
    finally { setLoading(l => ({ ...l, tx: false })); }
  }, [contracts, walletMismatch, loadMyCredits]);

  const retireCredit = useCallback(async (tokenId, amount) => {
    if (!contracts) throw new Error('Wallet not connected');
    if (walletMismatch) throw new Error('Wrong wallet connected');
    setLoading(l => ({ ...l, tx: true }));
    try {
      const tx = await contracts.token.retireCredit(tokenId, amount);
      await tx.wait();
      await loadMyCredits();
      return { success: true, txHash: tx.hash };
    } catch (e) { throw e; }
    finally { setLoading(l => ({ ...l, tx: false })); }
  }, [contracts, walletMismatch, loadMyCredits]);

  const buyCredit = useCallback(async (listingId, amount, totalEth) => {
    if (!contracts) throw new Error('Wallet not connected');
    if (walletMismatch) throw new Error('Wrong wallet connected');
    setLoading(l => ({ ...l, tx: true }));
    try {
      const tx = await contracts.market.buyCredit(
        listingId, amount,
        { value: ethers.parseEther(totalEth.toString()) }
      );
      await tx.wait();
      return { success: true, txHash: tx.hash };
    } catch (e) { throw e; }
    finally { setLoading(l => ({ ...l, tx: false })); }
  }, [contracts, walletMismatch]);

  const placeBuyOrder = useCallback(async (tokenId, amount, limitPriceEth, durationDays = 7) => {
    if (!contracts) throw new Error('Wallet not connected');
    if (walletMismatch) throw new Error('Wrong wallet connected');
    setLoading(l => ({ ...l, tx: true }));
    try {
      const limitWei  = ethers.parseEther(limitPriceEth.toString());
      const totalCost = limitWei * BigInt(amount); // eslint-disable-line no-undef
      const fee       = totalCost * 50n / 10000n;
      const tx = await contracts.market.placeBuyOrder(
        tokenId, amount, limitWei,
        durationDays * 86400,
        { value: totalCost + fee }
      );
      await tx.wait();
      await loadBuyOrders();
      return { success: true, txHash: tx.hash };
    } catch (e) { throw e; }
    finally { setLoading(l => ({ ...l, tx: false })); }
  }, [contracts, walletMismatch, loadBuyOrders]);

  const cancelBuyOrder = useCallback(async (orderId) => {
    if (!contracts) throw new Error('Wallet not connected');
    if (walletMismatch) throw new Error('Wrong wallet connected');
    setLoading(l => ({ ...l, tx: true }));
    try {
      const tx = await contracts.market.cancelBuyOrder(orderId);
      await tx.wait();
      await loadBuyOrders();
      return { success: true, txHash: tx.hash };
    } catch (e) { throw e; }
    finally { setLoading(l => ({ ...l, tx: false })); }
  }, [contracts, walletMismatch, loadBuyOrders]);

  const ammSwapETHForCredits = useCallback(async (poolId, ethAmount, minCredits = 0) => {
    if (!contracts?.amm) throw new Error('AMM not available');
    if (walletMismatch) throw new Error('Wrong wallet connected');
    setLoading(l => ({ ...l, tx: true }));
    try {
      const tx = await contracts.amm.swapETHForCredits(poolId, minCredits, { value: ethers.parseEther(ethAmount.toString()) });
      await tx.wait();
      await loadMyCredits(); await loadAMMPools();
      return { success: true, txHash: tx.hash };
    } catch (e) { throw e; }
    finally { setLoading(l => ({ ...l, tx: false })); }
  }, [contracts, walletMismatch, loadMyCredits, loadAMMPools]);

  const ammSwapCreditsForETH = useCallback(async (poolId, credits, minEth = 0) => {
    if (!contracts?.amm) throw new Error('AMM not available');
    if (walletMismatch) throw new Error('Wrong wallet connected');
    setLoading(l => ({ ...l, tx: true }));
    try {
      const approved = await contracts.token.isApprovedForAll(walletAddress, ADDRESSES.AMMPool);
      if (!approved) {
        const t = await contracts.token.setApprovalForAll(ADDRESSES.AMMPool, true);
        await t.wait();
      }
      const tx = await contracts.amm.swapCreditsForETH(poolId, credits, ethers.parseEther(minEth.toString()));
      await tx.wait();
      await loadMyCredits(); await loadAMMPools();
      return { success: true, txHash: tx.hash };
    } catch (e) { throw e; }
    finally { setLoading(l => ({ ...l, tx: false })); }
  }, [contracts, walletAddress, walletMismatch, loadMyCredits, loadAMMPools]);

  const ammAddLiquidity = useCallback(async (poolId, creditAmount, ethAmount) => {
    if (!contracts?.amm) throw new Error('AMM not available');
    if (walletMismatch) throw new Error('Wrong wallet connected');
    setLoading(l => ({ ...l, tx: true }));
    try {
      const approved = await contracts.token.isApprovedForAll(walletAddress, ADDRESSES.AMMPool);
      if (!approved) {
        const t = await contracts.token.setApprovalForAll(ADDRESSES.AMMPool, true);
        await t.wait();
      }
      const tx = await contracts.amm.addLiquidity(poolId, creditAmount, { value: ethers.parseEther(ethAmount.toString()) });
      await tx.wait();
      await loadMyCredits(); await loadAMMPools();
      return { success: true, txHash: tx.hash };
    } catch (e) { throw e; }
    finally { setLoading(l => ({ ...l, tx: false })); }
  }, [contracts, walletAddress, walletMismatch, loadMyCredits, loadAMMPools]);

  // ── Also load DB credits on mount even without wallet ─────────────
  // So approved credits show up before MetaMask is connected
  useEffect(() => {
    fetchMyRetirements().then(setMyRetirements);
    fetchDBCredits().then(dbCredits => {
      if (!dbCredits.length) return;
      setMyCredits(prev => {
        // Only pre-populate if blockchain hasn't loaded yet
        if (prev.length > 0) return prev;
        return dbCredits.map(db => ({
          id:             `db-${db.id}`,
          tokenId:        db.token_id || null,
          tokenHex:       null,
          projectId:      db.project_id || '',
          projectName:    db.project_name || db.projectName,
          location:       db.project_location || '',
          country:        db.country || '',
          standard:       db.standard || 'VCS',
          projectType:    db.project_type || '',
          developer:      db.developer || '',
          vintageYear:    db.vintage_year,
          expiryDate:     db.expiry_date || '',
          serialNumber:   db.registry_serial,
          credits:        db.available_credits ?? db.quantity ?? 0,
          heldCredits:    db.available_credits ?? db.quantity ?? 0,
          listedCredits:  0,
          totalRetired:   0,
          active:         true,
          status:         'HELD',
          pricePerCredit: 850,
          listingId:      null,
          vintageDiscount:vintagePenalty(db.vintage_year || 0),
          admin_status:   'approved',
          isOnChain:      false,
          creditType:             db.credit_type || 'voluntary',
          cbamEligible:           db.cbam_eligible || false,
          sdgTags:                db.sdg_tags || [],
          correspondingAdjustment:db.corresponding_adjustment || 'none',
          acvaStatus:             db.acva_status || 'pending',
        }));
      });
    });
  }, []);

  const stats = {
    totalCredits: myCredits
      .filter(c => c.status !== 'RETIRED')
      .reduce((s, c) => {
        const qty = c.heldCredits !== undefined ? c.heldCredits : (c.status === 'HELD' ? c.credits : 0);
        return s + qty;
      }, 0),
    totalValue: myCredits
      .filter(c => c.status !== 'RETIRED')
      .reduce((s, c) => {
        const priceInr = c.pricePerCredit > 0 ? c.pricePerCredit : 850;
        const dep      = vintagePenalty(c.vintageYear) / 100;
        const qty      = c.heldCredits !== undefined ? c.heldCredits : (c.status === 'HELD' ? c.credits : 0);
        return s + qty * priceInr * (1 - dep);
      }, 0),
    // ✅ FIX: listedCount = sum of listedCredits, not count of cards
    listedCount: myCredits
      .filter(c => c.status === 'LISTED')
      .reduce((s, c) => s + (c.listedCredits || 0), 0),
    // ✅ FIX: retiredCount = sum of tCO₂ from retirements table
    retiredCount: myRetirements
      .reduce((s, r) => s + (parseInt(r.amount) || 0), 0),
    heldCount: myCredits.filter(c => c.status === 'HELD').length,
    openBids:  buyOrders.filter(o => o.status === 0 || o.status === 2).length,
  };

  return (
    <PortfolioContext.Provider value={{
      provider, signer, walletAddress, isKYCVerified, contracts, chainOk,
      walletMismatch, walletMismatchInfo,
      myCredits, myRetirements, listings, buyOrders, tradeHistory, ammPools, stats,
      loading, error,
      registerCredit, listCredit, delistCredit, retireCredit,
      buyCredit, placeBuyOrder, cancelBuyOrder,
      ammSwapETHForCredits, ammSwapCreditsForETH, ammAddLiquidity,
      loadMyCredits, loadListings, loadBuyOrders, loadAMMPools, refreshKYC,
      // ✅ refresh retirements after a new retirement
      refreshRetirements: () => fetchMyRetirements().then(setMyRetirements),
      vintagePenalty, STANDARD_ENUM, STANDARD_FROM_ENUM, ETH_INR_RATE: 280000,
    }}>
      {children}
    </PortfolioContext.Provider>
  );
}

export function usePortfolio() {
  const ctx = useContext(PortfolioContext);
  if (!ctx) throw new Error('usePortfolio must be inside PortfolioProvider');
  return ctx;
}

export default PortfolioContext;