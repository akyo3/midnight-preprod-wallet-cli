// Prints finalized transaction history.
import * as ledger from "@midnightntwrk/ledger-v9";
import type { WalletEntry } from "@midnightntwrk/wallet-sdk";
import { formatUnits } from "../amounts";
import { getNetworkConfig } from "../config";
import {
  completeHistoryEntries,
  createHistoryDetailsLookup,
  historyTimestamp,
} from "../history-details";
import { buildWallet, startAndSync, stopWallet } from "../wallet";

function nightChange(entry: WalletEntry): bigint {
  const tokenType = ledger.unshieldedToken().raw;
  const created =
    entry.unshielded?.createdUtxos
      .filter((utxo) => utxo.tokenType === tokenType)
      .reduce((total, utxo) => total + utxo.value, 0n) ?? 0n;
  const spent =
    entry.unshielded?.spentUtxos
      .filter((utxo) => utxo.tokenType === tokenType)
      .reduce((total, utxo) => total + utxo.value, 0n) ?? 0n;
  return created - spent;
}

function printEntry(entry: WalletEntry) {
  const timestamp =
    historyTimestamp(entry)?.toISOString() ??
    "time unavailable (not retrieved from indexer)";
  const change = formatUnits(nightChange(entry), 6);
  const fees =
    entry.fees === null
      ? "not applicable (non-regular transaction)"
      : entry.fees === undefined
        ? "unknown (not retrieved from indexer)"
        : `${entry.fees} specks`;

  console.log(`${timestamp}  ${entry.status}`);
  console.log(`  History hash: ${entry.hash}`);
  console.log(`  NIGHT change: ${change}`);
  console.log(`  Fee: ${fees}`);
}

export async function historyCommand(seed: Buffer, hash?: string) {
  const bundle = await buildWallet(seed);

  try {
    console.log("Syncing transaction history...");
    await startAndSync(bundle, { waitForDust: false, waitForShielded: true });

    const stored = (
      hash
        ? [await bundle.facade.queryTxHistoryByHash(hash)].filter(
            (entry): entry is WalletEntry => entry !== undefined,
          )
        : await bundle.facade.getAllFromTxHistory()
    ).filter((entry) => entry.lifecycle.status === "finalized");

    const { entries, unavailable } = await completeHistoryEntries(
      stored,
      bundle.txHistoryStorage,
      createHistoryDetailsLookup(getNetworkConfig().indexerHttpUrl),
    );
    if (unavailable > 0) {
      console.warn(
        `Transaction details unavailable for ${unavailable} entries; missing fields remain unknown. ` +
          "Check the indexer connection and retry history.",
      );
    }
    entries.sort(
      (a, b) =>
        (historyTimestamp(b)?.getTime() ?? 0) -
        (historyTimestamp(a)?.getTime() ?? 0),
    );

    if (entries.length === 0) {
      console.log(
        hash ? `Transaction not found: ${hash}` : "No transactions found.",
      );
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
