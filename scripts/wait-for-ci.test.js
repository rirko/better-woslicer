const { test } = require("node:test");
const assert = require("node:assert/strict");
const { selectBuildRun } = require("./wait-for-ci.js");

const commit = "a".repeat(40);
function run(id, status, conclusion, runNumber = id, headSha = commit) {
  return { id, head_sha: headSha, event: "push", status, conclusion, run_number: runNumber };
}

test("reuses a successful branch CI run for the exact commit", () => {
  const result = selectBuildRun({ workflow_runs: [run(7, "completed", "success")] }, commit);
  assert.equal(result.state, "ready");
  assert.equal(result.run.id, 7);
});

test("waits for queued CI and does not match another commit or pull request", () => {
  const result = selectBuildRun({ workflow_runs: [
    run(8, "queued", null), run(9, "completed", "success", 9, "b".repeat(40)),
    { ...run(10, "completed", "success"), event: "pull_request" },
  ] }, commit);
  assert.equal(result.state, "waiting");
  assert.equal(result.run.id, 8);
});

test("accepts a successful manually dispatched CI run for the exact commit", () => {
  const manual = { ...run(12, "completed", "success"), event: "workflow_dispatch" };
  assert.equal(selectBuildRun({ workflow_runs: [manual] }, commit).state, "ready");
});

test("waits for a newer manual rebuild instead of reusing older artifacts", () => {
  const result = selectBuildRun({ workflow_runs: [
    run(13, "in_progress", null, 13), run(7, "completed", "success", 7),
  ] }, commit);
  assert.equal(result.state, "waiting");
  assert.equal(result.run.id, 13);
});

test("reports failed CI when no successful or active run exists", () => {
  const result = selectBuildRun({ workflow_runs: [run(11, "completed", "failure")] }, commit);
  assert.equal(result.state, "failed");
});

test("reports missing CI for an unbuilt commit", () => {
  assert.deepEqual(selectBuildRun({ workflow_runs: [] }, commit), { state: "missing" });
});

test("rejects malformed GitHub workflow responses", () => {
  assert.throws(() => selectBuildRun({}, commit), /invalid workflow-run response/);
  assert.throws(() => selectBuildRun({ workflow_runs: [{}] }, commit), /malformed workflow run/);
});
