# Midnight Preprod Wallet CLI

[日本語](README.ja.md)

A focused Wallet SDK reference CLI for learning and testing Midnight wallet flows on Preprod.

```text
seed → addresses → NIGHT, shielded tokens, and DUST → transfers
```

This project demonstrates:

- deterministic key and address derivation from one seed;
- unshielded NIGHT and shielded-token synchronization and transfers;
- an atomic transfer containing both output types;
- DUST generation backed by registered NIGHT UTxOs;
- DUST deregistration and generation-destination changes;
- DUST fee payment and finalized NIGHT transfers.

> [!IMPORTANT]
> This is an educational Preprod project, not a production or Mainnet wallet. Back up `.wallet-seed` and never share it. Losing the seed means losing access to the wallet.

## Requirements

- Node.js 22 or later
- pnpm
- Docker
- A Blockfrost Midnight Preprod Project ID

This repository targets **Preprod**, which still uses Ledger `8.1.3`. It pins Wallet SDK `1.2.0`, ledger `8.1.3`, and Proof Server `8.1.3` as one compatibility set. Do not replace these with the Mainnet Ledger 9 versions while using the Preprod endpoints.

Mainnet and Preview use Ledger 9 with node `2.1.101`, Wallet SDK `2.0.0`, and Proof Server `9.0.0`. Those versions require a Wallet SDK 2 API migration and are outside this Preprod CLI's current scope. This project connects to Blockfrost, so it does not run a Midnight node locally and does not need the node `2.1.101` binary.

When Preprod is upgraded to Ledger 9, this project must migrate the complete compatibility set together. Preprod DUST registrations will also need to be registered again after that network upgrade.

## Setup

Create a Midnight Preprod project at [Blockfrost](https://blockfrost.io/) and copy its Project ID. A Project ID for another network cannot access Preprod.

```bash
pnpm install
cp .env.example .env
```

Set the Project ID in `.env`:

```dotenv
BLOCKFROST_PROJECT_ID=your_project_id
```

Verify the local code before connecting a wallet:

```bash
pnpm typecheck
pnpm test
```

The first wallet command creates a random 32-byte seed in `.wallet-seed` with owner-only permissions. Later commands reuse the same seed and wallet.

## Proof Server

Keep the Proof Server running in a separate terminal for every command marked **Yes** in the command table:

```bash
docker run --rm \
  -p 6300:6300 \
  -e MIDNIGHT_PROOF_SERVER_VERBOSE=true \
  midnightntwrk/proof-server:8.1.3
```

Health check:

```bash
curl http://localhost:6300/health
```

## Quick start

### 1. Print the wallet addresses

```bash
pnpm address
```

Copy the `Unshielded` address (`mn_addr_preprod1...`) into the [Midnight Preprod Faucet](https://midnight-tmnight-preprod.nethermind.dev/). Do not use the Shielded address.

### 2. Check the NIGHT balance

```bash
pnpm balance
```

The faucet provides unshielded tNIGHT only. Shielded balances are separate tokens and are printed by raw token type and base-unit amount.

### 3. Register NIGHT for DUST generation

```bash
pnpm register-dust
```

Registration is complete when `Registration finalized` appears. Registration does not reduce the total NIGHT balance. DUST accrues over time and pays transaction fees.

### 4. Send NIGHT

```bash
pnpm send <recipient-unshielded-address> <amount-in-night>
```

Example:

```bash
pnpm send mn_addr_preprod1... 3
```

The SDK waits for finalization before printing `Transfer finalized`.

### 5. Try shielded and combined transfers

```bash
pnpm send-shielded <shielded-address> <token-type> <base-units>
pnpm send-combined \
  <unshielded-address> <night-amount> \
  <shielded-address> <token-type> <base-units>
```

NIGHT is unshielded. `send-shielded` spends an existing shielded token issued by a contract or received from another wallet; it does not convert faucet NIGHT into a shielded asset. Copy the token type and available base-unit balance from `pnpm balance`. Token decimals are defined by the token issuer, so the CLI accepts an integer base-unit amount rather than a NIGHT amount.

The combined command spends unshielded NIGHT and an existing shielded token in one atomic transaction: either both outputs succeed or neither does. It is not a conversion between the two token kinds. A first shielded sync can be considerably slower than an unshielded sync.

### 6. Inspect transaction history

```bash
pnpm history
pnpm history <history-hash>
```

Submission commands print a ledger `Identifier`, which the node uses to track the submitted transaction. Transaction history uses a separate `History hash`. Copy the value labeled `History hash` from `pnpm history` when filtering the history; a submission identifier is not a history hash.

## DUST synchronization

Wallet SDK 1.x rebuilds DUST state by replaying the global Preprod DUST history. The first sync can take hours. Shielded, unshielded, and DUST state is saved per wallet and network in `.wallet-state/`; long DUST syncs are checkpointed every 10,000 events so later commands resume from the latest checkpoint.

```text
syncing... 723829/723829 transactions; DUST events 76745/1838604 (1015s)
```

- `1006:: Abnormal Closure`: the SDK retries the WebSocket connection; wait while progress continues.
- `1000:: Normal Closure`: normal RPC shutdown after a command; not an error.

## Commands

| Command | Purpose | Proof Server |
| --- | --- | --- |
| `pnpm address` | Derive and print addresses | No |
| `pnpm balance` | Synchronize and print balances | No |
| `pnpm register-dust` | Register NIGHT UTxOs for DUST | Yes |
| `pnpm send <address> <amount>` | Send unshielded NIGHT | Yes |
| `pnpm send-shielded <address> <token-type> <base-units>` | Send an existing shielded token | Yes |
| `pnpm send-combined <u-address> <night> <s-address> <token-type> <base-units>` | Send NIGHT and a shielded token atomically | Yes |
| `pnpm deregister-dust` | Stop all available registered NIGHT UTxOs from generating DUST | Yes |
| `pnpm redesignate-dust <dust-address>` | Redirect all available registered NIGHT UTxOs to another DUST address | Yes |
| `pnpm history [history-hash]` | Print finalized transaction history | No |
| `pnpm test` | Run unit tests | No |

`deregister-dust` and `redesignate-dust` act on every currently available registered NIGHT UTxO. Both require an existing DUST balance for their transaction fee. Use `pnpm address` on the receiving wallet to obtain its `DUST` address.

Transaction submission retries the same finalized transaction up to three times when the node connection closes. If all attempts fail, synchronize with `pnpm balance` before rebuilding it: the first attempt may have reached the node even when its response was lost.

## Seed configuration

The default `.wallet-seed` file is excluded from Git and uses permission mode `600`. A different file can be selected in `.env`:

```dotenv
WALLET_SEED_FILE=/safe/path/to/midnight-wallet.seed
WALLET_STATE_DIR=/safe/path/to/midnight-wallet-state
```

CI environments may supply a 32-byte seed as 64 hexadecimal characters:

```dotenv
WALLET_SEED=<64 hexadecimal characters>
```

Older versions used the public test seed ending in `...0001`. To move those test funds, first create and record a new wallet address, temporarily set the old seed as `WALLET_SEED`, send the funds to the new address, and then remove the environment variable. Never use that public seed for real assets.

## Security scope

The CLI validates amounts without floating-point arithmetic, masks the Blockfrost Project ID in logs, stores wallet checkpoints in owner-only files, reverts reserved coins after failed transaction construction, and waits for transaction finalization. Wallet state reveals owned coins and must remain private. Mainnet use would additionally require encrypted or hardware-backed keys, durable storage with backup and migration, operational monitoring, transaction limits, recovery testing, and Mainnet-specific integration tests.

## Project scope

This repository intentionally stays a small, reusable Wallet SDK reference rather than a browser-extension wallet. DUST sponsorship, swaps, WASM proving, a wallet-side DApp Connector, multiple accounts, approval UI, and production key custody are out of scope. Future DApps should connect to an established wallet through the DApp Connector API instead of importing this CLI or exposing its seed.

CLI output is kept in `src/commands/`; reusable Node.js operations are exported from `src/lib.ts`. This boundary is useful for trusted scripts that own a seed. Browser DApps must not use it: connect to a wallet through the DApp Connector API instead.

## Acknowledgements

This independent, unofficial project was informed by the [Midnight Academy CLI wallet capstone](https://academy.midnight.network/learn/midnight-wallet/51-hands-on-build-a-cli-wallet-capstone-f15e7446-5ed5-82c3-a006-81a25ff9c09a) and the [official Wallet SDK developer guide](https://docs.midnight.network/sdks/official/wallet-developer-guide). It is not affiliated with or endorsed by the Midnight Foundation or HackQuest.

## License

This project is licensed under the [MIT License](LICENSE).
