// Custody Adapter Factory - Single point to get the right custody adapter

import { CustodyAdapter, CustodyType, CustodyAdapterConfig } from './CustodyAdapter';
import { OnChainCustodyAdapter } from './OnChainCustodyAdapter';
import { LedgerCustodyAdapter } from './LedgerCustodyAdapter';

export class CustodyAdapterFactory {
  private static onChainAdapter: OnChainCustodyAdapter | null = null;
  private static ledgerAdapter: LedgerCustodyAdapter | null = null;
  private static config: CustodyAdapterConfig | null = null;

  static initialize(config: CustodyAdapterConfig): void {
    this.config = config;
    this.onChainAdapter = new OnChainCustodyAdapter(config);
    this.ledgerAdapter = new LedgerCustodyAdapter(config);
  }

  static getAdapter(custodyType: CustodyType): CustodyAdapter {
    switch (custodyType) {
      case 'onchain':
        if (!this.onChainAdapter) {
          throw new Error('OnChainCustodyAdapter not initialized. Call CustodyAdapterFactory.initialize() first.');
        }
        return this.onChainAdapter;
      case 'ledger':
        if (!this.ledgerAdapter) {
          throw new Error('LedgerCustodyAdapter not initialized. Call CustodyAdapterFactory.initialize() first.');
        }
        return this.ledgerAdapter;
      default:
        throw new Error(`Unknown custody type: ${custodyType}`);
    }
  }

  static getOnChainAdapter(): OnChainCustodyAdapter {
    if (!this.onChainAdapter) {
      throw new Error('OnChainCustodyAdapter not initialized');
    }
    return this.onChainAdapter;
  }

  static getLedgerAdapter(): LedgerCustodyAdapter {
    if (!this.ledgerAdapter) {
      throw new Error('LedgerCustodyAdapter not initialized');
    }
    return this.ledgerAdapter;
  }

  static isInitialized(): boolean {
    return this.onChainAdapter !== null && this.ledgerAdapter !== null;
  }

  static getConfig(): CustodyAdapterConfig | null {
    return this.config;
  }
}

// Auto-initialize from environment (for backward compatibility)
export function initializeCustodyAdaptersFromEnv(): void {
  const config: CustodyAdapterConfig = {
    rpcUrl: process.env.ALCHEMY_RPC!,
    chainId: parseInt(process.env.CHAIN_ID || '80001'),
    contracts: {
      marketplace: process.env.MARKETPLACE_ADDRESS!,
      carbonCreditToken: process.env.CARBON_CREDIT_TOKEN_ADDRESS!,
      kycRegistry: process.env.KYC_REGISTRY_ADDRESS!,
      creditLedger: process.env.CREDIT_LEDGER_ADDRESS!,
    },
    custodyWallet: {
      address: process.env.CUSTODY_WALLET_ADDRESS!,
      privateKey: process.env.ETHERTRACK_CUSTODY_PRIVATE_KEY!,
    },
    minterWallet: {
      address: process.env.MINTER_WALLET_ADDRESS!,
      privateKey: process.env.MINTER_PRIVATE_KEY!,
    },
  };

  // Validate required env vars
  const required = [
    'ALCHEMY_RPC', 'CHAIN_ID', 'MARKETPLACE_ADDRESS', 'CARBON_CREDIT_TOKEN_ADDRESS',
    'KYC_REGISTRY_ADDRESS', 'CREDIT_LEDGER_ADDRESS', 'CUSTODY_WALLET_ADDRESS',
    'ETHERTRACK_CUSTODY_PRIVATE_KEY', 'MINTER_WALLET_ADDRESS', 'MINTER_PRIVATE_KEY'
  ];
  
  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }

  CustodyAdapterFactory.initialize(config);
}