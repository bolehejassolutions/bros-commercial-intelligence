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
