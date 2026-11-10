/** Read-only, tenant-scoped filtering of campaigns already returned by the authenticated workspace API. */
function normalizeSearchText(value) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('ms-MY');
}
function filterContentCampaigns(campaigns, query) {
  if (!Array.isArray(campaigns)) return [];
  const terms = normalizeSearchText(String(query ?? '')).trim().split(/\s+/u).filter(Boolean);
  if (!terms.length) return campaigns;
  return campaigns.filter(campaign => {
    if (!campaign || typeof campaign !== 'object') return false;
    const searchable = ['product_service', 'audience', 'status', 'objective'].map(field =>
      typeof campaign[field] === 'string' ? campaign[field] : ''
    ).join(' ');
    const normalized = normalizeSearchText(searchable);
    return terms.every(term => normalized.includes(term));
  });
}
exports.filterContentCampaigns = filterContentCampaigns;
