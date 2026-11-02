/** Server-only adapter for the explicit DEMAND credential name saved by the owner.
 * Keep the shared Meta connection verifier unchanged and never use a reporting
 * credential as a management fallback. Conflicting management values fail closed.
 */
export function pilotMetaConfiguration(input: NodeJS.ProcessEnv) {
  const scoped = input.BROS_DEMAND_META_ADS_MANAGEMENT_TOKEN;
  const legacy = input.META_ADS_MANAGEMENT_TOKEN;
  const managementCredentialConflict = Boolean(scoped && legacy && scoped !== legacy);
  // Copy/paste may add a terminal newline. Never remove embedded whitespace,
  // quotes, prefixes or other credential characters to make a value pass.
  const rawAppSecret = input.META_APP_SECRET;
  const appSecret = rawAppSecret?.trim();
  const environment: NodeJS.ProcessEnv = { ...input,
    META_ADS_MANAGEMENT_TOKEN: managementCredentialConflict ? undefined : scoped || legacy,
    META_APP_SECRET: appSecret,
  };
  const acceptedFormat = (value: string | undefined) => Boolean(value && value.length >= 16 && !/\s/.test(value));
  return {
    environment,
    managementCredentialConflict,
    // Safe build-time diagnostics only; never serialize `environment`.
    configurationChecks: {
      appIdConfigured: input.META_APP_ID === "1315572270590189",
      managementCredentialConflict,
      managementTokenFormatAccepted: acceptedFormat(environment.META_ADS_MANAGEMENT_TOKEN),
      appSecretConfigured: Boolean(rawAppSecret),
      appSecretBoundaryWhitespaceRemoved: rawAppSecret !== undefined && rawAppSecret !== appSecret,
      appSecretFormatAccepted: acceptedFormat(appSecret),
      appSecretTooShort: appSecret !== undefined && appSecret.length < 16,
      appSecretHasInternalWhitespace: Boolean(appSecret && /\s/.test(appSecret)),
      appSecretHasOnlyMaskCharacters: Boolean(appSecret && /^[*\u2022\u25cf\u00b7\u2026]+$/u.test(appSecret)),
    },
  };
}
