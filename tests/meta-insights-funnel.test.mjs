import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMetaCampaignFunnel } from '../lib/demand/meta-insights-funnel.ts';

const scope = {tenantId:'11111111-1111-4111-8111-111111111111',product:'demand',
  accountId:'act_1997776120879476',campaignId:'120250864977630697',currency:'MYR',
  since:'2026-10-08',until:'2026-10-26',collectedAt:'2026-10-26T09:00:00Z'};
const row = {campaign_id:scope.campaignId,date_start:scope.since,date_stop:scope.until,
  spend:124.93,impressions:'3194',reach:'2041',clicks:'84',inline_link_clicks:'63',
  actions:[{action_type:'purchase',value:1},{action_type:'omni_purchase',value:1},
    {action_type:'offsite_conversion.fb_pixel_purchase',value:1},
    {action_type:'landing_page_view',value:33},{action_type:'omni_landing_page_view',value:33}]};
const invalid=/Invalid BROS DEMAND Meta insight/;

test('Meta purchase aliases are not summed or mistaken for HitPay paid/settled orders',()=>{
  const x=normalizeMetaCampaignFunnel(scope,row);
  assert.equal(x.metaAttributedPurchases,1);
  assert.equal(x.pixelPurchaseEvents,1);
  assert.equal(x.spendMinor,12493);
  assert.equal(x.landingPageViews,33);
  assert.equal(x.inlineLinkClicks,63);
  assert.equal(x.observedLandingPageViewsPerInlineLinkClick,33/63);
  assert.equal(x.qualifiedVisits,null);assert.equal(x.qualifiedLeads,null);
  assert.equal(x.hitpayPaidOrders,null);assert.equal(x.hitpaySettledOrders,null);
  assert.equal(x.verifiedCacMinor,null);assert.equal(x.causalLift,null);
});
test('absent actions are unknown, explicitly reported zero is zero',()=>{
  const missing=normalizeMetaCampaignFunnel(scope,{...row,actions:[],inline_link_clicks:undefined});
  assert.equal(missing.metaAttributedPurchases,null);
  assert.equal(missing.pixelPurchaseEvents,null);
  assert.equal(missing.landingPageViews,null);
  assert.equal(missing.observedLandingPageViewsPerInlineLinkClick,null);
  const zero=normalizeMetaCampaignFunnel(scope,{...row,actions:[{action_type:'purchase',value:'0'},
    {action_type:'landing_page_view',value:'0'}]});
  assert.equal(zero.metaAttributedPurchases,0);
  assert.equal(zero.landingPageViews,0);
});
test('conflicting purchase aliases do not silently promote an attributed purchase',()=>{
  const x=normalizeMetaCampaignFunnel(scope,{...row,actions:[{action_type:'purchase',value:1},
    {action_type:'omni_purchase',value:2},{action_type:'offsite_conversion.fb_pixel_purchase',value:1}]});
  assert.equal(x.actionAliasMismatch,true);
  assert.equal(x.metaAttributedPurchases,null);
  assert.equal(x.pixelPurchaseEvents,null);
});
test('pixel-only action is not promoted to a generic Meta purchase',()=>{
  const x=normalizeMetaCampaignFunnel(scope,{...row,actions:[{action_type:'offsite_conversion.fb_pixel_purchase',value:1}]});
  assert.equal(x.pixelPurchaseEvents,1);
  assert.equal(x.metaAttributedPurchases,null);
});
test('conflicting replay of same action type fails closed; exact duplicate is idempotent',()=>{
  assert.throws(()=>normalizeMetaCampaignFunnel(scope,{...row,actions:[
    {action_type:'purchase',value:1},{action_type:'purchase',value:2}]}),invalid);
  const x=normalizeMetaCampaignFunnel(scope,{...row,actions:[
    {action_type:'purchase',value:1},{action_type:'purchase',value:'1'}]});
  assert.equal(x.metaAttributedPurchases,1);
  assert.deepEqual(x,normalizeMetaCampaignFunnel(scope,{...row,actions:[
    {action_type:'purchase',value:1},{action_type:'purchase',value:'1'}]}));
});
test('reject invalid product, wrong campaign and reporting windows',()=>{
  for(const patch of [{tenantId:'22222222-2222-4222-8222-222222222222',product:'content'},
    {product:'content'},{accountId:'act_invalid'},{campaignId:'wrong'},
    {since:'2026-10-09'},{until:'2026-10-25'},
    {collectedAt:'2026-10-01T00:00:00Z'}]){
    assert.throws(()=>normalizeMetaCampaignFunnel({...scope,...patch},row),invalid);
  }
  assert.throws(()=>normalizeMetaCampaignFunnel(scope,{...row,campaign_id:'999'}),invalid);
});
test('reject invalid calendar, UTC timestamp, count and money',()=>{
  for(const patch of [{since:'2026-02-30'},{until:'2026-13-01'},
    {collectedAt:'2026-02-31T00:00:00Z'},
    {collectedAt:'2026-10-26T25:00:00Z'}])
    assert.throws(()=>normalizeMetaCampaignFunnel({...scope,...patch},row),invalid);
  for(const patch of [{spend:-1},{spend:1.005},{spend:'1e2'},
    {clicks:-1},{inline_link_clicks:'1.5'},
    {actions:[{action_type:'purchase',value:1.5}]}])
    assert.throws(()=>normalizeMetaCampaignFunnel(scope,{...row,...patch}),invalid);
});
test('landing-page views are observations, not qualified visits or guaranteed click conversions',()=>{
  const x=normalizeMetaCampaignFunnel(scope,{...row,inline_link_clicks:'0'});
  assert.equal(x.observedLandingPageViewsPerInlineLinkClick,null);
  assert.equal(x.qualifiedVisits,null);
});

test('source keys remain stable on replay and distinct across tenant boundaries',()=>{
  const first=normalizeMetaCampaignFunnel(scope,row);
  const replay=normalizeMetaCampaignFunnel(scope,{...row});
  const other=normalizeMetaCampaignFunnel({...scope,tenantId:'22222222-2222-4222-8222-222222222222'},row);
  assert.equal(first.sourceKey,replay.sourceKey);
  assert.notEqual(first.sourceKey,other.sourceKey);
  assert.match(first.sourceKey,/^meta_ads:tenant:11111111-1111-4111-8111-111111111111:/);
});

test('conflicting omni and pixel purchase aliases fail closed even without generic purchase',()=>{
  const x=normalizeMetaCampaignFunnel(scope,{...row,actions:[
    {action_type:'omni_purchase',value:1},
    {action_type:'offsite_conversion.fb_pixel_purchase',value:2}]});
  assert.equal(x.actionAliasMismatch,true);
  assert.equal(x.metaAttributedPurchases,null);
  assert.equal(x.pixelPurchaseEvents,null);
  assert.equal(x.hitpayPaidOrders,null);
  assert.equal(x.verifiedCacMinor,null);
});


test('MYT calendar boundary classifies partial reporting without claiming provider finality',()=>{
  const ongoing=normalizeMetaCampaignFunnel(scope,row);
  assert.equal(ongoing.calendarWindowStatus,'CURRENT_MYT_DAY');
  const past=normalizeMetaCampaignFunnel({...scope,collectedAt:'2026-10-27T00:00:00Z'},row);
  assert.equal(past.calendarWindowStatus,'PAST_MYT_DAY');
  assert.equal(past.verifiedCacMinor,null);
  assert.equal(past.hitpaySettledOrders,null);
});

test('MYT calendar boundary accepts valid local midnight and rejects future local report day',()=>{
  const midnightScope={...scope,since:'2026-10-26',until:'2026-10-26',
    collectedAt:'2026-10-25T16:05:00Z'};
  const midnightRow={...row,date_start:'2026-10-26',date_stop:'2026-10-26'};
  assert.equal(normalizeMetaCampaignFunnel(midnightScope,midnightRow).calendarWindowStatus,
    'CURRENT_MYT_DAY');
  assert.throws(()=>normalizeMetaCampaignFunnel(
    {...midnightScope,collectedAt:'2026-10-25T15:59:59Z'},midnightRow),invalid);
  const futureRow={...row,date_stop:'2026-10-27'};
  assert.throws(()=>normalizeMetaCampaignFunnel({...scope,until:'2026-10-27'},futureRow),invalid);
});


// DEMAND_META_REVISED_SNAPSHOT_KEY_20261027_0304: stable grouping versus immutable report snapshot identity.
test('revised Meta snapshots do not overwrite campaign/window evidence candidates',()=>{
  const first=normalizeMetaCampaignFunnel(scope,row);
  const replay=normalizeMetaCampaignFunnel(scope,{...row});
  const later=normalizeMetaCampaignFunnel({...scope,collectedAt:'2026-10-26T10:00:00Z'},row);
  const revisedSpend=normalizeMetaCampaignFunnel(scope,{...row,spend:125.93});
  const revisedLpv=normalizeMetaCampaignFunnel(scope,{...row,actions:row.actions.map(a=>
    a.action_type==='landing_page_view'?{...a,value:34}:a)});
  const missing=normalizeMetaCampaignFunnel(scope,{...row,spend:undefined});
  const zero=normalizeMetaCampaignFunnel(scope,{...row,spend:0});
  const otherTenant=normalizeMetaCampaignFunnel({...scope,tenantId:'22222222-2222-4222-8222-222222222222'},row);
  for(const x of [later,revisedSpend,revisedLpv,missing,zero]){
    assert.equal(x.sourceKey,first.sourceKey);
    assert.notEqual(x.snapshotKey,first.snapshotKey);
    assert.equal(x.hitpaySettledOrders,null);
    assert.equal(x.verifiedCacMinor,null);
  }
  assert.equal(first.snapshotKey,replay.snapshotKey);
  assert.notEqual(first.snapshotKey,otherTenant.snapshotKey);
  assert.notEqual(missing.snapshotKey,zero.snapshotKey);
  assert.equal(first.product,'demand');
});
test('Meta snapshot identity normalizes equivalent provider number encodings',()=>{
  const first=normalizeMetaCampaignFunnel(scope,row);
  const equivalent=normalizeMetaCampaignFunnel(scope,{
    ...row,spend:'124.93',impressions:3194,reach:2041,clicks:84,
    inline_link_clicks:63,actions:row.actions.map(a=>({...a,value:String(a.value)}))
  });
  assert.equal(first.snapshotKey,equivalent.snapshotKey);
});


// DEMAND_META_ACTION_SNAPSHOT_INTEGRITY_20261027
test('conflicting Meta alias reports retain distinct immutable snapshot IDs even when projected counts are null',()=>{
  const one=normalizeMetaCampaignFunnel(scope,{...row,actions:[
    {action_type:'purchase',value:1},{action_type:'omni_purchase',value:2}]});
  const two=normalizeMetaCampaignFunnel(scope,{...row,actions:[
    {action_type:'purchase',value:1},{action_type:'omni_purchase',value:3}]});
  assert.equal(one.actionAliasMismatch,true);
  assert.equal(two.actionAliasMismatch,true);
  assert.equal(one.metaAttributedPurchases,null);
  assert.equal(two.metaAttributedPurchases,null);
  assert.equal(one.sourceKey,two.sourceKey);
  assert.notEqual(one.snapshotKey,two.snapshotKey);
  assert.equal(one.hitpaySettledOrders,null);
  assert.equal(two.verifiedCacMinor,null);
});
test('unprojected Meta action revisions cannot overwrite candidate snapshots',()=>{
  const base=normalizeMetaCampaignFunnel(scope,row);
  const changed=normalizeMetaCampaignFunnel(scope,{...row,actions:row.actions.map(a=>
    a.action_type==='omni_landing_page_view'?{...a,value:34}:a)});
  assert.equal(base.landingPageViews,changed.landingPageViews);
  assert.equal(base.metaAttributedPurchases,changed.metaAttributedPurchases);
  assert.notEqual(base.snapshotKey,changed.snapshotKey);
});
test('Meta action order, exact duplicates and equivalent number encodings preserve snapshot identity',()=>{
  const base=normalizeMetaCampaignFunnel(scope,row);
  const shuffled=normalizeMetaCampaignFunnel(scope,{...row,actions:[
    ...row.actions.slice().reverse().map(a=>({...a,value:String(a.value)})),
    {action_type:'purchase',value:'1'}]});
  assert.equal(base.snapshotKey,shuffled.snapshotKey);
  assert.match(base.snapshotKey,/:actions-sha256:[a-f0-9]{64}$/);
});
