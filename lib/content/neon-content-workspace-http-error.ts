/** User-facing, sanitized workspace read errors; never expose server payloads. */
export function contentWorkspaceReadError(status:number):string {
 if(status===401)return 'Sesi tamat. Sila log masuk semula.';
 if(status===403||status===404)return 'Workspace tidak ditemui atau akses tidak dibenarkan.';
 if(status===503)return 'Data workspace terlalu besar atau belum lengkap. Tiada kandungan disembunyikan; cuba lagi kemudian.';
 return 'Data kempen belum dapat dibaca. Cuba semula.';
}
