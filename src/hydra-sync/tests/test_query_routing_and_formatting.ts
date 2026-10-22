/**
 * src/hydra-sync/tests/test_query_routing_and_formatting.ts
 * Suíte de testes de regressão:
 * 1. "OSs do jabaquara" não confunde com veículo CROSSFOX nem herda OS individual de turnos anteriores.
 * 2. Injeção de prompt: translateInteractiveRowToPrompt traduz comandos para perguntas naturais.
 * 3. Formatação Hermes Ficha Completa: composeFullOS360Card particiona em balões sem rodapé de URA.
 * 4. Listagem de OSs por loja: estrutura em árvore com joelho (└) e espaçamento de parágrafos.
 */

import {
  translateInteractiveRowToPrompt
} from '../types/evo_interactive_contract.js';

import {
  composeExecutiveOSSummary,
  composeFullOS360Card,
  type OS360CardParams
} from '../os_situation_composer.js';

import { sanitizeWhatsAppMarkdown, splitIntoWhatsAppBlocks } from '../format_utils.js';
import { determineCanonicalOSStatus } from '../db_repository.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${msg}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${msg}`);
    failed++;
  }
}

console.log('=== TESTE: Roteamento de Queries e Formatação Executiva Hermes ===\n');

// ----------------------------------------------------------------------------------
// 1. Injeção de Prompt: rowId -> Pergunta Natural do Usuário
// ----------------------------------------------------------------------------------
console.log('🧪 TESTE 1: Tradução de Cliques / Comandos Textuais (Prompt Injection)');

assert(
  translateInteractiveRowToPrompt('os_445_servicos') === 'Quais são os serviços discriminados da OS #445?',
  'os_445_servicos deve virar "Quais são os serviços discriminados da OS #445?"'
);

assert(
  translateInteractiveRowToPrompt('os_445_pecas') === 'Quais são as peças e materiais aplicados na OS #445?',
  'os_445_pecas deve virar "Quais são as peças e materiais aplicados na OS #445?"'
);

assert(
  translateInteractiveRowToPrompt('os_445_pagamentos') === 'Quais são as formas de pagamento e parcelas da OS #445?',
  'os_445_pagamentos deve virar "Quais são as formas de pagamento e parcelas da OS #445?"'
);

assert(
  translateInteractiveRowToPrompt('os_445_documentos') === 'Mostre as vistorias, checklists e documentos da OS #445.',
  'os_445_documentos deve virar "Mostre as vistorias, checklists e documentos da OS #445."'
);

assert(
  translateInteractiveRowToPrompt('os_445_historico') === 'Qual o histórico de atendimento, conversas e tratativas da OS #445?',
  'os_445_historico deve virar "Qual o histórico de atendimento, conversas e tratativas da OS #445?"'
);

assert(
  translateInteractiveRowToPrompt('SERVICOS 445') === 'Quais são os serviços discriminados da OS #445?',
  'Comando de texto "SERVICOS 445" deve virar pergunta natural'
);

assert(
  translateInteractiveRowToPrompt('pecas #445') === 'Quais são as peças e materiais aplicados na OS #445?',
  'Comando de texto "pecas #445" deve virar pergunta natural'
);

assert(
  translateInteractiveRowToPrompt('qual o faturamento de hoje?') === 'qual o faturamento de hoje?',
  'Texto livre não deve ser alterado pelo tradutor'
);

// ----------------------------------------------------------------------------------
// 2. Proteção contra Falsos Positivos em Modelos de Carro (Bug do "OSs" -> "CROSSFOX")
// ----------------------------------------------------------------------------------
console.log('\n🧪 TESTE 2: Proteção de Roteamento para "OSs do jabaquara"');

const testQuery = 'OSs do jabaquara';
const modelMatch = testQuery.match(/\b(linea|civic|corolla|hb20|onix|gol|palio|fiesta|compass|renegade|kwid|argo|cronos|polo|virtus|crossfox|fox)\b/i);
assert(modelMatch === null, '"OSs do jabaquara" NÃO deve casar regex de modelos de veículos');

const osIdMatch = testQuery.match(/\b(?:os|ordem)[_\s]*#?\s*(\d{1,8})\b/i);
assert(osIdMatch === null, '"OSs do jabaquara" NÃO deve casar número de OS individual');

const isListStoreRequest = /\b(?:oss|ordens|carros\s+(?:no|em)\s+patio|veiculos\s+(?:no|em)\s+patio)\b/i.test(testQuery) && !osIdMatch && !modelMatch;
assert(isListStoreRequest === true, '"OSs do jabaquara" DEVE ser classificado como isListStoreRequest');

// ----------------------------------------------------------------------------------
// 3. Formatação Visual Hermes: Ficha Completa 360° em 4 Balões
// ----------------------------------------------------------------------------------
console.log('\n🧪 TESTE 3: Formatação Visual Hermes 360° (composeFullOS360Card)');

const os445Fixture: OS360CardParams = {
  osId: 445,
  lojaSlug: 'MPJabaquara',
  vehicleModel: 'CROSSFOX',
  vehiclePlate: 'DTT2E56',
  clientName: 'MAURO COGO',
  clientPhone: '(11) 94309-9444',
  responsavel: 'VANESSA',
  statusGrid: 'EM TESTE',
  isOpen: true,
  daysInYard: 0,
  totalAmount: 138.90,
  remainingBalance: 0,
  servicos: [
    { descricao: 'REVISAO GERAL', valorTotal: 0, executor: 'MECANICO 1' }
  ],
  pecas: [
    { codigo: 'P01', descricao: 'LAMPADA', qtd: 1, valorTotal: 138.90 }
  ],
  pagamentos: [
    { parcela: 1, modalidade: 'PIX', valor: 138.90, vencimento: '09/10/2026' }
  ],
  documentosAnexosCount: 2,
  checklists: [
    { tipo: 'Inspeção de Entrada', status: 'Concluído', realizado_por: 'Vanessa' }
  ]
};

const fullCardText = composeFullOS360Card(os445Fixture);
const blocks = fullCardText.split('---BLOCK---');

assert(blocks.length >= 3, `Ficha completa deve ser particionada em múltiplos blocos nativos (obteve ${blocks.length})`);
assert(!fullCardText.includes('Selecione uma opção'), 'Ficha completa NÃO deve conter URA "Selecione uma opção"');
assert(!fullCardText.includes('MÓDULOS DISPONÍVEIS'), 'Ficha completa NÃO deve conter "MÓDULOS DISPONÍVEIS"');
assert(!fullCardText.includes('SERVICOS 445'), 'Ficha completa NÃO deve conter comandos textuais "SERVICOS 445"');

assert(fullCardText.includes('OS #445 — CROSSFOX (DTT2E56)'), 'Bloco 1 deve conter cabeçalho da OS #445');
assert(fullCardText.includes('MAURO COGO'), 'Bloco 1 deve conter nome do cliente');
assert(fullCardText.includes('Peças e Materiais'), 'Bloco de peças presente');
assert(fullCardText.toLowerCase().includes('lampada'), 'Peça aplicada discriminada');
assert(fullCardText.includes('Formas de Pagamento'), 'Bloco financeiro presente');
assert(fullCardText.includes('PIX'), 'Forma de pagamento discriminada');

// ----------------------------------------------------------------------------------
// 4. Formatação de Listagem de OSs por Loja (Hierarquia com Joelho └)
// ----------------------------------------------------------------------------------
console.log('\n🧪 TESTE 4: Listagem em Árvore com Joelho (└) e Espaçamento de Parágrafos');

const mockOS1 = {
  os_id: 445,
  veiculo: 'CROSSFOX',
  placa: 'DTT2E56',
  status_grid: 'EM TESTE',
  dias_no_patio: 0,
  total_os: 138.90,
  valor_restante: 0,
  responsavel: 'VANESSA',
  cliente_nome: 'MAURO COGO'
};

const mockOS2 = {
  os_id: 465,
  veiculo: 'FORD KA SE',
  placa: 'BXD6F52',
  status_grid: 'Na Fila para Execução',
  dias_no_patio: 4,
  total_os: 2600.00,
  valor_restante: 2600.00,
  responsavel: 'Vanessa',
  cliente_nome: 'Francisco Carlos Alves'
};

const renderedList = [mockOS1, mockOS2].map(o => {
  const saldoStr = o.valor_restante > 0 ? `*R$ ${o.valor_restante.toFixed(2)}*` : '*Quitado*';
  const modelStr = o.veiculo.toUpperCase();
  const plateStr = o.placa.toUpperCase();
  const diasStr = `${o.dias_no_patio} dias no pátio`;
  const resp = o.responsavel ? ` · Resp: ${o.responsavel}` : '';
  const cliente = o.cliente_nome ? ` · Cliente: ${o.cliente_nome}` : '';

  return [
    `*OS #${o.os_id} — ${modelStr} (${plateStr})*`,
    `  └ Status: *${o.status_grid}* · *${diasStr}*`,
    `  └ Financeiro: Total *R$ ${o.total_os.toFixed(2)}* · Saldo: ${saldoStr}`,
    `  └ Operação:${resp}${cliente}`
  ].join('\n');
}).join('\n\n');

assert(renderedList.includes('  └ Status:'), 'Deve conter o joelho "  └ Status:"');
assert(renderedList.includes('  └ Financeiro:'), 'Deve conter o joelho "  └ Financeiro:"');
assert(renderedList.includes('  └ Operação:'), 'Deve conter o joelho "  └ Operação:"');
assert(renderedList.includes('\n\n*OS #465'), 'Ordens devem ser separadas por parágrafo com linha em branco (\n\n)');
assert(!renderedList.includes('|'), 'PROIBIÇÃO de tabelas markdown com pipes (|)');

// ----------------------------------------------------------------------------------
// 5. Anti-Bullet em Títulos de Seção e Expurgos de Menus/Botões 1, 2, 3
// ----------------------------------------------------------------------------------
console.log('\n🧪 TESTE 5: Limpeza de Bullets em Títulos e Expurgos de Menus/Botões 1, 2, 3');

const rawLLMResponseWithFlaws = [
  `- *Jabaquara (1 veículo em pátio)*`,
  `- *Valor em serviço:* R$ 2.600,00`,
  `- *Saldo a receber:* R$ 2.600,00`,
  `- *HYDRA | Posição Operacional — Jabaquara*`,
  `09/10/2026 · 13:02`,
  `- *Visão geral*`,
  `A unidade Jabaquara conta atualmente com 1 veículo físico em atendimento ativo no pátio.`,
  `- *Ordens de serviço ativas*`,
  `- *OS #465 — KA SE (BXD6F52)*`,
  `  └ Status: *NA FILA PARA EXECUÇÃO* · *4 dias* no pátio`,
  `  └ Financeiro: Total *R$ 2.600,00* · Saldo: *R$ 2.600,00*`,
  `  └ Operação: Resp: Vanessa · Cliente: Francisco Carlos Alves`,
  `- *Gargalos de pátio*`,
  `Nenhum veículo com retenção crítica.`,
  `- *Ponto crítico*`,
  `> Veículo na fila há 4 dias.`,
  `*O que fazer agora*`,
  `1. Cobrar liberação das peças`,
  `2. Exigir cobrança de sinal`
].join('\n');

const cleaned = sanitizeWhatsAppMarkdown(rawLLMResponseWithFlaws);

assert(!cleaned.includes('- *Visão geral*'), 'NUNCA deve ter "- *Visão geral*" com bullet');
assert(cleaned.includes('*Visão geral*'), 'Deve conter "*Visão geral*" puro sem bullet');

assert(!cleaned.includes('- *Ordens de serviço ativas*'), 'NUNCA deve ter "- *Ordens de serviço ativas*" com bullet');
assert(cleaned.includes('*Ordens de serviço ativas*'), 'Deve conter "*Ordens de serviço ativas*" puro sem bullet');

assert(!cleaned.includes('- *OS #465'), 'NUNCA deve ter "- *OS #465" com bullet');
assert(cleaned.includes('*OS #465 — KA SE (BXD6F52)*'), 'Deve conter título puro da OS #465');

assert(!cleaned.includes('- *Gargalos de pátio*'), 'NUNCA deve ter "- *Gargalos de pátio*" com bullet');
assert(!cleaned.includes('- *Ponto crítico*'), 'NUNCA deve ter "- *Ponto crítico*" com bullet');

assert(!cleaned.includes('*O que fazer agora*'), 'Expurgo de menu simulado "*O que fazer agora*"');
assert(!cleaned.includes('1. Cobrar'), 'Expurgo de botões numerados "1. Cobrar"');
assert(!cleaned.includes('2. Exigir'), 'Expurgo de botões numerados "2. Exigir"');

assert(cleaned.startsWith('*HYDRA | Posição Operacional — Jabaquara*'), 'Cabeçalho *HYDRA | ...* deve ser reposicionado no topo absoluto');

// Sub-teste 5.1: Caso onde o modelo envia bullets com marcadores soltos sem asteriscos e sem joelho
const rawWithBulletSubItems = [
  `*Ordens de serviço ativas*`,
  `• OS #465 — KA SE (BXD6F52)`,
  `- Status: NA FILA PARA EXECUÇÃO · 4 dias no pátio`,
  `- Financeiro: Total R$ 2.600,00 · Saldo: R$ 2.600,00`,
  `- Operação: Resp: Vanessa · Cliente: Francisco Carlos Alves`,
  ``,
  `*Ações recomendadas*`,
  `1. Cobrar peças`
].join('\n');

const cleaned2 = sanitizeWhatsAppMarkdown(rawWithBulletSubItems);
assert(!cleaned2.includes('• OS #465'), 'Bullet • OS #465 deve ser removido');
assert(cleaned2.includes('*OS #465 — KA SE (BXD6F52)*'), 'OS sem asterisco deve virar título em negrito');
assert(cleaned2.includes('  └ Status: *NA FILA PARA EXECUÇÃO* · *4 dias* no pátio'), 'Sub-item - Status: deve ser convertido para joelho └ com dias');
assert(cleaned2.includes('  └ Financeiro: Total *R$ 2.600,00* · Saldo: *R$ 2.600,00*'), 'Sub-item - Financeiro: deve ser convertido para joelho └');
assert(!cleaned2.includes('*Ações recomendadas*'), 'Menu *Ações recomendadas* deve ser completamente expurgado');
assert(!cleaned2.includes('1. Cobrar'), 'Botão 1. Cobrar peças deve ser completamente expurgado');

// ----------------------------------------------------------------------------------
// 6. Conversão de Payload Legado com > OS e Blindagem Anti-Orphan Card
// ----------------------------------------------------------------------------------
console.log('\n🧪 TESTE 6: Conversão de Payload Legado com > OS e Blindagem Anti-Orphan Card');

const legacyPayload = [
  `*HYDRA | Posição Jabaquara*`,
  `09/10/2026 · 12:13`,
  ``,
  `*Ordens recentes concluídas / quitadas*`,
  `> OS #468 — RENEGADE (QNX1G46)`,
  `- Status: Finalizada / Entregue • Pátio: 0 dias`,
  `- Cliente: Joaquim Antonio da Silva`,
  `- Valor: R$ 980,00 (resta R$ 0,00)`,
  ``,
  `> OS #467 — C4 (RJM1H74)`,
  `- Status: Finalizada / Entregue • Pátio: 0 dias`,
  `- Cliente: Matheus dos Santos Cesar`,
  `- Valor: R$ 980,00 (resta R$ 0,00)`,
  ``,
  `> OS #466 — PEUGEOT 207 (ERB6H96)`,
  `- Status: Finalizada / Entregue • Pátio: 0 dias`,
  `- Cliente: Alexandre Jose Moura Castro`,
  `- Valor: R$ 60,00 (resta R$ 0,00)`,
  ``,
  `> OS #464 — ETIOS (QNC9H54)`,
  `- Status: Finalizada / Entregue • Pátio: 0 dias`,
  `- Cliente: Gladys Noffs`,
  `- Valor: R$ 6.968,00 (resta R$ 0,00)`,
  ``,
  `> OS #463 — FOX (HDF6F77)`,
  `- Status: Finalizada / Entregue • Pátio: 0 dias`,
  `- Cliente: Fernando Ferreira da Silva`,
  `- Valor: R$ 608,00 (resta R$ 0,00)`
].join('\n');

const cleanedLegacy = sanitizeWhatsAppMarkdown(legacyPayload);

assert(!cleanedLegacy.includes('> OS #468'), 'Deve remover citação > de OS #468');
assert(!cleanedLegacy.includes('> *OS #468'), 'NUNCA deve ter > *OS #468');
assert(cleanedLegacy.includes('*OS #468 — RENEGADE (QNX1G46)*'), 'Cabeçalho da OS #468 deve ser negrito puro');

assert(cleanedLegacy.includes('  └ Status: *Finalizada / Entregue* · *0 dias* no pátio'), 'Status deve ser convertido para joelho com pátio');
assert(cleanedLegacy.includes('  └ Operação: Cliente: Joaquim Antonio da Silva'), 'Cliente deve ser convertido para joelho de Operação');
assert(cleanedLegacy.includes('  └ Financeiro: Total *R$ 980,00* · Saldo: *Quitado*'), 'Valor deve ser convertido para joelho Financeiro Quitado');

assert(cleanedLegacy.includes('*OS #467 — C4 (RJM1H74)*'), 'OS #467 deve virar negrito puro');
assert(cleanedLegacy.includes('*OS #466 — PEUGEOT 207 (ERB6H96)*'), 'OS #466 deve virar negrito puro');
assert(cleanedLegacy.includes('*OS #464 — ETIOS (QNC9H54)*'), 'OS #464 deve virar negrito puro');
assert(cleanedLegacy.includes('*OS #463 — FOX (HDF6F77)*'), 'OS #463 deve virar negrito puro');

// Teste de Fatiamento sem Títulos Órfãos (maxBlockLength: 650 para forçar partição)
const splitBlocks = splitIntoWhatsAppBlocks(cleanedLegacy, 650);
assert(splitBlocks.length > 1, 'Deve fatiar em múltiplos balões quando exceder o limite');

for (let bIdx = 0; bIdx < splitBlocks.length; bIdx++) {
  const block = splitBlocks[bIdx];
  const bLines = block.trim().split('\n');
  const lastLine = bLines[bLines.length - 1].trim();

  // NENHUM balão pode terminar com um cabeçalho de OS sozinho
  const isLastLineOrphanOs = /^\*OS\s*#?\d+[^*]*\*$/i.test(lastLine);
  assert(!isLastLineOrphanOs, `Balão ${bIdx + 1} NUNCA deve terminar com cabeçalho de OS órfão ("${lastLine}")`);

  // Se o balão contiver um cabeçalho de OS, deve conter pelo menos uma linha de joelho └
  const osMatches = block.match(/\*OS\s*#?\d+[^*]*\*/g) || [];
  if (osMatches.length > 0) {
    assert(block.includes('  └ '), `Balão ${bIdx + 1} com OSs deve conter campos de joelho vinculados`);
  }
}

// ----------------------------------------------------------------------------------
// 7. Sanitização Real de 08/10: Voyage #18503 (Eliminação de * *, Metadados Vazios e Status Factual)
// ----------------------------------------------------------------------------------
console.log('\n🧪 TESTE 7: Payload Real de 08/10 (Voyage #18503 - Gramática Universal)');

const realInput0810 = [
  `> *Situação Operacional: VOYAGE LS (LZQ0669)*`,
  `* *OS:* #18503 (MPplanalto)`,
  `* *Status:* *ABERTO*`,
  `* *Permanência:* *6 dias no pátio*`,
  `* *Cliente:* MAURO LUIZ RODRIGUES BUENO DA SILVA`,
  `* *Valor Total:* *R$ 6.731,10* (Saldo a Pagar: *R$ 2.723,10*)`,
  ``,
  `> *Serviços Discriminados:*`,
  `* *DIAGNOSTICO NACIONAL:* R$ 385,00`,
  `* *REMOÇAO ALTERNADOR:* R$ 680,00`,
  `* *LIMPEZA SISTEMA ARREFECIMENTO:* R$ 149,90`,
  `* *SERVIÇO MOTOBOY:* R$ 26,00`,
  `* *ALINHAMENTO DIANTEIRO:* R$ 110,00`,
  `* *GEOMETRIA:* R$ 380,00`,
  `* *REGULAGEM ALAVANCA DE FREIO:* R$ 120,00`,
  ``,
  `> *Formas de Pagamento e Parcelas:*`,
  `* *Parcela 1:* R$ 2.010,00 (PIX, Venc: 02/10/2026)`,
  `* *Parcela 2:* R$ 1.998,00 (PIX, Venc: 06/10/2026)`,
  ``,
  `> *Documentos e Checklists:*`,
  `* *Checklist de Entrada:*`,
  `* *Checklist do Mecanico:*`,
  `* *Nota Fiscal:*`,
  `* *Anexos:*`
].join('\n');

const cleaned0810 = sanitizeWhatsAppMarkdown(realInput0810);

assert(!/^\s*\*[\t ]+\*/m.test(cleaned0810), 'Zero ocorrências de marcadores duplos "* *" no início de linha');
assert(cleaned0810.includes('- *OS:* #18503 (MPplanalto)'), 'Marcador "* *OS:*" deve virar "- *OS:*"');
assert(cleaned0810.includes('- *DIAGNOSTICO NACIONAL:* R$ 385,00'), 'Serviço discriminado deve virar "- *DIAGNOSTICO..."');
assert(cleaned0810.includes('- *Parcela 1:* R$ 2.010,00'), 'Parcela deve virar "- *Parcela 1:*"');
assert(cleaned0810.includes('- *Checklist de Entrada:* Não informado / Pendente'), 'Checklist vazio deve ser preenchido');
assert(cleaned0810.includes('- *Nota Fiscal:* Não informado / Pendente'), 'Nota Fiscal vazia deve ser preenchida');
assert(cleaned0810.includes('MAURO LUIZ RODRIGUES BUENO DA SILVA'), 'Nome completo do cliente preservado sem reticências');
assert(!cleaned0810.includes('MAURO LUIZ RODRIGUES BU...'), 'Proibido nome truncado com reticências');

// Validação de Status Canônico com hora/data de finalização
const statusAudit1 = determineCanonicalOSStatus('ABERTO', '2026-10-08 17:30:00', undefined, undefined, 1);
assert(statusAudit1.statusExibicao === 'Finalizada', 'OS com data_fim deve ser considerada Finalizada mesmo com status_grid ABERTO');
assert(statusAudit1.isEfetivamenteAberta === false, 'OS com data_fim não pode ser considerada efetivamente aberta');

const statusAudit2 = determineCanonicalOSStatus('ABERTO', undefined, '17:30', undefined, 1);
assert(statusAudit2.statusExibicao === 'Finalizada', 'OS com hora_fim deve ser considerada Finalizada');

// ----------------------------------------------------------------------------------
// 8. Sanitização Real de 09/10: Jorge Beretta #1129 (Negrito Integral, Joelhos Unificados e Saldo)
// ----------------------------------------------------------------------------------
console.log('\n🧪 TESTE 8: Payload Real de 09/10 (Jorge Beretta #1129 - Gramática Universal)');

const realInput0910 = [
  `*HYDRA | Carros em pátio | Jorge Beretta*`,
  ``,
  `*09/10/2026 · 15:45*`,
  ``,
  `> *Visão geral*`,
  ``,
  `A unidade Jorge Beretta conta atualmente com 5 veículos físicos em atendimento ativo no pátio. O valor total em serviço soma R$ 9.289,70, com R$ 8.289,70 de saldo a receber (89,2% de exposição financeira). O faturamento acumulado no mês é de R$ 14.486,30 (6 OSs, ticket médio de R$ 2.414,00).`,
  ``,
  `> *Jorge Beretta (5 veículos)*`,
  `* *Valor em serviço:* R$ 9.289,70`,
  `* *Saldo a receber:* R$ 8.289,70`,
  ``,
  `> *Ordens de serviço*`,
  ``,
  `*OS #1129* — CORSA WIND (CYG2B02)`,
  `  └ *AGUARDANDO RETIRADA*`,
  `  └  *8 dias* no pátio`,
  `  └ *Total da OS* R$ 905,00 ·`,
  `  └ *Saldo:*  `,
  `  └ *Resp:* ROGERIO`
].join('\n');

const cleaned0910 = sanitizeWhatsAppMarkdown(realInput0910);

assert(cleaned0910.includes('*OS #1129 — CORSA WIND (CYG2B02)*'), 'Título da OS deve ter negrito integral contínuo na linha toda');
assert(!cleaned0910.includes('*OS #1129* — CORSA WIND'), 'Proibido negrito parcial apenas no número da OS');
assert(cleaned0910.includes('  └ Status: *AGUARDANDO RETIRADA* · *8 dias* no pátio'), 'Joelhos desmembrados de status e pátio devem ser unificados com rótulo Status:');
assert(cleaned0910.includes('  └ Financeiro: Total *R$ 905,00* · Saldo: *Quitado*'), 'Total com pontuação solta e saldo vazio devem ser unificados com Saldo: *Quitado*');
assert(cleaned0910.includes('  └ Operação: Resp: ROGERIO'), 'Joelhor de responsável deve conter rótulo Operação:');
assert(!cleaned0910.includes('R$ 905,00 ·\n'), 'Ponto mediano solto no fim da linha deve ser eliminado');
assert(cleaned0910.includes('- *Valor em serviço:* R$ 9.289,70'), 'Marcador "* *Valor em serviço:*" deve virar "- *Valor em serviço:*"');

console.log(`\n=======================================================`);
console.log(`RESULTADO DA SUÍTE: ${passed} PASSOU | ${failed} FALHOU`);
console.log(`=======================================================`);

if (failed > 0) {
  process.exit(1);
}
