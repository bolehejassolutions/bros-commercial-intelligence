'use client';

import {useEffect, useRef, useState} from 'react';
import {
  clearContentBrowserDraftRetry, prepareContentBrowserDraftRetry, type ContentDraftAttempt,
} from '@/lib/content/neon-content-draft-retry';

const statusLabels = {
  queued: 'Dalam giliran', running: 'Sedang diproses', completed: 'Selesai', failed: 'Gagal',
};
type Status = keyof typeof statusLabels;
type Job = {id: string; status: Status; attempts: number; createdAt: string};
type History = {state: 'loading' | 'unavailable'} | {state: 'ready'; jobs: Job[]};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dateFormat = new Intl.DateTimeFormat('ms-MY', {dateStyle: 'medium', timeStyle: 'short'});

function readHistory(value: unknown, campaignId: string): Job[] {
  const {data} = value as {data?: {campaignId?: unknown; jobs?: unknown}};
  if (data?.campaignId !== campaignId || !Array.isArray(data.jobs) || data.jobs.length > 25)
    throw new Error('Invalid campaign history');
  const ids = new Set<string>();
  return data.jobs.map(job => {
    if (!job || typeof job.id !== 'string' || !uuid.test(job.id) || ids.has(job.id) ||
        !Object.hasOwn(statusLabels, job.status) || !Number.isSafeInteger(job.attempts) ||
        job.attempts < 0 || typeof job.createdAt !== 'string' || !Number.isFinite(Date.parse(job.createdAt)))
      throw new Error('Invalid job in campaign history');
    ids.add(job.id);
    return {id: job.id, status: job.status, attempts: job.attempts, createdAt: job.createdAt};
  });
}

type Props = {
  workspaceId: string;
  campaignId: string;
  allowSubmission: boolean;
  onExpired: () => void;
};

export default function CampaignJobs({workspaceId, campaignId, allowSubmission, onExpired}: Props) {
  const endpoint = '/api/content/dev/workspaces/' + encodeURIComponent(workspaceId) + '/generation-jobs';
  const [opened, setOpened] = useState(false);
  const [revision, setRevision] = useState(0);
  const [history, setHistory] = useState<History>({state: 'loading'});
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const pending = useRef<ContentDraftAttempt | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!opened) return;
    const request = new AbortController();
    async function load() {
      try {
        const reply = await fetch(endpoint + '?campaign=' + encodeURIComponent(campaignId), {
          credentials: 'same-origin', cache: 'no-store', signal: request.signal,
        });
        if (request.signal.aborted) return;
        if (reply.status === 401) { onExpired(); return; }
        if (!reply.ok) throw new Error('History unavailable');
        const jobs = readHistory(await reply.json(), campaignId);
        if (!request.signal.aborted) setHistory({state: 'ready', jobs});
      } catch {
        if (!request.signal.aborted) setHistory({state: 'unavailable'});
      }
    }
    void load();
    return () => request.abort();
  }, [opened, revision, endpoint, campaignId, onExpired]);

  function refresh() {
    setHistory({state: 'loading'});
    setRevision(current => current + 1);
  }

  async function submit() {
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setSending(true);
    setMessage('');
    try {
      pending.current = await prepareContentBrowserDraftRetry(pending.current, workspaceId,
        {operation: 'campaign-generation', campaignId}, () => crypto.randomUUID());
      if (request.signal.aborted) return;
      const reply = await fetch(endpoint, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: request.signal,
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({campaignId, idempotencyKey: pending.current.key}),
      });
      if (request.signal.aborted) return;
      if (reply.status === 401) {
        clearContentBrowserDraftRetry(pending.current);
        pending.current = null;
        onExpired();
        return;
      }
      if (reply.status !== 202) throw new Error('Submission unavailable');
      const {data} = await reply.json();
      if (data?.campaignId !== campaignId || !uuid.test(data.id) || !Object.hasOwn(statusLabels, data.status))
        throw new Error('Invalid receipt');
      clearContentBrowserDraftRetry(pending.current);
      pending.current = null;
      if (!request.signal.aborted) { setMessage('Permintaan diterima.'); refresh(); }
    } catch {
      if (!request.signal.aborted) setMessage('Permintaan belum dapat disahkan. Cuba semula.');
    } finally {
      controller.current = null;
      if (!request.signal.aborted) setSending(false);
    }
  }

  return <details onToggle={event => {
    setOpened(event.currentTarget.open);
    if (!event.currentTarget.open) { setHistory({state: 'loading'}); setMessage(''); }
  }}>
    <summary>Sejarah penjanaan</summary>
    {opened && <div>
      {history.state === 'loading' && <p role="status">Memuatkan sejarah…</p>}
      {history.state === 'unavailable' && <p role="alert">Sejarah belum dapat dibaca.</p>}
      {history.state === 'ready' && (history.jobs.length === 0
        ? <p>Belum ada permintaan penjanaan untuk kempen ini.</p>
        : <ol>{history.jobs.map(job => <li key={job.id}>
          <time dateTime={job.createdAt}>{dateFormat.format(new Date(job.createdAt))}</time>
          {' · '}{statusLabels[job.status]}{' · Percubaan '}{job.attempts}
        </li>)}</ol>)}
      {history.state !== 'loading' && <button type="button" disabled={sending} onClick={refresh}>Muat semula sejarah</button>}
      {allowSubmission && history.state === 'ready' && <button type="button"
        disabled={sending || history.jobs.some(job => job.status === 'queued' || job.status === 'running')}
        onClick={submit}>Hantar permintaan penjanaan</button>}
      {message && <p role="status">{message}</p>}
    </div>}
  </details>;
}
