// scripts/debug-execute2.sepolia.ts
import { ethers } from "hardhat";

async function main() {
  const timelockAddr = "0x47F60Bc8559B82f61240125083A6AD6124C1D541";
  const timelock = await ethers.getContractAt("TimelockController", timelockAddr);
  
  // Operation 1: CarbonCreditToken.setOperator
  const target = "0x0C72dcc5a88C66259DDB09B187F9A8392f6cf3C2";
  const data = "0xb3ab15fb00000000000000000000000047f60bc8559b82f61240125083a6ad6124c1d541";
  const predecessor = ethers.ZeroHash;
  const salt = ethers.ZeroHash;
  
  console.log("Trying to execute via timelock...");
  console.log("  target:", target);
  console.log("  data:", data);
  
  // Try to call execute directly on timelock with full error
  try {
    const tx = await timelock.execute(target, 0, data, predecessor, salt);
    console.log("TX sent:", tx.hash);
    const receipt = await tx.wait();
    console.log("Success! Gas used:", receipt.gasUsed.toString());
  } catch (e: any) {
    console.log("Error:", e.message);
    if (e.data) console.log("Error data:", e.data);
    if (e.reason) console.log("Revert reason:", e.reason);
  }
  
  // Also try calling setOperator directly on CarbonCreditToken from deployer
  console.log("\n--- Testing direct call from deployer ---");
  const carbonCreditToken = await ethers.getContractAt("CarbonCreditToken", target);
  try {
    const tx2 = await carbonCreditToken.setOperator(timelockAddr);
    console.log("Direct TX sent:", tx2.hash);
    await tx2.wait();
    console.log("Direct call succeeded!");
  } catch (e: any) {
    console.log("Direct call failed:", e.message);
    if (e.data) console.log("Error data:", e.data);
  }
}

main().catch(console.error);