/** Isolated PostgreSQL concurrency check for the exact transaction advisory-lock
 * expression used by the restricted CONTENT draft writer. No live Neon access.
 * Does not substitute for end-to-end restricted-writer/RLS acceptance.
 */
import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

if (process.env.CONTENT_PG_INTEGRATION_CI !== 'disposable_only' ||
    !/^postgresql:\/\/postgres:[^@]+@127\.0\.0\.1:5432\/bros_intelligence_dev$/.test(process.env.CONTENT_ADMIN_DB_URL ?? '')) {
  throw Error('Refusing non-disposable PostgreSQL target');
}
const pool = new pg.Pool({connectionString:process.env.CONTENT_ADMIN_DB_URL,max:2});
after(async()=>pool.end());

test('PostgreSQL: identical tenant/principal/key locks serialize and release on rollback', async()=>{
  const first=await pool.connect();
  const second=await pool.connect();
  const identity='11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:replay-lock-key-123';
  const sql='SELECT pg_try_advisory_xact_lock(hashtextextended($1::text, 0)) AS acquired';
  try {
    await first.query('BEGIN');
    await second.query('BEGIN');
    assert.equal((await first.query(sql,[identity])).rows[0].acquired,true);
    assert.equal((await second.query(sql,[identity])).rows[0].acquired,false,
      'same-key concurrent writer must wait rather than independently reserve');
    await first.query('ROLLBACK');
    assert.equal((await second.query(sql,[identity])).rows[0].acquired,true,
      'failed transaction must release its advisory lock for safe retry');
    await second.query('COMMIT');
  } finally {
    await first.query('ROLLBACK').catch(()=>{});
    await second.query('ROLLBACK').catch(()=>{});
    first.release();
    second.release();
  }
});

test('PostgreSQL: distinct idempotency keys do not share a lock', async()=>{
  const first=await pool.connect();
  const second=await pool.connect();
  const prefix='11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:';
  const sql='SELECT pg_try_advisory_xact_lock(hashtextextended($1::text, 0)) AS acquired';
  try {
    await first.query('BEGIN');
    await second.query('BEGIN');
    assert.equal((await first.query(sql,[prefix+'first-key-123'])).rows[0].acquired,true);
    assert.equal((await second.query(sql,[prefix+'second-key-456'])).rows[0].acquired,true);
  } finally {
    await first.query('ROLLBACK').catch(()=>{});
    await second.query('ROLLBACK').catch(()=>{});
    first.release();
    second.release();
  }
});
