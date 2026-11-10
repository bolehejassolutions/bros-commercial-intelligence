/** Typed interface for the existing read-only CommonJS campaign search adapter. */
export interface SearchableContentCampaign {
  id: string;
  product_service?: string;
  audience?: string;
  status?: string;
  objective?: string;
}
/** Returns the original authenticated array for an empty query; otherwise a filtered subset. */
export function filterContentCampaigns<T extends SearchableContentCampaign>(
  campaigns: readonly T[] | null | undefined,
  query: string | null | undefined
): readonly T[];
