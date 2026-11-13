/** BROS CONTENT Neon DEV: fail-closed, principal-bound workspace read adapter.
 * Not an HTTP route. Requires a separately provisioned restricted direct-login role.
 * No permissions are granted by this module.
 */
import {MAX_CONTENT_SCENES_PER_ITEM} from './neon-content-generation-contract.ts';

export class ContentReadDenied extends Error { constructor() { super("CONTENT access denied"); } }
/** Valid access but too many rows for a complete response; never report this as 404. */
export class ContentReadIncomplete extends Error { constructor() { super("CONTENT result exceeds supported read limit"); } }
/** A LIMIT N+1 sentinel distinguishes complete reads from silent truncation. */
export function requireCompleteContentRows<T>(rows:readonly T[],limit:number):readonly T[]{
 if(!Array.isArray(rows)||!Number.isSafeInteger(limit)||limit<1||rows.length>limit)
  throw new ContentReadIncomplete();
 return rows;
}
type Row = Record<string, unknown>;
type Query = (sql: string, params: readonly string[]) => Promise<{rows: readonly Row[]}>;
type Transaction = <T>(fn: (query: Query) => Promise<T>) => Promise<T>;
type Principal = Readonly<{userId: string; authenticated: true}>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny = (): never => {throw new ContentReadDenied();};
export function createContentWorkspaceReader(transaction: Transaction) {
  if (typeof transaction !== "function") deny();
  return async (principal: Principal, workspaceId: string, before?: string, draftId?: string) => {
    if (principal?.authenticated !== true || !UUID.test(principal.userId) || !UUID.test(workspaceId) ||
        (before !== undefined && !UUID.test(before)) ||
        (draftId !== undefined && (!UUID.test(draftId) || before !== undefined))) deny();
    return transaction(async query => {
      const role = (await query(`SELECT current_user AS name, session_user AS login,
        rolcanlogin AS can_login, rolinherit AS inherits, rolbypassrls AS bypass,
        rolsuper AS superuser, rolcreaterole AS can_create_role,
        (SELECT count(*)::int FROM pg_auth_members WHERE member=pg_roles.oid) AS parents
        FROM pg_roles WHERE rolname=current_user`, [])).rows;
      if (role.length !== 1 || role[0].name !== "content_dev_reader_v2" ||
          role[0].login !== "content_dev_reader_v2" || role[0].can_login !== true ||
          role[0].inherits !== false || role[0].bypass !== false ||
          role[0].superuser !== false || role[0].can_create_role !== false ||
          role[0].parents !== 0) deny();
      const posture = (await query(`SELECT current_database() AS db,
        (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='content_dev' AND c.relname IN
          ('workspaces','campaigns','content_items','scenes')
          AND c.relrowsecurity AND c.relforcerowsecurity) AS forced,
        has_schema_privilege(current_user,'content_import_dev','USAGE') AS staging,
        has_table_privilege(current_user,'content_dev.credit_ledger','SELECT') AS credits,
        has_table_privilege(current_user,'content_dev.campaigns','INSERT') AS writes,
        has_table_privilege(current_user,'bci_dev.tenant_memberships','SELECT') AS membership`, [])).rows;
      if (posture.length !== 1 || posture[0].db !== "bros_intelligence_dev" ||
          posture[0].forced !== 4 || posture[0].staging !== false ||
          posture[0].credits !== false || posture[0].writes !== false ||
          posture[0].membership !== true) deny();
      // Bind the verified identity to this transaction before membership RLS evaluates.
      const context=(await query(`SELECT set_config('bci.principal_id',$1,true) AS principal_id`,[principal.userId])).rows;
      if(context.length!==1||context[0].principal_id!==principal.userId)deny();
      const workspace = (await query(`SELECT w.id,w.tenant_id,w.name,w.business_dna
        FROM content_dev.workspaces w JOIN bci_dev.tenant_memberships m
          ON m.tenant_id=w.tenant_id AND m.principal_id=$1::uuid
          AND m.product='content' AND m.active IS TRUE AND m.revoked_at IS NULL
        WHERE w.id=$2::uuid AND w.owner_principal_id=$1::uuid LIMIT 1`,
        [principal.userId,workspaceId])).rows;
      if (workspace.length !== 1 || !UUID.test(String(workspace[0].tenant_id))) deny();
      if (workspace[0].id !== workspaceId) deny();
      const tenant = String(workspace[0].tenant_id);
      const scope = [tenant,workspaceId,principal.userId];
      if (draftId !== undefined) {
        const drafts = (await query(`SELECT id,product_service,description,audience,problem,objective,
          duration_days,platforms,status,strategy,angles,captions,publish_plan,created_at,updated_at
          FROM content_dev.campaigns
          WHERE tenant_id=$1::uuid AND workspace_id=$2::uuid AND owner_principal_id=$3::uuid
          AND id=$4::uuid AND status='draft' LIMIT 1`, [...scope,draftId])).rows;
        if (drafts.length !== 1 || drafts[0].id !== draftId || drafts[0].status !== 'draft') deny();
        // Receipt reads must restore the same seven-layer draft as a paginated workspace read.
        // Bound both child collections; never silently truncate a saved draft.
        const contentItems = (await query(`SELECT id,campaign_id,type,title,body,sort_order,version
          FROM content_dev.content_items WHERE tenant_id=$1::uuid AND campaign_id=$2::uuid
          ORDER BY sort_order,id LIMIT 501`,[tenant,draftId])).rows;
        requireCompleteContentRows(contentItems,500);
        if (contentItems.some(row => row.campaign_id !== draftId || !UUID.test(String(row.id)))) deny();
        const scenes: Row[] = [];
        for (const item of contentItems) {
          const itemScenes = (await query(`SELECT id,content_item_id,scene_number,duration_seconds,
            narration,dialogue,visual_prompt,motion_prompt,continuity_lock
            FROM content_dev.scenes WHERE tenant_id=$1::uuid AND content_item_id=$2::uuid
            ORDER BY scene_number,id LIMIT ${MAX_CONTENT_SCENES_PER_ITEM+1}`,[tenant,String(item.id)])).rows;
          requireCompleteContentRows(itemScenes,MAX_CONTENT_SCENES_PER_ITEM);
          if (itemScenes.some(row => row.content_item_id !== item.id || !UUID.test(String(row.id)))) deny();
          scenes.push(...itemScenes);
        }
        return {workspace:workspace[0],campaigns:drafts,contentItems,scenes,nextCursor:null};
      }
      // Compare both ordering fields in PostgreSQL so timestamp precision is preserved.
      // An out-of-scope cursor matches no row and cannot expose another tenant's data.
      const cursorFilter = before ? `AND (created_at,id) < (
        SELECT cursor_row.created_at,cursor_row.id FROM content_dev.campaigns cursor_row
        WHERE cursor_row.tenant_id=$1::uuid AND cursor_row.workspace_id=$2::uuid
        AND cursor_row.owner_principal_id=$3::uuid AND cursor_row.id=$4::uuid)` : '';
      const page = (await query(`SELECT id,product_service,description,audience,problem,objective,
        duration_days,platforms,status,strategy,angles,captions,publish_plan,created_at,updated_at
        FROM content_dev.campaigns WHERE tenant_id=$1::uuid AND workspace_id=$2::uuid
        AND owner_principal_id=$3::uuid ${cursorFilter} ORDER BY created_at DESC,id DESC LIMIT 101`,
        before ? [...scope,before] : scope)).rows;
      const campaigns = page.slice(0,100);
      const contentItems: Row[] = [], scenes: Row[] = [];
      for (const campaign of campaigns) {
        if (!UUID.test(String(campaign.id))) deny();
        const rows = (await query(`SELECT id,campaign_id,type,title,body,sort_order,version
          FROM content_dev.content_items WHERE tenant_id=$1::uuid AND campaign_id=$2::uuid
          ORDER BY sort_order,id LIMIT 501`,[tenant,String(campaign.id)])).rows;
        requireCompleteContentRows(rows,500);
        if (rows.some(row => row.campaign_id !== campaign.id || !UUID.test(String(row.id)))) deny();
        contentItems.push(...rows);
      }
      for (const item of contentItems) {
        if (!UUID.test(String(item.id))) deny();
        const itemScenes=(await query(`SELECT id,content_item_id,scene_number,duration_seconds,
          narration,dialogue,visual_prompt,motion_prompt,continuity_lock
          FROM content_dev.scenes WHERE tenant_id=$1::uuid AND content_item_id=$2::uuid
          ORDER BY scene_number,id LIMIT ${MAX_CONTENT_SCENES_PER_ITEM+1}`,[tenant,String(item.id)])).rows;
        requireCompleteContentRows(itemScenes,MAX_CONTENT_SCENES_PER_ITEM);
        if (itemScenes.some(row => row.content_item_id !== item.id || !UUID.test(String(row.id)))) deny();
        scenes.push(...itemScenes);
      }
      const nextCursor = page.length>100 ? campaigns.at(-1)!.id : null;
      return {workspace:workspace[0],campaigns,contentItems,scenes,nextCursor};
    });
  };
}
