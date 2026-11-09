/** Human-readable draft-save failures; never interpret an unsuccessful POST as persisted. */
export function contentDraftSaveHttpError(status:number):string {
 switch(status){
  case 401:return 'Sesi tamat. Sila log masuk semula.';
  case 403:case 404:return 'Akses workspace tidak dibenarkan.';
  case 409:return 'Draf ini bercanggah dengan cubaan terdahulu. Semak semula kandungan sebelum cuba lagi.';
  case 400:case 422:return 'Butiran draf tidak sah. Semak maklumat yang dimasukkan.';
  case 429:return 'Terlalu banyak permintaan. Tunggu sebentar sebelum cuba lagi.';
  default:return 'Draf tidak dapat disimpan. Sila cuba lagi.';
 }
}
