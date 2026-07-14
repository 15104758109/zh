export const SECRET_SCAN_VERSION = "G07_CANDIDATE_BLOBS_V2";

export const SECRET_PATTERNS = Object.freeze([
  ["AWS_ACCESS_KEY", /AKIA[0-9A-Z]{16}/],
  ["OPENAI_KEY", /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/],
  ["GITHUB_TOKEN", /gh[pousr]_[A-Za-z0-9]{30,}/],
  ["GITHUB_FINE_GRAINED_PAT", /github_pat_[A-Za-z0-9_]{82}/],
  ["ANTHROPIC_KEY", /sk-ant-[A-Za-z0-9_-]{20,}/],
  ["GOOGLE_API_KEY", /AIza[0-9A-Za-z_-]{30,}/],
  ["SLACK_TOKEN", /xox[baprs]-[0-9A-Za-z-]{20,}/],
  ["PRIVATE_KEY", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
]);

export function scanSecretBytes(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const text = bytes.toString("latin1");
  return SECRET_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
}
