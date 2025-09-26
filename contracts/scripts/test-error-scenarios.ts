import { ethers } from "hardhat";

async function main() {
  const [deployer, user] = await ethers.getSigners();
  
  // Deploy contract
  const Auth = await ethers.getContractFactory('AuthRegistry');
  const auth = await Auth.deploy();
  await auth.waitForDeployment();
  console.log('AuthRegistry deployed to:', await auth.getAddress());

  const network = await ethers.provider.getNetwork();
  const chainId = network.chainId;
  const now = Math.floor(Date.now() / 1000);

  // Test 1: Expired message
  console.log("\n=== Test 1: Expired Message ===");
  try {
    const expiredMessage = {
      domain: 'localhost:5173',
      address_: user.address,
      statement: 'Sign in with Ethereum to prove you own this account.',
      uri: 'http://localhost:5173',
      chainId: chainId,
      nonce: ethers.hexlify(ethers.randomBytes(32)),
      issuedAt: now - 600, // 10 minutes ago
      expiresAt: now - 300  // 5 minutes ago (expired)
    };

    const messageHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ['string', 'address', 'string', 'string', 'uint256', 'bytes32', 'uint256', 'uint256'],
      [expiredMessage.domain, expiredMessage.address_, expiredMessage.statement, expiredMessage.uri, expiredMessage.chainId, expiredMessage.nonce, expiredMessage.issuedAt, expiredMessage.expiresAt]
    ));

    const signature = await user.signMessage(ethers.getBytes(messageHash));
    await auth.authenticate(expiredMessage, signature);
    console.log("❌ ERROR: Should have failed with 'Message expired'");
  } catch (e: any) {
    console.log("✅ SUCCESS: Got expected error:", e.reason || e.message);
  }

  // Test 2: Future message
  console.log("\n=== Test 2: Future Message ===");
  try {
    const futureMessage = {
      domain: 'localhost:5173',
      address_: user.address,
      statement: 'Sign in with Ethereum to prove you own this account.',
      uri: 'http://localhost:5173',
      chainId: chainId,
      nonce: ethers.hexlify(ethers.randomBytes(32)),
      issuedAt: now + 300, // 5 minutes in future
      expiresAt: now + 600  // 10 minutes in future
    };

    const messageHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ['string', 'address', 'string', 'string', 'uint256', 'bytes32', 'uint256', 'uint256'],
      [futureMessage.domain, futureMessage.address_, futureMessage.statement, futureMessage.uri, futureMessage.chainId, futureMessage.nonce, futureMessage.issuedAt, futureMessage.expiresAt]
    ));

    const signature = await user.signMessage(ethers.getBytes(messageHash));
    await auth.authenticate(futureMessage, signature);
    console.log("❌ ERROR: Should have failed with 'Message not yet valid'");
  } catch (e: any) {
    console.log("✅ SUCCESS: Got expected error:", e.reason || e.message);
  }

  // Test 3: Wrong chain ID
  console.log("\n=== Test 3: Wrong Chain ID ===");
  try {
    const wrongChainMessage = {
      domain: 'localhost:5173',
      address_: user.address,
      statement: 'Sign in with Ethereum to prove you own this account.',
      uri: 'http://localhost:5173',
      chainId: chainId === 1n ? 137n : 1n, // Wrong chain
      nonce: ethers.hexlify(ethers.randomBytes(32)),
      issuedAt: now,
      expiresAt: now + 300
    };

    const messageHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ['string', 'address', 'string', 'string', 'uint256', 'bytes32', 'uint256', 'uint256'],
      [wrongChainMessage.domain, wrongChainMessage.address_, wrongChainMessage.statement, wrongChainMessage.uri, wrongChainMessage.chainId, wrongChainMessage.nonce, wrongChainMessage.issuedAt, wrongChainMessage.expiresAt]
    ));

    const signature = await user.signMessage(ethers.getBytes(messageHash));
    await auth.authenticate(wrongChainMessage, signature);
    console.log("❌ ERROR: Should have failed with 'Invalid chain'");
  } catch (e: any) {
    console.log("✅ SUCCESS: Got expected error:", e.reason || e.message);
  }

  // Test 4: Invalid signature (different address)
  console.log("\n=== Test 4: Invalid Signature ===");
  try {
    const invalidSigMessage = {
      domain: 'localhost:5173',
      address_: '0x0000000000000000000000000000000000000001', // Different address
      statement: 'Sign in with Ethereum to prove you own this account.',
      uri: 'http://localhost:5173',
      chainId: chainId,
      nonce: ethers.hexlify(ethers.randomBytes(32)),
      issuedAt: now,
      expiresAt: now + 300
    };

    const messageHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ['string', 'address', 'string', 'string', 'uint256', 'bytes32', 'uint256', 'uint256'],
      [invalidSigMessage.domain, invalidSigMessage.address_, invalidSigMessage.statement, invalidSigMessage.uri, invalidSigMessage.chainId, invalidSigMessage.nonce, invalidSigMessage.issuedAt, invalidSigMessage.expiresAt]
    ));

    // Sign with user but message claims different address
    const signature = await user.signMessage(ethers.getBytes(messageHash));
    await auth.authenticate(invalidSigMessage, signature);
    console.log("❌ ERROR: Should have failed with 'Invalid signature'");
  } catch (e: any) {
    console.log("✅ SUCCESS: Got expected error:", e.reason || e.message);
  }

  // Test 5: Valid message first, then replay attack
  console.log("\n=== Test 5: Replay Attack ===");
  try {
    const validMessage = {
      domain: 'localhost:5173',
      address_: user.address,
      statement: 'Sign in with Ethereum to prove you own this account.',
      uri: 'http://localhost:5173',
      chainId: chainId,
      nonce: ethers.hexlify(ethers.randomBytes(32)),
      issuedAt: now,
      expiresAt: now + 300
    };

    const messageHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ['string', 'address', 'string', 'string', 'uint256', 'bytes32', 'uint256', 'uint256'],
      [validMessage.domain, validMessage.address_, validMessage.statement, validMessage.uri, validMessage.chainId, validMessage.nonce, validMessage.issuedAt, validMessage.expiresAt]
    ));

    const signature = await user.signMessage(ethers.getBytes(messageHash));
    
    // First authentication should succeed
    await auth.authenticate(validMessage, signature);
    console.log("✅ First authentication succeeded");
    
    // Second authentication with same message should fail
    await auth.authenticate(validMessage, signature);
    console.log("❌ ERROR: Should have failed with 'Message already used'");
  } catch (e: any) {
    console.log("✅ SUCCESS: Got expected error:", e.reason || e.message);
  }

  // Test 6: Expiry too long
  console.log("\n=== Test 6: Expiry Too Long ===");
  try {
    const longExpiryMessage = {
      domain: 'localhost:5173',
      address_: user.address,
      statement: 'Sign in with Ethereum to prove you own this account.',
      uri: 'http://localhost:5173',
      chainId: chainId,
      nonce: ethers.hexlify(ethers.randomBytes(32)),
      issuedAt: now,
      expiresAt: now + 600 // 10 minutes (too long, max is 5 minutes)
    };

    const messageHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ['string', 'address', 'string', 'string', 'uint256', 'bytes32', 'uint256', 'uint256'],
      [longExpiryMessage.domain, longExpiryMessage.address_, longExpiryMessage.statement, longExpiryMessage.uri, longExpiryMessage.chainId, longExpiryMessage.nonce, longExpiryMessage.issuedAt, longExpiryMessage.expiresAt]
    ));

    const signature = await user.signMessage(ethers.getBytes(messageHash));
    await auth.authenticate(longExpiryMessage, signature);
    console.log("❌ ERROR: Should have failed with 'Expiry too long'");
  } catch (e: any) {
    console.log("✅ SUCCESS: Got expected error:", e.reason || e.message);
  }

  console.log("\n=== All tests completed ===");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});