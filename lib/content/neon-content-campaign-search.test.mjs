import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {filterContentCampaigns}=createRequire(import.meta.url)('./neon-content-campaign-search.js');
const campaigns=[
 {id:'a',product_service:'BROS SELL',audience:'Peniaga Malaysia',status:'draft',objective:'jualan'},
 {id:'b',product_service:'Deep Cleaning',audience:'Pemilik rumah',status:'ready',objective:'tempahan'},
 {id:'c',product_service:'BROS CONTENT',audience:'SME',status:'draft',objective:'kesedaran'}
];
test('empty query preserves the authenticated response without mutation',()=>{
 assert.equal(filterContentCampaigns(campaigns,'  '),campaigns);
 assert.deepEqual(campaigns.map(x=>x.id),['a','b','c']);
});
test('case-insensitive Malay campaign search matches across fields',()=>{
 assert.deepEqual(filterContentCampaigns(campaigns,'bros malaysia').map(x=>x.id),['a']);
 assert.deepEqual(filterContentCampaigns(campaigns,'DRAFT').map(x=>x.id),['a','c']);
 assert.deepEqual(filterContentCampaigns(campaigns,'rumah tempahan').map(x=>x.id),['b']);
});
test('search does not include private content or arbitrary object fields',()=>{
 const data=[{id:'secret',product_service:'Public',internal_notes:'sensitive customer name'}];
 assert.deepEqual(filterContentCampaigns(data,'sensitive'),[]);
});
test('malformed campaign records are ignored for nonempty search',()=>{
 assert.deepEqual(filterContentCampaigns([null,3,{id:'ok',product_service:'Test'}],'test').map(x=>x.id),['ok']);
 assert.deepEqual(filterContentCampaigns(null,'test'),[]);
});
