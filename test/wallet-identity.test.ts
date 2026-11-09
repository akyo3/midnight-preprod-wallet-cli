import assert from "node:assert/strict";
import test from "node:test";
import { stateBelongsToWallet } from "../src/wallet";

const identity = {
  unshieldedPublicKey: "night-key",
  shieldedCoinPublicKey: "coin-key",
  shieldedEncryptionPublicKey: "encryption-key",
  dustPublicKey: 42n,
};

test("wallet checkpoints are accepted only for the current keys and network", () => {
  const unshielded = JSON.stringify({
    networkId: "preprod",
    publicKey: { publicKey: "night-key" },
  });
  const shielded = JSON.stringify({
    networkId: "preprod",
    publicKeys: { coinPublicKey: "coin-key", encryptionPublicKey: "encryption-key" },
  });
  const dust = JSON.stringify({
    networkId: "preprod",
    publicKey: { publicKey: "42" },
  });

  assert.equal(stateBelongsToWallet(unshielded, "unshielded", identity), true);
  assert.equal(stateBelongsToWallet(shielded, "shielded", identity), true);
  assert.equal(stateBelongsToWallet(dust, "dust", identity), true);
  assert.equal(
    stateBelongsToWallet(
      JSON.stringify({ networkId: "preprod", publicKey: { publicKey: "wrong" } }),
      "unshielded",
      identity,
    ),
    false,
  );
  assert.equal(stateBelongsToWallet("not-json", "dust", identity), false);
});
