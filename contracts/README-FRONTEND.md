Frontend quickstart (SIWE demo)

1) Start Hardhat local node:

```bash
pnpm -C contracts exec -- npx hardhat node
```

2) Deploy contract to local node:

```bash
pnpm -C contracts exec -- npx hardhat run scripts/deploy.ts --network localhost
```

3) Start frontend dev server (from repo root):

```bash
pnpm -C frontend install
pnpm -C frontend run dev
```

4) In the frontend paste contract address, connect MetaMask to http://127.0.0.1:8545, import an account from the hardhat node, then click `Sign Nonce & Submit`.
