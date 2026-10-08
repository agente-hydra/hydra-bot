/**
 * SUÍTE DE TESTES EXCLUSIVA: EXECUTOR 2 (FRENTE 2)
 * Spec: hydra-language-whatsapp-comprehension
 * 
 * Cobertura Completa dos Entregáveis:
 * - [E2-01]: Política de Zero Emoji (purgeDecorativeEmojis, Unicode \p{Extended_Pictographic}, teto 1 em alerta crítico)
 * - [E2-02]: Conversor Estruturado Anti-Tabela (convertMarkdownTableToNativeBlocks, TableToBlockResult, preservação 100%)
 * - [E2-03]: Padronização de Relatórios (> *Título*, - *Campo:* valor, _Dados atualizados em...)
 * - [E2-04]: Compositor de Balões por Unidade de Assunto (composeSemanticBalloons, 600-900 chars, <600 em 1 balão, Card-Aware)
 * - [E2-05]: Barreira Anti-Balão Vazio (enforceAntiEmptyBalloons, proibição de "Entendi." isolado)
 */

import {
  purgeDecorativeEmojis,
  convertMarkdownTableToNativeBlocks,
  convertMarkdownTablesToWhatsAppBlocks,
  enforceAntiEmptyBalloons,
  sanitizeWhatsAppMarkdown,
  splitIntoWhatsAppBlocks,
  calculateGoalMetrics,
  assertNoDoubleAsterisks,
  assertWhatsAppNativeFormat
} from '../format_utils.js';

import {
  composeSemanticBalloons,
  composeSemanticBalloonsStructured,
  convertMarkdownTablesToWhatsAppLists,
  splitIntoAtomicItems
} from '../balloon_composer.js';

import {
  formatGoalGapWhatsAppReply
} from '../operational_adapter.js';

import {
  formatarRelatorioExecutivo,
  formatarStatusCompacto,
  formatarAlertaOperacional
} from '../whatsapp_formatter.js';

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ [PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`  ❌ [FAIL] ${testName}`);
    if (detail) {
      console.error(`     Detalhe: ${detail}`);
    }
    process.exitCode = 1;
  }
}

console.log('===============================================================================');
console.log('🧪 INICIANDO SUÍTE DE TESTES: EXECUTOR 2 (FRENTE 2 — FORMATAÇÃO & COMPOSITOR)');
console.log('===============================================================================\n');

// ─────────────────────────────────────────────────────────────────────────────
// [E2-01]: POLÍTICA DE ZERO EMOJI
// ─────────────────────────────────────────────────────────────────────────────
console.log('--- [E2-01]: Política de Zero Emoji (purgeDecorativeEmojis) ---');

// 1.1 Purga de emojis decorativos em saudações
const saudacaoComEmojis = 'Olá! 👋 Bom dia 🚗✨ Tudo bem?';
const saudacaoLimpa = purgeDecorativeEmojis(saudacaoComEmojis);
assert(!saudacaoLimpa.includes('👋'), 'Purga emoji de mão acenando em saudação');
assert(!saudacaoLimpa.includes('🚗'), 'Purga emoji de carro');
assert(!saudacaoLimpa.includes('✨'), 'Purga emoji de brilho');
assert(saudacaoLimpa.trim() === 'Olá! Bom dia Tudo bem?', 'Saudação preserva texto limpo');

// 1.2 Purga de emojis decorativos em rankings e competições
const rankingComEmojis = '1º Lugar: 🏆 Santo André 🥇\n2º Lugar: 🥈 Jabaquara 👏';
const rankingLimpo = purgeDecorativeEmojis(rankingComEmojis);
assert(!rankingLimpo.includes('🏆'), 'Purga troféu de ranking');
assert(!rankingLimpo.includes('🥇'), 'Purga medalha de ouro');
assert(!rankingLimpo.includes('🥈'), 'Purga medalha de prata');
assert(!rankingLimpo.includes('👏'), 'Purga palmas decorativas');

// 1.3 Alerta sem comprovação de negócio: converte para *Atenção:*
const alertaSemComprovacao = '⚠️ Atenção: Peça em falta para o modelo Yaris.';
const alertaTratado = purgeDecorativeEmojis(alertaSemComprovacao);
assert(!alertaTratado.includes('⚠️'), 'Remove emoji de alerta sem regra de negócio comprovada');
assert(alertaTratado.includes('*Atenção:*') || alertaTratado.includes('Atenção:'), 'Preserva aviso textual Atenção:');

// 1.4 Alerta crítico com regra comprovada (>30 dias no pátio): teto de no máximo 1 emoji
const alerta30Dias = '🚨🚨🚨 Veículo retido há mais de 35 dias no pátio da unidade Mauá.';
const alerta30DiasTratado = purgeDecorativeEmojis(alerta30Dias);
const countAlertaEmojis = (alerta30DiasTratado.match(/🚨/g) || []).length;
assert(countAlertaEmojis <= 1, 'Teto estrito de no máximo 1 emoji em alerta crítico com regra > 30 dias comprovada', `Contagem: ${countAlertaEmojis}`);
assert(alerta30DiasTratado.includes('retido há mais de 35 dias no pátio'), 'Preserva texto do alerta intacto');

// 1.5 Purga total em sanitizeWhatsAppMarkdown
const textoGeralComEmojis = 'Total de OS: 15 🔧. Faturamento: R$ 45.000,00 💰. Meta alcançada 🎯🚀!';
const textoGeralSanitizado = sanitizeWhatsAppMarkdown(textoGeralComEmojis);
assert(!textoGeralSanitizado.includes('🔧'), 'Purga ferramenta');
assert(!textoGeralSanitizado.includes('💰'), 'Purga saco de dinheiro');
assert(!textoGeralSanitizado.includes('🎯'), 'Purga alvo');
assert(!textoGeralSanitizado.includes('🚀'), 'Purga foguete');

// ─────────────────────────────────────────────────────────────────────────────
// [E2-02]: CONVERSOR ESTRUTURADO ANTI-TABELA
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- [E2-02]: Conversor Estruturado Anti-Tabela (convertMarkdownTableToNativeBlocks) ---');

const markdownTable = `
| Loja | Pátio | Saldo | Meta |
| :--- | :--- | :--- | :--- |
| Jabaquara | 18 | R$ 42.150,00 | R$ 50.000,00 |
| Santo André | 12 | R$ 15.000,00 | R$ 20.000,00 |
| Mauá | 8 | R$ 38.000,00 | R$ 35.000,00 |
`;

const tableResult = convertMarkdownTableToNativeBlocks(markdownTable);
assert(tableResult.hasTable === true, 'Detecta presença de tabela Markdown');
assert(tableResult.rowsProcessed === 3, 'Processa exatamente 3 linhas de dados');
assert(tableResult.dataPreserved === true, 'Preserva 100% dos dados das células');

const convertedBlocks = tableResult.convertedBlocksText;
assert(!convertedBlocks.includes('|'), 'Zero barras "|" residuais nos blocos gerados');
assert(!convertedBlocks.includes('---'), 'Zero delimitadores de alinhamento residuais');

// Cada linha vira um card nativo com *Nome da Loja* e campos em traço - *Campo:* valor
assert(convertedBlocks.includes('*Jabaquara*'), 'Card 1 tem cabeçalho *Jabaquara*');
assert(convertedBlocks.includes('- *Pátio:* 18'), 'Card 1 preserva campo Pátio');
assert(convertedBlocks.includes('- *Saldo:* R$ 42.150,00'), 'Card 1 preserva campo Saldo');
assert(convertedBlocks.includes('- *Meta:* R$ 50.000,00'), 'Card 1 preserva campo Meta');

assert(convertedBlocks.includes('*Santo André*'), 'Card 2 tem cabeçalho *Santo André*');
assert(convertedBlocks.includes('- *Pátio:* 12'), 'Card 2 preserva campo Pátio');

assert(convertedBlocks.includes('*Mauá*'), 'Card 3 tem cabeçalho *Mauá*');
assert(convertedBlocks.includes('- *Pátio:* 8'), 'Card 3 preserva campo Pátio');

// Teste de tabela de Ordens de Serviço (OS)
const osTableMarkdown = `
| OS | Placa | Cliente | Valor |
| --- | --- | --- | --- |
| #1024 | ABC-1234 | Carlos Silva | R$ 3.500,00 |
| #1025 | XYZ-9876 | Mariana Dias | R$ 1.200,00 |
`;
const osTableResult = convertMarkdownTableToNativeBlocks(osTableMarkdown);
assert(osTableResult.convertedBlocksText.includes('*OS #1024*') || osTableResult.convertedBlocksText.includes('*OS: #1024*') || osTableResult.convertedBlocksText.includes('*#1024*'), 'Card de OS com identificador no cabeçalho');
assert(osTableResult.convertedBlocksText.includes('- *Placa:* ABC-1234'), 'Preserva campo Placa');
assert(osTableResult.convertedBlocksText.includes('- *Cliente:* Carlos Silva'), 'Preserva campo Cliente');
assert(osTableResult.convertedBlocksText.includes('- *Valor:* R$ 3.500,00'), 'Preserva campo Valor');

// ─────────────────────────────────────────────────────────────────────────────
// [E2-03]: PADRONIZAÇÃO DE RELATÓRIOS
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- [E2-03]: Padronização de Relatórios (operational_adapter & whatsapp_formatter) ---');

// 3.1 Relatório de Loja Única
const mockRecordsSingle = [
  {
    loja_slug: 'mpsantoandre',
    data_referencia: '2026-02-28',
    posicao_hora: '17:00',
    faturamento_mes: 160000,
    meta_mes: 180000,
    volume_os: 45,
    ticket_medio: 3555.55
  }
];

const singleStoreReply = formatGoalGapWhatsAppReply({
  records: mockRecordsSingle,
  targetLojaSlug: 'mpsantoandre',
  dataReferencia: '2026-02-28',
  posicaoHora: '17:00'
});

assert(singleStoreReply.includes('> *Meta: Santo André'), 'Inicia com bloco de citação WhatsApp (> *Meta: ...*)');
assert(singleStoreReply.includes('- *Falta para bater:*') || singleStoreReply.includes('- *Status:*'), 'Contém campo com lista nativa (- *Falta para bater:* ou - *Status:*)');
assert(singleStoreReply.includes('- *Atingimento:* 88,9% da meta'), 'Contém atingimento formatado');
assert(singleStoreReply.endsWith('_Dados atualizados em 28/02/2026 às 17:00._'), 'Termina estritamente com _Dados atualizados em [data/hora]._');

// 3.2 Relatório Consolidado da Rede
const mockRecordsNetwork = [
  { loja_slug: 'mpsantoandre', faturamento_mes: 160000, meta_mes: 180000 },
  { loja_slug: 'jabaquara', faturamento_mes: 210000, meta_mes: 200000 },
  { loja_slug: 'maua', faturamento_mes: 95000, meta_mes: 100000 }
];

const networkReply = formatGoalGapWhatsAppReply({
  records: mockRecordsNetwork,
  dataReferencia: '2026-02-28',
  posicaoHora: '18:00'
});

assert(networkReply.includes('> *Meta da rede —'), 'Rede inicia com cabeçalho > *Meta da rede*');
assert(networkReply.includes('> *Lojas que ainda não bateram a meta*'), 'Agrupa lojas pendentes em bloco');
assert(networkReply.includes('> *Lojas que já bateram a meta*'), 'Agrupa lojas batidas em bloco');
assert(networkReply.endsWith('_Dados atualizados em 28/02/2026 às 18:00._'), 'Rede termina com _Dados atualizados em [data/hora]._');
assert(networkReply.includes('\n\n> *Lojas'), 'Grupos lógicos separados por linha em branco');

// 3.3 Relatório Executivo
const relExec = formatarRelatorioExecutivo({
  dataReferencia: '28/02/2026',
  posicaoHora: '19:00',
  faturamentoMes: 1500000,
  totalOsMes: 320,
  veiculosAbertosSistema: 42,
  pontosAtencao: [
    {
      id: 'alerta-carros-travados',
      descricao: '5 veículos travados há mais de 10 dias em Mauá.',
      categoria: 'TEMPO_PATIO',
      nivel: 'CRITICO'
    } as any
  ],
  ticketMedioRede: 4687.50,
  lideresComerciais: [{ nome: 'Jabaquara', faturamento: 350000 }],
  proximasAcoes: [
    {
      id: 'acao-1',
      regraOrigem: 'regra-pecas',
      evidencia: 'Mauá 5 veículos travados',
      prioridade: 1,
      textoAcao: 'Contatar fornecedor de autopeças.'
    } as any
  ],
  ambienteOperacionalVerificado: true
});

assert(relExec.includes('*HYDRA | Operação*'), 'Relatório executivo tem cabeçalho institucional');
assert(relExec.includes('*Visão geral*'), 'Contém seção Visão Geral');
assert(relExec.includes('> 5 veículos travados'), 'Ponto crítico em citação WhatsApp (> )');
assert(relExec.includes('_Status do ambiente: operacional_'), 'Rodapé técnico verificado');
assert(assertNoDoubleAsterisks(relExec), 'Zero duplo asterisco no relatório executivo');

// ─────────────────────────────────────────────────────────────────────────────
// [E2-04]: COMPOSITOR DE BALÕES POR UNIDADE DE ASSUNTO
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- [E2-04]: Compositor de Balões (composeSemanticBalloons & Structured) ---');

// 4.1 Respostas curtas (<600 chars) permanecem SEMPRE em 1 balão
const respostaCurta = '> *Status Jabaquara*\n- *Faturamento:* R$ 180.000,00\n- *Meta:* R$ 170.000,00\n- *Atingimento:* 105,9%\n\n_Dados atualizados em 28/02/2026._';
const baloesCurtos = composeSemanticBalloons(respostaCurta);
assert(baloesCurtos.length === 1, 'Resposta curta (<600 chars) gera exatamente 1 balão');
assert(baloesCurtos[0].includes('105,9%'), 'Preserva dados da resposta curta');

// 4.2 Card-Aware Chunking: Nunca quebrar dentro de card
const card1 = `*OS 5001*\n- *Pátio:* Jabaquara\n- *Veículo:* Corolla\n- *Tempo:* 35 dias\n- *Valor:* R$ 4.500,00`;
const card2 = `*OS 5002*\n- *Pátio:* Santo André\n- *Veículo:* Civic\n- *Tempo:* 28 dias\n- *Valor:* R$ 6.200,00`;
const card3 = `*OS 5003*\n- *Pátio:* Mauá\n- *Veículo:* Onix\n- *Tempo:* 15 dias\n- *Valor:* R$ 2.100,00`;
const card4 = `*OS 5004*\n- *Pátio:* Kennedy\n- *Veículo:* Compass\n- *Tempo:* 12 dias\n- *Valor:* R$ 8.900,00`;
const card5 = `*OS 5005*\n- *Pátio:* Planalto\n- *Veículo:* Renegade\n- *Tempo:* 10 dias\n- *Valor:* R$ 5.400,00`;
const card6 = `*OS 5006*\n- *Pátio:* Piraporinha\n- *Veículo:* HB20\n- *Tempo:* 8 dias\n- *Valor:* R$ 1.950,00`;
const card7 = `*OS 5007*\n- *Pátio:* Dom Pedro\n- *Veículo:* Kicks\n- *Tempo:* 7 dias\n- *Valor:* R$ 3.200,00`;
const card8 = `*OS 5008*\n- *Pátio:* Rudge Ramos\n- *Veículo:* Tracker\n- *Tempo:* 6 dias\n- *Valor:* R$ 4.100,00`;
const card9 = `*OS 5009*\n- *Pátio:* Rei do Óleo\n- *Veículo:* Creta\n- *Tempo:* 5 dias\n- *Valor:* R$ 2.800,00`;
const card10 = `*OS 5010*\n- *Pátio:* Rei do Módulo\n- *Veículo:* Polo\n- *Tempo:* 4 dias\n- *Valor:* R$ 1.500,00`;

const allCards = [card1, card2, card3, card4, card5, card6, card7, card8, card9, card10];
const atomicItems = splitIntoAtomicItems(allCards.join('\n\n'));
assert(atomicItems.length === 10, 'splitIntoAtomicItems preserva exatamente os 10 cards intactos');
assert(atomicItems[0].startsWith('*OS 5001*') && atomicItems[0].includes('- *Pátio:* Jabaquara'), 'Card 1 mantém título e campos juntos');

// Compositor com múltiplos cards (>900 chars)
const payloadLongo = {
  directAnswer: '> *Listagem de Veículos em Atenção Operacional*\nIdentificados 10 veículos com tempo de pátio elevado na rede.',
  resultReading: '> *Diagnóstico Operacional*\nAs unidades Jabaquara e Santo André concentram os casos mais urgentes com tempo superior a 25 dias.',
  details: allCards.join('\n\n'),
  sourcePeriod: '_Dados atualizados em 28/02/2026 às 19:30._'
};

const baloesCompostos = composeSemanticBalloons(payloadLongo, { minBalloonChars: 600, maxBalloonChars: 900 });
assert(baloesCompostos.length >= 2, 'Payload longo é dividido em múltiplos balões saudáveis');

// Nenhum balão deve ter um card quebrado (ex: título em um balão e campos no outro)
for (let bIdx = 0; bIdx < baloesCompostos.length; bIdx++) {
  const b = baloesCompostos[bIdx];
  assert(assertNoDoubleAsterisks(b), `Balão ${bIdx + 1} com zero duplo asterisco`);
  assert(assertWhatsAppNativeFormat(b), `Balão ${bIdx + 1} em conformidade com WhatsApp Nativo`);

  // Se tem título de OS, deve ter também os campos correspondentes
  if (b.includes('*OS 5001*')) {
    assert(b.includes('- *Pátio:* Jabaquara'), 'Balão contendo OS 5001 contém também seus campos subordinados');
  }
  if (b.includes('*OS 5002*')) {
    assert(b.includes('- *Pátio:* Santo André'), 'Balão contendo OS 5002 contém também seus campos subordinados');
  }
}

// 4.3 composeSemanticBalloonsStructured
const structuredRes = composeSemanticBalloonsStructured(payloadLongo);
assert(Array.isArray(structuredRes.balloons), 'Retorna array de balões');
assert(structuredRes.balloonCount === structuredRes.balloons.length, 'Contagem de balões consistente');
assert(structuredRes.totalChars > 0, 'Total de caracteres calculado');
assert(structuredRes.emojisCount === 0, 'Zero emojis na contagem estruturada');
assert(structuredRes.sanitized === true, 'Flag sanitized é true');
assert(structuredRes.isStructuredCard === true, 'Flag isStructuredCard é true');

// ─────────────────────────────────────────────────────────────────────────────
// [E2-05]: BARREIRA ANTI-BALÃO VAZIO
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n--- [E2-05]: Barreira Anti-Balão Vazio (enforceAntiEmptyBalloons) ---');

// 5.1 Balão isolado com palavra curta ("Entendi.")
const baloesComPalavraIsolada = [
  'Entendi.',
  '> *Atingimento de Metas*\n- *Santo André:* R$ 160.000,00\n- *Jabaquara:* R$ 210.000,00'
];

const baloesFiltrados = enforceAntiEmptyBalloons(baloesComPalavraIsolada);
assert(baloesFiltrados.length === 1, 'Funde palavra isolada "Entendi." com o balão seguinte');
assert(baloesFiltrados[0].startsWith('Entendi.\n\n> *Atingimento'), 'Introdução curta fica unida no mesmo balão');

// 5.2 Outras palavras isoladas proibidas
const baloesIsolados2 = [
  'Olá!',
  '> *Status da Rede*\nTudo operando normalmente.'
];
const baloesFiltrados2 = enforceAntiEmptyBalloons(baloesIsolados2);
assert(baloesFiltrados2.length === 1, 'Funde "Olá!" com o conteúdo subsequente');

// 5.3 Balões normais (>30 chars com conteúdo) não são fundidos desnecessariamente
const baloesNormais = [
  '> *Resumo Operacional da Manhã*\nTodas as 10 oficinas abriram sem pendências de abertura.',
  '> *Faturamento Parcial*\nTotal acumulado de R$ 450.000,00 até as 12:00.'
];
const baloesNormaisPreservados = enforceAntiEmptyBalloons(baloesNormais);
assert(baloesNormaisPreservados.length === 2, 'Preserva balões independentes bem estruturados');

console.log('\n===============================================================================');
console.log(`🎯 RESULTADO FINAL: ${passedTests}/${totalTests} TESTES APROVADOS!`);
console.log('===============================================================================\n');

if (passedTests === totalTests) {
  process.exit(0);
} else {
  process.exit(1);
}
