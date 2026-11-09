/** Disposable PostgreSQL 16 transaction atomicity probe.
 * Uses temporary tables only; does not exercise the application draft writer,
 * restricted login or live Neon grants. Those require separate integration.
 */
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

if (process.env.CONTENT_PG_INTEGRATION_CI !== 'disposable_only' ||
    !/^postgresql:\/\/postgres:[^@]+@127\.0\.0\.1:5432\/bros_intelligence_dev$/.test(process.env.CONTENT_ADMIN_DB_URL ?? '')) {
  throw Error('Refusing non-disposable PostgreSQL target');
}
const pool = new pg.Pool({connectionString:process.env.CONTENT_ADMIN_DB_URL,max:1});
after(async()=>pool.end());

test('PostgreSQL: failed final draft reservation link rolls back both inserts', async()=>{
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE draft_campaigns (id uuid PRIMARY KEY, brief text NOT NULL) ON COMMIT PRESERVE ROWS');
    await client.query('CREATE TEMP TABLE draft_reservations (key text PRIMARY KEY, campaign_id uuid REFERENCES draft_campaigns(id)) ON COMMIT PRESERVE ROWS');
    await client.query('COMMIT');

    const id='44444444-4444-4444-8444-444444444444';
    await client.query('BEGIN');
    await assert.rejects(async()=>{
      await client.query('INSERT INTO draft_reservations(key) VALUES ($1)', ['atomic-retry-key']);
      await client.query('INSERT INTO draft_campaigns(id,brief) VALUES ($1,$2)',[id,'original submitted brief']);
      // Force a failed link by requiring a mismatched reservation key.
      const link=await client.query('UPDATE draft_reservations SET campaign_id=$1 WHERE key=$2 AND campaign_id IS NULL RETURNING campaign_id',[id,'wrong-key']);
      assert.equal(link.rows.length,1,'A draft save must never succeed without a linked reservation');
    }, /A draft save must never succeed/);
    await client.query('ROLLBACK');
    const rows=await client.query('SELECT (SELECT count(*)::int FROM draft_campaigns) AS campaigns, (SELECT count(*)::int FROM draft_reservations) AS reservations');
    assert.deepEqual(rows.rows[0],{campaigns:0,reservations:0});

    // The same key must be reusable after rollback, with exactly one linked campaign.
    await client.query('BEGIN');
    await client.query('INSERT INTO draft_reservations(key) VALUES ($1)',['atomic-retry-key']);
    await client.query('INSERT INTO draft_campaigns(id,brief) VALUES ($1,$2)',[id,'original submitted brief']);
    const linked=await client.query('UPDATE draft_reservations SET campaign_id=$1 WHERE key=$2 AND campaign_id IS NULL RETURNING campaign_id',[id,'atomic-retry-key']);
    assert.equal(linked.rows.length,1);
    await client.query('COMMIT');
    const committed=await client.query('SELECT (SELECT count(*)::int FROM draft_campaigns) AS campaigns, (SELECT count(*)::int FROM draft_reservations WHERE campaign_id IS NOT NULL) AS linked');
    assert.deepEqual(committed.rows[0],{campaigns:1,linked:1});
  } finally {
    await client.query('ROLLBACK').catch(()=>{});
    client.release();
  }
});
