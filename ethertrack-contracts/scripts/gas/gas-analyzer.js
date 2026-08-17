/**
 * EtherTrack - Gas Optimization Analyzer
 * Analyzes contract bytecode and suggests optimizations
 */

const fs = require('fs');
const path = require('path');

const ARTIFACTS_DIR = path.join(__dirname, '..', '..', 'artifacts', 'contracts');
const REPORTS_DIR = path.join(__dirname, '..', '..', 'gas-reports');

class GasAnalyzer {
  constructor() {
    this.opcodes = {
      // Storage operations (expensive)
      'SLOAD': { cost: 2100, category: 'storage_read' },
      'SSTORE': { cost: 20000, category: 'storage_write' },
      
      // Memory operations
      'MLOAD': { cost: 3, category: 'memory' },
      'MSTORE': { cost: 3, category: 'memory' },
      'MSTORE8': { cost: 3, category: 'memory' },
      'MSIZE': { cost: 2, category: 'memory' },
      
      // External calls (expensive)
      'CALL': { cost: 700, category: 'external_call' },
      'CALLCODE': { cost: 700, category: 'external_call' },
      'DELEGATECALL': { cost: 700, category: 'external_call' },
      'STATICCALL': { cost: 700, category: 'external_call' },
      'CREATE': { cost: 32000, category: 'contract_creation' },
      'CREATE2': { cost: 32000, category: 'contract_creation' },
      
      // Logging (moderate)
      'LOG0': { cost: 375, category: 'logging' },
      'LOG1': { cost: 750, category: 'logging' },
      'LOG2': { cost: 1125, category: 'logging' },
      'LOG3': { cost: 1500, category: 'logging' },
      'LOG4': { cost: 1875, category: 'logging' },
      
      // Arithmetic (cheap)
      'ADD': { cost: 3, category: 'arithmetic' },
      'SUB': { cost: 3, category: 'arithmetic' },
      'MUL': { cost: 5, category: 'arithmetic' },
      'DIV': { cost: 5, category: 'arithmetic' },
      'MOD': { cost: 5, category: 'arithmetic' },
      'EXP': { cost: 10, category: 'arithmetic' },
      
      // Bitwise (cheap)
      'AND': { cost: 3, category: 'bitwise' },
      'OR': { cost: 3, category: 'bitwise' },
      'XOR': { cost: 3, category: 'bitwise' },
      'NOT': { cost: 3, category: 'bitwise' },
      
      // Comparison (cheap)
      'LT': { cost: 3, category: 'comparison' },
      'GT': { cost: 3, category: 'comparison' },
      'EQ': { cost: 3, category: 'comparison' },
      
      // Hashing (moderate)
      'SHA3': { cost: 30, category: 'hashing' },
      'KECCAK256': { cost: 30, category: 'hashing' }
    };
  }

  /**
   * Analyze contract bytecode for gas optimization opportunities
   */
  analyzeContract(contractName, bytecode) {
    const opcodes = this.extractOpcodes(bytecode);
    const analysis = this.analyzeOpcodes(opcodes);
    
    return {
      contractName,
      bytecodeSize: bytecode.length / 2, // bytes
      opcodeCount: opcodes.length,
      analysis,
      recommendations: this.generateRecommendations(analysis)
    };
  }

  /**
   * Extract opcodes from bytecode
   */
  extractOpcodes(bytecode) {
    // Remove 0x prefix
    const hex = bytecode.startsWith('0x') ? bytecode.slice(2) : bytecode;
    const opcodes = [];
    
    for (let i = 0; i < hex.length; i += 2) {
      const byte = hex.slice(i, i + 2);
      const opcode = this.byteToOpcode(byte);
      if (opcode) {
        opcodes.push({ opcode, position: i / 2 });
      }
    }
    
    return opcodes;
  }

  byteToOpcode(byte) {
    const opcodeMap = {
      '00': 'STOP', '01': 'ADD', '02': 'MUL', '03': 'SUB', '04': 'DIV',
      '05': 'SDIV', '06': 'MOD', '07': 'SMOD', '08': 'ADDMOD', '09': 'MULMOD',
      '0a': 'EXP', '0b': 'SIGNEXTEND', '10': 'LT', '11': 'GT', '12': 'SLT',
      '13': 'SGT', '14': 'EQ', '15': 'ISZERO', '16': 'AND', '17': 'OR',
      '18': 'XOR', '19': 'NOT', '1a': 'BYTE', '1b': 'SHL', '1c': 'SHR',
      '1d': 'SAR', '20': 'SHA3', '30': 'ADDRESS', '31': 'BALANCE',
      '32': 'ORIGIN', '33': 'CALLER', '34': 'CALLVALUE', '35': 'CALLDATALOAD',
      '36': 'CALLDATASIZE', '37': 'CALLDATACOPY', '38': 'CODESIZE',
      '39': 'CODECOPY', '3a': 'GASPRICE', '3b': 'EXTCODESIZE',
      '3c': 'EXTCODECOPY', '3d': 'RETURNDATASIZE', '3e': 'RETURNDATACOPY',
      '3f': 'EXTCODEHASH', '40': 'BLOCKHASH', '41': 'COINBASE',
      '42': 'TIMESTAMP', '43': 'NUMBER', '44': 'DIFFICULTY', '45': 'GASLIMIT',
      '46': 'CHAINID', '47': 'SELFBALANCE', '48': 'BASEFEE', '49': 'BLOBHASH',
      '4a': 'BLOBBASEFEE', '50': 'POP', '51': 'MLOAD', '52': 'MSTORE',
      '53': 'MSTORE8', '54': 'SLOAD', '55': 'SSTORE', '56': 'JUMP',
      '57': 'JUMPI', '58': 'PC', '58': 'PC', '59': 'MSIZE', '5a': 'GAS',
      '5b': 'JUMPDEST', '5c': 'TLOAD', '5c': 'TLOAD', '5d': 'TSTORE',
      '5e': 'TSTORE', '5f': 'PUSH0', '60': 'PUSH1', '61': 'PUSH2',
      '62': 'PUSH3', '63': 'PUSH4', '64': 'PUSH5', '65': 'PUSH6',
      '66': 'PUSH7', '67': 'PUSH8', '68': 'PUSH9', '68': 'PUSH9',
      '69': 'PUSH9', '6a': 'PUSH10', '6b': 'PUSH11', '6c': 'PUSH12',
      '6d': 'PUSH13', '6e': 'PUSH14', '6f': 'PUSH15', '70': 'PUSH16',
      '71': 'PUSH17', '72': 'PUSH18', '73': 'PUSH19', '74': 'PUSH20',
      '75': 'PUSH21', '76': 'PUSH22', '77': 'PUSH23', '77': 'PUSH23',
      '78': 'PUSH24', '79': 'PUSH25', '7a': 'PUSH26', '7b': 'PUSH27',
      '7c': 'PUSH28', '7d': 'PUSH29', '7e': 'PUSH30', '7f': 'PUSH31',
      '80': 'PUSH32', '81': 'DUP1', '82': 'DUP2', '83': 'DUP3', '84': 'DUP4',
      '85': 'DUP5', '86': 'DUP6', '87': 'DUP7', '88': 'DUP8', '89': 'DUP9',
      '8a': 'DUP10', '8b': 'DUP11', '8c': 'DUP12', '8d': 'DUP13',
      '8e': 'DUP14', '8f': 'DUP15', '90': 'DUP16', '91': 'SWAP1',
      '92': 'SWAP2', '93': 'SWAP3', '94': 'SWAP4', '95': 'SWAP5',
      '96': 'SWAP6', '97': 'SWAP7', '98': 'SWAP8', '99': 'SWAP9',
      '9a': 'SWAP10', '9b': 'SWAP11', '9c': 'SWAP11', '9d': 'SWAP13',
      '9e': 'SWAP14', '9f': 'SWAP15', 'a0': 'LOG0', 'a1': 'LOG1',
      'a2': 'LOG2', 'a3': 'LOG3', 'a4': 'LOG4', 'a5': 'LOG4',
      'a6': 'LOG4', 'a7': 'LOG4', 'a8': 'LOG4', 'a9': 'LOG4',
      'aa': 'LOG4', 'ab': 'LOG4', 'ac': 'LOG4', 'ad': 'LOG4',
      'ae': 'LOG4', 'af': 'LOG4', 'b0': 'LOG4', 'b1': 'LOG4',
      'b2': 'LOG4', 'b3': 'LOG4', 'b4': 'LOG4', 'b5': 'LOG4',
      'b6': 'LOG4', 'b7': 'LOG4', 'b8': 'LOG4', 'b9': 'LOG4',
      'ba': 'LOG4', 'bb': 'LOG4', 'bc': 'LOG4', 'bd': 'LOG4',
      'be': 'LOG4', 'bf': 'LOG4', 'c0': 'LOG4', 'c1': 'LOG4',
      'c2': 'LOG4', 'c3': 'LOG4', 'c4': 'LOG4', 'c5': 'LOG4',
      'c6': 'LOG4', 'c7': 'LOG4', 'c8': 'LOG4', 'c9': 'LOG4',
      'ca': 'LOG4', 'cb': 'LOG4', 'cc': 'LOG4', 'cd': 'LOG4',
      'ce': 'LOG4', 'cf': 'LOG4', 'd0': 'LOG4', 'd1': 'LOG4',
      'd2': 'LOG4', 'd3': 'LOG4', 'd4': 'LOG4', 'd5': 'LOG4',
      'd6': 'LOG4', 'd7': 'LOG4', 'd8': 'LOG4', 'd9': 'LOG4',
      'da': 'LOG4', 'db': 'LOG4', 'dc': 'LOG4', 'dd': 'LOG4',
      'de': 'LOG4', 'df': 'LOG4', 'e0': 'LOG4', 'e1': 'LOG4',
      'e2': 'LOG4', 'e3': 'LOG4', 'e4': 'LOG4', 'e5': 'LOG4',
      'e6': 'LOG4', 'e7': 'LOG4', 'e8': 'LOG4', 'e9': 'LOG4',
      'ea': 'LOG4', 'eb': 'LOG4', 'ec': 'LOG4', 'ed': 'LOG4',
      'ee': 'LOG4', 'ef': 'LOG4', 'f0': 'CREATE', 'f1': 'CALL',
      'f2': 'CALLCODE', 'f3': 'RETURN', 'f4': 'DELEGATECALL',
      'f5': 'CREATE2', 'fa': 'STATICCALL', 'fd': 'REVERT',
      'fe': 'INVALID', 'ff': 'SELFDESTRUCT'
    };
    
    return opcodeMap[byte];
  }

  analyzeOpcodes(opcodes) {
    const counts = {};
    const costs = {};
    let totalCost = 0;
    
    for (const { opcode } of opcodes) {
      counts[opcode] = (counts[opcode] || 0) + 1;
      const info = this.opcodes[opcode];
      if (info) {
        costs[opcode] = (costs[opcode] || 0) + info.cost;
        totalCost += info.cost;
      }
    }
    
    // Group by category
    const byCategory = {};
    for (const [opcode, count] of Object.entries(counts)) {
      const info = this.opcodes[opcode];
      if (info) {
        if (!byCategory[info.category]) {
          byCategory[info.category] = { count: 0, cost: 0, opcodes: {} };
        }
        byCategory[info.category].count += count;
        byCategory[info.category].cost += costs[opcode] || 0;
        byCategory[info.category].opcodes[opcode] = count;
      }
    }
    
    return { counts, costs, totalCost, byCategory };
  }

  generateRecommendations(analysis) {
    const recommendations = [];
    
    // Check for expensive storage operations
    if (analysis.byCategory.storage_write) {
      const count = analysis.byCategory.storage_write.count;
      const cost = analysis.byCategory.storage_write.cost;
      if (count > 10) {
        recommendations.push({
          type: 'HIGH',
          title: 'High Storage Write Count',
          description: `${count} SSTORE operations detected (${cost} gas). Consider packing variables or using transient storage.`,
          savings: `Potential ${Math.floor(count * 5000)} gas savings`
        });
      }
      
      if (analysis.byCategory.storage_read && analysis.byCategory.storage_read.count > 50) {
        recommendations.push({
          type: 'MEDIUM',
          title: 'High Storage Read Count',
          description: `${analysis.byCategory.storage_read.count} SLOAD operations. Cache values in memory when possible.`,
          savings: `Potential ${Math.floor(analysis.byCategory.storage_read.count * 100)} gas savings`
        });
      }
      
      if (analysis.byCategory.external_call && analysis.byCategory.external_call.count > 10) {
        recommendations.push({
          type: 'HIGH',
          title: 'Multiple External Calls',
          description: `${analysis.byCategory.external_call.count} external calls. Batch calls or use multicall.`,
          savings: `Potential ${Math.floor(analysis.byCategory.external_call.count * 2000)} gas savings`
        });
      }
      
      if (analysis.byCategory.logging && analysis.byCategory.logging.count > 20) {
        recommendations.push({
          type: 'LOW',
          title: 'Excessive Event Logging',
          description: `${analysis.byCategory.logging.count} LOG operations. Consider reducing event parameters.`,
          savings: `Potential ${Math.floor(analysis.byCategory.logging.count * 100)} gas savings`
        });
      }
      
      // Check for PUSH operations (can indicate large constants)
      const pushCount = Object.entries(analysis.counts || {})
        .filter(([k]) => k.startsWith('PUSH'))
        .reduce((sum, [, v]) => sum + v, 0);
      
      if (pushCount > 100) {
        recommendations.push({
          type: 'LOW',
          title: 'Many PUSH Operations',
          description: `${pushCount} PUSH operations. Consider using constants or immutables.`,
          savings: 'Minor'
        });
      }
      
      return recommendations;
    }

  generateReport(contracts) {
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalContracts: contracts.length,
        totalBytecodeSize: contracts.reduce((sum, c) => sum + c.bytecodeSize, 0),
        totalEstimatedGas: contracts.reduce((sum, c) => sum + c.analysis.totalCost, 0)
      },
      contracts: contracts.map(c => ({
        name: c.contractName,
        bytecodeSize: c.bytecodeSize,
        estimatedDeploymentGas: c.analysis.totalCost,
        topOpcodes: Object.entries(c.analysis.counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10),
        recommendations: c.recommendations
      }))
    };
    
    return report;
  }
}

// CLI interface
async function main() {
  const analyzer = new GasAnalyzer();
  const contracts = [];
  
  // Scan artifacts directory
  const artifactsDir = path.join(__dirname, '..', '..', 'artifacts', 'contracts');
  
  if (!fs.existsSync(artifactsDir)) {
    console.error('Artifacts directory not found. Run `npx hardhat compile` first.');
    process.exit(1);
  }
  
  // Find all contract JSON files
  const findContracts = (dir) => {
    const contracts = [];
    const files = fs.readdirSync(dir);
    
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      
      if (stat.isDirectory()) {
        contracts.push(...findContracts(fullPath));
      } else if (file.endsWith('.json') && !file.includes('.dbg.json')) {
        try {
          const content = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          if (content.bytecode && content.bytecode !== '0x') {
            contracts.push({
              name: path.basename(file, '.json'),
              bytecode: content.bytecode,
              path: fullPath
            });
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }
    }
    return contracts;
  };
  
  const contractFiles = findContracts(artifactsDir);
  console.log(`Found ${contractFiles.length} contracts to analyze`);
  
  const analyses = contractFiles.map(cf => 
    analyzer.analyzeContract(cf.name, cf.bytecode)
  );
  
  const report = analyzer.generateReport(analyses);
  
  // Ensure reports directory exists
  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }
  
  // Write detailed report
  const reportPath = path.join(REPORTS_DIR, `gas-analysis-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  // Print summary
  console.log('\n=== Gas Optimization Report ===');
  console.log(`Contracts analyzed: ${report.summary.totalContracts}`);
  console.log(`Total bytecode size: ${report.summary.totalBytecodeSize} bytes`);
  console.log(`Total estimated deployment gas: ${report.summary.totalEstimatedGas.toLocaleString()}`);
  console.log(`\nReport saved to: ${reportPath}\n`);
  
  for (const contract of report.contracts) {
    console.log(`\n${contract.name}:`);
    console.log(`  Bytecode: ${contract.bytecodeSize} bytes`);
    console.log(`  Est. deployment gas: ${contract.estimatedDeploymentGas.toLocaleString()}`);
    
    if (contract.recommendations.length > 0) {
      console.log('  Recommendations:');
      for (const rec of contract.recommendations) {
        console.log(`    [${rec.type}] ${rec.title}: ${rec.description}`);
        if (rec.savings) console.log(`      Savings: ${rec.savings}`);
      }
    } else {
      console.log('  No major optimizations found');
    }
  }
  
  console.log('\n=== Analysis Complete ===');
}

main().catch(console.error);