import assert from "node:assert/strict";
import test from "node:test";
import { formatUnits } from "../src/amounts";

test("large bigint amounts are formatted without losing precision", () => {
  assert.equal(formatUnits(19_733_120_000n, 6), "19733.12");
  assert.equal(
    formatUnits(77_703_424_506_943_999_999n, 15),
    "77703.424506943999999",
  );
  assert.equal(formatUnits(-3_000_000n, 6), "-3");
});
