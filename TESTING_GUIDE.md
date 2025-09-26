# SIWE Authentication Testing Guide

This guide explains how to comprehensively test the Sign-In With Ethereum (SIWE) authentication system with different accounts and error scenarios.

## Overview

The SIWE authentication system validates messages based on several criteria:
- **Timing**: Messages must be within their validity window
- **Chain ID**: Must match the current blockchain
- **Signature**: Must be signed by the claimed address
- **Uniqueness**: Each message can only be used once (prevents replay attacks)

## Testing with Different Accounts

### 1. Setting Up Multiple Test Accounts

**In MetaMask:**
1. Click on the account icon (top right)
2. Select "Add account" or "Import account"
3. Create/import multiple accounts for testing

**Account Types to Test:**
- **Funded Account**: Has ETH for transactions (your main account)
- **Empty Account**: Has 0 ETH (will fail at transaction submission)
- **New Account**: Never used before (good for clean testing)

### 2. Switching Between Accounts

**Method 1: Using the "Switch Account" Button**
- Click "Switch Account" in the dApp
- MetaMask will prompt you to select a different account

**Method 2: Directly in MetaMask**
- Click the account dropdown in MetaMask
- Select a different account
- Refresh the dApp page

## Error Scenarios and Testing

### 1. Message Expired Error
**What it means**: The authentication message has passed its expiration time.

**How to test**:
1. Open the Testing Panel
2. Select "Expired Message (5 min ago)"
3. Click "Sign & Authenticate"
4. **Expected result**: "Message expired" error

**Real-world scenario**: User takes too long to complete authentication.

### 2. Message Not Yet Valid Error
**What it means**: The message's `issuedAt` time is in the future.

**How to test**:
1. Select "Future Message (5 min from now)"
2. Click "Sign & Authenticate"
3. **Expected result**: "Message not yet valid" error

**Real-world scenario**: Clock synchronization issues between client and blockchain.

### 3. Invalid Chain Error
**What it means**: Message was signed for a different blockchain network.

**How to test**:
1. Select "Wrong Chain ID"
2. Click "Sign & Authenticate"
3. **Expected result**: "Invalid chain" error

**Real-world scenario**: User switches networks after signing but before submitting.

### 4. Invalid Signature Error
**What it means**: The signature doesn't match the message or claimed address.

**How to test**:
1. Select "Invalid Signature"
2. Click "Sign & Authenticate"
3. **Expected result**: "Invalid signature" error

**Real-world scenario**: Message tampering or signature corruption.

### 5. Message Already Used (Replay Attack)
**What it means**: Attempting to reuse a previously submitted message.

**How to test**:
1. First, complete a successful authentication
2. Select "Replay Attack (reuse last message)"
3. Click "Sign & Authenticate"
4. **Expected result**: "Message already used" error

**Real-world scenario**: Malicious actor trying to replay captured authentication.

### 6. Insufficient Funds Error
**What it means**: Account doesn't have enough ETH to pay for the transaction.

**How to test**:
1. Switch to an account with 0 ETH balance
2. Try any authentication
3. **Expected result**: Transaction will fail due to insufficient funds

**Real-world scenario**: User's account runs out of ETH.

## Understanding Message Components

### Message Structure
```typescript
{
  domain: "localhost:5173",           // Where the auth is happening
  address_: "0x123...",              // User's wallet address
  statement: "Sign in with Ethereum...", // Human-readable purpose
  uri: "http://localhost:5173",      // App's URI
  chainId: 31337,                    // Blockchain network ID
  nonce: "0xabc123...",             // Unique random value
  issuedAt: 1640995200,             // When message was created (Unix timestamp)
  expiresAt: 1640995500             // When message expires (Unix timestamp)
}
```

### Key Validation Rules
- **Expiry Window**: Maximum 5 minutes (300 seconds)
- **Timing**: `block.timestamp` must be between `issuedAt` and `expiresAt`
- **Chain**: `block.chainid` must equal `message.chainId`
- **Signature**: Must be signed by `message.address_`
- **Uniqueness**: Each message hash can only be used once

## Testing Workflow

### Basic Testing Flow
1. **Connect Wallet** → Test with different accounts
2. **Check Balance** → Note if account has ETH
3. **Select Test Scenario** → Choose error condition to test
4. **Sign & Authenticate** → Observe the result
5. **Check Logs** → Review detailed error messages

### Comprehensive Testing Checklist
- [ ] Test with funded account (normal flow)
- [ ] Test with empty account (insufficient funds)
- [ ] Test expired message
- [ ] Test future message
- [ ] Test wrong chain ID
- [ ] Test invalid signature
- [ ] Test replay attack
- [ ] Test custom expiry times
- [ ] Test account switching
- [ ] Verify all error messages are clear

## Common Issues and Solutions

### Issue: "User rejected the request"
**Cause**: User clicked "Reject" in MetaMask
**Solution**: Click "Approve" when MetaMask prompts for signature

### Issue: "Insufficient funds for gas"
**Cause**: Account has no ETH
**Solution**: Send some ETH to the account or switch to funded account

### Issue: "Network mismatch"
**Cause**: MetaMask is on different network than contract
**Solution**: Switch MetaMask to correct network (usually localhost:8545 for development)

### Issue: Contract not found
**Cause**: Contract address is wrong or not deployed
**Solution**: Verify contract address and ensure it's deployed to current network

## Advanced Testing Scenarios

### Testing Message Expiry Edge Cases
1. Set custom expiry to 1 minute
2. Sign message but wait 2 minutes before submitting
3. Should get "Message expired" error

### Testing Network Switching
1. Sign message on one network
2. Switch MetaMask to different network
3. Try to submit → should fail with network mismatch

### Testing Concurrent Sessions
1. Open multiple browser tabs
2. Connect different accounts in each
3. Test authentication from each tab

## Logs and Debugging

The enhanced logging system shows:
- **Blue text**: Informational messages
- **Green text**: Success messages  
- **Red text**: Error messages
- **Timestamps**: When each event occurred

Key log messages to watch for:
- Account balance warnings
- Test scenario notifications (🧪)
- Contract error details (❌)
- Transaction confirmations

This comprehensive testing approach ensures your SIWE implementation handles all edge cases and provides clear feedback to users.