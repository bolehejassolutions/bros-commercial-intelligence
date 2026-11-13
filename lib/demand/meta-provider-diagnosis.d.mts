export function diagnoseDemandMetaError(response: unknown): Readonly<{
  state: "TOKEN_INVALID_OR_EXPIRED" | "PERMISSION_DENIED" | "RATE_LIMITED" | "INVALID_REQUEST" | "PROVIDER_UNVERIFIED";
  retryable: boolean;
  requiresOwnerAction: boolean;
  providerAuthenticationVerified: false;
  metaWriteAllowed: false;
}>;
