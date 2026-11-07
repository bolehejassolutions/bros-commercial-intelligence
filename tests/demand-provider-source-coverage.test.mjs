import test from 'node:test';
import assert from 'node:assert/strict';
import { assessDemandProviderSourceCoverage as assess } from '../lib/demand/provider-source-coverage.ts';

const metaId = 'act_1997776120879476';
// Privacy-minimized shape from live HYPD selected-account inventory, 28 Oct 2026.
const inventory = {
  platforms: [
    {platform:'google_analytics',state:'ready',accounts:[]},
    {platform:'meta_ads',state:'ready',accounts:[
      {adAccountId:metaId,currency:'MYR',timeZone:'Asia/Kuala_Lumpur'},
    ]},
  ],
};

test('live-shaped inventory: operational GA4 connector with no property is a measurement gap',()=>{
  const x=assess(inventory,metaId);
  assert.equal(x.coverageStatus,'META_ONLY_GA4_NOT_SELECTED');
  assert.equal(x.nextBestEvidenceAction,'VERIFY_OR_SELECT_GA4_PROPERTY_IN_HYPD');
  assert.equal(x.metaSelectedForReadOnlyConnector,true);
  assert.equal(x.ga4SelectedForReadOnlyConnector,false);
  assert.equal(x.ga4ConnectorState,'ready');
  assert.equal(x.appProviderAuthenticationVerified,false);
  assert.equal(x.ga4UtmCaptureVerified,false);
  assert.equal(x.hitpayOrderAttributionVerified,false);
  assert.equal(x.verifiedSettledOrders,null);
  assert.equal(x.verifiedCpaMinor,null);
  assert.equal(x.causalLift,null);
  assert.equal(assess(structuredClone(inventory),metaId).snapshotKey,x.snapshotKey);
  assert.match(x.snapshotKey,/^demand:source-coverage:sha256:[a-f0-9]{64}$/);
});

test('property selected is still not app authentication, UTM capture or settlement',()=>{
  const changed=structuredClone(inventory);
  changed.platforms[0].accounts.push({propertyId:'properties/123456'});
  const x=assess(changed,metaId);
  assert.equal(x.coverageStatus,'META_AND_GA4_SELECTED_UNATTESTED');
  assert.equal(x.nextBestEvidenceAction,'OBTAIN_AUTHENTICATED_PRODUCT_SCOPED_SOURCE_RECEIPTS');
  assert.equal(x.appProviderAuthenticationVerified,false);
  assert.equal(x.ga4UtmCaptureVerified,false);
  assert.equal(x.verifiedSettledOrders,null);
  assert.notEqual(x.snapshotKey,assess(inventory,metaId).snapshotKey);
  const other=structuredClone(changed);
  other.platforms[0].accounts[0].propertyId='properties/987654';
  assert.notEqual(x.snapshotKey,assess(other,metaId).snapshotKey);
});

test('missing Meta selection and missing GA4 scope fail closed',()=>{
  const x=assess(inventory,'act_123456789');
  assert.equal(x.coverageStatus,'META_SOURCE_NOT_READY');
  assert.equal(x.metaSelectedForReadOnlyConnector,false);
  const missing=structuredClone(inventory);
  missing.platforms[0].state='missing_scope';
  assert.equal(assess(missing,metaId).ga4SelectedForReadOnlyConnector,false);
  assert.equal(assess(missing,metaId).ga4ConnectorState,'missing_scope');
});

test('reject duplicate platform entries, forged account types and malformed scopes',()=>{
  assert.throws(()=>assess({...inventory,platforms:[...inventory.platforms,inventory.platforms[0]]},metaId));
  assert.throws(()=>assess({...inventory,platforms:[...inventory.platforms,{platform:'unknown',state:'ready',accounts:[]}]},metaId));
  assert.throws(()=>assess({...inventory,platforms:[{platform:'meta_ads',state:'ready',accounts:[null]},inventory.platforms[0]]},metaId));
  assert.throws(()=>assess(inventory,[metaId]));
  assert.throws(()=>assess({platforms:[]},metaId));
});
