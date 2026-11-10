import { readDemandMetaAds } from './meta-readonly-fetch.mjs';
import { diagnoseDemandMetaError } from './meta-provider-diagnosis.mjs';

// Read-only diagnostic boundary: a failed provider response never becomes a successful snapshot.
// This does not authenticate the provider or authorize any Meta write.
export async function readDemandMetaAdsDiagnosed(input) {
  let diagnosis = diagnoseDemandMetaError(null);
  try {
    const originalFetch = input?.fetchImpl;
    const snapshot = await readDemandMetaAds({
      ...input,
      fetchImpl: async (url, options) => {
        // The underlying adapter validates tenant/account scope before calling this function.
        const response = await originalFetch(url, options);
        if (response && typeof response.json === 'function') {
          // Graph may return an error envelope even with HTTP 200. Read the body once,
          // retain it for the strict snapshot parser, and never expose provider text.
          const body = await response.json();
          if (body !== null && typeof body === 'object' && Object.hasOwn(body, 'error')) {
            diagnosis = diagnoseDemandMetaError(body);
          }
          // HTTP 429 without a Graph error envelope is still a rate limit, never a successful read.
          // Do not infer authentication or permissions from other bare HTTP statuses.
          if (response.status === 429 && diagnosis.state === 'PROVIDER_UNVERIFIED') {
            diagnosis = diagnoseDemandMetaError({error:{code:613}});
          }
          return {ok: response.ok, json: async () => body};
        }
        return response;
      }
    });
    return Object.freeze({ok:true,snapshot,diagnosis:null});
  } catch {
    return Object.freeze({ok:false,snapshot:null,diagnosis});
  }
}
