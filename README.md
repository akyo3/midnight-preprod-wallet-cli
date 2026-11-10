# Midnight Preprod Wallet CLI

[日本語](README.ja.md)

A small Wallet SDK reference CLI for Midnight Preprod: derive addresses, check balances and history, manage DUST generation, and transfer NIGHT or existing shielded tokens.

> [!IMPORTANT]
> For learning and testing on Preprod. Back up your seed and keep `.wallet-seed`, `.env`, and `.wallet-state/` private. This is not a production or Mainnet wallet.

## Requirements

- Node.js 22 or later, pnpm, and Docker
- A [Blockfrost](https://blockfrost.io/) Midnight **Preprod** Project ID
- Wallet SDK `2.0.0` and Proof Server `9.0.0` for Preprod's Ledger `9.1.0.1`

The CLI uses Blockfrost's node and indexer; only the Proof Server runs locally. The indexer must support `4.4.101`. See the [Ledger 9 compatibility guide](https://docs.midnight.network/relnotes/ledger-9).

## Setup

```bash
pnpm install --frozen-lockfile
cp .env.example .env
```

Set your Project ID in `.env`:

```dotenv
BLOCKFROST_PROJECT_ID=your_project_id
```

Check the code without accessing a wallet or connecting to Preprod:

```bash
pnpm typecheck
pnpm test
```

The first valid wallet command creates a random seed in `.wallet-seed` with owner-only permissions. Later commands reuse it.

## Start the Proof Server

Keep this running in a separate terminal for commands marked **Yes** below. Stop any old Proof Server using port 6300 first; Ledger 9 requires version `9.0.0`.

```bash
docker run --rm \
  -p 127.0.0.1:6300:6300 \
  midnightntwrk/proof-server:9.0.0
```

Check that it responds with `status: ok`:

```bash
curl --fail http://localhost:6300/health
```

## First transfer

1. Run `pnpm address` and copy the **Unshielded** address (`mn_addr_preprod1...`).
2. Request tNIGHT from the [Preprod faucet](https://midnight-tmnight-preprod.nethermind.dev/).
3. Run `pnpm balance` to wait for synchronization and check the balance.
4. Run `pnpm register-dust`. Registration keeps your NIGHT balance and enables DUST generation for transaction fees. If the SDK reports insufficient generated DUST for registration, wait and retry.
5. Send a small amount with `pnpm send <recipient-unshielded-address> <amount-in-night>`.
6. Wait for `Transfer finalized`, then check `pnpm history`.

Preprod's Ledger 9 upgrade cleared registrations not backed by cNIGHT. Existing faucet tNIGHT may need registration again; `register-dust` reports when all available coins are already registered.

## Commands

| Command                                                                        | Purpose                                                       | Proof Server |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------- | ------------ |
| `pnpm address`                                                                 | Print Unshielded, Shielded, and DUST addresses                | No           |
| `pnpm balance`                                                                 | Synchronize and print balances                                | No           |
| `pnpm history [history-hash]`                                                  | List finalized history or find one entry                      | No           |
| `pnpm register-dust`                                                           | Register available unregistered NIGHT UTxOs                   | Yes          |
| `pnpm send <address> <night>`                                                  | Transfer unshielded NIGHT                                     | Yes          |
| `pnpm send-shielded <address> <token-type> <base-units>`                       | Transfer an existing shielded token                           | Yes          |
| `pnpm send-combined <u-address> <night> <s-address> <token-type> <base-units>` | Transfer both token kinds atomically                          | Yes          |
| `pnpm deregister-dust`                                                         | Stop DUST generation for all available registered NIGHT UTxOs | Yes          |
| `pnpm redesignate-dust <dust-address>`                                         | Redirect generation for all available registered NIGHT UTxOs  | Yes          |

NIGHT amounts allow up to six decimal places. Shielded amounts are positive integers in the issuer's base units; copy the 64-character token type from `pnpm balance`. These commands do not convert NIGHT into shielded tokens. The combined transfer contains both outputs in one transaction.

`deregister-dust` and `redesignate-dust` change every available registered NIGHT UTxO and require DUST for fees. Obtain the destination DUST address with `pnpm address` on the receiving wallet.

For history searches, use the **History hash** printed by `pnpm history`, not the **Identifier** printed after submission. Times are UTC; fees are in specks (1 DUST = 10¹⁵ specks).

## Saved state and history

Wallet state and history are stored per wallet and network in `.wallet-state/`, or `WALLET_STATE_DIR`. These private files let later commands resume synchronization. Long DUST syncs save a checkpoint every 10,000 applied events.

When an older checkpoint has no saved history, the next wallet command rebuilds NIGHT and shielded history once, keeping the DUST checkpoint. This can take longer than a normal startup. Unreadable history fails explicitly instead of being silently discarded.

`history` fills missing times from finalized blocks and fetches missing fees or block information from the indexer. Retrieved details are saved for later commands. Unavailable fields remain unknown with a warning; non-regular transactions have no regular fee field and show `not applicable`.

## Troubleshooting

- **DUST proof rejected (`170`)**: check Proof Server `9.0.0` and indexer compatibility, then wait for DUST sync before rebuilding. See [DUST troubleshooting](https://docs.midnight.network/guides/manage-dust#dust-troubleshooting).
- **Submission result unclear after a disconnect**: check balance and history before rebuilding; the node may already have received the transaction. Run one command at a time per wallet.
- **Saved state cannot be restored**: move the state directory aside and resync with the same seed. Keep the original files and never delete the seed to reset synchronization.

## Seed and state configuration

Optional settings in `.env`:

```dotenv
WALLET_SEED_FILE=/safe/path/to/midnight-wallet.seed
WALLET_STATE_DIR=/safe/path/to/midnight-wallet-state
```

`WALLET_SEED` can supply a 32-byte seed as 64 hexadecimal characters and takes precedence over the seed file. Never commit or share it. Older versions used a public test seed; do not use that seed for private funds.

## Code and scope

CLI output lives in `src/commands/`. `src/lib.ts` exports reusable operations for trusted Node.js scripts that manage their own seed. Browser DApps should use the DApp Connector API with an established wallet.

This project does not implement production key custody, multiple accounts, swaps, DUST sponsorship, or a wallet-side DApp Connector. Amounts use `bigint`, Project IDs are masked in logs, and saved files use owner-only permissions; these measures do not make this a production wallet.

## Acknowledgements

An independent, unofficial project informed by the [Midnight Academy CLI wallet capstone](https://academy.midnight.network/learn/midnight-wallet/51-hands-on-build-a-cli-wallet-capstone-f15e7446-5ed5-82c3-a006-81a25ff9c09a) and [Wallet SDK developer guide](https://docs.midnight.network/sdks/official/wallet-developer-guide). Not affiliated with or endorsed by the Midnight Foundation or HackQuest.

## License

This project is licensed under the [MIT License](LICENSE).
