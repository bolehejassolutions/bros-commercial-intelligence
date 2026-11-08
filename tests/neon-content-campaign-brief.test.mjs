import test from 'node:test';
import assert from 'node:assert/strict';
import {buildContentCampaignBrief} from '../lib/content/neon-content-campaign-brief.ts';
test('persisted draft fields remain visible even without generated content',()=>{
 const rows=buildContentCampaignBrief({product_service:'BROS SELL',audience:'Penjual Malaysia',description:'Penerangan',
  problem:'Pelanggan tidak faham nilai',objective:'Terangkan proses',duration_days:7,platforms:['facebook','tiktok']});
 assert.deepEqual(rows.map(row=>row.label),['Produk / servis','Sasaran pelanggan','Penerangan','Masalah pelanggan','Objektif','Tempoh','Platform']);
 assert.equal(rows.find(row=>row.label==='Masalah pelanggan')?.value,'Pelanggan tidak faham nilai');
 assert.equal(rows.find(row=>row.label==='Platform')?.value,'facebook, tiktok');
});
test('legacy missing optional fields and malformed data never invent values',()=>{
 assert.deepEqual(buildContentCampaignBrief(null),[]);
 const rows=buildContentCampaignBrief({product_service:'Legacy',audience:null,problem:123,objective:'',duration_days:0,platforms:['bad','facebook','facebook',null]});
 assert.deepEqual(rows,[{label:'Produk / servis',value:'Legacy'},{label:'Platform',value:'facebook'}]);
});
test('malformed and oversized fields are bounded; input is not modified',()=>{
 const input=Object.freeze({product_service:'x'.repeat(300),audience:' y ',platforms:Object.freeze(['tiktok','TikTok','unsupported'])});
 const rows=buildContentCampaignBrief(input);
 assert.equal(rows[0].value.length,200);
 assert.equal(rows[1].value,'y');
 assert.equal(rows[2].value,'tiktok');
 assert.equal(input.product_service.length,300);
 assert.ok(Object.isFrozen(rows));
});
