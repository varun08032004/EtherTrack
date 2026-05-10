import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { ethers } from 'ethers';

const ADDRESSES = {
  CarbonCreditToken: process.env.REACT_APP_CARBON_CREDIT_TOKEN_ADDRESS,
  Marketplace:       process.env.REACT_APP_MARKETPLACE_ADDRESS,
  EmissionRegistry:  process.env.REACT_APP_EMISSION_REGISTRY_ADDRESS,
  Treasury:          process.env.REACT_APP_TREASURY_ADDRESS,
  AMMPool:           process.env.REACT_APP_AMM_POOL_ADDRESS,
};

const API              = process.env.REACT_APP_API_URL || 'http://localhost:5000';
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
    'function listCredit(uint256 tokenId, uint256 amount, uint256 pricePerUnit, uint256 pricePerUnitINR, uint256 duration) returns (uint256)',
    'function cancelListing(uint256 listingId)',
    'function updateListingPrice(uint256 listingId, uint256 newPriceEth, uint256 newPriceINR)',
    'function buyCredit(uint256 listingId, uint256 amount) payable',
    'function placeBuyOrder(uint256 tokenId, uint256 amount, uint256 limitPrice, uint256 duration) payable returns (uint256)',
    'function cancelBuyOrder(uint256 orderId)',
    'function getActiveListings() view returns (tuple(uint256 listingId,address seller,uint256 tokenId,uint256 amount,uint256 amountRemaining,uint256 pricePerUnit,uint256 pricePerUnitINR,uint256 listedAt,uint256 expiresAt,bool active)[])',
    'function getOpenBuyOrders() view returns (tuple(uint256 orderId,address buyer,uint256 tokenId,uint256 amount,uint256 amountFilled,uint256 limitPrice,uint256 ethEscrowed,uint8 status,uint256 createdAt,uint256 expiresAt)[])',
    'function listings(uint256) view returns (tuple(uint256 listingId,address seller,uint256 tokenId,uint256 amount,uint256 amountRemaining,uint256 pricePerUnit,uint256 pricePerUnitINR,uint256 listedAt,uint256 expiresAt,bool active))',
    'function getOrderBook(uint256 tokenId) view returns (tuple(uint256 listingId,address seller,uint256 tokenId,uint256 amount,uint256 amountRemaining,uint256 pricePerUnit,uint256 pricePerUnitINR,uint256 listedAt,uint256 expiresAt,bool active)[] asks, tuple(uint256 orderId,address buyer,uint256 tokenId,uint256 amount,uint256 amountFilled,uint256 limitPrice,uint256 ethEscrowed,uint8 status,uint256 createdAt,uint256 expiresAt)[] bids)',
    'function getSellerListings(address seller) view returns (uint256[])',
    'function getBuyerOrders(address buyer) view returns (uint256[])',
    'function calculateBuyerCost(uint256 amount, uint256 pricePerUnit) view returns (uint256 subtotal, uint256 buyerFee, uint256 totalBuyerPays)',
    'function calculateSellerReceives(uint256 amount, uint256 pricePerUnit) view returns (uint256 subtotal, uint256 sellerFee, uint256 sellerReceives)',
    'function shouldUseAMM(uint256 amount) view returns (bool)',
    'function ammThreshold() view returns (uint256)',
    'event CreditTraded(uint256 indexed tradeId,uint256 indexed listingId,uint256 indexed buyOrderId,address buyer,address seller,uint256 tokenId,uint256 amount,uint256 pricePerUnit,uint256 pricePerUnitINR,uint256 totalPrice,uint256 buyerFee,uint256 sellerFee,uint256 totalFee,bool isAMM)',
    'event CreditListed(uint256 indexed listingId,address indexed seller,uint256 indexed tokenId,uint256 amount,uint256 pricePerUnit,uint256 pricePerUnitINR)',
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
    'function getPool(uint256 poolId) view returns (tuple(uint256 tokenId,uint256 creditReserve,uint256 ethReserve,uint256 totalShares,bool active,string name))',
    'function getPrice(uint256 poolId) view returns (uint256)',
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

// ── Auth fetch helper ─────────────────────────────────────────────
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

// ── Public fetch (no auth needed) ────────────────────────────────
const publicFetch = async (path) => {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
};

const fetchDBKycStatus   = async () => { try { const d = await authFetch('/api/auth/me'); return !!(d.kyc_verified || d.kyc_status === 'verified'); } catch { return false; } };
const fetchBoundWallet   = async () => { try { const d = await authFetch('/api/wallet/status'); return d.walletAddress?.toLowerCase() || null; } catch { return null; } };
const fetchDBCredits     = async () => { try { const d = await authFetch('/api/portfolio/my-credits'); return d.credits || []; } catch { return []; } };
const fetchMyRetirements = async () => { try { const d = await authFetch('/api/transactions/retirements'); return d.retirements || []; } catch { return []; } };
const fetchETHRate       = async () => { try { const d = await authFetch('/api/trades/eth-rate'); return d.rate || 280000; } catch { return 280000; } };

// ── Public listings fetch (no auth needed) ────────────────────────
const fetchListingsFromAPI = async () => {
  try {
    const d = await publicFetch('/api/market/listings');
    return d.listings || [];
  } catch {
    return [];
  }
};

// ── ✅ Safe number helper — fixes PostgreSQL returning numerics as strings ──
// PostgreSQL returns numeric/decimal columns as strings in JSON.
// Always wrap price fields with safeNum() before calling .toFixed()
const safeNum = (val, fallback = 0) => {
  const n = Number(val);
  return isNaN(n) ? fallback : n;
};

const PortfolioContext = createContext(null);

export function PortfolioProvider({ children }) {
  const [provider,           setProvider]           = useState(null);
  const [signer,             setSigner]             = useState(null);
  const [walletAddress,      setWalletAddress]      = useState('');
  const [contracts,          setContracts]          = useState(null);
  const [isKYCVerified,      setIsKYCVerified]      = useState(false);
  const [chainOk,            setChainOk]            = useState(false);
  const [walletMismatch,     setWalletMismatch]     = useState(false);
  const [walletMismatchInfo, setWalletMismatchInfo] = useState(null);
  const [myCredits,          setMyCredits]          = useState([]);
  const [myRetirements,      setMyRetirements]      = useState([]);
  const [listings,           setListings]           = useState([]);
  const [buyOrders,          setBuyOrders]          = useState([]);
  const [tradeHistory,       setTradeHistory]       = useState([]);
  const [ammPools,           setAmmPools]           = useState([]);
  const [loading,            setLoading]            = useState({ credits:false, listings:false, buyOrders:false, tx:false });
  const [error,              setError]              = useState('');
  const [ethINRRate,         setEthINRRate]         = useState(280000);

  const listenersRef = useRef([]);

  // ── Load listings from API on mount — no wallet needed ────────
  useEffect(() => {
    loadListingsFromAPI();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch live ETH rate on mount and every 5 min
  useEffect(() => {
    fetchETHRate().then(setEthINRRate);
    const id = setInterval(() => fetchETHRate().then(setEthINRRate), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // ── KYC status check runs independently of wallet ─────────────
  useEffect(() => {
    fetchDBKycStatus().then(v => { if (v) setIsKYCVerified(true); });
  }, []);

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

  // ── loadListingsFromAPI — wallet-independent ──────────────────
  const loadListingsFromAPI = useCallback(async () => {
    setLoading(l => ({ ...l, listings: true }));
    try {
      const apiListings = await fetchListingsFromAPI();
      if (apiListings.length > 0) {
        const mapped = apiListings.map(l => {
          const dep = vintagePenalty(safeNum(l.vintage_year || l.vintageYear, 0));

          // ✅ FIX: Always use safeNum() — PostgreSQL returns numerics as strings
          const priceINR    = safeNum(l.price_per_credit_inr || l.pricePerUnitINR, 850);
          const priceEth    = safeNum(l.price_per_credit_eth || l.pricePerUnit, priceINR / 280000);
          const adjPriceINR = Math.round(priceINR * (1 - dep / 100));
          const adjPriceEth = +(priceEth * (1 - dep / 100)).toFixed(8);

          return {
            listingId:       safeNum(l.listing_id_onchain ?? l.listingId ?? l.id, 0),
            seller:          l.seller_wallet || l.seller || '',
            tokenId:         safeNum(l.token_id ?? l.tokenId, null) || null,
            amount:          safeNum(l.available_credits ?? l.amount, 0),
            pricePerUnit:    +priceEth.toFixed(8),   // ✅ always number
            pricePerUnitINR: +priceINR,              // ✅ always number
            adjPrice:        adjPriceEth,            // ✅ always number
            adjPriceINR:     +adjPriceINR,           // ✅ always number
            adjPriceInr:     +adjPriceINR,           // backwards compat
            projectName:     l.project_name || l.projectName || '',
            location:        l.project_location || l.location || '',
            country:         (l.project_location || l.location || '').split(',').pop().trim(),
            standard:        l.standard || 'VCS',
            projectType:     l.project_type || l.projectType || '',
            developer:       l.developer || '',
            vintageYear:     safeNum(l.vintage_year || l.vintageYear, 0),
            serialNumber:    l.registry_serial || l.serialNumber || '',
            vintageDiscount: dep,
            active:          true,
            batchId:         l.id || l.batchId || null,
            expiresAt:       safeNum(l.expires_at || l.expiresAt, Date.now() / 1000 + 86400 * 30),
            listedAt:        safeNum(l.listed_at || l.listedAt, Date.now() / 1000),
          };
        });
        setListings(mapped);
      }
    } catch (e) {
      console.warn('API listings load failed:', e.message);
    } finally {
      setLoading(l => ({ ...l, listings: false }));
    }
  }, []);

  const init = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      if (!accounts.length) {
        setWalletAddress(''); setContracts(null);
        setChainOk(false);
        setWalletMismatch(false); setWalletMismatchInfo(null);
        // ✅ Don't clear KYC — it's account-level not wallet-level
        return;
      }
      const metamaskWallet = accounts[0].toLowerCase();
      const boundWallet    = await fetchBoundWallet();
      if (boundWallet && boundWallet !== metamaskWallet) {
        setWalletMismatch(true);
        setWalletMismatchInfo({ metamaskWallet, boundWallet });
        setWalletAddress(''); setContracts(null);
        setChainOk(false);
        setMyCredits([]);
        setError(`Wrong wallet. Account bound to ${boundWallet.slice(0,6)}...${boundWallet.slice(-4)}`);
        return;
      }
      setWalletMismatch(false); setWalletMismatchInfo(null); setError('');
      const ok = await checkChain();
      setChainOk(ok);
      if (!ok) {
        setContracts(null);
        setError('Switch MetaMask to Sepolia');
        return;
      }
      const _provider = new ethers.BrowserProvider(window.ethereum);
      const _signer   = await _provider.getSigner();
      const _address  = await _signer.getAddress();
      setProvider(_provider); setSigner(_signer); setWalletAddress(_address);
      const c = buildContracts(_signer);
      setContracts(c);

      // ✅ Re-check KYC after wallet connects
      const verified = await fetchDBKycStatus();
      setIsKYCVerified(verified);

      _setupListeners(c, _address);

      // Upgrade to on-chain data now that wallet is connected
      loadListings(c);
      loadBuyOrders(c);
      loadMyCredits(c, _address);
      if (c.amm) loadAMMPools(c);

    } catch (e) { console.error('Wallet init error:', e); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const _setupListeners = (c, address) => {
    listenersRef.current.forEach(({ contract, event, handler }) => { try { contract.off(event, handler); } catch {} });
    listenersRef.current = [];
    const addr = address.toLowerCase();

    const onTraded = (tradeId, listingId, buyOrderId, buyer, seller, tokenId, amount, pricePerUnit, pricePerUnitINR, totalPrice, buyerFee, sellerFee, totalFee, isAMM) => {
      const isBuyer  = buyer?.toLowerCase()  === addr;
      const isSeller = seller?.toLowerCase() === addr;
      if (isBuyer || isSeller) {
        setTimeout(() => { loadMyCredits(c, address); loadListings(c); loadBuyOrders(c); }, 2500);
        setTradeHistory(prev => [{
          id:           `TXN-${Date.now()}`,
          type:         isBuyer ? 'Buy' : 'Sell',
          tradeId:      Number(tradeId),
          listingId:    Number(listingId),
          tokenId:      Number(tokenId),
          amount:       Number(amount),
          totalEth:     ethers.formatEther(totalPrice),
          priceINR:     Number(pricePerUnitINR),
          buyerFeeINR:  Number(buyerFee),
          sellerFeeINR: Number(sellerFee),
          time:         new Date().toLocaleTimeString(),
          status:       'Confirmed',
          isAMM,
        }, ...prev.slice(0, 49)]);
      } else {
        setTimeout(() => { loadListings(c); loadBuyOrders(c); }, 2000);
      }
    };

    const onMatch  = () => setTimeout(() => { loadListings(c); loadBuyOrders(c); }, 1500);
    const onListed = () => setTimeout(() => { loadListings(c); loadListingsFromAPI(); }, 1500);
    const onBid    = () => setTimeout(() => loadBuyOrders(c), 1500);
    const onUnlist = () => setTimeout(() => { loadListings(c); loadListingsFromAPI(); }, 1500);
    const onUnbid  = () => setTimeout(() => loadBuyOrders(c), 1500);

    c.market.on('CreditTraded',      onTraded);
    c.market.on('MatchExecuted',     onMatch);
    c.market.on('CreditListed',      onListed);
    c.market.on('BuyOrderPlaced',    onBid);
    c.market.on('ListingCancelled',  onUnlist);
    c.market.on('BuyOrderCancelled', onUnbid);

    listenersRef.current = [
      { contract:c.market, event:'CreditTraded',      handler:onTraded  },
      { contract:c.market, event:'MatchExecuted',     handler:onMatch   },
      { contract:c.market, event:'CreditListed',      handler:onListed  },
      { contract:c.market, event:'BuyOrderPlaced',    handler:onBid     },
      { contract:c.market, event:'ListingCancelled',  handler:onUnlist  },
      { contract:c.market, event:'BuyOrderCancelled', handler:onUnbid   },
    ];
  };

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
      listenersRef.current.forEach(({ contract, event, handler }) => { try { contract.off(event, handler); } catch {} });
    };
  }, [init]);

  // Pre-populate from DB on mount even without wallet
  useEffect(() => {
    fetchMyRetirements().then(setMyRetirements);
    fetchDBCredits().then(dbCredits => {
      if (!dbCredits.length) return;
      setMyCredits(prev => {
        if (prev.length > 0) return prev;
        return dbCredits.map(db => ({
          id:             `db-${db.id}`,
          tokenId:        db.token_id || null,
          tokenHex:       null,
          projectId:      db.project_id || '',
          projectName:    db.project_name,
          location:       db.project_location || '',
          country:        db.country || '',
          standard:       db.standard || 'VCS',
          projectType:    db.project_type || '',
          developer:      db.developer || '',
          vintageYear:    safeNum(db.vintage_year, 0),
          expiryDate:     db.expiry_date || '',
          serialNumber:   db.registry_serial,
          credits:        safeNum(db.available_credits ?? db.quantity, 0),
          heldCredits:    safeNum(db.available_credits ?? db.quantity, 0),
          listedCredits:  0,
          totalRetired:   0,
          active:         true,
          status:         'HELD',
          pricePerCredit: safeNum(db.price_per_credit_inr || db.last_traded_price_inr, 850),
          listingId:      null,
          vintageDiscount:vintagePenalty(safeNum(db.vintage_year, 0)),
          admin_status:   'approved',
          isOnChain:      db.token_id != null,  // ✅ token_id set = minted on chain
          creditType:             db.credit_type || 'voluntary',
          cbamEligible:           db.cbam_eligible || false,
          sdgTags:                db.sdg_tags || [],
          correspondingAdjustment:db.corresponding_adjustment || 'none',
          acvaStatus:             db.acva_status || 'pending',
        }));
      });
    });
  }, []);

  const refreshKYC = useCallback(async () => {
    try { const v = await fetchDBKycStatus(); setIsKYCVerified(v); return v; }
    catch { return false; }
  }, []);

  // ── loadMyCredits ─────────────────────────────────────────────
  const loadMyCredits = useCallback(async (c, addr) => {
    const _c = c || contracts;
    const _addr = addr || walletAddress;

    // Only block on wallet mismatch
    if (walletMismatch) return;

    setLoading(l => ({ ...l, credits: true }));

    try {
      // Always fetch DB credits first
      const dbCredits = await fetchDBCredits();
      let onChainCredits = [];

      // Only fetch on-chain data if wallet + contracts exist
      if (_addr && _c) {
        try {
          const nextId = await _c.token.getNextTokenId();
          const total = Number(nextId);

          const sellerIds = await _c.market.getSellerListings(_addr);
          const sellerListings = await Promise.all(
            sellerIds.map(lid => _c.market.listings(lid))
          );

          for (let tokenId = 0; tokenId < total; tokenId++) {
            const bal = await _c.token.balanceOf(_addr, tokenId);
            const heldBal = Number(bal);

            let listingId = null;
            let listingPrice = 0;
            let listingPriceINR = 0;
            let listedBal = 0;

            for (let i = 0; i < sellerListings.length; i++) {
              const l = sellerListings[i];

              if (Number(l.tokenId) === tokenId && l.active) {
                listingId = Number(sellerIds[i]);
                listingPrice = parseFloat(ethers.formatEther(l.pricePerUnit));
                listingPriceINR = safeNum(
                  l.pricePerUnitINR,
                  Math.round(listingPrice * ethINRRate)
                );
                listedBal = Number(l.amountRemaining);
                break;
              }
            }

            const totalBal = heldBal + listedBal;
            if (totalBal === 0) continue;

            const meta = await _c.token.getCreditMetadata(tokenId);
            const retired = await _c.token.getTotalRetired(tokenId);
            const dep = vintagePenalty(Number(meta.vintageYear));
            const stdStr = STANDARD_FROM_ENUM[Number(meta.standard)] || 'VCS';

            const priceInr =
              listingPriceINR > 0
                ? listingPriceINR
                : listingPrice > 0
                ? Math.round(listingPrice * ethINRRate)
                : 850;

            onChainCredits.push({
              id: tokenId,
              tokenId,
              tokenHex: `0x${tokenId.toString(16).padStart(8, '0').toUpperCase()}`,
              projectId: meta.serialNumber,
              projectName: meta.projectName,
              location: meta.location,
              country: meta.location.split(',').pop().trim(),
              standard: stdStr,
              projectType: meta.projectType,
              developer: meta.developer,
              vintageYear: Number(meta.vintageYear),
              expiryDate: new Date(Number(meta.expiryDate) * 1000).toISOString().slice(0, 10),
              serialNumber: meta.serialNumber,
              credits: totalBal,
              heldCredits: heldBal,
              listedCredits: listedBal,
              totalRetired: Number(retired),
              active: meta.active,
              registeredBy: meta.registeredBy,
              registeredAt: new Date(Number(meta.registeredAt) * 1000).toISOString().slice(0, 10),
              ownerWallet: _addr,
              verificationStatus: meta.active ? 'Verified' : 'Retired',
              status: !meta.active ? 'RETIRED' : listedBal > 0 ? 'LISTED' : 'HELD',
              pricePerCredit: +priceInr,
              pricePerCreditEth: +listingPrice,
              listingId,
              vintageDiscount: dep,
              admin_status: 'approved',
              isOnChain: true,
            });
          }
        } catch (e) {
          console.warn('On-chain load failed, using DB:', e.message);
        }
      }

      // DB-only credits
      const onChainSerials = new Set(onChainCredits.map(c => c.serialNumber));

      const dbOnlyCredits = dbCredits
        .filter(db => !onChainSerials.has(db.registry_serial || db.serialNumber))
        .map(db => ({
          id: `db-${db.id}`,
          tokenId: db.token_id || null,
          tokenHex: db.token_id
            ? `0x${Number(db.token_id).toString(16).padStart(8, '0').toUpperCase()}`
            : null,
          projectId: db.project_id || '',
          projectName: db.project_name,
          location: db.project_location || '',
          country: db.country || '',
          standard: db.standard || 'VCS',
          projectType: db.project_type || '',
          developer: db.developer || '',
          vintageYear: safeNum(db.vintage_year, 0),
          expiryDate: db.expiry_date || '',
          serialNumber: db.registry_serial,
          credits: safeNum(db.available_credits ?? db.quantity, 0),
          heldCredits: safeNum(db.available_credits ?? db.quantity, 0),
          listedCredits: 0,
          totalRetired: safeNum(db.retired_credits, 0),
          active: true,
          ownerWallet: _addr || '',
          status:
            db.status === 'tokenised'
              ? 'HELD'
              : db.status === 'exhausted'
              ? 'RETIRED'
              : 'HELD',
          pricePerCredit: safeNum(
            db.price_per_credit_inr || db.last_traded_price_inr,
            850
          ),
          pricePerCreditEth: 0,
          listingId: null,
          vintageDiscount: vintagePenalty(safeNum(db.vintage_year, 0)),
          admin_status: db.admin_status || 'approved',
          isOnChain: db.token_id != null,  // ✅ token_id set = minted on chain
        }));

      // Merge safely — prevent accidental wipeout
      const merged = [...onChainCredits, ...dbOnlyCredits];

      if (!merged.length && dbCredits.length) {
        setMyCredits(dbOnlyCredits);
      } else {
        setMyCredits(merged);
      }

      if (_addr) {
        try {
          localStorage.setItem(`et_credits_${_addr}`, JSON.stringify(merged));
        } catch {}
      }
    } catch (e) {
      console.error('loadMyCredits error:', e);
    } finally {
      setLoading(l => ({ ...l, credits: false }));
    }
  }, [contracts, walletAddress, walletMismatch, ethINRRate]);

  // ── loadListings — on-chain version (wallet required) ─────────
  const loadListings = useCallback(async (c) => {
    const _c = c || contracts;
    if (!_c) return loadListingsFromAPI();

    setLoading(l => ({ ...l, listings: true }));
    try {
      const raw      = await _c.market.getActiveListings();
      const enriched = await Promise.all(raw.map(async (l) => {
        const tokenId = Number(l.tokenId);
        let meta;
        try { meta = await _c.token.getCreditMetadata(tokenId); } catch { return null; }
        const dep         = vintagePenalty(Number(meta.vintageYear));
        const basePrice   = parseFloat(ethers.formatEther(l.pricePerUnit));
        const priceINR    = safeNum(l.pricePerUnitINR, Math.round(basePrice * ethINRRate));
        const adjPriceINR = Math.round(priceINR * (1 - dep / 100));
        return {
          listingId:       Number(l.listingId),
          seller:          l.seller,
          tokenId,
          amount:          Number(l.amountRemaining),
          pricePerUnit:    +basePrice,             // ✅ always number
          pricePerUnitINR: +priceINR,              // ✅ always number
          adjPrice:        +(basePrice * (1 - dep / 100)).toFixed(8),
          adjPriceINR:     +adjPriceINR,
          adjPriceInr:     +adjPriceINR,
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
      console.error('loadListings on-chain error:', e);
      await loadListingsFromAPI();
    }
    finally { setLoading(l => ({ ...l, listings: false })); }
  }, [contracts, ethINRRate, loadListingsFromAPI]);

  // ── loadBuyOrders ─────────────────────────────────────────────
  const loadBuyOrders = useCallback(async (c) => {
    const _c = c || contracts;
    if (!_c) return;
    setLoading(l => ({ ...l, buyOrders: true }));
    try {
      const raw = await _c.market.getOpenBuyOrders();
      setBuyOrders(raw.map(o => ({
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
      })));
    } catch (e) { console.error('loadBuyOrders error:', e); setBuyOrders([]); }
    finally { setLoading(l => ({ ...l, buyOrders: false })); }
  }, [contracts]);

  // ── loadAMMPools ──────────────────────────────────────────────
  const loadAMMPools = useCallback(async (c) => {
    const _c = c || contracts;
    if (!_c?.amm) return;
    try {
      const total = Number(await _c.amm.totalPools());
      const pools = [];
      for (let i = 1; i <= total; i++) {
        const pool     = await _c.amm.getPool(i);
        const price    = await _c.amm.getPrice(i);
        const priceEth = parseFloat(ethers.formatEther(price));
        pools.push({
          poolId:        i,
          tokenId:       Number(pool.tokenId),
          name:          pool.name,
          creditReserve: Number(pool.creditReserve),
          ethReserve:    parseFloat(ethers.formatEther(pool.ethReserve)),
          totalShares:   Number(pool.totalShares),
          active:        pool.active,
          priceEth:      +priceEth,
          priceInr:      +(priceEth * ethINRRate),
        });
      }
      setAmmPools(pools);
    } catch (e) { console.error('loadAMMPools error:', e); }
  }, [contracts, ethINRRate]);

  // ── Trade functions ───────────────────────────────────────────

  const registerCredit = useCallback(async (formData) => {
    if (!contracts || walletMismatch) throw new Error('Wallet not connected');
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
      const event   = receipt.logs.find(l => { try { return contracts.token.interface.parseLog(l)?.name === 'CreditMinted'; } catch { return false; } });
      const tokenId = event ? Number(contracts.token.interface.parseLog(event).args.tokenId) : null;
      await loadMyCredits();
      return { success: true, tokenId, txHash: tx.hash };
    } catch (e) { throw e; }
    finally { setLoading(l => ({ ...l, tx: false })); }
  }, [contracts, walletAddress, walletMismatch, loadMyCredits]);

  const listCredit = useCallback(async (tokenId, amount, priceInEth, priceInINR, durationDays = 30) => {
    if (!contracts || walletMismatch) throw new Error('Wallet not connected');
    setLoading(l => ({ ...l, tx: true }));
    try {
      const approved = await contracts.token.isApprovedForAll(walletAddress, ADDRESSES.Marketplace);
      if (!approved) {
        const approveTx = await contracts.token.setApprovalForAll(ADDRESSES.Marketplace, true);
        await approveTx.wait();
      }
      const inrPrice = priceInINR > 0
        ? Math.round(priceInINR)
        : Math.round(parseFloat(priceInEth) * ethINRRate);

      const tx = await contracts.market.listCredit(
        tokenId, amount,
        ethers.parseEther(priceInEth.toString()),
        inrPrice,
        durationDays * 86400
      );
      await tx.wait();
      await loadMyCredits();
      await loadListings();
      await loadListingsFromAPI();
      return { success: true, txHash: tx.hash };
    } catch (e) { throw e; }
    finally { setLoading(l => ({ ...l, tx: false })); }
  }, [contracts, walletAddress, walletMismatch, loadMyCredits, loadListings, loadListingsFromAPI, ethINRRate]);

  const delistCredit = useCallback(async (listingId) => {
    if (!contracts || walletMismatch) throw new Error('Wallet not connected');
    setLoading(l => ({ ...l, tx: true }));
    try {
      const tx = await contracts.market.cancelListing(listingId);
      await tx.wait();
      await loadMyCredits();
      await loadListings();
      await loadListingsFromAPI();
      return { success: true, txHash: tx.hash };
    } catch (e) { throw e; }
    finally { setLoading(l => ({ ...l, tx: false })); }
  }, [contracts, walletMismatch, loadMyCredits, loadListings, loadListingsFromAPI]);

  const retireCredit = useCallback(async (tokenId, amount) => {
    if (!contracts || walletMismatch) throw new Error('Wallet not connected');
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
    if (!contracts || walletMismatch) throw new Error('Wallet not connected');
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
    if (!contracts || walletMismatch) throw new Error('Wallet not connected');
    setLoading(l => ({ ...l, tx: true }));
    try {
      const limitWei  = ethers.parseEther(limitPriceEth.toString());
      const amountBig = ethers.toBigInt(amount);
      const totalCost = limitWei * amountBig;
      const buyerFee  = totalCost * ethers.toBigInt(50) / ethers.toBigInt(10000);
      const tx = await contracts.market.placeBuyOrder(
        tokenId, amount, limitWei,
        durationDays * 86400,
        { value: totalCost + buyerFee }
      );
      await tx.wait();
      await loadBuyOrders();
      return { success: true, txHash: tx.hash };
    } catch (e) { throw e; }
    finally { setLoading(l => ({ ...l, tx: false })); }
  }, [contracts, walletMismatch, loadBuyOrders]);

  const cancelBuyOrder = useCallback(async (orderId) => {
    if (!contracts || walletMismatch) throw new Error('Wallet not connected');
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
    if (!contracts?.amm || walletMismatch) throw new Error('AMM not available');
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
    if (!contracts?.amm || walletMismatch) throw new Error('AMM not available');
    setLoading(l => ({ ...l, tx: true }));
    try {
      const approved = await contracts.token.isApprovedForAll(walletAddress, ADDRESSES.AMMPool);
      if (!approved) { const t = await contracts.token.setApprovalForAll(ADDRESSES.AMMPool, true); await t.wait(); }
      const tx = await contracts.amm.swapCreditsForETH(poolId, credits, ethers.parseEther(minEth.toString()));
      await tx.wait();
      await loadMyCredits(); await loadAMMPools();
      return { success: true, txHash: tx.hash };
    } catch (e) { throw e; }
    finally { setLoading(l => ({ ...l, tx: false })); }
  }, [contracts, walletAddress, walletMismatch, loadMyCredits, loadAMMPools]);

  const ammAddLiquidity = useCallback(async (poolId, creditAmount, ethAmount) => {
    if (!contracts?.amm || walletMismatch) throw new Error('AMM not available');
    setLoading(l => ({ ...l, tx: true }));
    try {
      const approved = await contracts.token.isApprovedForAll(walletAddress, ADDRESSES.AMMPool);
      if (!approved) { const t = await contracts.token.setApprovalForAll(ADDRESSES.AMMPool, true); await t.wait(); }
      const tx = await contracts.amm.addLiquidity(poolId, creditAmount, { value: ethers.parseEther(ethAmount.toString()) });
      await tx.wait();
      await loadMyCredits(); await loadAMMPools();
      return { success: true, txHash: tx.hash };
    } catch (e) { throw e; }
    finally { setLoading(l => ({ ...l, tx: false })); }
  }, [contracts, walletAddress, walletMismatch, loadMyCredits, loadAMMPools]);

  // ── Stats ─────────────────────────────────────────────────────
  const stats = {
    totalCredits: myCredits
      .filter(c => c.status !== 'RETIRED')
      .reduce((s, c) => s + safeNum(c.heldCredits ?? (c.status === 'HELD' ? c.credits : 0), 0), 0),
    totalValue: myCredits
      .filter(c => c.status !== 'RETIRED')
      .reduce((s, c) => {
        const priceInr = safeNum(c.pricePerCredit, 850);
        const dep      = vintagePenalty(safeNum(c.vintageYear, 0)) / 100;
        const qty      = safeNum(c.heldCredits ?? (c.status === 'HELD' ? c.credits : 0), 0);
        return s + qty * priceInr * (1 - dep);
      }, 0),
    listedCount:  myCredits.filter(c => c.status === 'LISTED').reduce((s, c) => s + safeNum(c.listedCredits, 0), 0),
    retiredCount: myRetirements.reduce((s, r) => s + safeNum(r.amount, 0), 0),
    heldCount:    myCredits.filter(c => c.status === 'HELD').length,
    openBids:     buyOrders.filter(o => o.status === 0 || o.status === 2).length,
  };

  return (
    <PortfolioContext.Provider value={{
      provider, signer, walletAddress, isKYCVerified, contracts, chainOk,
      walletMismatch, walletMismatchInfo,
      myCredits, myRetirements, listings, buyOrders, tradeHistory, ammPools, stats,
      loading, error,
      ethINRRate,
      ETH_INR_RATE: ethINRRate,
      registerCredit, listCredit, delistCredit, retireCredit,
      buyCredit, placeBuyOrder, cancelBuyOrder,
      ammSwapETHForCredits, ammSwapCreditsForETH, ammAddLiquidity,
      loadMyCredits, loadListings, loadListingsFromAPI, loadBuyOrders, loadAMMPools, refreshKYC,
      refreshRetirements: () => fetchMyRetirements().then(setMyRetirements),
      vintagePenalty, STANDARD_ENUM, STANDARD_FROM_ENUM,
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