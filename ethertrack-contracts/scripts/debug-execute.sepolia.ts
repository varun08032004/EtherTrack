// scripts/debug-execute.sepolia.ts
import { ethers } from "hardhat";

async function main() {
  const timelockAddr = "0x47F60Bc8559B82f61240125083A6AD6124C1D541";
  const timelock = await ethers.getContractAt("TimelockController", timelockAddr);
  
  // Operation 1: CarbonCreditToken.setOperator
  const target = "0x0C72dcc5a88C66259DDB09B187F9A8392f6cf3C2";
  const data = "0xb3ab15fb00000000000000000000000047f60bc8559b82f61240125083a6ad6124c1d541";
  const predecessor = ethers.ZeroHash;
  const salt = ethers.ZeroHash;
  
  console.log("Trying to execute:");
  console.log("  target:", target);
  console.log("  data:", data);
  
  // Try to call execute with gas estimation
  try {
    const gas = await timelock.execute.estimateGas(target, 0, data, predecessor, salt);
    console.log("Estimated gas:", gas.toString());
  } catch (e: any) {
    console.log("Gas estimation failed:", e.message);
    if (e.data) console.log("Error data:", e.data);
    if (e.reason) console.log("Revert reason:", e.reason);
  }
  
  // Also check if target contract has the function
  const carbonCreditToken = await ethers.getContractAt("CarbonCreditToken", target);
  try {
    const operator = await carbonCreditToken.operator();
    console.log("Current operator:", operator);
  } catch (e: any) {
    console.log("Cannot read operator:", e.message);
  }
  
  // Check if timelock has EXECUTOR_ROLE on target
  const executorRole = await timelock.EXECUTOR_ROLE();
  const hasRole = await timelock.hasRole(executorRole, target);
  console.log("Timelock has EXECUTOR_ROLE on target:", hasRole);
}

main().catch(console.error);