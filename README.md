# CloakRFP

Confidential vendor bidding for public tenders, powered by Zama FHE.

## Pitch

CloakRFP lets vendors submit encrypted commercial bids while a smart contract computes and compares bid scores without exposing the raw bid values on-chain.

## Problem

Public procurement and competitive RFP workflows need transparency around rules, ownership, and final state, but vendors often do not want to reveal sensitive commercial terms such as price, delivery timing, warranty coverage, and supplied quantity. A fully public bidding contract leaks those values immediately. A fully private off-chain process weakens auditability and makes it harder to trust that every bid was evaluated with the same scoring rules.

## Solution

CloakRFP keeps tender metadata and scoring weights public, then accepts encrypted vendor bids. The contract computes a weighted score over encrypted bid fields and tracks the current best vendor. When a later vendor submits a bid, the contract creates an encrypted comparison against the current best score. That comparison can be publicly decrypted as a boolean so the contract can update the best vendor without revealing the bid values or scores.

The current MVP is intentionally focused on a single demo tender: Tender #0.

## How CloakRFP Uses Zama FHE

- The frontend uses `@zama-fhe/react-sdk` to encrypt four bid fields as `euint32` inputs:
  - `price`
  - `deliveryDays`
  - `warrantyMonths`
  - `quantity`
- The contract accepts those values as `externalEuint32` handles plus input proofs.
- `CloakRFP.submitBid` converts the external encrypted inputs with `FHE.fromExternal`.
- The contract computes an encrypted weighted score using FHE arithmetic.
- The first bid becomes the initial best bid.
- Later bids are compared with `FHE.lt(score, bestScore)`, producing an encrypted `ebool`.
- The encrypted comparison is made publicly decryptable.
- The frontend calls `usePublicDecrypt()` for the pending comparison handle, then calls `resolvePendingBest` with the clear boolean encoded as a scalar `uint256` plus the Zama decryption proof.
- The contract verifies the public decrypt proof with `FHE.checkSignatures` before updating the best vendor.

## Public vs Private

Public:

- Tender ID and buyer address.
- Tender metadata URI.
- Public scoring weights.
- Vendor addresses that submit bids.
- Current best vendor address.
- Pending vendor address.
- Whether a pending encrypted comparison resolved to true or false.

Private:

- Vendor `price`.
- Vendor `deliveryDays`.
- Vendor `warrantyMonths`.
- Vendor `quantity`.
- Encrypted bid scores.
- The numeric difference between bids.

Local demo note: the local chain uses Zama's cleartext development stack for testing. It is useful for local development and demos, but it is not a privacy-preserving production deployment.

## Current MVP Scope

Implemented:

- Tender #0 creation.
- Public tender metadata and scoring weights.
- Encrypted vendor bid submission.
- Encrypted score computation.
- Sequential multi-vendor bidding.
- Pending encrypted comparison resolution.
- Premium Next.js demo UI with wallet connection, refresh state, bid form, resolve action, and demo flow guidance.

Not implemented yet:

- Winner reveal UI.
- Multi-tender browsing.
- Production deployment configuration for a live public demo.
- Security audit or production hardening.

## Demo Flow

1. Create Tender #0.
2. Submit the first encrypted bid.
3. Switch wallet and submit a second encrypted bid.
4. Resolve the pending encrypted comparison.
5. Repeat with another vendor.

See [docs/demo-script.md](docs/demo-script.md) for a reviewer-friendly walkthrough.

## Local Setup

Prerequisites:

- Node.js 20 or newer.
- pnpm 10.x. The repo pins `pnpm@10.18.3`.
- Foundry (`forge`, `anvil`, `cast`).
- `jq`.
- MetaMask or another browser wallet.

Install dependencies:

```bash
pnpm install
```

Install Foundry/Soldeer contract dependencies if they are not already present:

```bash
pnpm contracts:install
```

Start the local chain and FHEVM development stack:

```bash
pnpm chain
```

In a second terminal, start the frontend:

```bash
pnpm start
```

Open the app at:

```text
http://localhost:3000
```

## Commands

```bash
pnpm install
pnpm contracts:install
pnpm chain
pnpm start
pnpm contracts:test
pnpm next:check-types
pnpm next:lint
NEXT_PUBLIC_ALCHEMY_API_KEY=dummy pnpm next:build
```

Additional useful commands:

```bash
pnpm contracts:build
pnpm deploy:localhost
pnpm generate
```

`pnpm chain` starts Anvil on chain ID `31337`, deploys the local FHEVM development stack, deploys `FHECounter` and `CloakRFP`, and regenerates frontend ABI/address files.

## Localhost / Anvil Wallet Notes

Use the local network:

- RPC URL: `http://127.0.0.1:8545`
- Chain ID: `31337`
- Currency symbol: `ETH`

Common Anvil test wallets:

- Account 0 address: `0xf39F...2266`
- Account 0 private key: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`
- Account 1 address: `0x7099...79C8`
- Account 1 private key: `0x59c6995e998f97a5a0044966f094538e5dae66190b5e6ba7ab557f5d1f0b44d2`

For the demo, connect with the first wallet to create Tender #0 and submit the first bid. Then switch to a second wallet to submit the next vendor bid.

If MetaMask shows stale balances, nonce errors, or old activity after restarting Anvil, clear the wallet activity data for the local account or reset the account in MetaMask advanced settings.

## Known MVP Limitations

- Tender #0 only. The UI intentionally focuses on a single tender.
- No winner reveal UI yet.
- No multi-tender browser yet.
- Local demo only unless the contracts are deployed and frontend addresses are regenerated for another chain.
- Local FHE execution uses a cleartext development stack; it is not equivalent to a production privacy deployment.
- The project has not been audited.

## Architecture Summary

Contracts:

- `packages/foundry/src/CloakRFP.sol` contains the confidential tender contract.
- `createTender` stores public tender metadata and scoring weights.
- `submitBid` accepts encrypted `externalEuint32` bid fields and proofs, computes an encrypted weighted score, and records either the first best bid or a pending encrypted comparison.
- `resolvePendingBest` verifies the public decrypt proof for the encrypted comparison and updates the best vendor when the pending bid is better.
- `packages/foundry/test/CloakRFP.t.sol` covers tender creation, encrypted bid submission, pending comparison resolution, repeated bid rejection, ACL expectations, and score overflow behavior.

Frontend:

- `packages/nextjs/app/page.tsx` contains the premium Tender #0 demo UI.
- `packages/nextjs/hooks/cloakrfp/useCloakRFPWagmi.ts` wraps contract reads/writes, Zama encryption, public decrypt, transaction receipt waiting, and user-facing status messages.
- `packages/nextjs/contracts/` contains generated ABI/address files consumed by the frontend.
- `packages/nextjs/components/DappWrapperWithProviders.tsx` wires the app providers, including wallet and Zama SDK context.

Scripts:

- `scripts/chain.sh` starts Anvil, deploys the local FHEVM development stack, deploys contracts, and keeps the local chain running.
- `scripts/deploy-localhost.sh` deploys `FHECounter` and `CloakRFP` to a running local chain and regenerates frontend artifacts.
- `scripts/generateTsAbis.ts` emits frontend contract ABI/address TypeScript files from Foundry output and deployment broadcasts.

## License

BSD-3-Clause-Clear. See [LICENSE](LICENSE).
