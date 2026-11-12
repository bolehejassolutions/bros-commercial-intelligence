'use client';

import {useState} from 'react';
import {buildWorkspaceCreativeDraft, readWorkspaceCreativeConfig} from '@/lib/visual-presets/workspace-creative.mjs';

export default function ContentCreativeDraft({businessDna, campaign}: {
  businessDna: unknown;
  campaign: {product_service?: string; audience?: string; problem?: string; objective?: string};
}) {
  const config = readWorkspaceCreativeConfig(businessDna);
  const [presetId, setPresetId] = useState('');
  const [ratio, setRatio] = useState('');
  const preset = config?.presets.find(option => option.id === presetId);
  const draft = preset && buildWorkspaceCreativeDraft(businessDna, preset.id, ratio);
  if (!config?.presets.length) return null;

  return <details style={{margin: '10px 0'}}>
    <summary style={{cursor: 'pointer'}}>Sediakan arahan visual</summary>
    <div style={{display: 'grid', gap: 8, marginTop: 8}}>
      <label>Gaya visual{' '}
        <select value={preset?.id ?? ''} onChange={event => {
          const next = config.presets.find(option => option.id === event.target.value);
          setPresetId(next?.id ?? '');
          setRatio(next?.defaultAspectRatio ?? '');
        }}>
          <option value="">Pilih gaya</option>
          {config.presets.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>
      {preset && <label>Nisbah gambar{' '}
        <select value={ratio} onChange={event => setRatio(event.target.value)}>
          {preset.ratios.map(value => <option key={value}>{value}</option>)}
        </select>
      </label>}
      {draft?.status === 'REFERENCE_REQUIRED' && <p role="status">{draft.reason}</p>}
      {draft?.status === 'DRAFT_NOT_GENERATED' && <>
        <label>Arahan visual untuk disalin
          <textarea readOnly rows={8} style={{width: '100%', marginTop: 4}} value={[
            `Gaya visual ${preset?.label} · ${draft.aspectRatio}`,
            ...Object.entries({
              'Produk / servis': campaign.product_service,
              'Sasaran pelanggan': campaign.audience,
              'Masalah pelanggan': campaign.problem,
              'Objektif': campaign.objective,
            }).flatMap(([label, value]) => value ? [`${label}: ${value}`] : []),
            draft.guidance,
            'Gunakan aset jenama yang telah diluluskan. Elakkan mereka semula logo dan membuat dakwaan tanpa bukti.',
            ...(draft.communication ? [draft.communication.principle, draft.communication.sequence] : []),
          ].join('\n\n')}/>
        </label>
        <small>Draf arahan. Fail media belum dihasilkan.</small>
        {draft.communication && <div>
          <h4>Semakan editorial BROS SELL</h4>
          <ul>{draft.communication.checks.map(check => <li key={check}>{check}</li>)}</ul>
        </div>}
      </>}
    </div>
  </details>;
}
