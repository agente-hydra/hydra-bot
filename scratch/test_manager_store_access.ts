import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { executeManagerStoreQuery, isOutsideManagerStore } from '../manager_store_access.js';

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE metas_diarias (
    id INTEGER PRIMARY KEY,
    loja_slug TEXT,
    data_referencia TEXT,
    posicao_hora TEXT,
    faturamento_mes REAL,
    volume_os INTEGER,
    ticket_medio REAL,
    meta_mes REAL,
    percentual_meta REAL
  );

  CREATE TABLE cmv_lojas (
    id INTEGER PRIMARY KEY,
    loja_slug TEXT,
    data_inicio TEXT,
    data_fim TEXT,
    cmv_percentual REAL,
    faturamento_total REAL,
    custo_total REAL
  );

  CREATE TABLE faturamento_areas (
    id INTEGER PRIMARY KEY,
    loja_slug TEXT,
    area TEXT,
    data_inicio TEXT,
    data_fim TEXT,
    cmv_percentual REAL,
    faturamento REAL,
    custo REAL
  );

  CREATE TABLE ordens_servico (
    os_id TEXT,
    loja_slug TEXT,
    placa TEXT,
    veiculo TEXT,
    status_grid TEXT,
    is_aberta INTEGER,
    total_os REAL,
    valor_restante REAL,
    dias_no_patio INTEGER
  );

  -- Dados da loja ativa (Dom Pedro I)
  INSERT INTO metas_diarias VALUES (1, 'MPdompedro1', '2026-09-30', '11:31', 100, 2, 50, 200, 50);
  INSERT INTO cmv_lojas VALUES (1, 'MPdompedro1', '2026-09-01', '2026-09-30', 20, 100, 20);
  INSERT INTO faturamento_areas VALUES (1, 'MPdompedro1', 'OLEO', '2026-09-01', '2026-09-30', 21, 50, 10);
  INSERT INTO faturamento_areas VALUES (3, 'MPdompedro1', 'MECANICA', '2026-09-01', '2026-09-30', 25, 50, 12);
  INSERT INTO ordens_servico VALUES ('101', 'MPdompedro1', 'AAA1111', 'Carro local', 'Aberta', 1, 100, 3000, 6);

  -- DADOS SENTINELA DA LOJA EXTERNA (Kennedy) - Devem permanecer 100% inacessíveis
  INSERT INTO metas_diarias VALUES (2, 'MPkennedy', '2026-09-30', '11:31', 999999, 4, 249999, 1000000, 99);
  INSERT INTO cmv_lojas VALUES (2, 'MPkennedy', '2026-09-01', '2026-09-30', 99, 999999, 999998);
  INSERT INTO faturamento_areas VALUES (2, 'MPkennedy', 'OLEO', '2026-09-01', '2026-09-30', 98, 999999, 999998);
  INSERT INTO ordens_servico VALUES ('202', 'MPkennedy', 'BBB2222', 'SEGREDO_EXTERNO', 'Aberta', 1, 999999, 999999, 9);
`);

const local = 'MPdompedro1';
const EXPECTED_DENIAL = 'No perfil de gerente, só posso consultar dados da sua loja. Use /perfil para conferir a unidade ativa.';

console.log('--- 1. TESTE DA BARREIRA LÉXICA (isOutsideManagerStore) ---');
const networkQueries = [
  'faturamento da rede',
  'faturamento das lojas',
  'faturamento das unidades',
  'faturamento das filiais',
  'faturamento de todas',
  'como estão todos',
  'ranking de faturamento',
  'faturamento geral',
  'dados gerais',
  'faturamento consolidado',
  'resultado consolidado',
  'receita consolidada',
  'resultados consolidados',
  'dados consolidados',
  'qual a pior loja',
  'quais as piores lojas',
  'qual a melhor loja',
  'comparativo entre lojas',
  'faturamento da Kennedy',
  'como tá Jabaquara',
  'como tá Beretta',
  'como tá Mauá',
  'como tá o Rei do Óleo',
  'como tá Piraporinha',
  'como tá Planalto',
  'como tá o Rei do Módulo',
  'como tá Rudge Ramos',
  'como tá Santo André',
  'como tá a Master',
  'OS de Kennedy.'
];

for (const text of networkQueries) {
  assert.equal(isOutsideManagerStore(text, local), true, `Deveria ser fora de escopo: "${text}"`);
  const result = executeManagerStoreQuery(db, text, { intent: 'financial_alerts' } as any, local);
  assert.equal(result.allowed, false, `Consulta não deveria ser permitida: "${text}"`);
  assert.equal(result.replyText, EXPECTED_DENIAL, `Mensagem de recusa incorreta para: "${text}"`);
  assert.equal(result.toolsCalled[0], 'manager_scope_denied');
}
console.log(`[PASS] ${networkQueries.length} consultas externas bloqueadas lexicalmente.`);

console.log('--- 2. TESTE DE CONSULTAS PERMITIDAS DA PRÓPRIA LOJA ---');
const permittedQueries = [
  'faturamento da minha loja',
  'faturamento da Dom Pedro',
  'como estamos de faturamento?',
  'como estamos de meta?',
  'CMV de óleo da minha loja',
  'quais OS estão abertas?',
  'veículos retidos no pátio',
  'OS 101'
];

for (const text of permittedQueries) {
  assert.equal(isOutsideManagerStore(text, local), false, `Deveria ser dentro de escopo: "${text}"`);
}
console.log(`[PASS] ${permittedQueries.length} consultas da própria loja liberadas pela barreira.`);

console.log('--- 3. TESTE DE EXECUÇÃO SQL E DADOS SENTINELA ---');
// 3.1. Faturamento da loja
const fatRes = executeManagerStoreQuery(db, 'faturamento da minha loja', { intent: 'financial_alerts' } as any, local);
assert.equal(fatRes.allowed, true);
assert.match(fatRes.replyText, /R\$\s*100,00/);
assert.doesNotMatch(fatRes.replyText, /999999|Kennedy|SEGREDO_EXTERNO/);

// 3.2. Saldos pendentes (noDeposit)
const alertRes = executeManagerStoreQuery(db, 'alertas de saldo', { intent: 'financial_alerts', noDeposit: true } as any, local);
assert.equal(alertRes.allowed, true);
assert.match(alertRes.replyText, /OS #101/);
assert.match(alertRes.replyText, /R\$\s*3\.000,00/);
assert.doesNotMatch(alertRes.replyText, /202|999999|Kennedy|SEGREDO_EXTERNO/);

// 3.3. CMV de área específica
const cmvAreaRes = executeManagerStoreQuery(db, 'CMV de óleo da minha loja', { intent: 'store_cmv', targetArea: 'OLEO' } as any, local);
assert.equal(cmvAreaRes.allowed, true);
assert.match(cmvAreaRes.replyText, /21,00%/);
assert.doesNotMatch(cmvAreaRes.replyText, /98,00%|999999|Kennedy/);

// 3.4. CMV total da loja
const cmvTotalRes = executeManagerStoreQuery(db, 'CMV da loja', { intent: 'store_cmv' } as any, local);
assert.equal(cmvTotalRes.allowed, true);
assert.match(cmvTotalRes.replyText, /20,00%/);
assert.doesNotMatch(cmvTotalRes.replyText, /99,00%|999999|Kennedy/);

// 3.5. Áreas da loja
const areasRes = executeManagerStoreQuery(db, 'áreas da loja', { intent: 'store_areas' } as any, local);
assert.equal(areasRes.allowed, true);
assert.match(areasRes.replyText, /OLEO/);
assert.match(areasRes.replyText, /MECANICA/);
assert.doesNotMatch(areasRes.replyText, /999999|Kennedy/);

// 3.6. Listagem de OS
const osRes = executeManagerStoreQuery(db, 'OS abertas', { intent: 'list_os' } as any, local);
assert.equal(osRes.allowed, true);
assert.match(osRes.replyText, /Carro local/);
assert.match(osRes.replyText, /OS #101/);
assert.doesNotMatch(osRes.replyText, /SEGREDO_EXTERNO|202|999999|Kennedy/);

// 3.7. Detalhe de OS local
const osDetailRes = executeManagerStoreQuery(db, 'OS 101', { intent: 'os_detail', osId: '101' } as any, local);
assert.equal(osDetailRes.allowed, true);
assert.match(osDetailRes.replyText, /Carro local/);
assert.doesNotMatch(osDetailRes.replyText, /SEGREDO_EXTERNO|202|Kennedy/);

// 3.8. Tentativa de acessar OS 202 (pertencente à Kennedy)
const osForeignRes = executeManagerStoreQuery(db, 'OS 202', { intent: 'os_detail', osId: '202' } as any, local);
assert.equal(osForeignRes.allowed, true);
assert.match(osForeignRes.replyText, /Nenhuma OS encontrada nesta loja/);
assert.doesNotMatch(osForeignRes.replyText, /SEGREDO_EXTERNO|Kennedy|999999|BBB2222/);

// 3.9. Veículos retidos no pátio (aging_cars)
const agingRes = executeManagerStoreQuery(db, 'carros retidos', { intent: 'aging_cars' } as any, local);
assert.equal(agingRes.allowed, true);
assert.match(agingRes.replyText, /Carro local/);
assert.doesNotMatch(agingRes.replyText, /SEGREDO_EXTERNO|202|Kennedy/);
console.log('[PASS] Execução de todas as 7 intenções permitidas com isolamento total dos sentinelas.');

console.log('--- 4. TESTE DE INTENÇÕES NÃO SUPORTADAS E RECUSA PADRÃO ---');
const disallowedIntents = [
  'network_cmv',
  'media_survey',
  'checklist_audit',
  'worst_store',
  'ranking',
  'store_list',
  'arbitrary_unknown'
];

for (const badIntent of disallowedIntents) {
  const res = executeManagerStoreQuery(db, 'consulta operacional', { intent: badIntent } as any, local);
  assert.equal(res.allowed, false, `Intenção ${badIntent} deveria ser recusada`);
  assert.equal(res.replyText, EXPECTED_DENIAL, `Recusa padrão esperada para ${badIntent}`);
}
console.log(`[PASS] ${disallowedIntents.length} intenções não suportadas recusadas com mensagem padrão.`);

console.log('--- 5. TESTE DE INJEÇÃO EM PLANOS E SUB-QUERIES ---');
// 5.1. subQueries apontando para outra loja
const subQAttack = executeManagerStoreQuery(
  db,
  'como estamos?',
  {
    intent: 'financial_alerts',
    subQueries: [
      { intent: 'financial_alerts', lojaSlug: 'MPdompedro1' },
      { intent: 'financial_alerts', lojaSlug: 'MPkennedy' }
    ]
  } as any,
  local
);
assert.equal(subQAttack.allowed, false);
assert.equal(subQAttack.replyText, EXPECTED_DENIAL);

// 5.2. contract.plan com targetLojaSlug externo
const contractAttack = executeManagerStoreQuery(
  db,
  'como estamos?',
  {
    intent: 'financial_alerts',
    contract: {
      plan: { targetLojaSlug: 'MPkennedy' }
    }
  } as any,
  local
);
assert.equal(contractAttack.allowed, false);
assert.equal(contractAttack.replyText, EXPECTED_DENIAL);

// 5.3. answerRequirements apontando para loja externa
const reqAttack = executeManagerStoreQuery(
  db,
  'como estamos?',
  {
    intent: 'financial_alerts',
    answerRequirements: [{ targetLojaSlug: 'MPkennedy' }]
  } as any,
  local
);
assert.equal(reqAttack.allowed, false);
assert.equal(reqAttack.replyText, EXPECTED_DENIAL);

// 5.4. subIntent worst_store ou store_list
const worstAttack = executeManagerStoreQuery(
  db,
  'como estamos?',
  {
    intent: 'financial_alerts',
    subIntent: 'worst_store'
  } as any,
  local
);
assert.equal(worstAttack.allowed, false);
assert.equal(worstAttack.replyText, EXPECTED_DENIAL);

// 5.5. scope network
const scopeAttack = executeManagerStoreQuery(
  db,
  'como estamos?',
  {
    intent: 'financial_alerts',
    scope: 'network'
  } as any,
  local
);
assert.equal(scopeAttack.allowed, false);
assert.equal(scopeAttack.replyText, EXPECTED_DENIAL);

console.log('[PASS] Bloqueio determinístico de todos os 5 cenários de injeção e sub-queries externas.');
console.log('TODOS OS TESTES DE ISOLAMENTO DE GERENTE: PASSOU COM SUCESSO (100%).');
