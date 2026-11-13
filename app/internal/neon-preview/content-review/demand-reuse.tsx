'use client';

import { useState } from 'react';
import {
  DEMAND_REUSE_CHECKS, signContentDemandReuse, type ContentReviewerKey,
} from '@/lib/portfolio/content-review-signing';

const labels: Record<typeof DEMAND_REUSE_CHECKS[number], string> = {
  ORIGINAL_AND_EDITORIAL: 'Saya telah menyemak imej asal, mutu visual, dan maksudnya jika digunakan secara berasingan.',
  LOGO_AND_CLAIMS: 'Hak penggunaan dan bukti logo menepati garis panduan jenama. Imej ini tiada dakwaan yang memerlukan bukti.',
  AI_DISCLOSURE: 'Pendedahan penggunaan AI dan konteks visual adalah tepat.',
  DEMAND_REVIEW_ONLY: 'Saya membenarkan BROS DEMAND menyemak versi ini dalam Preview sahaja.',
};

export default function DemandReuse({ envelope, image, slot, reviewerKey }: Readonly<{
  envelope: Record<string, unknown>; image: string; slot: number; reviewerKey: ContentReviewerKey | null;
}>) {
  const [presetId, setPresetId] = useState('');
  const [presetVersion, setPresetVersion] = useState('');
  const [logo, setLogo] = useState<'' | 'NO_LOGO' | 'OFFICIAL_APPROVED'>('');
  const [logoVersion, setLogoVersion] = useState('');
  const [checks, setChecks] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [grant, setGrant] = useState<Awaited<ReturnType<typeof signContentDemandReuse>> | null>(null);
  const refs = (envelope.copy as { claimEvidenceRefs?: readonly string[] } | undefined)?.claimEvidenceRefs;
  const noClaims = Array.isArray(refs) && refs.length === 0;
  const complete = reviewerKey && presetId.trim() && presetVersion.trim() && logo &&
    (logo === 'NO_LOGO' || logoVersion.trim()) && noClaims && checks.length === DEMAND_REUSE_CHECKS.length;

  async function sign() {
    if (!complete || !reviewerKey || !logo || busy) return;
    setBusy(true);
    setGrant(null);
    setMessage('');
    try {
      const prefix = 'data:image/png;base64,';
      if (!image.startsWith(prefix) || image.length > prefix.length + 16 * 1024 * 1024) throw Error();
      const original = Uint8Array.from(atob(image.slice(prefix.length)), char => char.charCodeAt(0));
      const result = await signContentDemandReuse(reviewerKey, envelope, slot, original, {
        presetId: presetId.trim(), presetVersion: presetVersion.trim(), logoEvidence: logo,
        logoAssetVersionId: logo === 'OFFICIAL_APPROVED' ? logoVersion.trim() : null,
        confirmedChecks: checks,
      });
      setGrant(result);
      setMessage('Kelulusan ditandatangani. Muat turun fail untuk persediaan Preview yang dibenarkan.');
    } catch {
      setMessage('Kelulusan tidak dapat ditandatangani. Semak imej asal, ID dan versi yang dimasukkan.');
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!grant) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(grant)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `bros-demand-review-slot-${slot}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return <section className="approval-card" aria-labelledby="demand-reuse-heading">
    <div className="approval-header"><h2 id="demand-reuse-heading">Benarkan semakan BROS DEMAND</h2></div>
    <p className="approval-sub">Imej {slot} yang dipilih di atas. Kelulusan tamat dalam 24 jam dan hanya untuk semakan dalaman dalam Preview.</p>
    {!noClaims && <p>Imej dengan rujukan dakwaan memerlukan aliran pengesahan bukti.</p>}
    {!reviewerKey ? <p>Gunakan kunci penyemak yang berdaftar untuk Preview ini.</p> :
      <fieldset className="review-list demand-reuse-fields" disabled={busy || !!grant}>
        <legend>Bukti semakan untuk imej {slot}</legend>
        <label>ID preset yang diluluskan <input value={presetId} maxLength={128} onChange={e => setPresetId(e.target.value)} /></label>
        <label>Versi preset <input value={presetVersion} maxLength={128} onChange={e => setPresetVersion(e.target.value)} /></label>
        <label>Bukti logo <select value={logo} onChange={e => {
          setLogo(e.target.value === 'NO_LOGO' ? 'NO_LOGO' : e.target.value === 'OFFICIAL_APPROVED' ? 'OFFICIAL_APPROVED' : '');
        }}>
          <option value="">Pilih selepas semakan</option>
          <option value="NO_LOGO">Tiada logo</option>
          <option value="OFFICIAL_APPROVED">Logo rasmi diluluskan</option>
        </select></label>
        {logo === 'OFFICIAL_APPROVED' && <label>ID versi aset logo rasmi
          <input value={logoVersion} maxLength={128} onChange={e => setLogoVersion(e.target.value)} />
        </label>}
        {DEMAND_REUSE_CHECKS.map(check => <label className="review-choice" key={check}>
          <input type="checkbox" checked={checks.includes(check)} onChange={e => {
            setChecks(e.target.checked ? [...checks, check] : checks.filter(value => value !== check));
          }} /> <span>{labels[check]}</span>
        </label>)}
      </fieldset>}
    <div className="approval-actions">
      {grant ? <button type="button" className="button-primary" onClick={download}>Muat turun kelulusan bertandatangan</button> :
        <button type="button" className="button-primary" onClick={() => void sign()} disabled={!complete || busy}>
          Tandatangani kelulusan semakan
        </button>}
    </div>
    {message && <p role="status">{message}</p>}
    {grant && <div className="reference-list">
      <p>ID aset <code>{grant.payload.creative.assetId}</code></p>
      <p>Versi aset <code>{grant.payload.creative.creativeVersion}</code></p>
      <p>Tamat (UTC) <time dateTime={grant.payload.expiresAt}>{grant.payload.expiresAt}</time></p>
    </div>}
  </section>;
}
