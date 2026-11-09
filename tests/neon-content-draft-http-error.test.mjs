import test from 'node:test';
import assert from 'node:assert/strict';
import {contentDraftSaveHttpError} from '../lib/content/neon-content-draft-http-error.ts';
const cases=[
 [401,'Sesi tamat. Sila log masuk semula.'],
 [403,'Akses workspace tidak dibenarkan.'],
 [404,'Akses workspace tidak dibenarkan.'],
 [409,'Draf ini bercanggah dengan cubaan terdahulu. Semak semula kandungan sebelum cuba lagi.'],
 [400,'Butiran draf tidak sah. Semak maklumat yang dimasukkan.'],
 [422,'Butiran draf tidak sah. Semak maklumat yang dimasukkan.'],
 [429,'Terlalu banyak permintaan. Tunggu sebentar sebelum cuba lagi.']
];
for(const [status,message] of cases){
 test('draft POST HTTP '+status+' produces actionable Malay failure feedback',()=>{
  assert.equal(contentDraftSaveHttpError(status),message);
 });
}
for(const status of [408,412,423,500,502,503,504]){
 test('draft POST HTTP '+status+' fails with neutral retry message',()=>{
  assert.equal(contentDraftSaveHttpError(status),'Draf tidak dapat disimpan. Sila cuba lagi.');
 });
}
