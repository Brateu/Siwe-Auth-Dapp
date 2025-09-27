import { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";

/** ---------- Types ---------- */
type Props = {
  contractAddress?: string;           // (optional) default contract addr
  domain?: string;                    // shown in the message
  statement?: string;                 // shown in the message
};

type TestScenario =
  | "normal"
  | "expired"
  | "future"
  | "wrong_chain"
  | "invalid_signature"
  | "replay_attack";

type Msg = {
  domain: string;
  address_: string;
  statement: string;
  uri: string;
  chainId: bigint;
  nonce: `0x${string}`;
  issuedAt: number;
  expiresAt: number;
};

/** ---------- Constants ---------- */
const AUTH_ABI = [
  "function authenticate((string domain,address address_,string statement,string uri,uint256 chainId,bytes32 nonce,uint256 issuedAt,uint256 expiresAt) message, bytes signature) public returns (bool)",
] as const;

const SEPOLIA = 11155111n;
const MAX_MINUTES = 5;

/** ---------- Helpers ---------- */
function makeNonce(): `0x${string}` {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return ethers.hexlify(arr) as `0x${string}`;
}

function clampExpiryMinutes(mins: number) {
  return Math.max(1, Math.min(MAX_MINUTES, Math.floor(mins || 1)));
}

function encodeMessageHash(m: Msg): `0x${string}` {
  // Must match solidity abi.encode order/types exactly
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      [
        "string",
        "address",
        "string",
        "string",
        "uint256",
        "bytes32",
        "uint256",
        "uint256",
      ],
      [
        m.domain,
        m.address_,
        m.statement,
        m.uri,
        m.chainId,
        m.nonce,
        m.issuedAt,
        m.expiresAt,
      ]
    )
  ) as `0x${string}`;
}

function parseRevert(e: any): string {
  const msg = e?.shortMessage || e?.reason || e?.message || "";
  const known = [
    "Message expired",
    "Message not yet valid",
    "Invalid chain",
    "Message already used",
    "Invalid signature",
    "Expiry too long",
  ];
  for (const k of known) if (msg.includes(k)) return k;

  if (e?.info?.error?.message) {
    for (const k of known) if (e.info.error.message.includes(k)) return k;
  }
  // Error(string) selector
  if (typeof e?.data === "string" && e.data.startsWith("0x08c379a0")) {
    try {
      const [reason] = ethers.AbiCoder.defaultAbiCoder().decode(
        ["string"],
        `0x${e.data.slice(10)}`
      );
      if (typeof reason === "string" && reason.length) return reason;
    } catch {}
  }
  if (/insufficient funds/i.test(msg)) return "Insufficient funds";
  if (/user rejected|denied/i.test(msg)) return "User rejected";
  return msg || "Transaction failed";
}

async function ensureSepolia(): Promise<void> {
  const eth = (window as any).ethereum;
  if (!eth) return;
  try {
    await eth.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0xaa36a7" }], // 11155111
    });
  } catch (e: any) {
    if (e?.code === 4902) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: "0xaa36a7",
            chainName: "Sepolia",
            nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
            rpcUrls: ["https://rpc.sepolia.org"],
            blockExplorerUrls: ["https://sepolia.etherscan.io"],
          },
        ],
      });
    } else {
      throw e;
    }
  }
}

function isAddressLike(s: string) {
  try {
    return !!ethers.getAddress(s);
  } catch {
    return false;
  }
}

/** ---------- Component ---------- */
export default function SignInWithEthereum({
  contractAddress = "",
  domain = typeof window !== "undefined" ? window.location.host : "localhost",
  statement = "Sign in with Ethereum to prove you own this account.",
}: Props) {
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [address, setAddress] = useState("");
  const [status, setStatus] = useState<{ message: string; type: "info" | "error" | "success" }>({
    message: "",
    type: "info",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [addrInput, setAddrInput] = useState(
    contractAddress || (typeof window !== "undefined" ? localStorage.getItem("auth_contract") || "" : "")
  );
  const [logs, setLogs] = useState<Array<{ time: string; text: string; type?: "info" | "error" | "success" }>>([]);
  const [lastMessageHash, setLastMessageHash] = useState<string | null>(null);
  const [lastSignature, setLastSignature] = useState<string | null>(null);
  const [lastMessage, setLastMessage] = useState<Msg | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [testScenario, setTestScenario] = useState<TestScenario>("normal");
  const [customExpiryMinutes, setCustomExpiryMinutes] = useState(5);
  const [accountBalance, setAccountBalance] = useState<string>("");
  const [showTestingPanel, setShowTestingPanel] = useState(true);

  const statusColor = useMemo(
    () => ({ info: "#cbd5e1", error: "#ef4444", success: "#10b981" }),
    []
  );

  function pushLog(text: string, type: "info" | "error" | "success" = "info") {
    const time = new Date().toISOString();
    setLogs((s) => [{ time, text, type }, ...s].slice(0, 200));
  }

  function hardReset(keepContract = true) {
    setLastMessageHash(null);
    setLastSignature(null);
    setLastMessage(null);
    setLastTxHash(null);
    setStatus({ message: "Reset state", type: "info" });
    // do NOT change customExpiryMinutes or addrInput unless asked
    setTestScenario("normal");
    if (!keepContract) setAddrInput("");
    pushLog("State reset", "info");
  }

  useEffect(() => {
    const eth = (window as any).ethereum;
    if (!eth) {
      setStatus({ message: "Please install MetaMask", type: "error" });
      return;
    }
    const p = new ethers.BrowserProvider(eth);
    setProvider(p);

    const onAccounts = (accs: string[]) => {
      pushLog(`accountsChanged: ${accs[0] || "(none)"}`, "info");
      setAddress(accs[0] || "");
      hardReset(true);
    };
    const onChain = (chainIdHex: string) => {
      pushLog(`chainChanged: ${chainIdHex}`, "info");
      hardReset(true);
    };

    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (addrInput && typeof window !== "undefined") localStorage.setItem("auth_contract", addrInput);
  }, [addrInput]);

  async function updateAccountBalance(targetAddress?: string) {
    if (!provider) return;
    const addressToCheck = targetAddress || address;
    if (!addressToCheck) return;
    try {
      const balance = await provider.getBalance(addressToCheck);
      const balanceInEth = ethers.formatEther(balance);
      setAccountBalance(balanceInEth);
      pushLog(`Account balance: ${balanceInEth} ETH`, "success");
    } catch (e: any) {
      pushLog(`Failed to get balance: ${e.message}`, "error");
      setAccountBalance("0");
    }
  }

  async function connect() {
    if (!provider) return setStatus({ message: "No wallet provider", type: "error" });
    try {
      await ensureSepolia();
      await (window as any).ethereum.request({ method: "eth_requestAccounts" });
      const signer = await provider.getSigner();
      const addr = await signer.getAddress();
      setAddress(addr);
      pushLog(`Wallet connected: ${addr}`, "success");
      setStatus({ message: "Wallet connected (Sepolia)", type: "success" });

      const net = await provider.getNetwork();
      if (net.chainId !== SEPOLIA) {
        setStatus({ message: `Switch to Sepolia (current ${net.chainId.toString()})`, type: "error" });
        return;
      }
      await updateAccountBalance(addr);
      hardReset(true);
    } catch (e: any) {
      pushLog(`Connection failed: ${e.message}`, "error");
      setStatus({ message: "Failed to connect: " + (e?.message ?? e), type: "error" });
    }
  }

  async function switchAccount() {
    if (!provider) return;
    try {
      await (window as any).ethereum.request({
        method: "wallet_requestPermissions",
        params: [{ eth_accounts: {} }],
      });
      await connect();
    } catch (e: any) {
      pushLog(`Failed to switch account: ${e.message}`, "error");
      setStatus({ message: "Failed to switch account: " + (e?.message ?? e), type: "error" });
    }
  }

  async function signAndSend() {
    const useAddr = addrInput || contractAddress;
    if (!provider || !useAddr) {
      return setStatus({ message: "Connect wallet and set contract address", type: "error" });
    }
    if (!isAddressLike(useAddr)) {
      return setStatus({ message: "Invalid contract address format", type: "error" });
    }

    setIsLoading(true);
    setStatus({ message: "Preparing message...", type: "info" });

    try {
      await ensureSepolia();
      const signer = await provider.getSigner();
      const addr = await signer.getAddress();
      const net = await provider.getNetwork();

      if (net.chainId !== SEPOLIA) {
        setStatus({ message: `Please switch MetaMask to Sepolia`, type: "error" });
        setIsLoading(false);
        return;
      }

      // verify an actual contract is deployed here to avoid Blockaid warning UX
      const code = await provider.getCode(useAddr);
      if (!code || code === "0x") {
        const m = "No contract deployed at this address on Sepolia.";
        pushLog(m, "error");
        setStatus({ message: m, type: "error" });
        setIsLoading(false);
        return;
      }

      // >>> Replace your "chainNow / issuedAt / expiresAt" block with this:

// 1) Get chain time
const latestBlock = await provider.getBlock("latest");
const chainNow = Number(latestBlock?.timestamp ?? Math.floor(Date.now() / 1000));

// 2) Always skew issuedAt into the past to satisfy strict checks in the same block
const SKEW_SEC = 10; // 5–15s is fine
const baseIssued = chainNow - SKEW_SEC;
const baseExpiry = baseIssued + clampExpiryMinutes(customExpiryMinutes) * 60;

// 3) Build defaults from the skewed base
let mChainId: bigint = net.chainId;
let mIssued = baseIssued;
let mExpiry = baseExpiry;
let mAddress = addr;

// 4) Apply test scenarios on top of the skewed base
switch (testScenario) {
  case "expired":
    mIssued = chainNow - 600;
    mExpiry = chainNow - 300;
    pushLog("🧪 Expired", "info");
    // on any catch / failure:
setLastMessage(null);
setLastSignature(null);
setLastMessageHash(null);
    break;
  case "future":
    // Ensure truly future relative to chain time
    mIssued = chainNow + 300;
    mExpiry = chainNow + 600;
    pushLog("🧪 Future", "info");
    // on any catch / failure:
setLastMessage(null);
setLastSignature(null);
setLastMessageHash(null);
    break;
  case "wrong_chain":
    mChainId = 1n; // Mainnet vs Sepolia
    pushLog("🧪 Wrong chain (1 vs Sepolia)", "info");
    // on any catch / failure:
setLastMessage(null);
setLastSignature(null);
setLastMessageHash(null);
    break;
  case "invalid_signature":
    mAddress = "0x0000000000000000000000000000000000000001";
    pushLog("🧪 Invalid signature", "info");
    // on any catch / failure:
setLastMessage(null);
setLastSignature(null);
setLastMessageHash(null);
    break;
  case "replay_attack":
    pushLog("🧪 Replay attack", "info");
    // on any catch / failure:
setLastMessage(null);
setLastSignature(null);
setLastMessageHash(null);
    
    break;
  default:
    pushLog("Normal authentication", "info");
}

      let message: Msg;
      let signature: string;

      if (testScenario === "replay_attack" && lastMessage && lastSignature) {
        message = lastMessage;
        signature = lastSignature;
        pushLog("Reusing cached message & signature for replay", "info");
      } else {
        message = {
          domain,
          address_: testScenario === "invalid_signature" ? mAddress : addr,
          statement,
          uri: window.location.origin,
          chainId: mChainId,
          nonce: makeNonce(),
          issuedAt: mIssued,
          expiresAt: mExpiry,
        };
        const messageHash = encodeMessageHash(message);
        setLastMessageHash(messageHash);
        signature = await signer.signMessage(ethers.getBytes(messageHash)); // EIP-191 prefix applied by wallet
        setLastSignature(signature);
        pushLog(`Signed: ${signature.slice(0, 10)}…`, "success");
      }

      // Tuple (must match solidity order)
      const messageTuple: readonly [
        string,
        string,
        string,
        string,
        bigint,
        `0x${string}`,
        number,
        number
      ] = [
        message.domain,
        message.address_,
        message.statement,
        message.uri,
        message.chainId,
        message.nonce,
        message.issuedAt,
        message.expiresAt,
      ];

      // Contract and typed method handle
      const contract = new ethers.Contract(useAddr, AUTH_ABI, signer);
      const authenticate = contract.getFunction("authenticate");

      // Estimate & send
      try {
        const gasEst = await authenticate.estimateGas(messageTuple, signature, { value: 0n });
        const gasLimit = (gasEst * 120n) / 100n;

        const tx = await authenticate.send(messageTuple, signature, { gasLimit, value: 0n });
        setLastTxHash(tx.hash);
        pushLog(`Tx: ${tx.hash}`, "success");

        const rc = await tx.wait();
        if (!rc) throw new Error("No receipt");
        pushLog(`Confirmed in block ${rc.blockNumber}`, "info");

        if (rc.status === 1) {
          setStatus({ message: "Successfully authenticated!", type: "success" });
          if (testScenario !== "replay_attack") {
            setLastMessage(message);
            setLastSignature(signature);
          }
          setTestScenario("normal");
        } else {
          setStatus({ message: "Authentication failed - transaction reverted", type: "error" });
          // clear cached payload after failure to avoid sticky state
          setLastMessage(null);
          setLastSignature(null);
          setLastMessageHash(null);
        }
      } catch (gasErr: any) {
        // Surface contract revert reason from estimation
        const reason = parseRevert(gasErr);
        pushLog(`❌ Reverted (estimate/send): ${reason}`, "error");
        setStatus({ message: reason, type: "error" });

        // clear caches so next attempt is clean
        setLastMessage(null);
        setLastSignature(null);
        setLastMessageHash(null);

        // Special handling: If the user selected Replay but had nothing cached, tell them
        if (testScenario === "replay_attack" && (!lastMessage || !lastSignature)) {
          pushLog("No cached message/signature yet for replay. First do a successful normal auth.", "info");
        }
        return;
      }
    } catch (e: any) {
      const reason = parseRevert(e);
      pushLog(`❌ Error: ${reason}`, "error");
      setStatus({ message: reason, type: "error" });
      // clear cached payload after failure to avoid sticky state
      setLastMessage(null);
      setLastSignature(null);
      setLastMessageHash(null);
    } finally {
      setIsLoading(false);
    }
  }

  /** ---------- UI ---------- */
  return (
    <div style={{ maxWidth: 760, margin: "24px auto", padding: 28, borderRadius: 14, background: "#0f172a", boxShadow: "0 10px 30px rgba(2,6,23,0.6)" }}>
      <h2 style={{ marginBottom: 24, color: "#fff" }}>Sign-In With Ethereum — Sepolia Test Suite</h2>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 14, marginBottom: 8, color: "#cbd5e1" }}>Domain: {domain}</div>
        <div style={{ fontSize: 14, marginBottom: 16, color: "#cbd5e1" }}>Statement: {statement}</div>
        <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 12, marginRight: 8, color: "#cbd5e1" }}>Contract address:</label>
          <input
            value={addrInput}
            onChange={(e) => setAddrInput(e.target.value.trim())}
            placeholder="0x..."
            style={{ padding: "10px 14px", width: "100%", borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.03)", color: "#e6eef8" }}
          />
        </div>
      </div>

      <div style={{ marginBottom: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button
          onClick={connect}
          disabled={!provider || !!address || isLoading}
          style={{ padding: "10px 18px", borderRadius: 10, border: "none", backgroundColor: !provider || !!address || isLoading ? "#334155" : "#06b6d4", color: !provider || !!address || isLoading ? "#94a3b8" : "#062024", cursor: !provider || !!address || isLoading ? "not-allowed" : "pointer", fontWeight: 600 }}
        >
          {address ? `Connected: ${address.slice(0, 6)}...${address.slice(-4)}` : "Connect Wallet"}
        </button>

        {address && (
          <button
            onClick={switchAccount}
            disabled={isLoading}
            style={{ padding: "10px 18px", borderRadius: 10, border: "none", backgroundColor: isLoading ? "#334155" : "#7c3aed", color: isLoading ? "#94a3b8" : "#fff", cursor: isLoading ? "not-allowed" : "pointer", fontWeight: 600 }}
          >
            Switch Account
          </button>
        )}

        <button
          onClick={() => hardReset(true)}
          disabled={isLoading}
          style={{ padding: "8px 14px", borderRadius: 8, border: "none", backgroundColor: "#475569", color: "#fff", cursor: isLoading ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600 }}
        >
          Reset state
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>Status:</div>
          <div style={{ fontSize: 13, color: statusColor[status.type], fontWeight: 700 }}>
            {status.message || "Idle"}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <button
          onClick={() => setShowTestingPanel((s) => !s)}
          style={{ padding: "8px 16px", borderRadius: 8, border: "none", backgroundColor: showTestingPanel ? "#dc2626" : "#059669", color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
        >
          {showTestingPanel ? "Hide" : "Show"} Testing Panel
        </button>
      </div>

      {showTestingPanel && (
        <div style={{ marginBottom: 20, padding: 16, borderRadius: 10, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <h3 style={{ marginBottom: 12, color: "#fbbf24", fontSize: 16 }}>🧪 Testing Scenarios</h3>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, color: "#cbd5e1", marginBottom: 4, display: "block" }}>Test Scenario:</label>
            <select
              value={testScenario}
              onChange={(e) => setTestScenario(e.target.value as TestScenario)}
              style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.03)", color: "#e6eef8", width: "100%" }}
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
            <label style={{ fontSize: 12, color: "#cbd5e1", marginBottom: 4, display: "block" }}>Custom Expiry (minutes):</label>
            <input
              type="number"
              value={customExpiryMinutes}
              onChange={(e) => setCustomExpiryMinutes(Number(e.target.value))}
              min={1}
              max={60}
              style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.03)", color: "#e6eef8", width: "100px" }}
            />
            <span style={{ fontSize: 11, color: "#94a3b8", marginLeft: 8 }}>
              (Contract max: {MAX_MINUTES} minutes)
            </span>
          </div>

          <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.4 }}>
            <strong>Error Testing Guide (expected):</strong><br />
            • <strong>Expired:</strong> “Message expired”<br />
            • <strong>Future:</strong> “Message not yet valid”<br />
            • <strong>Wrong Chain:</strong> “Invalid chain”<br />
            • <strong>Invalid Signature:</strong> “Invalid signature”<br />
            • <strong>Replay Attack:</strong> “Message already used”
          </div>
        </div>
      )}

      <div style={{ marginBottom: 16, display: "flex", gap: 12 }}>
        <button
          onClick={signAndSend}
          disabled={!address || !(addrInput || contractAddress) || isLoading}
          style={{ padding: "10px 18px", borderRadius: 10, border: "none", backgroundColor: !address || !(addrInput || contractAddress) || isLoading ? "#334155" : "#0ea5a4", color: "#041014", cursor: !address || !(addrInput || contractAddress) || isLoading ? "not-allowed" : "pointer", fontWeight: 700 }}
        >
          {isLoading ? "Processing..." : "Sign & Authenticate"}
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 12, color: "#6b7280" }}>Contract:</div>
          <div style={{ fontSize: 13, color: "#e6eef8", fontFamily: "monospace", wordBreak: "break-all" }}>
            {addrInput || contractAddress || "not set"}
          </div>
        </div>
      </div>

      {status.message && (
        <div style={{ marginTop: 8, color: statusColor[status.type], padding: 12, backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.04)" }}>
          {status.message}
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <h3 style={{ marginBottom: 8, color: "#e6eef8" }}>Live logs</h3>
        <div style={{ maxHeight: 220, overflow: "auto", background: "rgba(255,255,255,0.02)", color: "#e6eef8", padding: 12, borderRadius: 8, border: "1px solid rgba(255,255,255,0.04)", fontFamily: "monospace", fontSize: 13 }}>
          {logs.length === 0 ? (
            <div style={{ opacity: 0.6, color: "#9ca3af" }}>No logs yet</div>
          ) : (
            logs.map((l, i) => {
              const logColor = l.type === "error" ? "#ef4444" : l.type === "success" ? "#10b981" : "#e6eef8";
              return (
                <div key={i} style={{ marginBottom: 8, color: logColor }}>
                  [{new Date(l.time).toLocaleTimeString()}] {l.text}
                </div>
              );
            })
          )}
        </div>

        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          {lastMessageHash && (
            <div style={{ padding: 10, borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)", fontFamily: "monospace", color: "#e6eef8" }}>
              <strong>Last messageHash:</strong>
              <div style={{ marginTop: 6, wordBreak: "break-all" }}>{lastMessageHash}</div>
            </div>
          )}
          {lastSignature && (
            <div style={{ padding: 10, borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)", fontFamily: "monospace", color: "#e6eef8" }}>
              <strong>Last signature:</strong>
              <div style={{ marginTop: 6, wordBreak: "break-all" }}>{lastSignature}</div>
            </div>
          )}
          {lastTxHash && (
            <div style={{ padding: 10, borderRadius: 8, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)", fontFamily: "monospace", color: "#e6eef8" }}>
              <strong>Last tx hash:</strong>
              <div style={{ marginTop: 6, wordBreak: "break-all" }}>{lastTxHash}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
