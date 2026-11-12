import {getVisualPreset, VISUAL_PRESET_VERSION} from './catalog.mjs';
import {BROS_PRIMARY_PROMPTS, BROS_VISUAL_INSTANCE} from './bros-instance.mjs';

const BROS_SELL_STANDARD = 'bros-sell-plain-language-v1';
const labels = Object.freeze({
  SELL_MANGA_STORY: 'Manga tiga babak',
  NATURAL_MY_UGC: 'Foto candid gaya Malaysia',
  SYSTEM_EXPLAINER: 'Penerangan visual',
  REAL_PRODUCT_SHOWCASE: 'Paparan produk sebenar',
  EXPRESSIVE_ANIME: 'Anime ekspresif',
  FOUNDER_EDITORIAL_PORTRAIT: 'Potret pengasas',
});
const guidance = Object.freeze({
  SELL_MANGA_STORY: 'Tunjukkan situasi harian, salah faham dan satu tindakan praktikal dalam tiga babak. Gunakan watak asli dan dialog ringkas.',
  NATURAL_MY_UGC: 'Gunakan suasana tempatan yang meyakinkan, cahaya semula jadi dan reaksi spontan. Persembahkan watak rekaan sebagai ilustrasi.',
  SYSTEM_EXPLAINER: 'Terangkan satu proses secara visual. Sediakan ruang untuk memasukkan teks dan angka yang telah disahkan.',
  EXPRESSIVE_ANIME: 'Gunakan watak asli, ekspresi yang jelas dan humor yang sesuai dengan situasi.',
});
const referenceRequired = Object.freeze({
  REAL_PRODUCT_SHOWCASE: 'Perlu tangkap layar produk asal yang telah disahkan untuk jenama ini.',
  FOUNDER_EDITORIAL_PORTRAIT: 'Perlu foto rujukan dengan kebenaran penggunaan wajah.',
});
const plainLanguage = Object.freeze({
  principle: 'Jangan suruh pelanggan terjemah. Biar dia terus faham.',
  sequence: 'KENA → PELIK → TERFIKIR → FAHAM → NAMPAK NILAI',
  checks: Object.freeze([
    'Dalam tiga saat, pembaca boleh cam situasi yang ditunjukkan.',
    'Baca kuat-kuat. Dialog kedengaran seperti perbualan kedai kopi dalam Bahasa Melayu Malaysia.',
    'Nyatakan manfaat yang jelas sebelum menyebut istilah sistem, peta atau lembaran kerja.',
    'Padankan janji dengan fungsi sebenar produk. Elakkan dakwaan hasil dan fungsi yang belum disahkan.',
    'Jaga adab, nilai Islam dan ketepatan. Gunakan nama awam BROS SELL.',
  ]),
});

function ownField(record, name) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return undefined;
  try { return Object.getOwnPropertyDescriptor(record, name)?.value; }
  catch { return undefined; }
}

function safePresetIds(ids) {
  if (!Array.isArray(ids) || ids.length > Object.keys(labels).length) return null;
  try {
    const descriptors = Object.getOwnPropertyDescriptors(ids);
    if (Object.keys(descriptors).length !== ids.length + 1) return null;
    const values = [];
    for (let i = 0; i < ids.length; i++) {
      const entry = descriptors[String(i)];
      if (!entry || !Object.hasOwn(entry, 'value') || typeof entry.value !== 'string') return null;
      values.push(entry.value);
    }
    return values;
  } catch { return null; }
}

// The source must be Business DNA from the currently authorized workspace.
// Explicit opt-in keeps legacy workspaces and independent brands on their own voice.
export function readWorkspaceCreativeConfig(businessDna) {
  const config = ownField(businessDna, 'content_creative');
  const brandId = ownField(config, 'brand_id');
  const presetIds = safePresetIds(ownField(config, 'preset_ids'));
  if (typeof brandId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(brandId)
      || !presetIds) return null;

  const brosSell = brandId === BROS_VISUAL_INSTANCE.brandId
    && ownField(config, 'communication_standard') === BROS_SELL_STANDARD;
  const presets = [...new Set(presetIds)].flatMap(id => {
    const preset = getVisualPreset(id);
    if (!preset) return [];
    return [Object.freeze({
      id: preset.id,
      label: labels[preset.id],
      defaultAspectRatio: preset.defaultAspectRatio,
      ratios: preset.ratios,
      referenceRequired: referenceRequired[preset.id] ?? null,
    })];
  });
  return Object.freeze({
    brandId,
    presetVersion: VISUAL_PRESET_VERSION,
    presets: Object.freeze(presets),
    communication: brosSell ? plainLanguage : null,
  });
}

export function buildWorkspaceCreativeDraft(businessDna, presetId, aspectRatio) {
  const config = readWorkspaceCreativeConfig(businessDna);
  const preset = config?.presets.find(option => option.id === presetId);
  if (!preset || !preset.ratios.includes(aspectRatio)) return null;
  if (preset.referenceRequired) return Object.freeze({
    status: 'REFERENCE_REQUIRED',
    reason: preset.referenceRequired,
  });
  const guidanceText = config.communication && BROS_PRIMARY_PROMPTS[preset.id]
    ? BROS_PRIMARY_PROMPTS[preset.id]
    : guidance[preset.id];
  return Object.freeze({
    status: 'DRAFT_NOT_GENERATED',
    presetId: preset.id,
    presetVersion: config.presetVersion,
    aspectRatio,
    guidance: guidanceText,
    communication: config.communication,
  });
}
