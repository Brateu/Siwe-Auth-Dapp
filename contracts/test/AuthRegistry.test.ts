import { expect } from "chai";
import { ethers } from "hardhat";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import type { AuthRegistry } from "../typechain-types";

interface SiweMessage {
  domain: string;
  address_: string;
  statement: string;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

function createSiweMessage(params: { address: string; issuedAt?: number; expiresAt?: number }): SiweMessage {
  const now = Math.floor(Date.now() / 1000);
  const nonce = ethers.hexlify(ethers.randomBytes(32));
  
  return {
    domain: 'example.com',
    address_: params.address,
    statement: 'Sign in with Ethereum',
    uri: 'https://example.com',
    chainId: 31337, // Default Hardhat chainId
    nonce,
    issuedAt: params.issuedAt || now,
    expiresAt: params.expiresAt || (now + 300)
  };
}

describe("AuthRegistry", function () {
  async function deployFixture() {
    const [owner, user, attacker] = await ethers.getSigners();
    const AuthRegistry = await ethers.getContractFactory("AuthRegistry");
    const auth = await AuthRegistry.deploy();
    return { auth, owner, user, attacker };
  }

  describe("Authentication", function () {
    it("Should accept valid SIWE message and signature", async function () {
      const { auth, user } = await deployFixture();

      const message = createSiweMessage({ address: user.address });
      const messageHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ['string', 'address', 'string', 'string', 'uint256', 'bytes32', 'uint256', 'uint256'],
        [message.domain, message.address_, message.statement, message.uri, message.chainId, message.nonce, message.issuedAt, message.expiresAt]
      ));

      const ethSignedMessageHash = ethers.keccak256(
        ethers.concat([
          ethers.toUtf8Bytes("\x19Ethereum Signed Message:\n32"),
          messageHash
        ])
      );

      const signature = await user.signMessage(ethers.getBytes(messageHash));

      await auth.connect(user).authenticate(message, signature);
      expect(await auth.isMessageUsed(messageHash)).to.be.true;
    });

    it("Should reject expired message", async function () {
      const { auth, user } = await deployFixture();

      const now = Math.floor(Date.now() / 1000);
      const message = createSiweMessage({ 
        address: user.address,
        issuedAt: now - 600, // 10 minutes ago
        expiresAt: now - 300  // 5 minutes ago
      });

      const messageHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ['string', 'address', 'string', 'string', 'uint256', 'bytes32', 'uint256', 'uint256'],
        [message.domain, message.address_, message.statement, message.uri, message.chainId, message.nonce, message.issuedAt, message.expiresAt]
      ));

      const signature = await user.signMessage(ethers.getBytes(messageHash));

      await expect(
        auth.connect(user).authenticate(message, signature)
      ).to.be.revertedWith("Message expired");
    });

    it("Should prevent reuse of message", async function () {
      const { auth, user } = await deployFixture();

      const message = createSiweMessage({ address: user.address });
      const messageHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ['string', 'address', 'string', 'string', 'uint256', 'bytes32', 'uint256', 'uint256'],
        [message.domain, message.address_, message.statement, message.uri, message.chainId, message.nonce, message.issuedAt, message.expiresAt]
      ));

      const signature = await user.signMessage(ethers.getBytes(messageHash));

      // First authentication should succeed
      await auth.connect(user).authenticate(message, signature);

      // Second authentication with same message should fail
      await expect(
        auth.connect(user).authenticate(message, signature)
      ).to.be.revertedWith("Message already used");
    });

    it("Should reject invalid signature", async function () {
      const { auth, user, attacker } = await deployFixture();

      const message = createSiweMessage({ address: user.address });
      const messageHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ['string', 'address', 'string', 'string', 'uint256', 'bytes32', 'uint256', 'uint256'],
        [message.domain, message.address_, message.statement, message.uri, message.chainId, message.nonce, message.issuedAt, message.expiresAt]
      ));

      // Attacker tries to sign instead of user
      const signature = await attacker.signMessage(ethers.getBytes(messageHash));

      await expect(
        auth.connect(attacker).authenticate(message, signature)
      ).to.be.revertedWith("Invalid signature");
    });

    it("Should reject message with too long expiry", async function () {
      const { auth, user } = await deployFixture();

      const now = Math.floor(Date.now() / 1000);
      const message = createSiweMessage({ 
        address: user.address,
        issuedAt: now,
        expiresAt: now + 3600 // 1 hour, longer than MESSAGE_TIMEOUT
      });

      const messageHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ['string', 'address', 'string', 'string', 'uint256', 'bytes32', 'uint256', 'uint256'],
        [message.domain, message.address_, message.statement, message.uri, message.chainId, message.nonce, message.issuedAt, message.expiresAt]
      ));

      const signature = await user.signMessage(ethers.getBytes(messageHash));

      await expect(
        auth.connect(user).authenticate(message, signature)
      ).to.be.revertedWith("Expiry too long");
    });
  });
});
