import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { loadWalletHistory, saveWalletHistory } from "../src/wallet-history";
import { saveWalletState } from "../src/wallet-state";

async function fixture(t: TestContext) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "midnight-wallet-history-"),
  );
  const previous = process.env.WALLET_STATE_DIR;
  process.env.WALLET_STATE_DIR = directory;
  t.after(async () => {
    if (previous === undefined) delete process.env.WALLET_STATE_DIR;
    else process.env.WALLET_STATE_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test("history survives restart and remains searchable with wallet sections and exact amounts", async (t) => {
  const directory = await fixture(t);
  const { storage, needsReplay } = await loadWalletHistory("wallet");
  assert.equal(needsReplay, true);
  const timestamp = new Date("2026-01-01T00:00:00Z");
  const common = {
    hash: "test-history-hash",
    identifiers: ["test-identifier"],
    status: "SUCCESS" as const,
    timestamp,
    fees: 9007199254740993n,
    finalizedBlock: { hash: "test-block", height: 1, timestamp },
  };
  await storage.gotFinalized({
    ...common,
    unshielded: {
      id: 1,
      createdUtxos: [],
      spentUtxos: [
        {
          value: 9007199254740995n,
          owner: "test-owner",
          tokenType: "test-token",
          intentHash: "test-intent",
          outputIndex: 0,
        },
      ],
    },
  });
  await storage.gotFinalized({
    ...common,
    shielded: { receivedCoins: [], spentCoins: [] },
  });
  await saveWalletHistory("wallet", storage);

  const restored = await loadWalletHistory("wallet");
  assert.equal(restored.needsReplay, false);
  const entry = await restored.storage.get(common.hash);
  assert.equal(entry?.fees, common.fees);
  assert.equal(entry?.timestamp?.toISOString(), timestamp.toISOString());
  assert.equal(entry?.unshielded?.spentUtxos[0].value, 9007199254740995n);
  assert.deepEqual(entry?.shielded, { receivedCoins: [], spentCoins: [] });
  assert.equal((await restored.storage.getAll()).length, 1);
  assert.equal(
    (await stat(path.join(directory, "wallet-history.json"))).mode & 0o777,
    0o600,
  );
  assert.equal((await loadWalletHistory("other-wallet")).needsReplay, true);
});

test("unreadable saved history fails explicitly instead of silently resetting", async (t) => {
  await fixture(t);
  await saveWalletState("wallet", "history", "not-json");
  await assert.rejects(loadWalletHistory("wallet"));
});
