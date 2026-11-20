import 'server-only';
import {Pool} from 'pg';
import {createPooledContentJobSubmitter} from './neon-content-generation-job-atomic-submission.ts';

export function createContentJobSubmitter() {
 const raw = process.env.CONTENT_NEON_JOB_WRITER_DATABASE_URL;
 if (!raw) throw new Error('CONTENT job writer unavailable');
 const url = new URL(raw);
 if (!['postgresql:', 'postgres:'].includes(url.protocol) || url.username !== 'content_dev_job_writer_v2' ||
     !url.password || !url.hostname.endsWith('.neon.tech') || (url.port && url.port !== '5432') ||
     url.pathname !== '/bros_intelligence_dev' || url.search !== '?sslmode=require' || url.hash)
  throw new Error('Invalid CONTENT job writer configuration');
 const pool = new Pool({connectionString:raw, max:1, connectionTimeoutMillis:5000, idleTimeoutMillis:10000});
 return {submit:createPooledContentJobSubmitter(pool), close:() => pool.end()};
}
