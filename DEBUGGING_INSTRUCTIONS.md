# SIWE Authentication Debugging Instructions

## Quick Setup and Testing

### 1. Start the Local Blockchain
```bash
cd contracts
npx hardhat node
```
Keep this running in one terminal.

### 2. Deploy the Contract
In a new terminal:
```bash
cd contracts
npx hardhat run scripts/deploy.ts --network localhost
```
**Important**: Copy the deployed contract address from the output (e.g., `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0`)

### 3. Start the Frontend
```bash
cd frontend
npm run dev
```

### 4. Test the Error Scenarios

1. **Open the frontend** at http://localhost:5173
2. **Connect your MetaMask** to localhost:8545 network
3. **Paste the contract address** from step 2 into the "Contract address" field
4. **Show the Testing Panel** by clicking the "Show Testing Panel" button
5. **Select an error scenario** from the dropdown (e.g., "Expired Message")
6. **Click "Sign & Authenticate"**

### 5. What Should Happen

- **Normal Authentication**: Should show "Successfully authenticated!"
- **Expired Message**: Should show "Message expired - the authentication window has passed"
- **Future Message**: Should show "Message not yet valid - issued time is in the future"
- **Wrong Chain ID**: Should show "Invalid chain - message was signed for a different blockchain"
- **Invalid Signature**: Should show "Invalid signature - signature doesn't match the message or address"
- **Replay Attack**: First attempt succeeds, second shows "Message already used - this is a replay attack attempt"

### 6. Debugging Information

The enhanced frontend now shows detailed debugging information in the logs:
- Contract address being used
- Test scenario selected
- Message details (timestamps, chain ID, etc.)
- Full error objects when errors occur

### Common Issues and Solutions

#### Issue: All scenarios show "authenticated successfully"
**Possible causes:**
1. **Wrong contract address**: Make sure you're using the address from step 2
2. **Wrong network**: Make sure MetaMask is connected to localhost:8545
3. **Contract not deployed**: Make sure step 2 completed successfully
4. **Test scenario not selected**: Make sure you selected a test scenario other than "Normal Authentication"

#### Issue: "User rejected the request"
**Solution**: Click "Approve" when MetaMask prompts for signature

#### Issue: "Insufficient funds for gas"
**Solution**: Make sure your MetaMask account has ETH. The hardhat node provides test accounts with ETH.

#### Issue: "Network mismatch"
**Solution**: Switch MetaMask to localhost:8545 network

### Verify Contract is Working
You can verify the contract validation is working by running:
```bash
cd contracts
npx hardhat run scripts/test-error-scenarios.ts --network localhost
```
This should show all error scenarios working correctly at the contract level.

### MetaMask Network Setup
If you don't have localhost network in MetaMask:
1. Open MetaMask
2. Click network dropdown
3. Click "Add network"
4. Add custom network:
   - Network Name: Localhost 8545
   - New RPC URL: http://127.0.0.1:8545
   - Chain ID: 31337
   - Currency Symbol: ETH

### Import Test Account
To import a test account with ETH:
1. Copy a private key from the hardhat node output
2. In MetaMask: Account menu → Import Account
3. Paste the private key

The first account private key is usually:
`0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`