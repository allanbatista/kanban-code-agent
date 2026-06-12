function formatValue(value) {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  try {
    const text = JSON.stringify(value);
    return text.length > 500 ? `${text.slice(0, 497)}...` : text;
  } catch {
    return String(value);
  }
}

export function logStep(scope, stage, details = undefined) {
  if (process.env.KCA_STDOUT_LOGS !== "1") return;
  if (scope === "fsdb" && process.env.KCA_LOG_FSDB !== "1") return;
  if (scope === "daemon" && stage === "http.request" && process.env.KCA_LOG_HTTP_REQUESTS !== "1") return;
  const suffix = details === undefined ? "" : ` ${formatValue(details)}`;
  console.log(`[${scope}] ${stage}${suffix}`);
}
