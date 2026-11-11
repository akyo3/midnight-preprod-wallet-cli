import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  parseBaseUnits,
  parseCommand,
  parseCombinedSendArguments,
  parseNightAmount,
  parseSendArguments,
  parseShieldedSendArguments,
  parseSingleArgument,
  parseTokenType,
} from "../src/cli";

const TOKEN_TYPE = "ab".repeat(32);

test("NIGHT amount is converted to micro-NIGHT without floating-point rounding", () => {
  assert.equal(parseNightAmount("3"), 3_000_000n);
  assert.equal(parseNightAmount("1.5"), 1_500_000n);
  assert.equal(parseNightAmount("0.000001"), 1n);
});

test("invalid NIGHT amounts are rejected", () => {
  for (const value of ["0", "-1", "1.0000001", "1e3", "NaN", ""]) {
    assert.throws(() => parseNightAmount(value));
  }
});

test("send arguments accept pnpm's optional separator", () => {
  assert.deepEqual(parseSendArguments(["address", "3"]), {
    recipient: "address",
    amount: 3_000_000n,
  });
  assert.deepEqual(parseSendArguments(["--", "address", "3"]), {
    recipient: "address",
    amount: 3_000_000n,
  });
});

test("combined transfer arguments preserve both recipients and exact amounts", () => {
  assert.deepEqual(
    parseCombinedSendArguments(["night", "1.25", "shielded", TOKEN_TYPE, "2"]),
    {
      unshielded: { recipient: "night", amount: 1_250_000n },
      shielded: { recipient: "shielded", tokenType: TOKEN_TYPE, amount: 2n },
    },
  );
  assert.throws(() => parseCombinedSendArguments(["night", "1"]));
});

test("shielded transfers require a token type and an integer base-unit amount", () => {
  assert.deepEqual(parseShieldedSendArguments(["shielded", TOKEN_TYPE, "25"]), {
    recipient: "shielded",
    tokenType: TOKEN_TYPE,
    amount: 25n,
  });
  assert.equal(parseBaseUnits("1"), 1n);
  assert.equal(parseTokenType(TOKEN_TYPE.toUpperCase()), TOKEN_TYPE);
  for (const value of ["0", "-1", "1.5", "1e3", ""]) {
    assert.throws(() => parseBaseUnits(value));
  }
  assert.throws(() => parseTokenType("ab"));
});

test("single argument commands reject missing or extra values", () => {
  assert.equal(parseSingleArgument(["--", "dust"], "usage"), "dust");
  assert.throws(() => parseSingleArgument([], "usage"), /usage/);
  assert.throws(() => parseSingleArgument(["one", "two"], "usage"), /usage/);
});

test("history supports the separator, normalizes hashes and rejects extra arguments", () => {
  const hash = "AB".repeat(32);
  assert.deepEqual(parseCommand("history", ["--", hash]), {
    command: "history",
    hash: hash.toLowerCase(),
  });
  assert.deepEqual(parseCommand("history", []), {
    command: "history",
    hash: undefined,
  });
  assert.throws(() => parseCommand("history", ["invalid"]), /Usage/);
  assert.throws(() => parseCommand("history", [hash, hash]), /Usage/);
  for (const command of [
    "address",
    "balance",
    "register-dust",
    "deregister-dust",
  ]) {
    assert.throws(() => parseCommand(command, ["unexpected"]), /Usage/);
  }
});

test("invalid command syntax exits before creating a wallet seed", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "midnight-cli-arguments-"),
  );
  const seedFile = path.join(directory, "seed");
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        fileURLToPath(new URL("../src/index.ts", import.meta.url)),
        "send",
        "unused-recipient",
        "0",
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          WALLET_SEED: "",
          WALLET_SEED_FILE: seedFile,
          BLOCKFROST_PROJECT_ID: "",
        },
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /greater than zero/);
    await assert.rejects(stat(seedFile), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
