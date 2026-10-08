const Database = require("/opt/bots/node_modules/better-sqlite3");
const db = new Database("/home/operacional/hydra-data/hydra_ops.db", { readonly: true });

console.log("=== HYDRA ANALYSIS REPORTS ===");
const rows = db.prepare("SELECT id, resposta_raw, created_at FROM whatsapp_delivery_logs WHERE resposta_raw LIKE '%HYDRA%' ORDER BY id DESC LIMIT 5").all();
for (const r of rows) {
  console.log(`\n================== ID #${r.id} (${r.created_at}) ==================`);
  try {
    const parsed = JSON.parse(r.resposta_raw);
    console.log(parsed?.message?.conversation || parsed?.conversation || r.resposta_raw);
  } catch {
    console.log(r.resposta_raw);
  }
}
