import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import type { FacadeState } from "@midnightntwrk/wallet-sdk";
import { BehaviorSubject } from "rxjs";
import { startAndSync, stopWallet } from "../src/wallet";
import { loadWalletState } from "../src/wallet-state";
import { loadWalletHistory } from "../src/wallet-history";

function state(crossing: boolean, synced = true): FacadeState {
  const progress = {
    appliedId: 1n,
    highestTransactionId: 1n,
    appliedIndex: 0n,
    highestRelevantWalletIndex: 0n,
    isStrictlyComplete: () => synced,
  };
  const wallet = { progress, serialize: () => "test-checkpoint" };
  return {
    protocol: crossing
      ? { _tag: "Crossing", from: 1n, to: 2n, behind: ["shielded"] }
      : { _tag: "Settled", version: 2n },
    unshielded: { ...wallet, totalCoins: [] },
    shielded: wallet,
    dust: wallet,
  } as unknown as FacadeState;
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "midnight-wallet-sync-"),
  );
  const previous = process.env.WALLET_STATE_DIR;
  process.env.WALLET_STATE_DIR = directory;
  t.after(async () => {
    if (previous === undefined) delete process.env.WALLET_STATE_DIR;
    else process.env.WALLET_STATE_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  });
  const states = new BehaviorSubject(state(true));
  const { storage: txHistoryStorage } = await loadWalletHistory("sync-test");
  const bundle = {
    facade: {
      start: async () => {},
      stop: async () => {},
      state: () => states.asObservable(),
    },
    walletId: "sync-test",
    txHistoryStorage,
    needsHistoryReplay: false,
    historyReadyToSave: false,
    clearKeystoreSecret: () => {},
  } as unknown as Parameters<typeof startAndSync>[0];
  return { states, bundle };
}

test("transaction sync waits for both protocol agreement and required balances", async (t) => {
  const { states, bundle } = await fixture(t);
  let finished = false;
  const result = startAndSync(bundle, {
    waitForDust: false,
    waitForProtocol: true,
    timeoutMs: 1_000,
  }).then((value) => {
    finished = true;
    return value;
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  states.next(state(false, false));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);

  const ready = state(false);
  states.next(ready);
  assert.equal(await result, ready);
  assert.equal(states.observed, false);
});

test("protocol wait times out, saves a checkpoint and releases the subscription", async (t) => {
  const { states, bundle } = await fixture(t);
  await assert.rejects(
    startAndSync(bundle, {
      waitForDust: false,
      waitForProtocol: true,
      timeoutMs: 20,
    }),
    /Protocol crossing 1 -> 2: waiting for shielded/,
  );
  assert.equal(states.observed, false);
  assert.equal(
    await loadWalletState("sync-test", "unshielded"),
    "test-checkpoint",
  );
});

test("read-only sync can finish during a protocol crossing", async (t) => {
  const { states, bundle } = await fixture(t);
  assert.equal(
    (await startAndSync(bundle, { waitForDust: false, timeoutMs: 1_000 }))
      .protocol._tag,
    "Crossing",
  );
  assert.equal(states.observed, false);
});

test("incomplete history replay does not mark a partial history as restored", async (t) => {
  const { states, bundle } = await fixture(t);
  bundle.needsHistoryReplay = true;
  states.next(state(false, false));
  await assert.rejects(
    startAndSync(bundle, { waitForDust: false, timeoutMs: 20 }),
    /Sync timed out/,
  );
  await stopWallet(bundle);
  assert.equal(await loadWalletState("sync-test", "history"), undefined);
  assert.equal(await loadWalletState("sync-test", "unshielded"), undefined);
});

test("history replay waits for shielded sync even when the caller skips it", async (t) => {
  const { states, bundle } = await fixture(t);
  bundle.needsHistoryReplay = true;
  const incomplete = state(false);
  states.next({
    ...incomplete,
    shielded: {
      ...incomplete.shielded,
      progress: state(false, false).shielded.progress,
    },
  } as unknown as FacadeState);
  await assert.rejects(
    startAndSync(bundle, {
      waitForDust: false,
      waitForShielded: false,
      timeoutMs: 20,
    }),
    /Sync timed out/,
  );
  assert.equal(await loadWalletState("sync-test", "history"), undefined);
});

test("completed replay persists history and shutdown saves entries received after sync", async (t) => {
  const { states, bundle } = await fixture(t);
  bundle.needsHistoryReplay = true;
  states.next(state(false));
  await startAndSync(bundle, { waitForDust: false, timeoutMs: 1_000 });
  assert.equal(bundle.historyReadyToSave, true);
  await bundle.txHistoryStorage.gotPending({
    hash: "after-sync",
    identifiers: ["test-identifier"],
    submittedAt: new Date("2026-01-01T00:00:00Z"),
  });
  await stopWallet(bundle);
  const restored = await loadWalletHistory("sync-test");
  assert.equal(restored.needsReplay, false);
  assert.equal(
    (await restored.storage.get("after-sync"))?.lifecycle.status,
    "pending",
  );
});

test("a closed state stream fails promptly rather than waiting for the sync timeout", async (t) => {
  const { states, bundle } = await fixture(t);
  states.complete();
  await assert.rejects(
    startAndSync(bundle, { waitForDust: false, timeoutMs: 1_000 }),
    /state stream ended/,
  );
  assert.equal(states.observed, false);
});

test("shutdown failures do not replace an operation result or prevent secret cleanup", async (t) => {
  const { bundle } = await fixture(t);
  t.mock.method(console, "warn", () => {});
  t.mock.method(bundle.facade, "stop", async () => {
    throw new Error("stop failed");
  });
  let cleared = false;
  bundle.clearKeystoreSecret = () => {
    cleared = true;
  };
  assert.equal(await stopWallet(bundle), false);
  assert.equal(cleared, true);
});

test("a history save failure on shutdown is reported without hiding finalization", async (t) => {
  const { bundle } = await fixture(t);
  const warnings = t.mock.method(console, "warn", () => {});
  bundle.historyReadyToSave = true;
  t.mock.method(bundle.txHistoryStorage, "serialize", async () => {
    throw new Error("save failed");
  });
  let cleared = false;
  bundle.clearKeystoreSecret = () => {
    cleared = true;
  };
  assert.equal(await stopWallet(bundle), false);
  assert.equal(cleared, true);
  assert.match(
    String(warnings.mock.calls[0].arguments[0]),
    /finalized transaction remains finalized/,
  );
});
