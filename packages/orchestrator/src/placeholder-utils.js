/**
 * Detects whether the acceptance criteria still uses placeholder text.
 *
 * @param {string} acceptanceContent - Raw markdown content of acceptance.md
 * @returns {boolean} true if acceptance is placeholder or empty
 */
export function isPlaceholderAcceptance(acceptanceContent) {
  if (typeof acceptanceContent !== "string") return true;
  const normalized = acceptanceContent.trim().toLowerCase();
  const placeholders = [
    "critério verificável de pronto",
    "todo",
    "tbd",
    "placeholder"
  ];
  if (normalized.length === 0) return true;
  return placeholders.some(p => normalized.includes(p));
}
