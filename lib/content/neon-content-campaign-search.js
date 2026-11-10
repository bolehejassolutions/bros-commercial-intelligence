/** Read-only, tenant-scoped filtering of campaigns already returned by the authenticated workspace API. */
function filterContentCampaigns(campaigns, query) {
  if (!Array.isArray(campaigns)) return [];
  const terms = String(query ?? '').trim().toLocaleLowerCase('ms-MY').split(/\s+/u).filter(Boolean);
  if (!terms.length) return campaigns;
  return campaigns.filter(campaign => {
    if (!campaign || typeof campaign !== 'object') return false;
    const searchable = ['product_service', 'audience', 'status', 'objective'].map(field =>
      typeof campaign[field] === 'string' ? campaign[field] : ''
    ).join(' ').toLocaleLowerCase('ms-MY');
    return terms.every(term => searchable.includes(term));
  });
}
exports.filterContentCampaigns = filterContentCampaigns;
