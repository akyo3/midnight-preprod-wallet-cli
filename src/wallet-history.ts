import {
  InMemoryTransactionHistoryStorage,
  WalletEntrySchema,
  mergeWalletEntries,
} from "@midnightntwrk/wallet-sdk";
import { loadWalletState, saveWalletState } from "./wallet-state";

export async function loadWalletHistory(walletId: string) {
  const saved = await loadWalletState(walletId, "history");
  return {
    needsReplay: saved === undefined,
    storage:
      saved === undefined
        ? new InMemoryTransactionHistoryStorage(
            WalletEntrySchema,
            mergeWalletEntries,
          )
        : InMemoryTransactionHistoryStorage.restore(
            saved,
            WalletEntrySchema,
            mergeWalletEntries,
          ),
  };
}

export async function saveWalletHistory(
  walletId: string,
  storage: Awaited<ReturnType<typeof loadWalletHistory>>["storage"],
) {
  await saveWalletState(walletId, "history", await storage.serialize());
}
