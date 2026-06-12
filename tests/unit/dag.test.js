import test from "node:test";
import assert from "node:assert/strict";
import { validateDag } from "../../packages/core/src/dag.js";

test("dag validator accepts dependency edges and rejects invalid graphs", () => {
  const valid = validateDag([
    { id: "a", provides: ["contract:a"], needs: [] },
    { id: "b", provides: ["contract:b"], needs: ["contract:a"] },
    { id: "c", provides: [], needs: ["contract:a", "contract:b"] }
  ]);
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.edges.map((edge) => `${edge.from}->${edge.to}`).sort(), ["a->b", "a->c", "b->c"]);
  assert.equal(validateDag([{ id: "a", provides: ["x"], needs: [] }, { id: "b", provides: ["x"], needs: [] }]).errors[0].type, "duplicate_provide");
  assert.equal(validateDag([{ id: "a", provides: [], needs: ["missing"] }]).errors[0].type, "missing_contract");
  assert.equal(validateDag([{ id: "a", provides: ["a"], needs: ["b"] }, { id: "b", provides: ["b"], needs: ["a"] }]).errors.some((error) => error.type === "cycle"), true);
});
