// scripts/check-timelock.sepolia.ts
// Check timelock operation status

import { ethers } from "hardhat";

async function main() {
  const timelockAddr = "0x47F60Bc8559B82f61240125083A6AD6124C1D541";
  const timelock = await ethers.getContractAt("TimelockController", timelockAddr);
  
  const ids = [
    "0x006b7814972d5c5c1b7b5a0e8f4a694b2e9d396f3137e2a4f05a8a3235f7c889",
    "0xab2518c466b3a515cd2d3a612e4bdb94be6d2a0eadae0449345815c5f8f6df4e",
    "0xa6c820accdda51d2a1184e0771790530c7224d88b4d39bad453e420409a5ebc4",
    "0x0936370bbe5b7b65322236f14d1b02f22815d129d294e12a9e9edf0baa1aa9cb",
    "0xcc612ef2108d9b615d2a4ba75480644a857661b16dd82c61f9ce117e65ab0222",
    "0xf7b722bab1d410d729b8ebef496325a930adff438c6accbb383cc0a2f166220e"
  ];
  
  const block = await ethers.provider.getBlock("latest");
  console.log("Current block timestamp:", block?.timestamp);
  console.log("Min delay:", await timelock.getMinDelay());
  
  for (const id of ids) {
    const ready = await timelock.isOperationReady(id);
    const pending = await timelock.isOperationPending(id);
    const done = await timelock.isOperationDone(id);
    console.log(`ID: ${id.slice(0,10)}... ready=${ready} pending=${pending} done=${done}`);
  }
}

main().catch(console.error);