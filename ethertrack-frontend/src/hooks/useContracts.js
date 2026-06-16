import { useMemo } from 'react';
import { ethers }  from 'ethers';
import { CONTRACT_ADDRESSES, ABIS, NETWORKS } from '../config/contracts.config';

/**
 * useContracts
 * Returns ethers contract instances for the current network.
 * All other hooks (useKYC, usePortfolio, useMarket) call this first.
 *
 * Usage:
 *   const { marketplace, creditToken, kycRegistry } = useContracts();
 *   const listings = await marketplace.getActiveListings();
 */
export function useContracts() {
  return useMemo(() => {
    if (!window.ethereum) return {};

    const provider = new ethers.BrowserProvider(window.ethereum);

    const getChainId = async () => {
      const network = await provider.getNetwork();
      return Number(network.chainId);
    };

    const getContracts = async () => {
      const chainId   = await getChainId();
      const addresses = CONTRACT_ADDRESSES[chainId];
      if (!addresses) throw new Error(`Unsupported network: chainId ${chainId}`);

      const signer = await provider.getSigner();

      return {
        provider,
        signer,
        chainId,

        // ── Read-only contracts (no gas) ──
        kycRegistryRead:   new ethers.Contract(addresses.KYCRegistry,       ABIS.KYCRegistry,       provider),
        creditTokenRead:   new ethers.Contract(addresses.CarbonCreditToken,  ABIS.CarbonCreditToken, provider),
        marketplaceRead:   new ethers.Contract(addresses.Marketplace,        ABIS.Marketplace,       provider),
        emissionRead:      new ethers.Contract(addresses.EmissionRegistry,   ABIS.EmissionRegistry,  provider),
        treasuryRead:      new ethers.Contract(addresses.Treasury,           ABIS.Treasury,          provider),

        // ── Write contracts (requires wallet signature) ──
        kycRegistry:       new ethers.Contract(addresses.KYCRegistry,       ABIS.KYCRegistry,       signer),
        creditToken:       new ethers.Contract(addresses.CarbonCreditToken,  ABIS.CarbonCreditToken, signer),
        marketplace:       new ethers.Contract(addresses.Marketplace,        ABIS.Marketplace,       signer),
        emissionRegistry:  new ethers.Contract(addresses.EmissionRegistry,   ABIS.EmissionRegistry,  signer),
        treasury:          new ethers.Contract(addresses.Treasury,           ABIS.Treasury,          signer),

        // ── Raw addresses ──
        addresses,
      };
    };

    return { getContracts, provider };
  }, []);
}
