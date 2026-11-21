import type {ContentPersistenceBundle} from './neon-content-persistence-bundle.ts';
import type {JobTransactionQuery} from './neon-content-generation-job-restricted-db.ts';
import {ContentReadDenied} from './neon-content-workspace-reader.ts';

function insertedId(rows:readonly Record<string,unknown>[]) {
 if (rows.length !== 1 || typeof rows[0].id !== 'string' ||
     !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rows[0].id))
  throw new ContentReadDenied();
 return rows[0].id;
}

export async function writeContentBundleChildren(query:JobTransactionQuery,tenantId:string,campaignId:string,
 bundle:ContentPersistenceBundle) {
 const refs = new Map<string,string>();
 for (const item of bundle.items) {
  if (refs.has(item.ref)) throw new ContentReadDenied();
  const saved = await query(
   `INSERT INTO content_dev.content_items (tenant_id,campaign_id,type,title,body,sort_order,version)
    VALUES ($1::uuid,$2::uuid,$3,$4,$5::jsonb,$6,$7) RETURNING id`,
   [tenantId,campaignId,item.type,item.title,JSON.stringify(item.body),item.sort_order,item.version]);
  refs.set(item.ref,insertedId(saved.rows));
 }
 for (const scene of bundle.scenes) {
  const itemId = refs.get(scene.content_item_ref);
  if (!itemId) throw new ContentReadDenied();
  const saved = await query(
   `INSERT INTO content_dev.scenes
    (tenant_id,content_item_id,scene_number,duration_seconds,narration,dialogue,visual_prompt,motion_prompt,continuity_lock)
    VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING id`,
   [tenantId,itemId,scene.scene_number,scene.duration_seconds,scene.narration,scene.dialogue,
    scene.visual_prompt,scene.motion_prompt,JSON.stringify(scene.continuity_lock)]);
  insertedId(saved.rows);
 }
}
