/** Disposable PostgreSQL proof that the actual blocking advisory-lock expression
 * serializes same-key draft requests and fails closed on bounded wait.
 * No Neon access, application credentials, or production mutations.
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

test('blocking same-key writer times out, rolls back, then succeeds after owner rollback', async()=>{
  const first=await pool.connect();
  const second=await pool.connect();
  const key='11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222:bounded-wait-key-123';
  const sql='SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0)) AS lock_result';
  try {
    await first.query('BEGIN');
    await second.query('BEGIN');
    await first.query(sql,[key]);
    await second.query("SET LOCAL lock_timeout = '100ms'");
    await assert.rejects(second.query(sql,[key]),error=>error.code==='55P03',
      'contending writer must not acknowledge a lock it cannot acquire');
    await assert.rejects(second.query('SELECT 1'),error=>error.code==='25P02',
      'failed lock wait must abort the current transaction');
    await second.query('ROLLBACK');
    await first.query('ROLLBACK');
    await second.query('BEGIN');
    assert.equal((await second.query(sql,[key])).rows.length,1,
      'retry must acquire the lock after the competing transaction rolls back');
    await second.query('COMMIT');
  } finally {
    await first.query('ROLLBACK').catch(()=>{});
    await second.query('ROLLBACK').catch(()=>{});
    first.release();
    second.release();
  }
});
