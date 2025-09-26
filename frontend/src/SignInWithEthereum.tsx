import { useEffect, useState } from "react";
import { ethers } from "ethers";

type Props = { 
  contractAddress?: string;
  domain?: string;
  statement?: string; 
};

type TestScenario = 'normal' | 'expired' | 'future' | 'wrong_chain' | 'invalid_signature' | 'replay_attack';

export default function SignInWithEthereum({ 
  contractAddress = "",
  domain = window.location.host,
  statement = "Sign in with Ethereum to prove you own this account."
}: Props) {
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState<{message: string; type: 'info' | 'error' | 'success'}>({ message: "", type: 'info' });
  const [isLoading, setIsLoading] = useState(false);
  const [addrInput, setAddrInput] = useState(contractAddress || localStorage.getItem('auth_contract') || "");
  const [logs, setLogs] = useState<Array<{time:string; text:string; type?: 'info' | 'error' | 'success'}>>([]);
  const [lastMessageHash, setLastMessageHash] = useState<string | null>(null);
  const [lastSignature, setLastSignature] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<any | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [testScenario, setTestScenario] = useState<TestScenario>('normal');
  const [customExpiryMinutes, setCustomExpiryMinutes] = useState(5);
  const [accountBalance, setAccountBalance] = useState<string>("");
  const [showTestingPanel, setShowTestingPanel] = useState(false);

  useEffect(() => {
    if ((window as any).ethereum) {
      setProvider(new ethers.BrowserProvider((window as any).ethereum));
    } else {
      setStatus({ message: "Please install MetaMask", type: 'error' });
    }
  }, []);

  useEffect(() => {
    // persist contract address in localStorage
    if (addrInput) localStorage.setItem('auth_contract', addrInput);
  }, [addrInput]);

  function pushLog(text: string, type: 'info' | 'error' | 'success' = 'info') {
    const time = new Date().toISOString();
    setLogs((s) => [{ time, text, type }, ...s].slice(0, 200));
  }

  async function updateAccountBalance(targetAddress?: string) {
    if (!provider) return;
    const addressToCheck = targetAddress || address;
    if (!addressToCheck) return;
    
    try {
      pushLog(`Fetching balance for: ${addressToCheck}`, 'info');
      const balance = await provider.getBalance(addressToCheck);
      const balanceInEth = ethers.formatEther(balance);
      setAccountBalance(balanceInEth);
      pushLog(`Account balance: ${balanceInEth} ETH`, 'success');
    } catch (e: any) {
      pushLog(`Failed to get balance for ${addressToCheck}: ${e.message}`, 'error');
      setAccountBalance("0");
    }
  }

  function makeNonce(): string {
    const arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    return ethers.hexlify(arr);
  }

  async function connect() {
    if (!provider) return setStatus({ message: "No wallet provider", type: 'error' });
    try {
      await (window as any).ethereum.request({ method: "eth_requestAccounts" });
      const signer = await provider.getSigner();
      const addr = await signer.getAddress();
      setAddress(addr);
      pushLog(`Wallet connected: ${addr}`, 'success');
      setStatus({ message: "Wallet connected successfully", type: 'success' });
      
      // Update balance immediately with the new address
      await updateAccountBalance(addr);
    } catch (e: any) {
      pushLog(`Connection failed: ${e.message}`, 'error');
      setStatus({ message: "Failed to connect: " + (e?.message ?? e), type: 'error' });
    }
  }

  async function switchAccount() {
    if (!provider) return;
    try {
      pushLog(`Requesting account switch...`, 'info');
      await (window as any).ethereum.request({
        method: "wallet_requestPermissions",
        params: [{ eth_accounts: {} }]
      });
      // After permission request, reconnect
      pushLog(`Account switch permission granted, reconnecting...`, 'info');
      await connect();
    } catch (e: any) {
      pushLog(`Failed to switch account: ${e.message}`, 'error');
      setStatus({ message: "Failed to switch account: " + (e?.message ?? e), type: 'error' });
    }
  }

  async function signAndSend() {
    const useAddr = addrInput || contractAddress;
    if (!provider || !useAddr) {
      return setStatus({ message: "Connect wallet and set contract address", type: 'error' });
    }

    setIsLoading(true);
    try {
      const signer = await provider.getSigner();
      const addr = await signer.getAddress();
      const chainId = (await provider.getNetwork()).chainId;
      const now = Math.floor(Date.now() / 1000);
      
      // Apply test scenario modifications
      let modifiedChainId = chainId;
      let modifiedIssuedAt = now;
      let modifiedExpiresAt = now + (customExpiryMinutes * 60);
      let modifiedAddress = addr;
      
      switch (testScenario) {
        case 'expired':
          modifiedIssuedAt = now - 600; // 10 minutes ago
          modifiedExpiresAt = now - 300; // 5 minutes ago (expired)
          pushLog(`🧪 TEST: Creating expired message (expired 5 minutes ago)`, 'info');
          break;
        case 'future':
          modifiedIssuedAt = now + 300; // 5 minutes in future
          modifiedExpiresAt = now + 600; // 10 minutes in future
          pushLog(`🧪 TEST: Creating future message (valid in 5 minutes)`, 'info');
          break;
        case 'wrong_chain':
          modifiedChainId = chainId === 1n ? 137n : 1n; // Switch between mainnet and polygon
          pushLog(`🧪 TEST: Using wrong chain ID (${modifiedChainId} instead of ${chainId})`, 'info');
          break;
        case 'invalid_signature':
          modifiedAddress = '0x0000000000000000000000000000000000000001'; // Different address
          pushLog(`🧪 TEST: Will create invalid signature (signing for different address)`, 'info');
          break;
        case 'replay_attack':
          // Use the last message if available
          if (lastMessage && lastSignature) {
            pushLog(`🧪 TEST: Attempting replay attack with previous message`, 'info');
          } else {
            pushLog(`🧪 TEST: No previous message available for replay attack - will create normal message first`, 'info');
          }
          break;
        default:
          pushLog(`Creating normal authentication message`, 'info');
      }
      
      // For replay attack, use the exact previous message if available
      let message;
      if (testScenario === 'replay_attack' && lastMessage && lastSignature) {
        message = lastMessage;
        pushLog(`Reusing previous message for replay attack`, 'info');
      } else {
        message = {
          domain,
          address_: testScenario === 'invalid_signature' ? modifiedAddress : addr,
          statement,
          uri: window.location.origin,
          chainId: modifiedChainId,
          nonce: makeNonce(),
          issuedAt: modifiedIssuedAt,
          expiresAt: modifiedExpiresAt
        };
      }
      // Create the message hash matching the contract's format
      const messageHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ['string', 'address', 'string', 'string', 'uint256', 'bytes32', 'uint256', 'uint256'],
        [message.domain, message.address_, message.statement, message.uri, message.chainId, message.nonce, message.issuedAt, message.expiresAt]
      ));

      pushLog(`Message created. nonce=${message.nonce}`, 'info');
      pushLog(`Message expires at: ${new Date(message.expiresAt * 1000).toLocaleString()}`, 'info');
      setLastMessageHash(messageHash);

      // For replay attack, use the previous signature if available
      let signature;
      if (testScenario === 'replay_attack' && lastMessage && lastSignature) {
        signature = lastSignature;
        pushLog(`Reusing previous signature for replay attack`, 'info');
      } else {
        // Sign the message hash
        signature = await signer.signMessage(ethers.getBytes(messageHash));
        setLastSignature(signature);
        pushLog(`Message signed. signature=${signature.slice(0,10)}...`, 'success');
      }

      // Check account balance before transaction
      const balance = await provider.getBalance(addr);
      const balanceInEth = ethers.formatEther(balance);
      pushLog(`Account balance: ${balanceInEth} ETH`, 'info');
      
      if (balance === 0n) {
        pushLog(`⚠️ WARNING: Account has 0 ETH - transaction will fail`, 'error');
      }

      setStatus({ message: "Submitting to contract...", type: 'info' });
      pushLog(`📋 Using contract address: ${useAddr}`, 'info');
      pushLog(`📋 Test scenario: ${testScenario}`, 'info');
      pushLog(`📋 Message details: domain=${message.domain}, chainId=${message.chainId}, issuedAt=${new Date(message.issuedAt * 1000).toLocaleString()}, expiresAt=${new Date(message.expiresAt * 1000).toLocaleString()}`, 'info');

      // Call the contract
      const abi = [
        "function authenticate((string domain,address address_,string statement,string uri,uint256 chainId,bytes32 nonce,uint256 issuedAt,uint256 expiresAt) message, bytes signature) public returns (bool)",
      ];
      const contract = new ethers.Contract(useAddr, abi, signer);
      
      try {
        const tx = await contract.authenticate(message, signature);
        setLastTxHash(tx.hash);
        pushLog(`Transaction submitted: ${tx.hash}`, 'success');

        const receipt = await tx.wait();
        pushLog(`Transaction confirmed in block ${receipt.blockNumber}`, 'info');
        
        // Check if the transaction was successful or reverted
        if (receipt.status === 1) {
          pushLog(`✅ Transaction succeeded - authentication successful!`, 'success');
          setStatus({ message: "Successfully authenticated!", type: 'success' });
          
          // Store the successful message and signature for potential replay attack testing
          if (testScenario !== 'replay_attack') {
            setLastMessage(message);
            setLastSignature(signature);
          }
        } else {
          // Transaction was mined but reverted
          pushLog(`❌ Transaction reverted - authentication failed`, 'error');
          setStatus({ message: "Authentication failed - transaction reverted", type: 'error' });
          throw new Error("Transaction reverted - authentication failed");
        }
      } catch (contractError: any) {
        // Enhanced error debugging
        pushLog(`🔍 DEBUG: Full error object: ${JSON.stringify(contractError, null, 2)}`, 'info');
        pushLog(`🔍 DEBUG: contractError.reason: ${contractError.reason}`, 'info');
        pushLog(`🔍 DEBUG: contractError.message: ${contractError.message}`, 'info');
        pushLog(`🔍 DEBUG: contractError.data: ${contractError.data}`, 'info');
        pushLog(`🔍 DEBUG: contractError.code: ${contractError.code}`, 'info');
        
        // Parse contract revert reasons with improved logic
        let errorMessage = "Transaction failed";
        
        // Helper function to extract revert reason from various error formats
        const extractRevertReason = (errorObj: any): string | null => {
          // Check direct reason property (most reliable)
          if (errorObj.reason) {
            return errorObj.reason;
          }
          
          // Check for revert reason in error message
          if (errorObj.message) {
            // Look for "reverted with reason string" pattern
            const revertMatch = errorObj.message.match(/reverted with reason string '([^']+)'/);
            if (revertMatch) {
              return revertMatch[1];
            }
            
            // Look for "execution reverted:" pattern
            const executionRevertMatch = errorObj.message.match(/execution reverted: (.+)/);
            if (executionRevertMatch) {
              return executionRevertMatch[1];
            }
          }
          
          // Check nested error objects
          if (errorObj.error && typeof errorObj.error === 'object') {
            return extractRevertReason(errorObj.error);
          }
          
          // Check data field for encoded revert reason
          if (errorObj.data && typeof errorObj.data === 'string') {
            // Try to decode if it looks like encoded revert data
            try {
              if (errorObj.data.startsWith('0x08c379a0')) {
                // This is the signature for Error(string)
                const decoded = ethers.AbiCoder.defaultAbiCoder().decode(['string'], '0x' + errorObj.data.slice(10));
                return decoded[0];
              }
            } catch (e) {
              // Ignore decode errors
            }
          }
          
          return null;
        };
        
        const revertReason = extractRevertReason(contractError);
        
        if (revertReason) {
          // Map specific revert reasons to user-friendly messages
          switch (revertReason) {
            case 'Message expired':
              errorMessage = "Message expired - the authentication window has passed";
              break;
            case 'Message not yet valid':
              errorMessage = "Message not yet valid - issued time is in the future";
              break;
            case 'Invalid chain':
              errorMessage = "Invalid chain - message was signed for a different blockchain";
              break;
            case 'Message already used':
              errorMessage = "Message already used - this is a replay attack attempt";
              break;
            case 'Invalid signature':
              errorMessage = "Invalid signature - signature doesn't match the message or address";
              break;
            case 'Expiry too long':
              errorMessage = "Expiry too long - maximum allowed is 5 minutes";
              break;
            default:
              errorMessage = `Contract error: ${revertReason}`;
          }
        } else {
          // Fallback to checking message content for known patterns
          const fullMessage = contractError.message || '';
          if (fullMessage.includes('Message expired')) {
            errorMessage = "Message expired - the authentication window has passed";
          } else if (fullMessage.includes('Message not yet valid')) {
            errorMessage = "Message not yet valid - issued time is in the future";
          } else if (fullMessage.includes('Invalid chain')) {
            errorMessage = "Invalid chain - message was signed for a different blockchain";
          } else if (fullMessage.includes('Message already used')) {
            errorMessage = "Message already used - this is a replay attack attempt";
          } else if (fullMessage.includes('Invalid signature')) {
            errorMessage = "Invalid signature - signature doesn't match the message or address";
          } else if (fullMessage.includes('Expiry too long')) {
            errorMessage = "Expiry too long - maximum allowed is 5 minutes";
          } else if (fullMessage.includes('insufficient funds')) {
            errorMessage = "Insufficient funds - account doesn't have enough ETH for gas";
          } else if (fullMessage.includes('user rejected')) {
            errorMessage = "Transaction rejected by user";
          } else {
            errorMessage = contractError.message || "Unknown transaction error";
          }
        }
        
        pushLog(`❌ Contract error: ${errorMessage}`, 'error');
        throw new Error(errorMessage);
      }
    } catch (e: any) {
      pushLog(`❌ Transaction failed: ${e.message}`, 'error');
      setStatus({ message: "Transaction failed: " + (e?.message ?? e), type: 'error' });
    } finally {
      setIsLoading(false);
    }
  }

  const statusColor = {
    info: '#333',
    error: '#d32f2f',
    success: '#2e7d32'
  };

  return (
    <div style={{ maxWidth: 760, margin: "24px auto", padding: 28, borderRadius: 14, background: '#0f172a', boxShadow: "0 10px 30px rgba(2,6,23,0.6)" }}>
      <h2 style={{ marginBottom: 24, color: '#fff' }}>Sign-In With Ethereum - Testing Suite</h2>
      
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 14, marginBottom: 8, color: '#cbd5e1' }}>Domain: {domain}</div>
        <div style={{ fontSize: 14, marginBottom: 16, color: '#cbd5e1' }}>Statement: {statement}</div>
        <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ fontSize: 12, marginRight: 8, color: '#cbd5e1' }}>Contract address:</label>
          <input value={addrInput} onChange={(e) => setAddrInput(e.target.value)} placeholder="0x..." style={{ padding: '10px 14px', width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.03)', color: '#e6eef8' }} />
        </div>
      </div>

      {/* Testing Panel Toggle */}
      <div style={{ marginBottom: 16 }}>
        <button 
          onClick={() => setShowTestingPanel(!showTestingPanel)}
          style={{ 
            padding: "8px 16px",
            borderRadius: 8,
            border: "none",
            backgroundColor: showTestingPanel ? "#dc2626" : "#059669",
            color: "#fff",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600
          }}
        >
          {showTestingPanel ? "Hide" : "Show"} Testing Panel
        </button>
      </div>

      {/* Testing Panel */}
      {showTestingPanel && (
        <div style={{ marginBottom: 20, padding: 16, borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <h3 style={{ marginBottom: 12, color: '#fbbf24', fontSize: 16 }}>🧪 Testing Scenarios</h3>
          
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 4, display: 'block' }}>Test Scenario:</label>
            <select 
              value={testScenario} 
              onChange={(e) => setTestScenario(e.target.value as TestScenario)}
              style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.03)', color: '#e6eef8', width: '100%' }}
            >
              <option value="normal">Normal Authentication</option>
              <option value="expired">Expired Message (5 min ago)</option>
              <option value="future">Future Message (5 min from now)</option>
              <option value="wrong_chain">Wrong Chain ID</option>
              <option value="invalid_signature">Invalid Signature</option>
              <option value="replay_attack">Replay Attack (reuse last message)</option>
            </select>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 4, display: 'block' }}>Custom Expiry (minutes):</label>
            <input 
              type="number" 
              value={customExpiryMinutes} 
              onChange={(e) => setCustomExpiryMinutes(Number(e.target.value))}
              min="1" 
              max="60"
              style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.03)', color: '#e6eef8', width: '100px' }}
            />
            <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 8 }}>
              (Contract max: 5 minutes)
            </span>
          </div>

          <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.4 }}>
            <strong>Error Testing Guide:</strong><br/>
            • <strong>Expired:</strong> Tests "Message expired" error<br/>
            • <strong>Future:</strong> Tests "Message not yet valid" error<br/>
            • <strong>Wrong Chain:</strong> Tests "Invalid chain" error<br/>
            • <strong>Invalid Signature:</strong> Tests "Invalid signature" error<br/>
            • <strong>Replay Attack:</strong> Tests "Message already used" error<br/>
            • <strong>No ETH:</strong> Use account with 0 balance to test transaction failures
          </div>
        </div>
      )}

      <div style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <button 
          onClick={connect} 
          disabled={!provider || !!address || isLoading}
          style={{ 
            padding: "10px 18px",
            borderRadius: 10,
            border: "none",
            backgroundColor: !provider || !!address || isLoading ? "#334155" : "#06b6d4",
            color: !provider || !!address || isLoading ? "#94a3b8" : "#062024",
            cursor: !provider || !!address || isLoading ? "not-allowed" : "pointer",
            fontWeight: 600
          }}
        >
          {address ? `Connected: ${address.slice(0, 6)}...${address.slice(-4)}` : "Connect Wallet"}
        </button>
        
        {address && (
          <button 
            onClick={switchAccount}
            disabled={isLoading}
            style={{ 
              padding: "10px 18px",
              borderRadius: 10,
              border: "none",
              backgroundColor: isLoading ? "#334155" : "#7c3aed",
              color: isLoading ? "#94a3b8" : "#fff",
              cursor: isLoading ? "not-allowed" : "pointer",
              fontWeight: 600
            }}
          >
            Switch Account
          </button>
        )}
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>Status:</div>
          <div style={{ fontSize: 13, color: statusColor[status.type], fontWeight: 700 }}>{status.message || 'Idle'}</div>
        </div>
      </div>

      {/* Account Info */}
      {address && (
        <div style={{ marginBottom: 16, padding: 12, borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
          <div style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 4 }}>Connected Account:</div>
          <div style={{ fontSize: 14, color: '#e6eef8', fontFamily: 'monospace', marginBottom: 8 }}>{address}</div>
          {accountBalance && (
            <div style={{ fontSize: 12, color: accountBalance === '0.0' ? '#ef4444' : '#10b981' }}>
              Balance: {accountBalance} ETH {accountBalance === '0.0' && '⚠️ No funds for transactions'}
            </div>
          )}
        </div>
      )}

      <div style={{ marginBottom: 16, display: 'flex', gap: 12 }}>
        <button 
          onClick={signAndSend}
          disabled={!address || !(addrInput || contractAddress) || isLoading}
          style={{ 
            padding: "10px 18px",
            borderRadius: 10,
            border: "none",
            backgroundColor: !address || !(addrInput || contractAddress) || isLoading ? "#334155" : "#0ea5a4",
            color: "#041014",
            cursor: !address || !(addrInput || contractAddress) || isLoading ? "not-allowed" : "pointer",
            fontWeight: 700
          }}
        >
          {isLoading ? "Processing..." : "Sign & Authenticate"}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Contract:</div>
          <div style={{ fontSize: 13, color: '#0f172a', fontFamily: 'monospace' }}>{addrInput || contractAddress || 'not set'}</div>
        </div>
      </div>

      {status.message && (
        <div style={{ marginTop: 8, color: statusColor[status.type], padding: 12, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.04)' }}>
          {status.message}
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <h3 style={{ marginBottom: 8 }}>Live logs</h3>
        <div style={{ maxHeight: 220, overflow: 'auto', background: 'rgba(255,255,255,0.02)', color: '#e6eef8', padding: 12, borderRadius: 8, border: '1px solid rgba(255,255,255,0.04)', fontFamily: 'monospace', fontSize: 13 }}>
          {logs.length === 0 ? <div style={{ opacity: 0.6, color: '#9ca3af' }}>No logs yet</div> : logs.map((l, i) => {
            const logColor = l.type === 'error' ? '#ef4444' : l.type === 'success' ? '#10b981' : '#e6eef8';
            return (
              <div key={i} style={{ marginBottom: 8, color: logColor }}>
                [{new Date(l.time).toLocaleTimeString()}] {l.text}
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
          {lastMessageHash && (
            <div style={{ padding: 10, borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', fontFamily: 'monospace', color: '#e6eef8' }}>
              <strong>Last messageHash:</strong>
              <div style={{ marginTop: 6, wordBreak: 'break-all' }}>{lastMessageHash}</div>
            </div>
          )}
          {lastSignature && (
            <div style={{ padding: 10, borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', fontFamily: 'monospace', color: '#e6eef8' }}>
              <strong>Last signature:</strong>
              <div style={{ marginTop: 6, wordBreak: 'break-all' }}>{lastSignature}</div>
            </div>
          )}
          {lastTxHash && (
            <div style={{ padding: 10, borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', fontFamily: 'monospace', color: '#e6eef8' }}>
              <strong>Last tx hash:</strong>
              <div style={{ marginTop: 6, wordBreak: 'break-all' }}>{lastTxHash}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
