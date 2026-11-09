import assert from "node:assert/strict";
import test from "node:test";
import {
  parseBaseUnits,
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
