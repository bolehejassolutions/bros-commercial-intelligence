/** CONTENT DEV-only restricted database adapter factory.
 * This module does not connect automatically or expose routes.
 * Only a separately provisioned, dedicated restricted PostgreSQL login may be
 * supplied via distinct CONTENT_NEON_READER_DATABASE_URL and
 * CONTENT_NEON_WRITER_DATABASE_URL secrets.
 */
import 'server-only';
import {Pool} from 'pg';
import {createContentTransaction} from './neon-content-transaction.ts';
import {createContentWorkspaceReader} from './neon-content-workspace-reader.ts';
import {createContentCampaignDraftWriter} from './neon-content-campaign-draft-writer.ts';

const prohibited=/^(postgres|neondb_owner|bros|bci_dev_.*)$/i;
export function createRestrictedContentAdapters(role:'content_dev_reader'|'content_dev_draft_writer'){
 if(role!=='content_dev_reader'&&role!=='content_dev_draft_writer')throw new Error('Invalid CONTENT role');
 const url=role==='content_dev_reader'?process.env.CONTENT_NEON_READER_DATABASE_URL:process.env.CONTENT_NEON_WRITER_DATABASE_URL;
 if(!url)throw new Error('CONTENT restricted database is not configured');
 let parsed:URL;
 try{parsed=new URL(url);}catch{throw new Error('Invalid CONTENT restricted database URL');}
 if(!['postgresql:','postgres:'].includes(parsed.protocol))throw new Error('Invalid CONTENT database protocol');
 const login=decodeURIComponent(parsed.username);
 if(parsed.searchParams.has('options')||parsed.searchParams.has('application_name'))throw new Error('Unsupported CONTENT connection parameters');
 if(login!==role||prohibited.test(login))
  throw new Error('CONTENT database login must be restricted');
 if(!parsed.password||parsed.searchParams.get('sslmode')!=='require'||!parsed.hostname.endsWith('.neon.tech')||(parsed.port&&parsed.port!=='5432')||parsed.hash)
  throw new Error('CONTENT database credentials require TLS');
 // Distinct reader and writer roles cannot share one login. The caller must
 // instantiate only the matching adapter. The SQL layer also verifies the role.
 const pool=new Pool({connectionString:url,max:2,idleTimeoutMillis:10000,
  connectionTimeoutMillis:5000,allowExitOnIdle:true});
 const transaction=createContentTransaction(pool);
 return {
  role:login,
  readWorkspace:login==='content_dev_reader'?createContentWorkspaceReader(transaction):null,
  createDraft:login==='content_dev_draft_writer'?createContentCampaignDraftWriter(transaction):null,
  close:()=>pool.end()
 };
}
