import assert from "node:assert/strict";
import test from "node:test";
import * as ledger from "@midnight-ntwrk/ledger-v8";
import {
  MidnightBech32m,
  PublicKey,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
  createKeystore,
} from "@midnight-ntwrk/wallet-sdk";
import { NETWORK_ID } from "../src/config";
import {
  assertSufficientBalances,
  createTokenTransfers,
  decodeShieldedAddress,
  selectDustCoins,
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
    createKeystore(Buffer.alloc(32, 8), NETWORK_ID),
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
  assert.deepEqual(outputs.map((output) => output.type), ["unshielded", "shielded"]);
  assert.deepEqual(outputs.map((output) => output.outputs[0].amount), [1n, 2n]);
});

test("transfer balance checks aggregate outputs by token type", () => {
  const shieldedType = ledger.shieldedToken().raw;
  const state = {
    unshielded: { balances: { [ledger.unshieldedToken().raw]: 5n } },
    shielded: { balances: { [shieldedType]: 3n } },
  };
  assert.doesNotThrow(() =>
    assertSufficientBalances(state, [
      { kind: "shielded", recipient: "unused", tokenType: shieldedType, amount: 3n },
      { kind: "unshielded", recipient: "unused", amount: 5n },
    ]),
  );
  assert.throws(
    () =>
      assertSufficientBalances(state, [
        { kind: "shielded", recipient: "unused", tokenType: shieldedType, amount: 2n },
        { kind: "shielded", recipient: "unused", tokenType: shieldedType, amount: 2n },
      ]),
    /need 4, available 3/,
  );
});

test("DUST actions select only coins with the required registration state", () => {
  const unregistered = { id: "new", meta: { registeredForDustGeneration: false } };
  const registered = { id: "existing", meta: { registeredForDustGeneration: true } };
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
