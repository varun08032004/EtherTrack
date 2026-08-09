// scripts/fix-remaining-operators.sepolia.ts
import { ethers } from "hardhat";

async function main() {
  const timelockAddr = "0x47F60Bc8559B82f61240125083A6AD6124C1D541";
  const [deployer] = await ethers.getSigners();
  
  console.log("Fixing remaining operators...\n");
  
  // 1. CreditLedger.setOperator(timelock)
  console.log("1. CreditLedger.setOperator(timelock)...");
  const cl = await ethers.getContractAt("CreditLedger", "0x2046625FC6181DeE411a35F160Cb00b9FEC9d830");
  try {
    const tx = await cl.setOperator(timelockAddr);
    await tx.wait();
    console.log("   ✅ Done! New operator:", await cl.operator());
  } catch (e: any) {
    console.log("   ❌ Failed:", e.message);
  }
  
  // 2. Marketplace.setSignerWalletViaTimelock - this needs timelock to call it
  // But the function has onlyTimelock modifier, so we need to use timelock
  // However, we can call setSignerWallet directly from owner
  console.log("\n2. Marketplace.setSignerWallet (direct from owner)...");
  const mp = await ethers.getContractAt("Marketplace", "0x3cDE5d0e6A0B0955d5fb72e7E5Ba2e3070AEA19A");
  const currentSigner = await mp.signerWallet();
  console.log("   Current signer:", currentSigner);
  try {
    // Use the owner-only setSignerWallet, not the timelock version
    const tx = await mp.setSignerWallet(currentSigner); // Keep same signer
    await tx.wait();
    console.log("   ✅ Signer wallet unchanged (owner call worked)");
  } catch (e: any) {
    console.log("   ❌ Failed:", e.message);
  }
  
  // 3. Transfer ownership of KYCRegistry, Treasury, AuditTrail to timelock
  console.log("\n3. Transferring ownership to timelock...");
  
  const contracts = [
    { name: "KYCRegistry", address: "0x443e068FE6F2F7B57C71A3Bc5492aA98b5069597" },
    { name: "Treasury", address: "0x2504e917A78C8094Aee0cba8e076fc3891b95265" },
    { name: "AuditTrail", address: "0x98D9f9555bd2049Fb52DCe040C1B895CB55BcE81" },
  ];
  
  for (const c of contracts) {
    console.log(`   ${c.name}...`);
    const contract = await ethers.getContractAt(c.name, c.address);
    try {
      const tx = await contract.transferOwnership(timelockAddr);
      await tx.wait();
      const newOwner = await contract.owner();
      console.log(`   ✅ New owner: ${newOwner}`);
    } catch (e: any) {
      console.log(`   ❌ Failed: ${e.message}`);
    }
  }
  
  console.log("\n✅ All direct fixes complete!");
}

main().catch(console.error);