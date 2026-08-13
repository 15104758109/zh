const CREDENTIAL_ENV_BY_REFERENCE = new Map([
  ["n8n-credential:openai-account-v1", "FP008_CREDENTIAL_OPENAI_ACCOUNT_V1"],
  ["n8n-credential:relaycove-v1", "FP008_CREDENTIAL_RELAYCOVE_V1"],
]);

export async function resolveCredential(reference) {
  const environmentName = CREDENTIAL_ENV_BY_REFERENCE.get(reference);
  const value = environmentName ? process.env[environmentName]?.trim() : null;
  if (!value) throw new Error("The local credential reference is unavailable.");
  return value;
}
