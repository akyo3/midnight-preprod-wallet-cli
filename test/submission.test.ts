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

  assert.equal(
    await submitWithRetry(submitter, transaction, 3, 0),
    "transaction-id",
  );
  assert.deepEqual(received, [transaction, transaction, transaction]);
});

test("DUST proof rejection is reported without retrying the rejected transaction", async () => {
  const rejection = new Error("Transaction submission error", {
    cause: new Error("1010: Invalid Transaction: Custom error: 170"),
  });
  let attempts = 0;
  await assert.rejects(
    submitWithRetry(
      {
        async submitTransaction() {
          attempts++;
          throw rejection;
        },
      },
      {},
      3,
      0,
    ),
    (error: Error) => {
      assert.match(error.message, /170 \(InvalidDustSpendProof\)/);
      assert.match(error.message, /rebuild the transaction/);
      assert.equal(error.cause, rejection);
      return true;
    },
  );
  assert.equal(attempts, 1);
});

test("Effect-style error text exposes the node rejection despite a generic message", async () => {
  const rejection = new Error("Transaction submission error");
  rejection.toString = () =>
    "(FiberFailure) SubmissionError: Transaction submission error\n" +
    "Caused by: 1010: Invalid Transaction: Custom error: 170";
  await assert.rejects(
    submitWithRetry(
      {
        async submitTransaction() {
          throw rejection;
        },
      },
      {},
      1,
      0,
    ),
    /InvalidDustSpendProof/,
  );
});

test("node validation rejection and pool ban are not retried", async () => {
  for (const message of [
    "1010: Invalid Transaction: Custom error: 196",
    "1012: Transaction is temporarily banned",
  ]) {
    const rejection = new Error(message);
    let attempts = 0;
    await assert.rejects(
      submitWithRetry(
        {
          async submitTransaction() {
            attempts++;
            throw rejection;
          },
        },
        {},
        3,
        0,
      ),
      (error) => error === rejection,
    );
    assert.equal(attempts, 1);
  }
});

test("unrecognized submission errors are not retried", async () => {
  const rejection = new Error("Transaction protocol version mismatch");
  let attempts = 0;
  await assert.rejects(
    submitWithRetry(
      {
        async submitTransaction() {
          attempts++;
          throw rejection;
        },
      },
      {},
      3,
      0,
    ),
    (error) => error === rejection,
  );
  assert.equal(attempts, 1);
});
