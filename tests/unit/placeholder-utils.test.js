import test from "node:test";
import assert from "node:assert/strict";
import { isPlaceholderAcceptance } from "../../packages/orchestrator/src/placeholder-utils.js";

test("isPlaceholderAcceptance returns true for the default Portuguese placeholder", () => {
  assert.equal(isPlaceholderAcceptance("# Critérios de aceite\n\n- [ ] Critério verificável de pronto."), true);
});

test("isPlaceholderAcceptance returns true for 'todo'", () => {
  assert.equal(isPlaceholderAcceptance("# TODO: define criteria"), true);
});

test("isPlaceholderAcceptance returns true for 'tbd' (case insensitive)", () => {
  assert.equal(isPlaceholderAcceptance("TBD"), true);
});

test("isPlaceholderAcceptance returns true for 'placeholder'", () => {
  assert.equal(isPlaceholderAcceptance("Placeholder acceptance criteria"), true);
});

test("isPlaceholderAcceptance returns true for empty string", () => {
  assert.equal(isPlaceholderAcceptance(""), true);
});

test("isPlaceholderAcceptance returns true for whitespace-only string", () => {
  assert.equal(isPlaceholderAcceptance("   "), true);
});

test("isPlaceholderAcceptance returns true for null/undefined input", () => {
  assert.equal(isPlaceholderAcceptance(null), true);
  assert.equal(isPlaceholderAcceptance(undefined), true);
});

test("isPlaceholderAcceptance returns false for real acceptance criteria", () => {
  assert.equal(isPlaceholderAcceptance("# Acceptance Criteria\n\n- [ ] User can login with valid credentials\n- [ ] Error message shown for invalid password"), false);
});

test("isPlaceholderAcceptance returns false for criteria that mention the word accept but are real", () => {
  assert.equal(isPlaceholderAcceptance("# Acceptance\n\n- [ ] System sends acceptance email after registration"), false);
});
