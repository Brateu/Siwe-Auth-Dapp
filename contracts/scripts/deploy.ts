import { ethers } from "hardhat";

async function deployAuthRegistry() {
  const Auth = await ethers.getContractFactory('AuthRegistry');
  const auth = await Auth.deploy();
  await auth.waitForDeployment();
  console.log('AuthRegistry deployed to:', await auth.getAddress());
  return auth;
}

export { deployAuthRegistry };

// Run this directly when needed
if (process.argv[1] === __filename) {
  deployAuthRegistry().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}