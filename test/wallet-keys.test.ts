import assert from "node:assert/strict";
import test from "node:test";
import { createWalletKeys } from "../src/wallet";

test("temporary role seeds can be cleared without corrupting the signing keystore", () => {
  const keys = createWalletKeys(Buffer.alloc(32, 9));
  const message = Buffer.from("signing regression test");

  assert.doesNotThrow(() => keys.keystore.signData(message));
  keys.clearKeystoreSecret();
  assert.deepEqual(keys.keystore.getSecretKey(), Buffer.alloc(32));
  assert.throws(() => keys.keystore.signData(message));
});
