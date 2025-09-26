
import { ethers } from "hardhat";

async function main() {
  const [signer] = await ethers.getSigners();
  const addr = await signer.getAddress();
  const bal = await ethers.provider.getBalance(addr);
  console.log("Signer address:", addr);
  console.log("Balance (ETH):", ethers.formatEther(bal));
  const net = await ethers.provider.getNetwork();
  console.log("Network chainId:", net.chainId.toString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});