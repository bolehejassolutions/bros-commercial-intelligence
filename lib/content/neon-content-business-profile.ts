const businessProfileFields = [
  ['brand_name', 'Nama jenama'],
  ['description', 'Tentang perniagaan'],
  ['products_services', 'Produk dan perkhidmatan'],
  ['audience', 'Sasaran pelanggan'],
  ['voice', 'Gaya bahasa'],
  ['visual', 'Identiti visual'],
  ['offers', 'Tawaran'],
] as const;

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function formatValue(value: unknown, depth = 0): string {
  if (depth > 5) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'Ya' : 'Tidak';
  if (Array.isArray(value)) {
    return value.map(entry => formatValue(entry, depth + 1)).filter(Boolean).join('\n');
  }
  if (!record(value)) return '';

  return Object.entries(value).flatMap(([key, entry]) => {
    const text = formatValue(entry, depth + 1);
    if (!text) return [];
    const label = key.replaceAll('_', ' ').trim();
    return [label ? `${label}\n${text}` : text];
  }).join('\n\n');
}

/** Display the known fields of the original Supabase Business DNA row. */
export function buildContentBusinessProfile(raw: unknown) {
  if (!record(raw)) return [];
  return businessProfileFields.flatMap(([key, label]) => {
    if (!Object.hasOwn(raw, key)) return [];
    const value = formatValue(raw[key]);
    return value ? [{label, value}] : [];
  });
}
