import assert from "node:assert/strict";
import test from "node:test";
import { bech32m } from "@scure/base";
import * as ledger from "@midnightntwrk/ledger-v9";
import {
  MidnightBech32m,
  PublicKey,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
  createKeystore,
} from "@midnightntwrk/wallet-sdk";
import { NETWORK_ID } from "../src/config";
import {
  assertSufficientBalances,
  createTokenTransfers,
  decodeShieldedAddress,
  selectDustCoins,
  submitDustRecipe,
  transfer,
  updateDustRegistration,
} from "../src/wallet-service";

test("long shielded addresses decode with checksum and network validation", () => {
  const keys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 7));
  const expected = new ShieldedAddress(
    ShieldedCoinPublicKey.fromHexString(keys.coinPublicKey),
    ShieldedEncryptionPublicKey.fromHexString(keys.encryptionPublicKey),
  );
  const encoded = MidnightBech32m.encode(NETWORK_ID, expected).asString();

  assert.ok(encoded.length > 90);
  assert.ok(decodeShieldedAddress(encoded).equals(expected));
  assert.throws(() => decodeShieldedAddress(`${encoded.slice(0, -1)}x`));
  const decoded = bech32m.decodeToBytes(encoded, false);
  const extendedPrefix = bech32m.encode(
    `${decoded.prefix}_extra`,
    bech32m.toWords(decoded.bytes),
    false,
  );
  assert.throws(() => decodeShieldedAddress(extendedPrefix));
});

test("DUST finalization failure releases the fee-paying recipe", async () => {
  type Recipe = Parameters<typeof submitDustRecipe>[1];
  const original = { transaction: { id: "original" } } as unknown as Recipe;
  const balanced = {
    transaction: { id: "with-dust-fee" },
  } as unknown as Recipe;
  const failure = new Error("proving failed");
  const reverted: unknown[] = [];
  const facade = {
    async balanceUnprovenTransaction() {
      return balanced;
    },
    async finalizeRecipe(recipe: unknown) {
      assert.equal(recipe, balanced);
      throw failure;
    },
    async submitTransaction() {
      assert.fail("must not submit after proving failure");
    },
    async revert(recipe: unknown) {
      reverted.push(recipe);
    },
  } as unknown as Parameters<typeof submitDustRecipe>[0];
  await assert.rejects(
    submitDustRecipe(facade, original, "deregister"),
    (error) => error === failure,
  );
  assert.deepEqual(reverted, [balanced]);
});

test("DUST registration finalizes directly; deregistration and redesignation add a DUST fee", async () => {
  type Recipe = Parameters<typeof submitDustRecipe>[1];
  const original = { transaction: { id: "original" } } as unknown as Recipe;
  const balanced = { transaction: { id: "balanced" } } as unknown as Recipe;
  for (const action of ["register", "deregister", "redesignate"] as const) {
    let balances = 0;
    const facade = {
      async balanceUnprovenTransaction(
        tx: unknown,
        options: { tokenKindsToBalance: string[] },
      ) {
        balances++;
        assert.equal(tx, original.transaction);
        assert.deepEqual(options.tokenKindsToBalance, ["dust"]);
        return balanced;
      },
      async finalizeRecipe(recipe: unknown) {
        assert.equal(recipe, action === "register" ? original : balanced);
        return "finalized";
      },
      async submitTransaction(tx: unknown) {
        assert.equal(tx, "finalized");
        return "identifier";
      },
      async revert() {
        assert.fail("successful recipe must not be reverted");
      },
    } as unknown as Parameters<typeof submitDustRecipe>[0];
    assert.equal(
      await submitDustRecipe(facade, original, action),
      "identifier",
    );
    assert.equal(balances, action === "register" ? 0 : 1);
  }
});

test("combined transfers contain one output of each token kind", () => {
  const keys = ledger.ZswapSecretKeys.fromSeed(Buffer.alloc(32, 7));
  const shielded = MidnightBech32m.encode(
    NETWORK_ID,
    new ShieldedAddress(
      ShieldedCoinPublicKey.fromHexString(keys.coinPublicKey),
      ShieldedEncryptionPublicKey.fromHexString(keys.encryptionPublicKey),
    ),
  ).asString();
  const unshielded = PublicKey.fromKeyStore(
    createKeystore(
      { kind: "schnorr", secret: Buffer.alloc(32, 8) },
      NETWORK_ID,
    ),
  ).address;

  const outputs = createTokenTransfers([
    { kind: "unshielded", recipient: unshielded, amount: 1n },
    {
      kind: "shielded",
      recipient: shielded,
      tokenType: ledger.shieldedToken().raw,
      amount: 2n,
    },
  ]);
  assert.deepEqual(
    outputs.map((output) => output.type),
    ["unshielded", "shielded"],
  );
  assert.deepEqual(
    outputs.map((output) => output.outputs[0].amount),
    [1n, 2n],
  );
});

test("transfer balance checks aggregate outputs by token type", () => {
  const shieldedType = ledger.shieldedToken().raw;
  const state = {
    unshielded: { balances: { [ledger.unshieldedToken().raw]: 5n } },
    shielded: { balances: { [shieldedType]: 3n } },
  };
  assert.doesNotThrow(() =>
    assertSufficientBalances(state, [
      {
        kind: "shielded",
        recipient: "unused",
        tokenType: shieldedType,
        amount: 3n,
      },
      { kind: "unshielded", recipient: "unused", amount: 5n },
    ]),
  );
  assert.throws(
    () =>
      assertSufficientBalances(state, [
        {
          kind: "shielded",
          recipient: "unused",
          tokenType: shieldedType,
          amount: 2n,
        },
        {
          kind: "shielded",
          recipient: "unused",
          tokenType: shieldedType,
          amount: 2n,
        },
      ]),
    /need 4, available 3/,
  );
});

test("DUST actions select only coins with the required registration state", () => {
  const unregistered = {
    id: "new",
    meta: { registeredForDustGeneration: false },
  };
  const registered = {
    id: "existing",
    meta: { registeredForDustGeneration: true },
  };
  const coins = [unregistered, registered];

  assert.deepEqual(selectDustCoins(coins, "register"), [unregistered]);
  assert.deepEqual(selectDustCoins(coins, "deregister"), [registered]);
  assert.deepEqual(selectDustCoins(coins, "redesignate"), [registered]);
});

test("reusable operations reject invalid input before opening a wallet", async () => {
  const seed = Buffer.alloc(32, 1);
  await assert.rejects(
    transfer(seed, [{ kind: "unshielded", recipient: "invalid", amount: 0n }]),
    /greater than zero/,
  );
  await assert.rejects(
    updateDustRegistration(seed, "redesignate", "invalid"),
    /DUST address/,
  );
  await assert.rejects(
    transfer(seed, [
      {
        kind: "shielded",
        recipient: "invalid",
        tokenType: "invalid",
        amount: 1n,
      },
    ]),
    /Token type/,
  );
});
