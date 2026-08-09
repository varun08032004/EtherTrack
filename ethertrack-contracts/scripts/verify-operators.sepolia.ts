// scripts/verify-operators.sepolia.ts
import { ethers } from "hardhat";

async function main() {
  const timelockAddr = "0x47F60Bc8559B82f61240125083A6AD6124C1D541";
  
  const cct = await ethers.getContractAt("CarbonCreditToken", "0x0C72dcc5a88C66259DDB09B187F9A8392f6cf3C2");
  console.log("CarbonCreditToken operator:", await cct.operator());
  
  const cl = await ethers.getContractAt("CreditLedger", "0x2046625FC6181DeE411a35F160Cb00b9FEC9d830");
  console.log("CreditLedger operator:", await cl.operator());
  
  const mp = await ethers.getContractAt("Marketplace", "0x3cDE5d0e6A0B0955d5fb72e7E5Ba2e3070AEA19A");
  console.log("Marketplace signerWallet:", await mp.signerWallet());
}

main().catch(console.error);