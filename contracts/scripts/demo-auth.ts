import { ethers } from "hardhat";

async function deployAuthRegistry() {
  const Auth = await ethers.getContractFactory('AuthRegistry');
  const auth = await Auth.deploy();
  await auth.waitForDeployment();
  console.log('AuthRegistry deployed to:', await auth.getAddress());
  return auth;
}

async function main() {
  const [deployer, user] = await ethers.getSigners();
  const auth = await deployAuthRegistry();
  await auth.waitForDeployment();
  console.log("Deployed AuthRegistry to", await auth.getAddress());

  // Create a secure random nonce
  const nonce = ethers.hexlify(ethers.randomBytes(32));
  
  // Set expiration to 1 hour from now
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 3600; // 1 hour
  
  // Get current chain info
  const network = await ethers.provider.getNetwork();
  const chainId = network.chainId;

  // Create the SIWE message
  const message = {
    domain: 'siwe-auth-dapp.example.com',  // Replace with your domain
    address_: user.address,
    statement: 'Sign in to SIWE Auth DApp. This signature proves you own this wallet.',
    uri: 'https://siwe-auth-dapp.example.com',  // Replace with your app URL
    version: '1',  // SIWE version
    chainId: chainId,
    nonce: nonce,
    issuedAt: issuedAt,
    expiresAt: expiresAt
  };

  // Create the message hash
  const messageHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
    ['string', 'address', 'string', 'string', 'uint256', 'bytes32', 'uint256', 'uint256'],
    [message.domain, message.address_, message.statement, message.uri, message.chainId, message.nonce, message.issuedAt, message.expiresAt]
  ));

  console.log("\nSigning message with following parameters:");
  console.log("----------------------------------------");
  console.log("Domain:", message.domain);
  console.log("Address:", message.address_);
  console.log("Statement:", message.statement);
  console.log("Chain ID:", message.chainId);
  console.log("Issued At:", new Date(message.issuedAt * 1000).toISOString());
  console.log("Expires At:", new Date(message.expiresAt * 1000).toISOString());
  console.log("----------------------------------------\n");

  // Get signature
  const signature = await user.signMessage(ethers.getBytes(messageHash));
  console.log("Signature:", signature);

  // Send authentication transaction
  console.log("\nSending authentication transaction...");
  const tx = await auth.authenticate(message, signature);
  console.log("Transaction hash:", tx.hash);
  
  // Wait for transaction confirmation
  const receipt = await tx.wait();
  if (receipt) {
    console.log("Transaction confirmed in block:", receipt.blockNumber);
  }

  // Verify the authentication worked
  const isMessageUsed = await auth.isMessageUsed(messageHash);
  console.log("\nAuthentication status:");
  console.log("Message used:", isMessageUsed);
  
  // For debugging/demo purposes, try to verify the signature
  const recoveredAddress = ethers.verifyMessage(ethers.getBytes(messageHash), signature);
  console.log("Signature verification:", recoveredAddress === user.address ? "Valid ✅" : "Invalid ❌");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

main().catch((e) => { 
  console.error("\nError occurred:");
  console.error(e); 
  process.exit(1); 
});
