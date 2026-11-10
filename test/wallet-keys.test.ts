import assert from "node:assert/strict";
import test from "node:test";
import { createWalletKeys } from "../src/wallet";

test("clearing the local signing secret buffer does not invalidate the keystore", async () => {
  const keys = createWalletKeys(Buffer.alloc(32, 9));
  const message = Buffer.from("signing regression test");

  await assert.doesNotReject(() => keys.keystore.signDataAsync(message));
  keys.clearKeystoreSecret();
  assert.deepEqual(keys.keystore.getSecretKey(), Buffer.alloc(32));
  await assert.doesNotReject(() => keys.keystore.signDataAsync(message));
});
