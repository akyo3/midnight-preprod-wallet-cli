import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadWalletState, saveWalletState } from "../src/wallet-state";

test("wallet checkpoints are private and can be restored", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "midnight-wallet-state-"));
  const previous = process.env.WALLET_STATE_DIR;
  process.env.WALLET_STATE_DIR = directory;

  try {
    await saveWalletState("wallet", "shielded", "serialized-state");
    assert.equal(await loadWalletState("wallet", "shielded"), "serialized-state");
    assert.equal((await stat(path.join(directory, "wallet-shielded.json"))).mode & 0o777, 0o600);
    assert.equal(await loadWalletState("wallet", "dust"), undefined);
    await assert.rejects(loadWalletState("../outside", "dust"), /state ID/);

    await Promise.all([
      saveWalletState("wallet", "dust", "first"),
      saveWalletState("wallet", "dust", "second"),
    ]);
    assert.ok(["first", "second"].includes((await loadWalletState("wallet", "dust")) ?? ""));
    assert.deepEqual(
      (await readdir(directory)).filter((file) => file.includes(".tmp")),
      [],
    );
  } finally {
    if (previous === undefined) delete process.env.WALLET_STATE_DIR;
    else process.env.WALLET_STATE_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
