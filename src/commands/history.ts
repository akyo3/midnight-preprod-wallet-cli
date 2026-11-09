// Prints finalized transaction history.
import * as ledger from "@midnight-ntwrk/ledger-v8";
import type { WalletEntry } from "@midnight-ntwrk/wallet-sdk";
import { formatUnits } from "../amounts";
import { buildWallet, startAndSync, stopWallet } from "../wallet";

function nightChange(entry: WalletEntry): bigint {
  const tokenType = ledger.unshieldedToken().raw;
  const created = entry.unshielded?.createdUtxos
    .filter((utxo) => utxo.tokenType === tokenType)
    .reduce((total, utxo) => total + utxo.value, 0n) ?? 0n;
  const spent = entry.unshielded?.spentUtxos
    .filter((utxo) => utxo.tokenType === tokenType)
    .reduce((total, utxo) => total + utxo.value, 0n) ?? 0n;
  return created - spent;
}

function printEntry(entry: WalletEntry) {
  const timestamp = entry.timestamp?.toISOString() ?? "time unavailable";
  const change = formatUnits(nightChange(entry), 6);
  const fees = entry.fees == null ? "unknown" : `${entry.fees} specks`;

  console.log(`${timestamp}  ${entry.status}`);
  console.log(`  History hash: ${entry.hash}`);
  console.log(`  NIGHT change: ${change}`);
  console.log(`  Fee: ${fees}`);
}

export async function historyCommand(seed: Buffer, hash?: string) {
  const bundle = await buildWallet(seed);

  try {
    console.log("Syncing transaction history...");
    await startAndSync(bundle, { waitForDust: false });

    const entries = hash
      ? [await bundle.facade.queryTxHistoryByHash(hash)].filter(
          (entry): entry is WalletEntry => entry !== undefined,
        )
      : await bundle.facade.getAllFromTxHistory();

    entries.sort((a, b) => (b.timestamp?.getTime() ?? 0) - (a.timestamp?.getTime() ?? 0));

    if (entries.length === 0) {
      console.log(hash ? `Transaction not found: ${hash}` : "No transactions found.");
      return;
    }

    for (const [index, entry] of entries.entries()) {
      if (index > 0) console.log("");
      printEntry(entry);
    }
  } finally {
    await stopWallet(bundle);
  }
}
