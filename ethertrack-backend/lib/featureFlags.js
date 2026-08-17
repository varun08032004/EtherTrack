// lib/featureFlags.js — EtherTrack
// Feature flag system for graceful degradation
'use strict';

const { EventEmitter } = require('events');
const logger = require('../services/logger');

class FeatureFlags extends EventEmitter {
  constructor() {
    super();
    this.flags = new Map();
    this.healthChecks = new Map();
    this.initDefaultFlags();
  }

  initDefaultFlags() {
    // Core feature flags
    this.define('blockchain.enabled', {
      default: true,
      description: 'Blockchain features enabled (minting, trading, retirement)',
      category: 'blockchain',
      dependsOn: ['blockchain.rpc.healthy', 'blockchain.contract.deployed']
    });

    this.define('blockchain.rpc.healthy', {
      default: true,
      description: 'RPC endpoint responding normally',
      category: 'blockchain',
      healthCheck: 'checkRpcHealth'
    });

    this.define('blockchain.contract.deployed', {
      default: true,
      description: 'Marketplace contract deployed and verified',
      category: 'blockchain',
      healthCheck: 'checkContractDeployed'
    });

    this.define('blockchain.minting', {
      default: true,
      description: 'Carbon credit minting via blockchain',
      category: 'blockchain',
      dependsOn: ['blockchain.enabled']
    });

    this.define('blockchain.trading', {
      default: true,
      description: 'On-chain credit trading (ETH/AMM)',
      category: 'blockchain',
      dependsOn: ['blockchain.enabled']
    });

    this.define('blockchain.retirement', {
      default: true,
      description: 'On-chain credit retirement',
      category: 'blockchain',
      dependsOn: ['blockchain.enabled']
    });

    this.define('blockchain.chainLogging', {
      default: true,
      description: 'INR trade logging to blockchain',
      category: 'blockchain',
      dependsOn: ['blockchain.enabled']
    });

    this.define('inrOnlyMode', {
      default: false,
      description: 'INR-only fallback mode (blockchain disabled)',
      category: 'fallback',
      dependsOn: [{ flag: 'blockchain.enabled', invert: true }]
    });

    this.define('pinata.enabled', {
      default: true,
      description: 'IPFS/Pinata uploads enabled',
      category: 'storage',
      healthCheck: 'checkPinataHealth'
    });

    this.define('razorpay.enabled', {
      default: true,
      description: 'Razorpay payments enabled',
      category: 'payments',
      healthCheck: 'checkRazorpayHealth'
    });

    this.define('firebase.auth', {
      default: true,
      description: 'Firebase authentication enabled',
      category: 'auth',
      healthCheck: 'checkFirebaseHealth'
    });
  }

  define(name, config) {
    const flag = {
      name,
      value: config.default,
      defaultValue: config.default,
      description: config.description,
      category: config.category || 'general',
      dependsOn: config.dependsOn || [],
      healthCheck: config.healthCheck,
      overridden: false,
      updatedAt: new Date().toISOString()
    };
    this.flags.set(name, flag);
    return flag;
  }

  get(name) {
    const flag = this.flags.get(name);
    if (!flag) return undefined;

    // Check dependencies
    for (const dep of flag.dependsOn) {
      if (typeof dep === 'string') {
        const depFlag = this.flags.get(dep);
        if (depFlag && !depFlag.value) return false;
      } else if (dep.flag && dep.invert) {
        const depFlag = this.flags.get(dep.flag);
        if (depFlag && depFlag.value) return false;
      }
    }

    return flag.value;
  }

  set(name, value, source = 'manual') {
    const flag = this.flags.get(name);
    if (!flag) return false;

    const oldValue = flag.value;
    flag.value = Boolean(value);
    flag.overridden = source !== 'health';
    flag.updatedAt = new Date().toISOString();
    flag.lastSource = source;

    if (oldValue !== flag.value) {
      logger.info({ flag: name, oldValue, newValue: flag.value, source }, 'Feature flag changed');
      this.emit('change', name, flag.value, oldValue);
      this.evaluateDependents(name);
    }
    return true;
  }

  evaluateDependents(changedFlag) {
    for (const [name, flag] of this.flags) {
      if (flag.dependsOn.some(dep => 
        (typeof dep === 'string' && dep === changedFlag) || 
        (dep.flag === changedFlag)
      )) {
        // Re-evaluate this flag
        const newValue = this.get(name);
        if (newValue !== flag.value) {
          const oldValue = flag.value;
          flag.value = newValue;
          flag.updatedAt = new Date().toISOString();
          flag.lastSource = 'dependency';
          this.emit('change', name, newValue, oldValue);
        }
      }
    }
  }

  registerHealthCheck(name, checkFn) {
    this.healthChecks.set(name, checkFn);
  }

  async runHealthChecks() {
    const results = {};
    for (const [name, checkFn] of this.healthChecks) {
      try {
        const healthy = await checkFn();
        results[name] = healthy;
        // Update flags that depend on this health check
        for (const [flagName, flag] of this.flags) {
          if (flag.healthCheck === name && !flag.overridden) {
            this.set(flagName, healthy, 'health');
          }
        }
      } catch (e) {
        results[name] = false;
        for (const [flagName, flag] of this.flags) {
          if (flag.healthCheck === name && !flag.overridden) {
            this.set(flagName, false, 'health');
          }
        }
      }
    }
    return results;
  }

  getAll() {
    const result = {};
    for (const [name, flag] of this.flags) {
      result[name] = {
        value: this.get(name),
        defaultValue: flag.defaultValue,
        description: flag.description,
        category: flag.category,
        overridden: flag.overridden,
        updatedAt: flag.updatedAt,
        lastSource: flag.lastSource
      };
    }
    return result;
  }

  getByCategory(category) {
    const result = {};
    for (const [name, flag] of this.flags) {
      if (flag.category === category) {
        result[name] = this.get(name);
      }
    }
    return result;
  }

  reset(name) {
    const flag = this.flags.get(name);
    if (!flag) return false;
    flag.value = flag.defaultValue;
    flag.overridden = false;
    flag.updatedAt = new Date().toISOString();
    flag.lastSource = 'reset';
    this.emit('change', name, flag.value, !flag.value);
    this.evaluateDependents(name);
    return true;
  }

  resetAll() {
    for (const [name, flag] of this.flags) {
      flag.value = flag.defaultValue;
      flag.overridden = false;
      flag.updatedAt = new Date().toISOString();
      flag.lastSource = 'reset';
    }
    this.emit('reset');
  }
}

// Singleton instance
const featureFlags = new FeatureFlags();

// Health check implementations
featureFlags.registerHealthCheck('checkRpcHealth', async () => {
  try {
    const { ethers } = require('ethers');
    const rpcUrl = process.env.ALCHEMY_RPC || process.env.POLYGON_RPC_URL;
    if (!rpcUrl) return false;
    
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const blockNumber = await Promise.race([
      provider.getBlockNumber(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
    ]);
    return typeof blockNumber === 'number' && blockNumber > 0;
  } catch (e) {
    logger.warn({ err: e.message }, 'RPC health check failed');
    return false;
  }
});

featureFlags.registerHealthCheck('checkContractDeployed', async () => {
  try {
    const { ethers } = require('ethers');
    const rpcUrl = process.env.ALCHEMY_RPC || process.env.POLYGON_RPC_URL;
    const contractAddress = process.env.MARKETPLACE_ADDRESS;
    if (!rpcUrl || !contractAddress) return false;
    
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const code = await Promise.race([
      provider.getCode(contractAddress),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
    ]);
    return code && code !== '0x';
  } catch (e) {
    logger.warn({ err: e.message }, 'Contract health check failed');
    return false;
  }
});

featureFlags.registerHealthCheck('checkPinataHealth', async () => {
  try {
    const axios = require('axios');
    const response = await Promise.race([
      axios.get('https://api.pinata.cloud/data/testAuthentication', {
        headers: {
          pinata_api_key: process.env.PINATA_API_KEY,
          pinata_secret_api_key: process.env.PINATA_SECRET_KEY
        },
        timeout: 5000
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
    ]);
    return response.status === 200;
  } catch (e) {
    logger.warn({ err: e.message }, 'Pinata health check failed');
    return false;
  }
});

featureFlags.registerHealthCheck('checkRazorpayHealth', async () => {
  try {
    const Razorpay = require('razorpay');
    const rzp = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET
    });
    // Safe non-mutating connectivity check - fetch account info (read-only)
    await Promise.race([
      rzp.accounts.fetch(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
    ]);
    return true;
  } catch (e) {
    logger.warn({ err: e.message }, 'Razorpay health check failed');
    return false;
  }
});

featureFlags.registerHealthCheck('checkFirebaseHealth', async () => {
  try {
    const admin = require('firebase-admin');
    if (!admin.apps.length) return false;
    // Simple check - try to get project info
    const app = admin.app();
    return !!app.options.projectId;
  } catch (e) {
    logger.warn({ err: e.message }, 'Firebase health check failed');
    return false;
  }
});

// Periodic health checks (every 60 seconds)
setInterval(async () => {
  try {
    await featureFlags.runHealthChecks();
  } catch (e) {
    logger.error({ err: e.message }, 'Periodic health check failed');
  }
}, 60000);

module.exports = { featureFlags, FeatureFlags };