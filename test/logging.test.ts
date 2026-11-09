import assert from "node:assert/strict";
import test from "node:test";
import { installLogRedaction, redactProjectId } from "../src/logging";

test("Blockfrost project IDs are removed from logs", () => {
  const projectId = "secret-project-id";
  const log = `disconnected from wss://example.test/?project_id=${projectId}`;
  assert.equal(
    redactProjectId(log, projectId),
    "disconnected from wss://example.test/?project_id=[REDACTED]",
  );
});

test("log redaction installation does not wrap console methods twice", () => {
  installLogRedaction("first-secret");
  const wrapped = console.log;
  installLogRedaction("second-secret");
  assert.equal(console.log, wrapped);
});
