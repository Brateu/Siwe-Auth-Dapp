// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title AuthRegistry
 * @dev Implements Sign-In with Ethereum (EIP-4361) authentication
 */
contract AuthRegistry is Ownable {
    // Events
    event AuthSuccess(address indexed user, bytes32 indexed messageHash, uint256 timestamp);
    event AuthFailure(address indexed user, bytes32 indexed messageHash, string reason);

    // State
    mapping(bytes32 => bool) public usedMessages;
    uint256 public constant MESSAGE_TIMEOUT = 5 minutes;

    constructor() Ownable(msg.sender) {}

    struct SiweMessage {
        string domain;      // The domain requesting the signin
        address address_;   // The address performing the signin
        string statement;   // A human-readable message
        string uri;        // The URI of the dapp
        uint256 chainId;   // The chain ID
        bytes32 nonce;     // Unique nonce
        uint256 issuedAt;  // Timestamp of when the message was issued
        uint256 expiresAt; // Expiration timestamp
    }

    /**
     * @dev Authenticates a user using a SIWE message and signature
     * @param message The SIWE message components
     * @param signature The signature of the message
     */
    function authenticate(
        SiweMessage calldata message,
        bytes calldata signature
    ) external returns (bool) {
        // Validate timing
        require(block.timestamp >= message.issuedAt, "Message not yet valid");
        require(block.timestamp <= message.expiresAt, "Message expired");
        require(message.expiresAt - message.issuedAt <= MESSAGE_TIMEOUT, "Expiry too long");

        // Validate chain
        require(block.chainid == message.chainId, "Invalid chain");

        // Create message hash
        bytes32 messageHash = keccak256(abi.encode(
            message.domain,
            message.address_,
            message.statement,
            message.uri,
            message.chainId,
            message.nonce,
            message.issuedAt,
            message.expiresAt
        ));

        // Check if message was already used
        require(!usedMessages[messageHash], "Message already used");

        // Verify signature
        bytes32 ethSignedMessageHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
        );
        address signer = ECDSA.recover(ethSignedMessageHash, signature);
        require(signer == message.address_, "Invalid signature");

        // Mark message as used
        usedMessages[messageHash] = true;

        emit AuthSuccess(message.address_, messageHash, block.timestamp);
        return true;
    }

    /**
     * @dev View function to check if a message hash has been used
     */
    function isMessageUsed(bytes32 messageHash) external view returns (bool) {
        return usedMessages[messageHash];
    }
}