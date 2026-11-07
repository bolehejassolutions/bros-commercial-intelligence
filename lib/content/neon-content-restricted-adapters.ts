/** CONTENT DEV-only restricted database adapter factory.
 * This module does not connect automatically or expose routes.
 * Only a separately provisioned, dedicated restricted PostgreSQL login may be
 * supplied via CONTENT_NEON_RESTRICTED_DATABASE_URL.
 */
import 'server-only';
import {Pool} from 'pg';
import {createContentTransaction} from './neon-content-transaction.ts';
import {createContentWorkspaceReader} from './neon-content-workspace-reader.ts';
import {createContentCampaignDraftWriter} from './neon-content-campaign-draft-writer.ts';

const prohibited=/^(postgres|neondb_owner|bros|bci_dev_.*)$/i;
export function createRestrictedContentAdapters(){
 const url=process.env.CONTENT_NEON_RESTRICTED_DATABASE_URL;
 if(!url)throw new Error('CONTENT restricted database is not configured');
 let parsed:URL;
 try{parsed=new URL(url);}catch{throw new Error('Invalid CONTENT restricted database URL');}
 if(!['postgresql:','postgres:'].includes(parsed.protocol))throw new Error('Invalid CONTENT database protocol');
 const login=decodeURIComponent(parsed.username);
 if(!['content_dev_reader','content_dev_draft_writer'].includes(login)||prohibited.test(login))
  throw new Error('CONTENT database login must be restricted');
 if(!parsed.password||parsed.searchParams.get('sslmode')!=='require')
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
