import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import {
  ensureTurnContextTable,
  getLatestTurnState,
  saveTurnState,
  resolveTurnContinuity,
  purgeNetworkCacheOnRoleSwitch,
  clearTurnState
} from '../turn_context_repository.js';

import {
  getOSDetailComplete,
  type OSDetailComplete
} from '../db_repository.js';

import {
  buildCandidateResponse,
  executeAuthorizedStoreTool,
  handleConsultarDecision,
  type ConsultedDataRecord
} from '../operational_adapter.js';

import {
  getLatestDailyRevenue,
  getLatestMetasSnapshot,
  getLatestCMVSnapshot
} from '../finance_snapshot_repository.js';

console.log('===============================================================================');
console.log('🧪 SUÍTE DE TESTES: FRENTE 2 (CONTINUIDADE, RESPOSTA CANDIDATA E FERRAMENTAS)');
console.log('===============================================================================');

// ─── 0. Setup do Banco em Memória com Schemas Oficiais ────────────────────────
const db = new Database(':memory:');

db.exec(`
  CREATE TABLE IF NOT EXISTS hydra_turn_contexts (
    phone TEXT PRIMARY KEY,
    last_turn_id TEXT NOT NULL,
    last_intent TEXT NOT NULL,
    loja_slug TEXT,
    placa TEXT,
    os_id TEXT,
    filters_json TEXT,
    last_message_id INTEGER,
    last_response_text TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ordens_servico (
    os_id TEXT NOT NULL,
    loja_slug TEXT NOT NULL,
    tipo TEXT DEFAULT 'OS',
    status_grid TEXT,
    is_aberta INTEGER NOT NULL DEFAULT 1,
    data_inicio TEXT,
    data_fim TEXT,
    dias_no_patio INTEGER DEFAULT 0,
    veiculo TEXT,
    placa TEXT,
    cliente_nome TEXT,
    responsavel TEXT,
    total_os REAL DEFAULT 0,
    valor_pago REAL DEFAULT 0,
    valor_restante REAL DEFAULT 0,
    tem_nf INTEGER DEFAULT 0,
    raw_payload TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (os_id, loja_slug)
  );

  CREATE TABLE IF NOT EXISTS faturamento_diario_horario (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    loja_slug TEXT NOT NULL,
    data_referencia TEXT NOT NULL,
    posicao_hora TEXT NOT NULL,
    faturamento_dia REAL NOT NULL,
    volume_os_dia INTEGER NOT NULL,
    captured_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS metas_horarias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    loja_slug TEXT NOT NULL,
    data_referencia TEXT NOT NULL,
    posicao_hora TEXT NOT NULL,
    faturamento_mes REAL NOT NULL,
    volume_os INTEGER NOT NULL,
    ticket_medio REAL NOT NULL,
    meta_mes REAL,
    previsao_mes REAL,
    percentual_meta REAL,
    captured_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS cmv_lojas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    loja_slug TEXT NOT NULL,
    data_inicio TEXT NOT NULL,
    data_fim TEXT NOT NULL,
    faturamento_total REAL NOT NULL,
    desconto_total REAL NOT NULL DEFAULT 0,
    custo_total REAL NOT NULL,
    cmv_percentual REAL NOT NULL,
    lucro_bruto REAL NOT NULL,
    lucro_bruto_percentual REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    captured_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS faturamento_areas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    loja_slug TEXT NOT NULL,
    area TEXT NOT NULL,
    data_inicio TEXT NOT NULL,
    data_fim TEXT NOT NULL,
    faturamento REAL NOT NULL,
    faturamento_percentual REAL NOT NULL DEFAULT 0,
    desconto REAL NOT NULL DEFAULT 0,
    custo REAL NOT NULL,
    cmv_percentual REAL NOT NULL,
    lucro_bruto REAL NOT NULL,
    lucro_bruto_percentual REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    captured_at TEXT NOT NULL
  );
`);

// Inserção de Dados Fictícios Oficiais para Testes
const payloadOS1128 = {
  id: '1128',
  tipo: 'OS',
  status_grid: 'EM_ANDAMENTO',
  data_inicio: '2026-09-25 08:30',
  data_fim: '2026-09-30 18:00',
  previsao: '2026-09-30 18:00',
  veiculo: 'Honda Civic 2021',
  placa: 'BRA2E19',
  cliente_nome: 'Roberto Firmino',
  responsavel: 'Carlos Eduardo',
  total_os: 3850,
  valor_pago: 1500,
  valor_restante: 2350,
  servicos: [
    { codigo: 'SRV-01', descricao: 'Troca de Correia Dentada', mecanico: 'Carlos Eduardo', qtd: 1, valor_total: 1200 },
    { codigo: 'SRV-02', descricao: 'Alinhamento e Balanceamento 3D', mecanico: 'Marcos Silva', qtd: 1, valor_total: 250 }
  ],
  pecas: [
    { codigo: 'PC-10', referencia: 'CT-909', descricao: 'Kit Correia Dentada Continental', qtd: 1, valor_total: 1800 },
    { codigo: 'PC-20', referencia: '5W30-SN', descricao: 'Óleo Sintético 5W30', qtd: 4, valor_total: 600 }
  ],
  checklists: [
    { codigo: 'CHK-01', tipo: 'Check-List de Inspeção de Entrada', status: 'Concluído', realizado_por: 'Lucas Santos', data: '2026-09-25 08:35' },
    { codigo: 'CHK-02', tipo: 'MECANICO', status: 'Concluído', realizado_por: 'Carlos Eduardo', data: '2026-09-25 10:15' }
  ]
};

const payloadOS2040 = {
  id: '2040',
  tipo: 'OS',
  status_grid: 'AGUARDANDO_PECAS',
  data_inicio: '2026-09-28 09:00',
  data_fim: '2026-10-02 17:00',
  veiculo: 'Toyota Corolla 2022',
  placa: 'XYZ9876',
  cliente_nome: 'Fernanda Lima',
  total_os: 4200,
  valor_pago: 0,
  valor_restante: 4200,
  itens: [
    { codigo: 'ITM-1', descricao: 'Revisão de Suspensão', executor: 'Marcos Silva', qtd: 1, valor_total: 800 },
    { codigo: 'ITM-2', descricao: 'Amortecedor Dianteiro Par', referencia: 'MON-441', qtd: 2, valor_total: 3400 }
  ],
  checklists: [
    { codigo: 'CHK-10', tipo: 'Check-List de Inspeção de Entrada', status: 'Concluído', realizado_por: 'Lucas Santos' }
    // Sem checklist de mecânico pendente
  ]
};

// Inserir OSs no banco
db.prepare(`
  INSERT INTO ordens_servico (os_id, loja_slug, tipo, status_grid, is_aberta, data_inicio, data_fim, dias_no_patio, veiculo, placa, cliente_nome, responsavel, total_os, valor_pago, valor_restante, tem_nf, raw_payload)
  VALUES ('1128', 'MPdompedro1', 'OS', 'EM_ANDAMENTO', 1, '2026-09-25 08:30', '2026-09-30 18:00', 5, 'Honda Civic 2021', 'BRA2E19', 'Roberto Firmino', 'Carlos Eduardo', 3850, 1500, 2350, 0, ?)
`).run(JSON.stringify(payloadOS1128));

db.prepare(`
  INSERT INTO ordens_servico (os_id, loja_slug, tipo, status_grid, is_aberta, data_inicio, data_fim, dias_no_patio, veiculo, placa, cliente_nome, responsavel, total_os, valor_pago, valor_restante, tem_nf, raw_payload)
  VALUES ('2040', 'MPdompedro1', 'OS', 'AGUARDANDO_PECAS', 1, '2026-09-28 09:00', '2026-10-02 17:00', 2, 'Toyota Corolla 2022', 'XYZ9876', 'Fernanda Lima', 'Marcos Silva', 4200, 0, 4200, 0, ?)
`).run(JSON.stringify(payloadOS2040));

// OS de outra loja (Santo André) para teste de isolamento de escopo
db.prepare(`
  INSERT INTO ordens_servico (os_id, loja_slug, tipo, status_grid, is_aberta, total_os, valor_restante, veiculo, placa)
  VALUES ('9999', 'MPSantoAndre', 'OS', 'ABERTA', 1, 9900, 9900, 'Carro Sigiloso Santo Andre', 'SEC0001')
`).run();

// Snapshots Financeiros
db.prepare(`
  INSERT INTO faturamento_diario_horario (loja_slug, data_referencia, posicao_hora, faturamento_dia, volume_os_dia, captured_at)
  VALUES ('MPdompedro1', '2026-09-30', '14:00', 18500, 14, '2026-09-30T14:00:00Z'),
         ('MPSantoAndre', '2026-09-30', '14:00', 22000, 18, '2026-09-30T14:00:00Z')
`).run();

db.prepare(`
  INSERT INTO metas_horarias (loja_slug, data_referencia, posicao_hora, faturamento_mes, volume_os, ticket_medio, meta_mes, previsao_mes, percentual_meta, captured_at)
  VALUES ('MPdompedro1', '2026-09-30', '14:00', 145000, 112, 1294.64, 200000, 190000, 72.5, '2026-09-30T14:00:00Z'),
         ('MPSantoAndre', '2026-09-30', '14:00', 210000, 160, 1312.50, 250000, 260000, 84.0, '2026-09-30T14:00:00Z')
`).run();

db.prepare(`
  INSERT INTO cmv_lojas (loja_slug, data_inicio, data_fim, faturamento_total, desconto_total, custo_total, cmv_percentual, lucro_bruto, lucro_bruto_percentual, captured_at)
  VALUES ('MPdompedro1', '2026-09-01', '2026-09-30', 145000, 2000, 52925, 36.5, 92075, 63.5, '2026-09-30T14:00:00Z'),
         ('MPSantoAndre', '2026-09-01', '2026-09-30', 210000, 3500, 77700, 37.0, 132300, 63.0, '2026-09-30T14:00:00Z')
`).run();

db.prepare(`
  INSERT INTO faturamento_areas (loja_slug, area, data_inicio, data_fim, faturamento, faturamento_percentual, custo, cmv_percentual, lucro_bruto, lucro_bruto_percentual, captured_at)
  VALUES ('MPdompedro1', 'OLEO', '2026-09-01', '2026-09-30', 42000, 28.9, 11970, 28.5, 30030, 71.5, '2026-09-30T14:00:00Z'),
         ('MPSantoAndre', 'OLEO', '2026-09-01', '2026-09-30', 65000, 30.9, 19500, 30.0, 45500, 70.0, '2026-09-30T14:00:00Z')
`).run();

// ─────────────────────────────────────────────────────────────────────────────
// BLOCO 1: CONTINUIDADE CONTEXTUAL E HERANÇA DE ENTIDADES (os_id, loja_slug)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- 1. Continuidade Contextual e Herança de Entidades ---');

const testPhone = '5511999990001';
clearTurnState(db, testPhone);

// 1.1 Turno 1: Foco na OS 1128 em Dom Pedro I
saveTurnState(db, {
  phone: testPhone,
  lastTurnId: 'turn_1',
  lastIntent: 'os_detail',
  lojaSlug: 'MPdompedro1',
  osId: '1128',
  placa: 'BRA2E19',
  filters: { isOSSpecific: true },
  updatedAt: new Date().toISOString()
});

const state1 = getLatestTurnState(db, testPhone, 120);
assert(state1 !== null, 'Turno 1 recuperado com sucesso');
assert.equal(state1?.osId, '1128', 'Turno 1 gravou os_id 1128');
assert.equal(state1?.placa, 'BRA2E19', 'Turno 1 gravou placa BRA2E19');
assert.equal(state1?.lojaSlug, 'MPdompedro1', 'Turno 1 gravou loja MPdompedro1');
console.log('  ✅ [PASS] 1.1: saveTurnState gravou os_id, placa e loja_slug');

// 1.2 Turno 2: Anáfora "Quero os detalhes" e "E o que falta nela?"
const cont1 = resolveTurnContinuity('Quero os detalhes', state1);
assert.equal(cont1.isContinuation, true, 'Reconhece "Quero os detalhes" como continuação');
assert.equal(cont1.osId, '1128', 'Herda os_id 1128 por anáfora');
assert.equal(cont1.lojaSlug, 'MPdompedro1', 'Herda loja_slug MPdompedro1');

const cont2 = resolveTurnContinuity('E o que falta nela?', state1);
assert.equal(cont2.isContinuation, true, 'Reconhece "E o que falta nela?" como continuação');
assert.equal(cont2.osId, '1128', 'Herda os_id 1128');
console.log('  ✅ [PASS] 1.2: resolveTurnContinuity resolve anáforas contextuais ("Quero os detalhes", "E o que falta nela?")');

// 1.3 Turno 3: Regra de Descarte Inteligente ao Mudar de Assunto ("qual o faturamento do mês?")
const contShift = resolveTurnContinuity('qual o faturamento do mês?', state1);
assert.equal(contShift.isTopicShift, true, 'Identifica mudança de assunto para faturamento');
assert.equal(contShift.isContinuation, false, 'Não considera continuação de OS');
assert.equal(contShift.osId, undefined, 'Não herda os_id ao mudar para faturamento');
assert.equal(contShift.lojaSlug, 'MPdompedro1', 'Preserva loja_slug na transição');

// Persiste o turno de faturamento
saveTurnState(db, {
  phone: testPhone,
  lastTurnId: 'turn_3',
  lastIntent: 'financial_alerts',
  lojaSlug: 'MPdompedro1',
  filters: {},
  updatedAt: new Date().toISOString()
});

const state3 = getLatestTurnState(db, testPhone, 120);
assert.equal(state3?.osId, undefined, 'Regra de descarte inteligente: os_id foi limpo');
assert.equal(state3?.placa, undefined, 'Placa foi limpa');
assert.equal(state3?.lojaSlug, 'MPdompedro1', 'Loja_slug MPdompedro1 foi mantido intacto');
console.log('  ✅ [PASS] 1.3: Regra de descarte inteligente: limpa os_id sem resetar loja_slug');

// 1.4 Turno 4: Expurgar Cache de Rede ao Alternar Sócio -> Gerente
const socioPhone = '5511999990002';
clearTurnState(db, socioPhone);

// Sócio com filtros de rede/ranking
saveTurnState(db, {
  phone: socioPhone,
  lastTurnId: 'socio_turn',
  lastIntent: 'store_overview',
  filters: { scope: 'network', ranking: true, networkData: { total: 1000000 } },
  updatedAt: new Date().toISOString()
});

// Alterna para Gerente da Dom Pedro I
purgeNetworkCacheOnRoleSwitch(db, socioPhone, 'MPdompedro1');
const stateGerente = getLatestTurnState(db, socioPhone, 120);
assert.equal(stateGerente?.lojaSlug, 'MPdompedro1', 'Contexto travado na unidade do gerente');
assert.equal(stateGerente?.filters.scope, 'store', 'Escopo alterado de network para store');
assert.equal(stateGerente?.filters.ranking, undefined, 'Cache de ranking de rede expurgado');
assert.equal(stateGerente?.filters.networkData, undefined, 'Cache de dados consolidados da rede expurgado');
console.log('  ✅ [PASS] 1.4: purgeNetworkCacheOnRoleSwitch expurga dados de rede e trava contexto na loja');

// ─────────────────────────────────────────────────────────────────────────────
// BLOCO 2: FICHA COMPLETA DE OS (getOSDetailComplete)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- 2. Ficha Completa de OS (getOSDetailComplete) ---');

const os1128Detail = getOSDetailComplete(db, 'MPdompedro1', '1128');
assert(os1128Detail !== null, 'OS 1128 encontrada com sucesso');
assert.equal(os1128Detail?.osId, '1128');
assert.equal(os1128Detail?.lojaSlug, 'MPdompedro1');
assert.equal(os1128Detail?.situacao, 'EM_ANDAMENTO');
assert.equal(os1128Detail?.dataAbertura, '2026-09-25 08:30');
assert.equal(os1128Detail?.dataPromessa, '2026-09-30 18:00');
assert.equal(os1128Detail?.valorTotal, 3850);
assert.equal(os1128Detail?.valorPago, 1500);
assert.equal(os1128Detail?.saldoDevedor, 2350);
assert.equal(os1128Detail?.veiculo, 'Honda Civic 2021');
assert.equal(os1128Detail?.placa, 'BRA2E19');
assert.equal(os1128Detail?.clienteNome, 'Roberto Firmino');

// Serviços com Mecânicos
assert.equal(os1128Detail?.servicos.length, 2, 'Contém 2 serviços');
assert.equal(os1128Detail?.servicos[0].descricao, 'Troca de Correia Dentada');
assert.equal(os1128Detail?.servicos[0].mecanico, 'Carlos Eduardo');
assert.equal(os1128Detail?.servicos[1].descricao, 'Alinhamento e Balanceamento 3D');
assert.equal(os1128Detail?.servicos[1].mecanico, 'Marcos Silva');

// Peças
assert.equal(os1128Detail?.pecas.length, 2, 'Contém 2 peças');
assert.equal(os1128Detail?.pecas[0].descricao, 'Kit Correia Dentada Continental');
assert.equal(os1128Detail?.pecas[0].qtd, 1);
assert.equal(os1128Detail?.pecas[1].descricao, 'Óleo Sintético 5W30');
assert.equal(os1128Detail?.pecas[1].qtd, 4);

// Auditoria de Checklists: Entrada + Mecânico
assert.equal(os1128Detail?.checklists.length, 2, 'Contém 2 checklists');
assert.equal(os1128Detail?.checklistAudit.temChecklistEntrada, true, 'Checklist de entrada realizado');
assert.equal(os1128Detail?.checklistAudit.temChecklistMecanico, true, 'Checklist do mecânico realizado');
assert.equal(os1128Detail?.checklistAudit.status, 'completo', 'Status de auditoria completo');
console.log('  ✅ [PASS] 2.1: getOSDetailComplete extraiu ficha completa com serviços, mecânicos, peças e checklists completos');

// Teste de Checklist Parcial (Pendente Mecânico) na OS 2040
const os2040Detail = getOSDetailComplete(db, 'MPdompedro1', '2040');
assert(os2040Detail !== null, 'OS 2040 encontrada com sucesso');
assert.equal(os2040Detail?.checklistAudit.temChecklistEntrada, true, 'Tem checklist de entrada');
assert.equal(os2040Detail?.checklistAudit.temChecklistMecanico, false, 'Pendente checklist do mecânico');
assert.equal(os2040Detail?.checklistAudit.status, 'pendente_mecanico', 'Auditoria indica pendência do mecânico');
console.log('  ✅ [PASS] 2.2: Auditoria detectou pendência de checklist do mecânico na OS 2040');

// Teste de isolamento de par (loja_slug, os_id): OS de outra loja não é vista
const osOutraLoja = getOSDetailComplete(db, 'MPdompedro1', '9999');
assert.equal(osOutraLoja, null, 'OS 9999 pertence a MPSantoAndre e não é retornada para MPdompedro1');
console.log('  ✅ [PASS] 2.3: getOSDetailComplete respeita estritamente o par (loja_slug, os_id)');

// ─────────────────────────────────────────────────────────────────────────────
// BLOCO 3: RESPOSTA CANDIDATA E EMPACOTAMENTO DE DADOS (buildCandidateResponse)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- 3. Resposta Candidata e Empacotamento (buildCandidateResponse) ---');

async function testCandidate() {
  const profileGerente = { persona: 'gerente', lojaSlug: 'MPdompedro1', lojaNome: 'Dom Pedro I' };

  // 3.1 Consulta de Vendas de Hoje
  const candHoje = await buildCandidateResponse(db, 'Quanto vendeu hoje na Dom Pedro?', null, profileGerente);
  assert(candHoje.replyText.includes('Vendas de Hoje'), 'Resposta candidata de vendas de hoje');
  assert(candHoje.replyText.includes('R$ 18.500,00') || candHoje.replyText.includes('18.500'), 'Valor das vendas de hoje presente');
  assert.equal(candHoje.dadosConsultados.length, 1, 'Empacotou exatamente 1 registro de dados');
  assert.equal(candHoje.dadosConsultados[0].fonte, 'faturamento_diario_horario', 'Fonte oficial de vendas do dia');
  assert(candHoje.dadosConsultados[0].periodo.includes('hoje'), 'Período indicado como hoje');
  assert.equal(candHoje.dadosConsultados[0].lojaSlug, 'MPdompedro1');
  console.log('  ✅ [PASS] 3.1: buildCandidateResponse para vendas de hoje com empacotamento oficial');

  // 3.2 Consulta de Metas e Acumulado do Mês
  const candMetas = await buildCandidateResponse(db, 'Como estão as metas do mês?', null, profileGerente);
  assert(candMetas.replyText.includes('Metas e Acumulado do Mês'), 'Título de metas');
  assert(candMetas.replyText.includes('72.5%') || candMetas.replyText.includes('72,5%'), 'Percentual de meta presente');
  assert.equal(candMetas.dadosConsultados[0].fonte, 'metas_horarias', 'Fonte oficial metas_horarias');
  assert(candMetas.dadosConsultados[0].periodo.includes('mês atual'), 'Período do mês atual');
  console.log('  ✅ [PASS] 3.2: buildCandidateResponse para metas com dadosConsultados devidamente tipados');

  // 3.3 Consulta de CMV Geral e Setorial
  const candCMV = await buildCandidateResponse(db, 'Qual o CMV e quanto deu o setor de óleo?', null, profileGerente);
  assert(candCMV.replyText.includes('CMV'), 'Título de CMV presente');
  assert(candCMV.replyText.includes('36.5') || candCMV.replyText.includes('36,5'), 'CMV geral de 36.5% presente');
  assert(candCMV.replyText.includes('28.5') || candCMV.replyText.includes('28,5'), 'CMV de óleo de 28.5% presente');
  assert.equal(candCMV.dadosConsultados[0].fonte, 'cmv_lojas', 'Fonte oficial cmv_lojas');
  console.log('  ✅ [PASS] 3.3: buildCandidateResponse para CMV geral e setorial de óleo');

  // 3.4 Continuidade de Turno com Detalhes da OS
  const turnContext = {
    phone: testPhone,
    lastTurnId: 'turn_prior',
    lastIntent: 'os_detail' as const,
    lojaSlug: 'MPdompedro1',
    osId: '1128',
    filters: {},
    updatedAt: new Date().toISOString()
  };

  const candCont = await buildCandidateResponse(db, 'Quero os detalhes', turnContext, profileGerente);
  assert(candCont.replyText.includes('Ficha da OS #1128'), 'Herança contextual: encontrou OS #1128');
  assert(candCont.replyText.includes('Troca de Correia Dentada'), 'Serviço detalhado presente');
  assert(candCont.replyText.includes('Carlos Eduardo'), 'Mecânico citado');
  assert.equal(candCont.dadosConsultados[0].fonte, 'ordens_servico', 'Fonte ordens_servico');
  assert.equal(candCont.osId, '1128', 'Identificador de OS herdado');
  console.log('  ✅ [PASS] 3.4: buildCandidateResponse com continuidade contextual herdou os_id e gerou ficha completa');

  // 3.5 Multi-Intenção ("OS e CMV da minha loja")
  const candMulti = await buildCandidateResponse(db, 'OS e CMV da minha loja', null, profileGerente);
  assert.equal(candMulti.isMultiIntent, true, 'Detectada multi-intenção');
  assert.equal(candMulti.dadosConsultados.length, 2, 'Empacotou 2 fontes de dados distintas (OS + CMV)');
  assert(candMulti.dadosConsultados.some(d => d.fonte === 'ordens_servico'), 'Contém fonte ordens_servico');
  assert(candMulti.dadosConsultados.some(d => d.fonte === 'cmv_lojas'), 'Contém fonte cmv_lojas');
  assert(candMulti.replyText.includes('Ordens de Serviço'), 'Seção de OS presente na resposta combinada');
  assert(candMulti.replyText.includes('CMV da Unidade'), 'Seção de CMV presente na resposta combinada');
  console.log('  ✅ [PASS] 3.5: Multi-intenção ("OS e CMV da minha loja") consolida ambas as fontes');
}

await testCandidate();

// ─────────────────────────────────────────────────────────────────────────────
// BLOCO 4: FERRAMENTAS AUTORIZADAS PÓS-REVISÃO (DECISÃO CONSULTAR)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- 4. Execução de Ferramentas Autorizadas pós-revisão (CONSULTAR) ---');

async function testAuthorizedTools() {
  const profileGerenteDomPedro = { persona: 'gerente', lojaSlug: 'MPdompedro1', lojaNome: 'Dom Pedro I' };

  // 4.1 get_os_details com trava na loja do gerente
  const toolOS = await executeAuthorizedStoreTool(db, {
    toolName: 'get_os_details',
    params: { osId: '1128' },
    profile: profileGerenteDomPedro
  });
  assert.equal(toolOS.allowed, true);
  assert.equal(toolOS.lojaSlug, 'MPdompedro1');
  assert(toolOS.replyText.includes('Ficha da OS #1128'));
  assert.equal(toolOS.data.osId, '1128');
  assert.equal(toolOS.dadosConsultados[0].fonte, 'ordens_servico');
  console.log('  ✅ [PASS] 4.1: executeAuthorizedStoreTool get_os_details executada com sucesso');

  // 4.2 Injeção Estrita: Tentativa de gerente acessar outra loja é bloqueada/forçada na sua loja
  const toolViolacao = await executeAuthorizedStoreTool(db, {
    toolName: 'get_os_details',
    params: { osId: '9999', lojaSlug: 'MPSantoAndre' }, // Tenta forçar Santo André
    profile: profileGerenteDomPedro
  });
  // O backend deve travar na loja do gerente (MPdompedro1)
  assert.equal(toolViolacao.lojaSlug, 'MPdompedro1', 'Backend forçou estritamente loja do gerente');
  assert.equal(toolViolacao.data, null, 'OS de outra loja retorna null');
  assert(toolViolacao.replyText.includes('não localizada na unidade Dom Pedro'), 'OS 9999 não é exposta');
  console.log('  ✅ [PASS] 4.2: Injeção estrita de lojaSlug no backend impede vazamento cross-store');

  // 4.3 get_cmv_loja com setor de óleo
  const toolCMV = await executeAuthorizedStoreTool(db, {
    toolName: 'get_cmv_loja',
    params: { area: 'OLEO' },
    profile: profileGerenteDomPedro
  });
  assert.equal(toolCMV.allowed, true);
  assert(toolCMV.replyText.includes('CMV Setorial (OLEO)') || toolCMV.replyText.includes('OLEO'));
  assert.equal(toolCMV.dadosConsultados[0].fonte, 'cmv_lojas');
  console.log('  ✅ [PASS] 4.3: executeAuthorizedStoreTool get_cmv_loja com suporte a área');

  // 4.4 list_os
  const toolList = await executeAuthorizedStoreTool(db, {
    toolName: 'list_os',
    profile: profileGerenteDomPedro
  });
  assert.equal(toolList.allowed, true);
  assert(toolList.replyText.includes('OS #1128') && toolList.replyText.includes('OS #2040'));
  console.log('  ✅ [PASS] 4.4: executeAuthorizedStoreTool list_os lista ordens abertas da unidade');

  // 4.5 Atendimento direto à decisão CONSULTAR via handleConsultarDecision
  const decisionResult = await handleConsultarDecision(db, {
    tool: 'get_daily_revenue',
    params: { dataReferencia: '2026-09-30' },
    reason: 'Confirmar vendas acumuladas até as 14h'
  }, profileGerenteDomPedro);
  assert.equal(decisionResult.allowed, true);
  assert(decisionResult.replyText.includes('Vendas de Hoje'));
  assert.equal(decisionResult.dadosConsultados[0].fonte, 'faturamento_diario_horario');
  console.log('  ✅ [PASS] 4.5: handleConsultarDecision atendeu decisão CONSULTAR com dados empacotados');
}

await testAuthorizedTools();

console.log('\n===============================================================================');
console.log('🎯 RESULTADO FINAL: 100% DOS TESTES DA FRENTE 2 PASSARAM COM SUCESSO!');
console.log('===============================================================================');
