import {cookies} from 'next/headers';
import {Pool} from 'pg';
import {createContentCampaignDraftWriter} from '../../lib/content/neon-content-campaign-draft-writer.ts';
import {createContentTransaction} from '../../lib/content/neon-content-transaction.ts';
import {createContentWorkspaceIndexReader} from '../../lib/content/neon-content-workspace-index.ts';
import {createContentWorkspaceReader} from '../../lib/content/neon-content-workspace-reader.ts';

type FixtureRole = 'content_dev_reader_v2' | 'content_dev_draft_writer_v2';

// Test-only substitute for the upstream Neon Auth SDK transport. The normal
// page and route modules still validate this response with the SDK verifier.
export function getContentNeonAuth() {
  return {
    async getSession() {
      if (process.env.CONTENT_PG_INTEGRATION_CI !== 'disposable_only') return null;
      const token = (await cookies()).get('content-browser-fixture')?.value;
      if (!token) return null;
      const owner = process.env.CONTENT_BROWSER_OWNER_ID;
      const foreign = process.env.CONTENT_BROWSER_FOREIGN_ID;
      const userId = token === process.env.CONTENT_BROWSER_OWNER_SESSION ? owner
        : token === process.env.CONTENT_BROWSER_FOREIGN_SESSION ? foreign
        : undefined;
      return userId ? {data: {user: {id: userId}, session: {userId}}} : null;
    },
  };
}

export function createRestrictedContentAdapters(role: FixtureRole) {
  const connectionString = role === 'content_dev_reader_v2'
    ? process.env.CONTENT_READER_DB_URL
    : process.env.CONTENT_DRAFT_DB_URL;
  const url = new URL(connectionString ?? '');
  if (
    process.env.CONTENT_PG_INTEGRATION_CI !== 'disposable_only'
    || url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1'
    || url.port !== '5432' || url.pathname !== '/bros_intelligence_dev'
    || url.username !== role || !url.password || url.search || url.hash
  ) {
    throw new Error('CONTENT browser tests require the disposable PostgreSQL fixture');
  }
  const pool = new Pool({connectionString, max: 2, connectionTimeoutMillis: 5000});
  const transaction = createContentTransaction(pool);
  return {
    readWorkspace: role === 'content_dev_reader_v2' ? createContentWorkspaceReader(transaction) : null,
    listWorkspaces: role === 'content_dev_reader_v2' ? createContentWorkspaceIndexReader(transaction) : null,
    createDraft: role === 'content_dev_draft_writer_v2' ? createContentCampaignDraftWriter(transaction) : null,
    close: () => pool.end(),
  };
}
