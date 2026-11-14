import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContentCampaignHandoff} from '../lib/content/neon-content-campaign-handoff.ts';

const workspace='22222222-2222-4222-8222-222222222222';
const campaign={id:'33333333-3333-4333-8333-333333333333',product_service:'Kempen contoh'};
const otherCampaign='44444444-4444-4444-8444-444444444444';
const ownItem={id:'55555555-5555-4555-8555-555555555555',campaign_id:campaign.id,type:'script',body:{hook:'Contoh'}};
const foreignItem={id:'66666666-6666-4666-8666-666666666666',campaign_id:otherCampaign,type:'script',body:'PRIVATE'};
test('handoff exports seven-layer campaign metadata and only selected campaign children',()=>{
 const output=JSON.parse(buildContentCampaignHandoff(workspace,{...campaign,strategy:{goal:'Education'},angles:[{hook:'Why?'}],captions:{facebook:'Hello'},publish_plan:[]},
  [ownItem,foreignItem],[{id:'77777777-7777-4777-8777-777777777777',content_item_id:ownItem.id,narration:'Example'},
  {id:'88888888-8888-4888-8888-888888888888',content_item_id:foreignItem.id,narration:'PRIVATE'}]));
 assert.equal(output.content_items.length,1);
 assert.equal(output.scenes.length,1);
 assert.equal(output.campaign.strategy.goal,'Education');
 assert.equal(output.media_verified,false);
 assert.equal(output.publication_verified,false);
 assert.ok(!JSON.stringify(output).includes('PRIVATE'));
});
test('invalid scope and duplicate item identities fail closed',()=>{
 assert.throws(()=>buildContentCampaignHandoff('bad',campaign,[],[]));
 assert.throws(()=>buildContentCampaignHandoff(workspace,campaign,[ownItem,ownItem],[]));
});
