// scripts/grant-executor-to-deployer.sepolia.ts
import { ethers } from "hardhat";

async function main() {
  const timelock = await ethers.getContractAt("TimelockController", "0x47F60Bc8559B82f61240125083A6AD6124C1D541");
  const [deployer] = await ethers.getSigners();
  const executorRole = await timelock.EXECUTOR_ROLE();
  
  console.log("Granting EXECUTOR_ROLE to deployer...");
  const tx = await timelock.grantRole(executorRole, deployer.address);
  await tx.wait();
  console.log("Done! Deployer has EXECUTOR_ROLE:", await timelock.hasRole(executorRole, deployer.address));
}

main().catch(console.error);