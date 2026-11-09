import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadOrCreateSeed, parseSeed } from "../src/seed";

test("seed parser accepts exactly 32 bytes of hexadecimal data", () => {
  const seed = parseSeed("ab".repeat(32));
  assert.equal(seed.length, 32);
  assert.equal(seed.toString("hex"), "ab".repeat(32));
  assert.throws(() => parseSeed("ab"));
  assert.throws(() => parseSeed("zz".repeat(32)));
});

test("a generated seed is private and stable across reloads", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "midnight-wallet-seed-"));
  const file = path.join(directory, "seed");
  const previousSeed = process.env.WALLET_SEED;
  const previousFile = process.env.WALLET_SEED_FILE;

  try {
    delete process.env.WALLET_SEED;
    process.env.WALLET_SEED_FILE = file;
    const generated = await loadOrCreateSeed();
    const loaded = await loadOrCreateSeed();

    assert.equal(generated.length, 32);
    assert.deepEqual(loaded, generated);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  } finally {
    if (previousSeed === undefined) delete process.env.WALLET_SEED;
    else process.env.WALLET_SEED = previousSeed;
    if (previousFile === undefined) delete process.env.WALLET_SEED_FILE;
    else process.env.WALLET_SEED_FILE = previousFile;
    await rm(directory, { recursive: true, force: true });
  }
});
