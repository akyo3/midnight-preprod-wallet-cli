import assert from "node:assert/strict";
import test from "node:test";
import { submitWithRetry } from "../src/wallet";

test("transaction submission retries the same finalized transaction", async () => {
  const transaction = { id: "finalized" };
  const received: unknown[] = [];
  const submitter = {
    async submitTransaction(value: unknown) {
      received.push(value);
      if (received.length < 3) throw new Error("connection closed");
      return "transaction-id";
    },
  };

  assert.equal(await submitWithRetry(submitter, transaction, 3, 0), "transaction-id");
  assert.deepEqual(received, [transaction, transaction, transaction]);
});
