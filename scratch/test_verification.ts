import { getDatabaseConnection, getOSDetails, getStoreDrilldown, getHighestValueOS } from '../src/hydra-sync/db_repository.js';
import { executeManagerTool } from '../src/hydra-sync/manager_store_access.js';

const db = getDatabaseConnection();

console.log('--- TESTE 1: OS #1132 DETAILS ---');
const os1132 = getOSDetails(db, { os_id: '1132', loja_slug: 'MPJorgeBeretta' });
console.log('OS 1132 Veículo:', os1132?.veiculo, os1132?.placa);
console.log('OS 1132 Total:', os1132?.valorTotal);
console.log('OS 1132 ChecklistAudit:', JSON.stringify(os1132?.checklistAudit, null, 2));
console.log('OS 1132 Checklists:', JSON.stringify(os1132?.checklists, null, 2));

console.log('\n--- TESTE 2: DRILLDOWN MPJorgeBeretta ---');
const drill = getStoreDrilldown(db, 'MPJorgeBeretta');
console.log('Total Veículos Pátio:', drill.total_veiculos_patio);
console.log('Pendências Baixa ERP:', drill.pendencias_baixa_erp);
console.log('Veículos Ativos no Pátio:', drill.veiculos_ativos?.length);
drill.veiculos_ativos?.forEach(v => {
  console.log(` - ${v.veiculo} (${v.placa}) | OS #${v.os_id} | R$ ${v.total_os} | Dias: ${v.dias_no_patio}`);
});

console.log('\n--- TESTE 3: HIGHEST VALUE OS (FILTRADO) ---');
const high = getHighestValueOS(db, { loja_slug: 'MPJorgeBeretta', limit: 10 });
console.log('Ordens retornadas para MPJorgeBeretta:', high.length);
high.forEach(h => {
  console.log(` - OS #${h.os_id}: ${h.veiculo} (${h.placa}) — R$ ${h.total_os}`);
});

console.log('\n--- TESTE 4: EXECUTE MANAGER TOOL (FORMATADO) ---');
const cardResult = executeManagerTool(db, 'get_os_details', { os_id: '1132' }, 'MPJorgeBeretta');
console.log('RESPOSTA FORMATADA DO BOT:\n');
console.log(cardResult.replyText);
