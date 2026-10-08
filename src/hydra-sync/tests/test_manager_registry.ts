import Database from 'better-sqlite3';
import {
  initManagerRegistrySchema,
  getAllStoreManagers,
  resolveStoreAndManager,
  getEffectiveRecipientPhone,
  checkNotificationIdempotency,
  recordManagerNotification,
  TEST_OVERRIDE_PHONE
} from '../manager_registry.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`[FAIL] ${msg}`);
    failed++;
  } else {
    console.log(`[PASS] ${msg}`);
    passed++;
  }
}

async function run() {
  console.log('Iniciando Suite E2: Catalogo de Gerentes, Idempotencia e Trava de Teste');

  const db = new Database(':memory:');
  initManagerRegistrySchema(db);

  // 1. Validacao do catalogo completo de 10 lojas
  const managers = getAllStoreManagers(db);
  assert(managers.length === 10, `Deve conter exatamente 10 gerentes cadastrados (encontrado: ${managers.length})`);

  // 2. Mapeamento de numeros dos gerentes
  const jorge = managers.find(m => m.loja_slug === 'MPJorgeBeretta');
  assert(jorge?.phone_canonical === '5511998874158', 'Telefone do gerente Jorge Beretta deve ser 5511998874158');

  const kennedy = managers.find(m => m.loja_slug === 'MPkennedy');
  assert(kennedy?.phone_canonical === '5511984926600', 'Telefone do gerente Kennedy deve ser 5511984926600');

  const dompedro = managers.find(m => m.loja_slug === 'MPdompedro1');
  assert(dompedro?.phone_canonical === '5511963717410', 'Telefone do gerente Dom Pedro I deve ser 5511963717410');

  const jabaquara = managers.find(m => m.loja_slug === 'MPJabaquara');
  assert(jabaquara?.phone_canonical === '5511933733131', 'Telefone do gerente Jabaquara deve ser 5511933733131');

  const maua = managers.find(m => m.loja_slug === 'ReiDoOleoMaua');
  assert(maua?.phone_canonical === '5511984324928', 'Telefone do gerente Maua deve ser 5511984324928');

  // 3. Resolucao inteligente/fuzzy de lojas
  const r1 = resolveStoreAndManager(db, 'jorge beretta');
  assert(r1.success === true && r1.manager?.loja_slug === 'MPJorgeBeretta', 'Resolve "jorge beretta" para MPJorgeBeretta');

  const r2 = resolveStoreAndManager(db, 'beretta');
  assert(r2.success === true && r2.manager?.loja_slug === 'MPJorgeBeretta', 'Resolve alias "beretta" para MPJorgeBeretta');

  const r3 = resolveStoreAndManager(db, 'maua');
  assert(r3.success === true && r3.manager?.loja_slug === 'ReiDoOleoMaua', 'Resolve "maua" para ReiDoOleoMaua');

  const r4 = resolveStoreAndManager(db, 'Loja Inexistente 999');
  assert(r4.success === false && Boolean(r4.availableStores?.length), 'Rejeita loja inexistente e lista lojas disponiveis');

  // 4. Trava de Seguranca: desvio obrigatorio para 5511996242812 em testes
  process.env.MCP_FORCE_RECIPIENT = '5511996242812';
  const effTest = getEffectiveRecipientPhone('5511998874158');
  assert(effTest.phone === TEST_OVERRIDE_PHONE, 'Com MCP_FORCE_RECIPIENT deve desviar para 5511996242812');
  assert(effTest.isTestOverride === true, 'Deve indicar isTestOverride = true');
  delete process.env.MCP_FORCE_RECIPIENT;

  // 5. Teste de Idempotencia por id_externo
  const idExt = 'lead_test_agendado_999';
  const idempAntes = checkNotificationIdempotency(db, idExt, 'LEAD_SCHEDULED');
  assert(idempAntes.isDuplicate === false, 'Antes do disparo nao deve ser duplicado');

  recordManagerNotification(db, {
    id: 'notif_001',
    id_externo: idExt,
    tipo: 'LEAD_SCHEDULED',
    loja_slug: 'MPJorgeBeretta',
    gerente_phone: '5511998874158',
    cliente_nome: 'Carlos Silva',
    cliente_phone: '5511988887777',
    data_agendamento: '08/10/2026',
    horario_agendamento: '14:30',
    instancia_emissora: 'atendimento',
    payload_json: '{}',
    mensagem_texto: 'Mensagem teste',
    status: 'SENT'
  });

  const idempDepois = checkNotificationIdempotency(db, idExt, 'LEAD_SCHEDULED');
  assert(idempDepois.isDuplicate === true && idempDepois.existingId === 'notif_001', 'Apos gravar, deve identificar duplicata com existingId');

  db.close();

  console.log(`\n========================================`);
  console.log(`Resultado E2: ${passed} PASS, ${failed} FAIL`);
  console.log(`========================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Erro fatal no teste E2:', err);
  process.exit(1);
});