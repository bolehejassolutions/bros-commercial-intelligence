/** Server-only adapter for the explicit DEMAND credential name saved by the owner.
 * Keep the shared Meta connection verifier unchanged and never use a reporting
 * credential as a management fallback. Conflicting management values fail closed.
 */
export function pilotMetaConfiguration(input: NodeJS.ProcessEnv) {
  const scoped = input.BROS_DEMAND_META_ADS_MANAGEMENT_TOKEN;
  const legacy = input.META_ADS_MANAGEMENT_TOKEN;
  const managementCredentialConflict = Boolean(scoped && legacy && scoped !== legacy);
  const environment: NodeJS.ProcessEnv = { ...input,
    META_ADS_MANAGEMENT_TOKEN: managementCredentialConflict ? undefined : scoped || legacy,
  };
  return {
    environment,
    managementCredentialConflict,
  };
}
