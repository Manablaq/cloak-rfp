# CloakRFP Demo Script

This script is for a local reviewer demo of the Tender #0 MVP.

## 1. Start the Local Chain

From the repo root:

```bash
pnpm install
pnpm contracts:install
pnpm chain
```

Keep this terminal open. It starts Anvil, deploys the local Zama FHEVM development stack, deploys `CloakRFP`, and regenerates frontend contract files.

## 2. Start the Frontend

In a second terminal:

```bash
pnpm start
```

Open:

```text
http://localhost:3000
```

## 3. Connect the Buyer Wallet

In MetaMask, add or select the local network:

- RPC URL: `http://127.0.0.1:8545`
- Chain ID: `31337`

Import the first Anvil account if needed:

```text
0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

Connect this wallet in the app. It will act as the buyer for the demo.

## 4. Create Tender #0

In the Create Tender panel:

1. Leave the default metadata URI or edit it.
2. Leave the default public scoring weights or adjust them.
3. Click `Create public tender`.
4. Confirm the transaction in the wallet.
5. Wait for the UI to refresh Tender #0.

After creation, the Create Tender button should become disabled with `Tender #0 already created`. This is expected because the MVP is focused on Tender #0.

## 5. Submit the First Encrypted Bid

Using the same connected wallet:

1. Go to the Vendor Bid panel.
2. Enter bid values for `price`, `deliveryDays`, `warrantyMonths`, and `quantity`.
3. Click `Submit encrypted bid`.
4. Confirm the wallet transaction.
5. Wait for confirmation and Tender #0 refresh.

The first bid becomes the current best vendor because there is no existing best bid to compare against.

## 6. Switch to a Second Vendor Wallet

In MetaMask, import or switch to a second Anvil account:

```text
0x59c6995e998f97a5a0044966f094538e5dae66190b5e6ba7ab557f5d1f0b44d2
```

Reconnect or switch the active wallet in the app if needed.

## 7. Submit the Second Encrypted Bid

With the second wallet connected:

1. Enter a different set of bid values.
2. Click `Submit encrypted bid`.
3. Confirm the wallet transaction.
4. Wait for confirmation.

The contract computes the second bid score privately and creates a pending encrypted comparison against the current best score. The UI should show a pending comparison state and block additional bid submissions until the comparison is resolved.

## 8. Resolve the Pending Comparison

Click `Resolve pending comparison`.

The frontend will:

1. Read the pending encrypted comparison handle from `getPendingComparison`.
2. Publicly decrypt that comparison with Zama's frontend SDK.
3. Submit `resolvePendingBest(0, cleartext, decryptionProof)`.
4. Wait for the transaction receipt.
5. Refresh Tender #0.

After resolution, the pending vendor is cleared and the bid form becomes available for another vendor wallet.

## 9. Explain the Privacy Model

During the demo, emphasize:

- Tender metadata and scoring weights are public.
- Vendor addresses are public when they submit bids.
- Raw bid fields are encrypted before submission.
- The contract computes the weighted score over encrypted values.
- The numeric score is not revealed in the current UI.
- Only the encrypted comparison result is publicly decrypted as a boolean so the contract can update the best vendor.
- The local demo uses Zama's cleartext development stack for developer ergonomics; production deployments require the appropriate live FHE infrastructure.

## 10. Repeat With Another Vendor

Switch to another Anvil account, submit another encrypted bid, then resolve the next pending comparison. This demonstrates the intended sequential MVP loop:

```text
submit encrypted bid -> resolve pending comparison -> submit next encrypted bid
```
