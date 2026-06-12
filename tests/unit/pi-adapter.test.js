import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { doctorPi, loadPiSdk, startPiSession } from "../../packages/pi-adapter/src/index.js";

test("pi adapter falls back to fake mode when SDK package is unavailable", async () => {
  const loaded = await loadPiSdk("__missing_pi_sdk_for_kca_tests__");
  assert.equal(loaded.ok, false);
  assert.equal(loaded.mode, "fake");
});

test("pi adapter fake session is deterministic enough for local runtime tests", async () => {
  const previous = process.env.KCA_PI_SDK_PACKAGE;
  process.env.KCA_PI_SDK_PACKAGE = "__missing_pi_sdk_for_kca_tests__";
  const session = await startPiSession({
    task: { id: "KCA-PI", title: "Run fake Pi" },
    agentId: "engineer",
    runId: "run_fake",
    cwd: "/tmp/kca",
    prompt: "Implement task"
  });
  if (previous === undefined) delete process.env.KCA_PI_SDK_PACKAGE;
  else process.env.KCA_PI_SDK_PACKAGE = previous;
  assert.equal(session.mode, "fake");
  assert.equal(session.sessionId, "run_fake");
});

test("pi adapter loads verified SDK and creates a dry-run AgentSession", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-pi-real-"));
  const loaded = await loadPiSdk();
  assert.equal(loaded.ok, true);
  assert.equal(loaded.packageName, "@earendil-works/pi-coding-agent");
  assert.equal(loaded.version, "0.79.1");
  assert.equal(loaded.api.createAgentSession, true);
  assert.equal(loaded.api.SessionManager, true);

  const session = await startPiSession({
    task: { id: "KCA-PI-REAL", title: "Dry run Pi session" },
    agentId: "engineer",
    runId: "run_real",
    cwd: root,
    sessionDir: join(root, "sessions"),
    prompt: "Do not call model in dry-run.",
    runPrompt: false
  });
  assert.equal(session.mode, "real");
  assert.equal(session.provider, "@earendil-works/pi-coding-agent");
  assert.equal(session.version, "0.79.1");
  assert.match(session.sessionFile, /sessions/);
  assert.equal(session.promptSent, false);
});

test("pi doctor reports SDK, auth presence and dry-run session without secrets", async () => {
  const root = await mkdtemp(join(tmpdir(), "kca-pi-doctor-"));
  const doctor = await doctorPi({ cwd: root, sessionDir: join(root, "sessions") });
  assert.equal(doctor.ok, true);
  assert.equal(doctor.sdk.packageName, "@earendil-works/pi-coding-agent");
  assert.equal(doctor.sdk.version, "0.79.1");
  assert.equal(typeof doctor.auth.filePresent, "boolean");
  assert.equal(doctor.dryRun.mode, "real");
  assert.equal(doctor.dryRun.promptSent, false);
  assert.equal(JSON.stringify(doctor).includes("apiKey"), false);
});
