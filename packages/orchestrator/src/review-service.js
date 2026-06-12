import { logStep } from "@kca/core/log";

export function evaluateReview({ findings = [], evidence = [] } = {}) {
  const blocking = findings.filter((finding) => ["high", "critical", "blocking"].includes(String(finding.severity || "").toLowerCase()));
  const result = {
    status: blocking.length ? "blocked" : "merge_ready",
    mergeReady: blocking.length === 0,
    blockingFindings: blocking,
    evidence
  };
  logStep("orchestrator", "review.evaluate", { blocking: blocking.length, mergeReady: result.mergeReady });
  return result;
}
