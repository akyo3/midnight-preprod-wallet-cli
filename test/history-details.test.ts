import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryTransactionHistoryStorage,
  WalletEntrySchema,
  mergeWalletEntries,
  type WalletEntry,
} from "@midnightntwrk/wallet-sdk";
import {
  completeHistoryEntries,
  createHistoryDetailsLookup,
  historyTimestamp,
} from "../src/history-details";

const block = {
  hash: "test-block",
  height: 1,
  timestamp: new Date("2026-01-01T00:00:00Z"),
};
const entry = (hash = "test-history"): WalletEntry => ({
  hash,
  identifiers: [],
  status: "SUCCESS",
  lifecycle: { status: "finalized", finalizedBlock: block },
  unshielded: { id: 1, createdUtxos: [], spentUtxos: [] },
});
const memory = () =>
  new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries);
const transaction = (overrides: Record<string, unknown> = {}) => ({
  __typename: "RegularTransaction",
  hash: "test-history",
  block: { ...block, timestamp: block.timestamp.getTime() },
  fees: { paidFees: "9007199254740993" },
  identifiers: ["test-identifier"],
  transactionResult: { status: "SUCCESS" },
  ...overrides,
});

function lookupFor(transactions: unknown[]) {
  return createHistoryDetailsLookup(
    "https://indexer.invalid",
    async (_url, init) => {
      assert.equal(init?.method, "POST");
      assert.equal(
        JSON.parse(String(init?.body)).variables.transactionHash,
        "test-history",
      );
      return Response.json({ data: { transactions } });
    },
  );
}

test("missing fee is fetched exactly and cached with block time across restart", async () => {
  const storage = memory();
  const result = await completeHistoryEntries(
    [entry()],
    storage,
    lookupFor([transaction()]),
  );
  assert.equal(result.unavailable, 0);
  assert.equal(result.entries[0].fees, 9007199254740993n);
  assert.equal(
    historyTimestamp(result.entries[0])?.toISOString(),
    block.timestamp.toISOString(),
  );
  const restored = InMemoryTransactionHistoryStorage.restore(
    await storage.serialize(),
    WalletEntrySchema,
    mergeWalletEntries,
  );
  const saved = await restored.get("test-history");
  assert.equal(saved?.fees, 9007199254740993n);
  assert.deepEqual(saved?.unshielded, entry().unshielded);
  assert.deepEqual(saved?.identifiers, ["test-identifier"]);
  assert.equal(saved?.timestamp?.toISOString(), block.timestamp.toISOString());
  await completeHistoryEntries(await restored.getAll(), restored, async () => {
    assert.fail("complete metadata must not be fetched again");
  });
});

test("block timestamp fills a missing display timestamp without a network query", async () => {
  const current = { ...entry(), fees: 0n };
  const result = await completeHistoryEntries([current], memory(), async () => {
    assert.fail("known block and fee need no network query");
  });
  assert.equal(
    result.entries[0].timestamp?.toISOString(),
    block.timestamp.toISOString(),
  );
  assert.equal(result.entries[0].fees, 0n);
});

test("an entry with no block gets its time from the matching transaction only", async () => {
  const current: WalletEntry = {
    ...entry(),
    lifecycle: { status: "finalized" },
  };
  const result = await completeHistoryEntries(
    [current],
    memory(),
    lookupFor([
      transaction({ hash: "different-transaction", fees: { paidFees: "1" } }),
      transaction(),
    ]),
  );
  assert.equal(
    result.entries[0].timestamp?.getTime(),
    block.timestamp.getTime(),
  );
  assert.equal(result.entries[0].fees, 9007199254740993n);
  assert.equal(
    await lookupFor([transaction({ hash: "different-transaction" })])(
      "test-history",
    ),
    undefined,
  );
});

test("non-regular transactions record no regular fee without inventing zero", async () => {
  const result = await completeHistoryEntries(
    [entry()],
    memory(),
    lookupFor([
      transaction({ __typename: "SystemTransaction", fees: undefined }),
    ]),
  );
  assert.equal(result.entries[0].fees, null);
  assert.equal(result.unavailable, 0);
});

test("metadata failure retains history and local times without repeated failing requests", async () => {
  let calls = 0;
  const result = await completeHistoryEntries(
    [entry(), entry("other")],
    memory(),
    async () => {
      calls++;
      throw new Error("private connection details must not be printed");
    },
  );
  assert.equal(calls, 1);
  assert.equal(result.unavailable, 2);
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].fees, undefined);
  assert.equal(
    result.entries[0].timestamp?.getTime(),
    block.timestamp.getTime(),
  );
});

test("malformed GraphQL metadata is rejected instead of displaying incorrect values", async () => {
  for (const tx of [
    transaction({ fees: { paidFees: -1 } }),
    transaction({ fees: { paidFees: "1.25" } }),
    transaction({ block: { ...block, timestamp: "not-a-time" } }),
    transaction({ __typename: "UnknownTransaction" }),
  ]) {
    await assert.rejects(lookupFor([tx])("test-history"));
  }
  const errorLookup = createHistoryDetailsLookup(
    "https://indexer.invalid",
    async () => Response.json({ errors: [{ message: "internal details" }] }),
  );
  await assert.rejects(errorLookup("test-history"), /response is invalid/);
});
