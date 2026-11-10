import type { WalletEntry } from "@midnightntwrk/wallet-sdk";
import type { loadWalletHistory } from "./wallet-history";

type Block = { hash: string; height: number; timestamp: Date };
export type HistoryDetails = {
  block: Block;
  fees: bigint | null;
  identifiers?: readonly string[];
  status?: WalletEntry["status"];
};

// Same selection as Wallet SDK 2's TransactionHistoryDetail query.
const detailsQuery = `query TransactionHistoryDetail($transactionHash: HexEncoded!) {
  transactions(offset: {hash: $transactionHash}) {
    __typename hash block { hash height timestamp }
    ... on RegularTransaction {
      identifiers fees { paidFees } transactionResult { status }
    }
  }
}`;

export function createHistoryDetailsLookup(
  url: string,
  request: typeof fetch = fetch,
) {
  return async (hash: string): Promise<HistoryDetails | undefined> => {
    const response = await request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: detailsQuery,
        variables: { transactionHash: hash },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new Error("Indexer transaction details request failed.");
    const result = await response.json();
    if (result.errors?.length || !Array.isArray(result.data?.transactions)) {
      throw new Error("Indexer transaction details response is invalid.");
    }
    const tx = result.data.transactions.find(
      (value: { hash?: unknown }) => value?.hash === hash,
    );
    if (!tx) return undefined;
    const block = tx.block;
    if (
      typeof block?.hash !== "string" ||
      !block.hash ||
      !Number.isSafeInteger(block.height) ||
      block.height < 0 ||
      typeof block.timestamp !== "number" ||
      !Number.isFinite(block.timestamp) ||
      !Number.isFinite(new Date(block.timestamp).getTime())
    )
      throw new Error("Indexer transaction block is invalid.");
    const metadata: HistoryDetails = {
      block: {
        hash: block.hash,
        height: block.height,
        timestamp: new Date(block.timestamp),
      },
      fees: null,
    };
    if (tx.__typename === "RegularTransaction") {
      if (
        typeof tx.fees?.paidFees !== "string" ||
        !/^\d+$/.test(tx.fees.paidFees) ||
        !Array.isArray(tx.identifiers) ||
        !tx.identifiers.every((id: unknown) => typeof id === "string") ||
        !["SUCCESS", "FAILURE", "PARTIAL_SUCCESS"].includes(
          tx.transactionResult?.status,
        )
      )
        throw new Error("Indexer transaction fee or status is invalid.");
      metadata.fees = BigInt(tx.fees.paidFees);
      metadata.identifiers = tx.identifiers;
      metadata.status = tx.transactionResult.status;
    } else if (
      !["SystemTransaction", "BridgeClaimTransaction"].includes(tx.__typename)
    ) {
      throw new Error("Indexer transaction type is invalid.");
    }
    return metadata;
  };
}

export function historyTimestamp(entry: WalletEntry): Date | undefined {
  return (
    entry.timestamp ??
    (entry.lifecycle.status === "finalized"
      ? entry.lifecycle.finalizedBlock?.timestamp
      : undefined)
  );
}

export async function completeHistoryEntries(
  entries: readonly WalletEntry[],
  storage: Awaited<ReturnType<typeof loadWalletHistory>>["storage"],
  lookup: (hash: string) => Promise<HistoryDetails | undefined>,
) {
  const completed: WalletEntry[] = [];
  let unavailable = 0;
  let requestFailed = false;
  for (const entry of entries) {
    if (entry.lifecycle.status !== "finalized") {
      completed.push(entry);
      continue;
    }
    let block = entry.lifecycle.finalizedBlock;
    let details: HistoryDetails | undefined;
    if (entry.fees === undefined || !historyTimestamp(entry) || !block) {
      if (!requestFailed) {
        try {
          details = await lookup(entry.hash);
        } catch {
          // A connection or schema failure affects the remaining lookups too.
          // Do not log the error, which may contain credentials in the URL.
          requestFailed = true;
        }
      }
      if (!details) unavailable++;
    }
    block ??= details?.block;
    const updated: WalletEntry = {
      ...entry,
      timestamp: historyTimestamp(entry) ?? details?.block.timestamp,
      fees: entry.fees !== undefined ? entry.fees : details?.fees,
      identifiers: [
        ...new Set([...entry.identifiers, ...(details?.identifiers ?? [])]),
      ],
      status: entry.status ?? details?.status,
    };
    if (block) {
      const { lifecycle: _lifecycle, ...input } = updated;
      await storage.gotFinalized({ ...input, finalizedBlock: block });
    }
    completed.push(updated);
  }
  return { entries: completed, unavailable };
}
