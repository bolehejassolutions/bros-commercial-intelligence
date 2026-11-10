// Pure, fail-closed Meta Graph API error diagnosis. No provider calls or token exposure.
const codes = Object.freeze({
  190: 'TOKEN_INVALID_OR_EXPIRED',
  10: 'PERMISSION_DENIED',
  200: 'PERMISSION_DENIED',
  4: 'RATE_LIMITED',
  17: 'RATE_LIMITED',
  32: 'RATE_LIMITED',
  613: 'RATE_LIMITED',
  100: 'INVALID_REQUEST'
});
const plain = v => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
const safeInt = n => Number.isSafeInteger(n) && n >= 0;
export function diagnoseDemandMetaError(response) {
  const unknown = Object.freeze({state:'PROVIDER_UNVERIFIED',retryable:false,requiresOwnerAction:false,providerAuthenticationVerified:false,metaWriteAllowed:false});
  try {
    if (!plain(response) || !plain(response.error)) return unknown;
    const e = response.error;
    if (!safeInt(e.code)) return unknown;
    const state = Object.hasOwn(codes,e.code) ? codes[e.code] : 'PROVIDER_UNVERIFIED';
    return Object.freeze({
      state,
      retryable:state === 'RATE_LIMITED',
      requiresOwnerAction:state === 'TOKEN_INVALID_OR_EXPIRED' || state === 'PERMISSION_DENIED',
      providerAuthenticationVerified:false,
      metaWriteAllowed:false
    });
  } catch {
    return unknown;
  }
}
