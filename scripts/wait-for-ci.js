const fs = require("node:fs");
const { setTimeout: delay } = require("node:timers/promises");

function isRun(value) {
  return typeof value === "object" && value !== null &&
    typeof value.id === "number" && Number.isSafeInteger(value.id) &&
    typeof value.head_sha === "string" &&
    typeof value.event === "string" &&
    typeof value.status === "string" &&
    (value.conclusion === null || typeof value.conclusion === "string") &&
    typeof value.run_number === "number";
}

function selectBuildRun(payload, commit) {
  if (typeof payload !== "object" || payload === null || !Array.isArray(payload.workflow_runs)) {
    throw new Error("GitHub returned an invalid workflow-run response");
  }
  const runs = payload.workflow_runs;
  if (!runs.every(isRun)) throw new Error("GitHub returned a malformed workflow run");
  const matches = runs.filter(run => run.head_sha === commit && (run.event === "push" || run.event === "workflow_dispatch"));
  matches.sort((a, b) => b.run_number - a.run_number);
  const latest = matches[0];
  const activeStatuses = ["queued", "in_progress", "waiting", "requested"];
  if (latest && activeStatuses.includes(latest.status)) return { state: "waiting", run: latest };
  const successful = matches.find(run => run.status === "completed" && run.conclusion === "success");
  if (successful) return { state: "ready", run: successful };
  if (latest) return { state: "failed", run: latest };
  return { state: "missing" };
}

async function listBuildRuns({ apiUrl, repository, token, commit }) {
  const baseUrl = apiUrl.endsWith("/") ? apiUrl : apiUrl + "/";
  const url = new URL("repos/" + repository + "/actions/workflows/build.yml/runs", baseUrl);
  url.searchParams.set("head_sha", commit);
  url.searchParams.set("per_page", "100");
  const response = await fetch(url, {
    headers: { accept: "application/vnd.github+json", authorization: "Bearer " + token, "x-github-api-version": "2022-11-28" },
  });
  if (!response.ok) throw new Error("GitHub Actions API returned HTTP " + response.status + ": " + await response.text());
  return response.json();
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const commit = process.env.GITHUB_SHA;
  const token = process.env.GITHUB_TOKEN;
  const apiUrl = process.env.GITHUB_API_URL || "https://api.github.com";
  const output = process.env.GITHUB_OUTPUT;
  if (!repository || !/^[^/]+\/[^/]+$/.test(repository) ||
      !commit || !/^[a-f0-9]{40,64}$/.test(commit) || !token || !output) {
    throw new Error("Missing or invalid GitHub Actions environment variables");
  }
  const timeoutMs = 90 * 60 * 1000;
  const discoveryMs = 2 * 60 * 1000;
  const pollMs = 15000;
  const started = Date.now();
  let runDiscoveryDeadline = started + discoveryMs;
  console.log("Looking for a successful CI run at commit " + commit);
  while (Date.now() - started < timeoutMs) {
    const decision = selectBuildRun(await listBuildRuns({ apiUrl, repository, token, commit }), commit);
    if (decision.state === "ready") {
      fs.appendFileSync(output, "run-id=" + decision.run.id + "\n");
      console.log("Reusing completed CI run " + decision.run.id + " for commit " + commit);
      return;
    }
    if (decision.state === "failed") {
      throw new Error("Latest CI run " + decision.run.id + " for this commit completed with conclusion " + decision.run.conclusion);
    }
    if (decision.state === "missing" && Date.now() >= runDiscoveryDeadline) {
      throw new Error("No successful CI run found for commit " + commit + "; push the commit or run CI manually before tagging it");
    }
    if (decision.state === "waiting") {
      runDiscoveryDeadline = started + timeoutMs;
      console.log("Waiting for CI run " + decision.run.id + " (" + decision.run.status + ")");
    } else {
      console.log("Waiting for the branch-push CI run to appear");
    }
    await delay(pollMs);
  }
  throw new Error("Timed out waiting for CI to finish for commit " + commit);
}

if (require.main === module) {
  main().catch(error => {
    console.error("CI artifact lookup failed: " + error.message);
    process.exitCode = 1;
  });
}

module.exports = { selectBuildRun };
