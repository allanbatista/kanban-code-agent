export function evaluateReview({ findings = [], evidence = [] } = {}) {
  const blocking = findings.filter((finding) => ["high", "critical", "blocking"].includes(String(finding.severity || "").toLowerCase()));
  return {
    status: blocking.length ? "blocked" : "merge_ready",
    mergeReady: blocking.length === 0,
    blockingFindings: blocking,
    evidence
  };
}
