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
        if (response?.ok === false && typeof response.json === 'function') {
          try {
            diagnosis = diagnoseDemandMetaError(await response.json());
          } catch {
            diagnosis = diagnoseDemandMetaError(null);
          }
        }
        return response;
      }
    });
    return Object.freeze({ok:true,snapshot,diagnosis:null});
  } catch {
    return Object.freeze({ok:false,snapshot:null,diagnosis});
  }
}
