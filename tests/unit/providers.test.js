import test from "node:test";
import assert from "node:assert/strict";
import { normalizeModel } from "../../packages/core/src/providers.js";

test("provider model normalization preserves supported effort capabilities", () => {
  assert.deepEqual(normalizeModel({ id: "gpt-effort", supported_efforts: ["none", "low", "xhigh", "invalid"] }), {
    id: "gpt-effort",
    name: "gpt-effort",
    contextWindow: undefined,
    maxOutputTokens: undefined,
    supportedEfforts: ["none", "low", "xhigh"]
  });
  assert.deepEqual(normalizeModel({ id: "gpt-no-effort", supported_efforts: [] })?.supportedEfforts, []);
});
