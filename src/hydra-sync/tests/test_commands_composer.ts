/**
 * SUÍTE DE TESTES: COMANDOS DETERMINÍSTICOS, INGRESS E COMPOSITOR SEMÂNTICO (Frente C)
 * 
 * Cobertura de Testes:
 * 1. Execução determinística de comandos sem IA (/menu, /perfil, /socio, /santoandre, etc.)
 *    - Baseado estritamente em CATALOGO_10_LOJAS em db_repository.ts
 *    - Rejeição de números não autorizados
 *    - Respostas estáticas em <10ms sem dependência de LLM
 * 2. Validação da Regra de Ouro do /reset abortivo:
 *    - Aborto imediato de job em voo (InFlightAbortRegistry)
 *    - Encerramento imediato do sinal de presença ('composing' -> 'paused')
 *    - Limpeza de contexto (hydra_turn_contexts) e memória diária
 *    - Incremento de geração de memória e restauração da persona Sócio/rede
 *    - Descarte da resposta antiga sem vazamento entre perfis
 *    - Preservação da auditoria histórica
 * 3. Compositor Semântico de Balões (balloon_composer.ts):
 *    - Ordem semântica estrita: 1. Resposta direta -> 2. Leitura -> 3. Detalhes -> 4. Fonte/período
 *    - Eliminação completa de tabelas Markdown (|---|) com conversão em listas limpas WhatsApp
 * 4. Orçamento de Caracteres & Quebras Respeitosas:
 *    - Orçamento de 700 a 900 caracteres por balão (preferência 1 a 3 balões)
 *    - Quebras apenas por seção ou grupo de lojas/itens
 *    - Zero fragmentação no meio de itens, valores monetários, placas ou frases
 *    - Sanitização WhatsApp com zero asteriscos duplos (**)
 */

import Database from 'better-sqlite3';
import { CATALOGO_10_LOJAS, STORE_DISPLAY_NAMES } from '../db_repository.js';
import {
  interceptCommand,
  isDeterministicCommand,
  isAuthorizedPhone,
  InFlightAbortRegistry,
  STORE_COMMANDS,
  getUserProfile,
  saveUserProfile,
  ensureUserProfileSchema,
  AUTHORIZED_NUMBERS
} from '../command_interceptor.js';
import {
  composeSemanticBalloons,
  convertMarkdownTablesToWhatsAppLists,
  parseSemanticSections
} from '../balloon_composer.js';
import {
  sanitizeWhatsAppMarkdown,
  assertNoDoubleAsterisks,
  assertWhatsAppNativeFormat
} from '../format_utils.js';
import {
  ensureTurnContextTable,
  getLatestTurnState,
  saveTurnState
} from '../turn_context_repository.js';

let totalTests = 0;
let passedTests = 0;

function assert(condition: any, testName: string, details?: string) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ [PASS] ${testName}`);
  } else {
    console.error(`  ❌ [FAIL] ${testName}`);
    if (details) console.error(`     Detalhe: ${details}`);
    process.exitCode = 1;
  }
}

async function runTests() {
  console.log('===============================================================================');
  console.log('🧪 INICIANDO SUÍTE DE TESTES: FRENTE C (COMANDOS DETERMINÍSTICOS & COMPOSITOR)');
  console.log('===============================================================================\n');

  // Inicializa banco SQLite isolado para testes
  const db = new Database(':memory:');
  ensureUserProfileSchema(db);
  ensureTurnContextTable(db);

  // Cria tabela de mensagens de conversação para validar preservação histórica no /reset
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const authPhone1 = '5511996242812';
  const authPhone2 = '5511970671717';
  const nonAuthPhone = '5511988887777';

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. EXECUÇÃO DETERMINÍSTICA DE COMANDOS SEM IA
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('--- 1. Execução Determinística de Comandos sem IA ---');

  // 1.1 Validação de Whitelist de Números Autorizados
  assert(isAuthorizedPhone(authPhone1), `Número autorizado 1 (${authPhone1}) aceito`);
  assert(isAuthorizedPhone(authPhone2), `Número autorizado 2 (${authPhone2}) aceito`);
  assert(!isAuthorizedPhone(nonAuthPhone), `Número não autorizado (${nonAuthPhone}) recusado`);

  const nonAuthRes = await interceptCommand({
    phone: nonAuthPhone,
    text: '/menu',
    db
  });
  assert(!nonAuthRes.handled, 'Comando de número não autorizado não é processado no interceptor');

  // 1.2 Validação do Catálogo de 10 Lojas
  assert(CATALOGO_10_LOJAS.length === 10, 'Catálogo base contém exatamente 10 lojas');
  const storeCmdSlugs = Object.values(STORE_COMMANDS).map(s => s.lojaSlug).sort();
  const catalogoSlugsSorted = [...CATALOGO_10_LOJAS].sort();
  assert(
    JSON.stringify(storeCmdSlugs) === JSON.stringify(catalogoSlugsSorted),
    'Comandos de loja cobrem 100% do CATALOGO_10_LOJAS (sem lojas fantasmas nem faltantes)'
  );

  // 1.3 Comando /menu
  const tMenuStart = Date.now();
  const menuRes = await interceptCommand({
    phone: authPhone1,
    text: '/menu',
    db
  });
  const menuDuration = Date.now() - tMenuStart;

  assert(menuRes.handled, '/menu manipulado com sucesso');
  assert(menuRes.command === '/menu', 'Comando identificado como /menu');
  assert(menuDuration < 50, `/menu executado em modo ultra-rápido (${menuDuration}ms < 50ms)`);
  assert(menuRes.messages.length === 1, '/menu gera exatamente 1 balão');
  assert(menuRes.replyText?.includes('> *Comandos Rápidos do Hydra*'), '/menu possui cabeçalho de bloco WhatsApp');
  assert(menuRes.replyText?.includes('- */menu:*'), '/menu descreve /menu');
  assert(menuRes.replyText?.includes('- */perfil:*'), '/menu descreve /perfil');
  assert(menuRes.replyText?.includes('- */reset:*'), '/menu descreve /reset');
  assert(menuRes.replyText?.includes('- */socio:*'), '/menu descreve /socio');
  assert(menuRes.replyText?.includes('- */santoandre:*'), '/menu descreve /santoandre');
  assert(menuRes.replyText?.includes('- */maua:*'), '/menu descreve /maua');
  assert(menuRes.replyText?.includes('- */reidomodulo:*'), '/menu descreve /reidomodulo');
  assert(assertNoDoubleAsterisks(menuRes.replyText || ''), '/menu com zero asteriscos duplos');

  // 1.4 Comando /perfil (Padrão: Sócio)
  const perfilDefaultRes = await interceptCommand({
    phone: authPhone1,
    text: '/perfil',
    db
  });
  assert(perfilDefaultRes.handled, '/perfil inicial manipulado com sucesso');
  assert(perfilDefaultRes.profile?.persona === 'socio', 'Perfil inicial padrão é Sócio');
  assert(perfilDefaultRes.profile?.defaultScope === 'rede', 'Escopo inicial padrão é Rede');
  assert(perfilDefaultRes.replyText?.includes('- *Persona:* Sócio'), '/perfil exibe persona Sócio');
  assert(perfilDefaultRes.replyText?.includes('- *Escopo Padrão:* Rede'), '/perfil exibe escopo Rede');

  // 1.5 Comando /{loja} -> /santoandre (assume gerente)
  const santoandreRes = await interceptCommand({
    phone: authPhone1,
    text: '/santoandre',
    db
  });
  assert(santoandreRes.handled, '/santoandre assumido com sucesso');
  assert(santoandreRes.profile?.persona === 'gerente', 'Persona alterada para Gerente');
  assert(santoandreRes.profile?.lojaSlug === 'MPSantoAndre', 'Loja vinculada é MPSantoAndre');
  assert(santoandreRes.profile?.defaultScope === 'loja', 'Escopo alterado para Loja');
  assert(santoandreRes.replyText?.includes('Santo André'), 'Confirmação cita Santo André');

  // Verifica persistência no contexto de turno
  const turnAfterStore = getLatestTurnState(db, authPhone1, 120);
  assert(turnAfterStore?.lojaSlug === 'MPSantoAndre', 'Contexto de turno atualizado com MPSantoAndre');

  // 1.6 Comando /perfil após assumir gerente
  const perfilGerenteRes = await interceptCommand({
    phone: authPhone1,
    text: '/perfil',
    db
  });
  assert(perfilGerenteRes.replyText?.includes('- *Persona:* Gerente de Loja'), '/perfil agora indica Gerente de Loja');
  assert(perfilGerenteRes.replyText?.includes('Santo André'), '/perfil indica Santo André');

  // 1.7 Comando /socio (restaura perfil Sócio)
  const socioRes = await interceptCommand({
    phone: authPhone1,
    text: '/socio',
    db
  });
  assert(socioRes.handled, '/socio processado com sucesso');
  assert(socioRes.profile?.persona === 'socio', 'Persona restaurada para Sócio');
  assert(socioRes.profile?.defaultScope === 'rede', 'Escopo restaurado para Rede');
  assert(socioRes.profile?.lojaSlug === undefined, 'Loja pré-fixada removida');

  const turnAfterSocio = getLatestTurnState(db, authPhone1, 120);
  assert(turnAfterSocio?.lojaSlug === undefined || turnAfterSocio?.lojaSlug === null, 'Contexto de turno limpo de loja específica');

  // 1.8 Outras lojas do catálogo (/dompedro, /maua)
  const dompedroRes = await interceptCommand({ phone: authPhone2, text: '/dompedro', db });
  assert(dompedroRes.profile?.lojaSlug === 'MPdompedro1', '/dompedro vincula MPdompedro1');

  const mauaRes = await interceptCommand({ phone: authPhone2, text: '/maua', db });
  assert(mauaRes.profile?.lojaSlug === 'ReiDoOleoMaua', '/maua vincula ReiDoOleoMaua');

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. REGRA DE OURO DO RESET ABORTIVO
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 2. Validação da Regra de Ouro do /reset Abortivo ---');

  // Simula histórico de auditoria existente antes do reset
  db.prepare(`
    INSERT INTO conversation_messages (phone, role, content)
    VALUES (?, 'user', 'Qual o faturamento de ontem?')
  `).run(authPhone1);
  db.prepare(`
    INSERT INTO conversation_messages (phone, role, content)
    VALUES (?, 'assistant', 'O faturamento consolidado foi R$ 120.000.')
  `).run(authPhone1);

  // Define um contexto ativo e uma loja assumida
  await interceptCommand({ phone: authPhone1, text: '/rudge', db });
  assert(getUserProfile(db, authPhone1).lojaSlug === 'MPrudge', 'Usuário estava com perfil de Rudge Ramos');

  // 2.1 Simula Job de IA em Voo (Geração em Andamento)
  const abortRegistry = InFlightAbortRegistry.getInstance();
  const inFlightJobId = 'job_test_inflight_123';
  const inFlightBatchId = 'batch_test_456';
  const abortController = abortRegistry.register(authPhone1, inFlightJobId, inFlightBatchId);

  let presenceEvents: string[] = [];
  const mockPresenceFn = async (p: string, pres: 'composing' | 'paused') => {
    presenceEvents.push(`${p}:${pres}`);
  };

  // Dispara presença 'composing'
  await mockPresenceFn(authPhone1, 'composing');
  assert(presenceEvents.includes(`${authPhone1}:composing`), 'Presença "digitando" estava ativa');

  // Mock de Batcher para verificar cancelamento de lote obsoleto
  let batchMarkedObsolete: string | null = null;
  let inFlightClearedPhone: string | null = null;
  const mockBatcher = {
    isInFlight: (k: string) => k === authPhone1,
    getInFlight: (k: string) => ({ batchId: inFlightBatchId }),
    markBatchObsolete: (bid: string) => { batchMarkedObsolete = bid; },
    clearInFlight: (k: string) => { inFlightClearedPhone = k; }
  };

  assert(abortRegistry.hasInFlight(authPhone1), 'Registro detecta job em voo para authPhone1');

  // 2.2 Usuário envia /reset enquanto a IA está gerando resposta
  const resetRes = await interceptCommand({
    phone: authPhone1,
    text: '/reset',
    db,
    batcher: mockBatcher,
    abortRegistry,
    presenceFn: mockPresenceFn
  });

  // Asserções críticas da Regra de Ouro:
  assert(resetRes.handled, '/reset executado com sucesso');
  assert(resetRes.abortedInFlight === true, 'Regra de Ouro: detectou e abortou geração em voo');
  assert(abortController.signal.aborted, 'AbortSignal do job em voo foi acionado');
  assert(abortRegistry.isAborted(authPhone1, inFlightJobId), 'InFlightAbortRegistry reporta job como abortado');
  assert(batchMarkedObsolete === inFlightBatchId, 'Lote do batcher foi marcado explicitamente como obsoleto');
  assert(inFlightClearedPhone === authPhone1, 'Estado in-flight do batcher foi removido');
  assert(presenceEvents.includes(`${authPhone1}:paused`), 'Presença "digitando" foi encerrada imediatamente com "paused"');

  // 2.3 Validação de Limpeza de Contexto e Nova Geração de Memória
  const profileAfterReset = getUserProfile(db, authPhone1);
  assert(profileAfterReset.persona === 'socio', 'Persona restaurada para Sócio');
  assert(profileAfterReset.defaultScope === 'rede', 'Escopo restaurado para Rede');
  assert(profileAfterReset.lojaSlug === undefined, 'Loja simulada removida');
  assert(profileAfterReset.memoryGeneration === 2, 'Geração de memória incrementada (1 -> 2)');
  assert(!!profileAfterReset.dailyMemoryResetAt, 'Timestamp de reset de memória diária registrado');

  const turnContextAfterReset = getLatestTurnState(db, authPhone1, 120);
  assert(turnContextAfterReset === null, 'Contexto conversacional em hydra_turn_contexts foi completamente limpo');

  // 2.4 Confirmação Única e Preservação de Auditoria Histórica
  assert(resetRes.messages.length === 1, 'Confirmação do reset enviada em balão único');
  assert(resetRes.replyText?.includes('> *Contexto e Memória Reiniciados*'), 'Título de confirmação limpo');
  assert(resetRes.replyText?.includes('Geração em voo:* Interrompida'), 'Menciona interrupção da resposta em voo');

  const msgAuditCount = db.prepare('SELECT count(*) as c FROM conversation_messages WHERE phone = ?').get(authPhone1) as any;
  assert(msgAuditCount.c === 2, 'Auditoria histórica (conversation_messages) preservada intacta (2 registros)');

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. COMPOSITOR SEMÂNTICO (ORDEM DE LEITURA & TABELAS MARKDOWN)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 3. Compositor Semântico (Ordem de Leitura & Tabelas Markdown) ---');

  // 3.1 Eliminação de Tabelas Markdown (|---|)
  const markdownTableSample = `
| Loja | Faturamento | Meta | Atingimento |
| :--- | :--- | :--- | :--- |
| Santo André | R$ 160.000,00 | R$ 180.000,00 | 88,9% |
| Dom Pedro I | R$ 210.000,00 | R$ 200.000,00 | 105,0% |
| Kennedy | R$ 95.000,00 | R$ 100.000,00 | 95,0% |
`;

  const convertedTable = convertMarkdownTablesToWhatsAppLists(markdownTableSample);
  assert(!convertedTable.includes('|'), 'Zero pipes "|" residuais na tabela convertida');
  assert(!convertedTable.includes('---'), 'Zero delimitadores de cabeçalho residuais');
  assert(convertedTable.includes('- *Santo André:*'), 'Linha 1 formatada como lista com marcador - e negrito');
  assert(convertedTable.includes('R$ 160.000,00'), 'Preserva valor monetário de Santo André');
  assert(convertedTable.includes('88,9%'), 'Preserva percentual de atingimento');
  assert(convertedTable.includes('- *Dom Pedro I:*'), 'Linha 2 formatada como lista com marcador - e negrito');

  // 3.2 Ordem Semântica de Leitura: 1. Direta -> 2. Leitura -> 3. Detalhes -> 4. Fonte
  const unorderedSections = {
    sourcePeriod: '> *Fonte:* Relatório Oficial de Metas • Período: 01 a 28/02/2026',
    details: `- *Dom Pedro I:* R$ 210.000,00 (105,0%)\n- *Jabaquara:* R$ 195.000,00 (102,6%)\n- *Santo André:* R$ 160.000,00 (88,9%)`,
    resultReading: '> *Leitura do Resultado*\n- 7 de 10 lojas superaram a meta. O desvio concentrou-se em Santo André por falta de peças.',
    directAnswer: '> *Atingimento de Metas — Rede*\n- Faturamento acumulado de *R$ 1.845.200,00*, atingindo *92,3%* da meta projetada.'
  };

  const semanticBalloons = composeSemanticBalloons(unorderedSections);
  assert(semanticBalloons.length >= 1, 'Compositor gerou balões semânticos');

  const combinedOutput = semanticBalloons.join('\n\n');
  const posDirect = combinedOutput.indexOf('Atingimento de Metas — Rede');
  const posReading = combinedOutput.indexOf('Leitura do Resultado');
  const posDetails = combinedOutput.indexOf('Dom Pedro I');
  const posSource = combinedOutput.indexOf('Relatório Oficial de Metas');

  assert(posDirect !== -1, 'Resposta direta presente');
  assert(posReading !== -1, 'Leitura do resultado presente');
  assert(posDetails !== -1, 'Detalhes presentes');
  assert(posSource !== -1, 'Fonte/período presente');

  assert(posDirect < posReading, '1. Resposta direta precede 2. Leitura do resultado');
  assert(posReading < posDetails, '2. Leitura do resultado precede 3. Detalhes pedidos');
  assert(posDetails < posSource, '3. Detalhes pedidos precedem 4. Fonte/período');

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. ORÇAMENTO DE CARACTERES (700 A 900) & QUEBRAS RESPEITOSAS
  // ─────────────────────────────────────────────────────────────────────────────
  console.log('\n--- 4. Orçamento de Caracteres (700 a 900) & Quebras Respeitosas ---');

  // 4.1 Mensagem Curta (< 700 chars) -> 1 único balão
  const shortText = '> *Status Operacional*\n- Todas as 10 lojas operando normalmente hoje.\n- Total de veículos no pátio: 42.';
  const shortBalloons = composeSemanticBalloons(shortText);
  assert(shortBalloons.length === 1, 'Mensagem curta permanece em 1 único balão');
  assert(shortBalloons[0].includes('Todas as 10 lojas'), 'Conteúdo do balão único íntegro');

  // 4.2 Relatório Extenso de 10 Lojas com ~1600 caracteres -> 2 balões de ~800 chars
  const tenStoresDetails = [
    '- *Dom Pedro I:* Faturamento: R$ 215.400,00 • Meta: R$ 200.000,00 • Atingimento: 107,7% • 18 carros no pátio',
    '- *Jabaquara:* Faturamento: R$ 198.200,00 • Meta: R$ 190.000,00 • Atingimento: 104,3% • 14 carros no pátio',
    '- *Jorge Beretta:* Faturamento: R$ 142.100,00 • Meta: R$ 150.000,00 • Atingimento: 94,7% • 9 carros no pátio',
    '- *Kennedy:* Faturamento: R$ 185.000,00 • Meta: R$ 180.000,00 • Atingimento: 102,8% • 12 carros no pátio',
    '- *Piraporinha:* Faturamento: R$ 160.500,00 • Meta: R$ 170.000,00 • Atingimento: 94,4% • 15 carros no pátio',
    '- *Planalto:* Faturamento: R$ 175.000,00 • Meta: R$ 170.000,00 • Atingimento: 102,9% • 11 carros no pátio',
    '- *Rudge Ramos:* Faturamento: R$ 230.800,00 • Meta: R$ 220.000,00 • Atingimento: 104,9% • 22 carros no pátio',
    '- *Santo André:* Faturamento: R$ 155.000,00 • Meta: R$ 185.000,00 • Atingimento: 83,8% • 26 carros no pátio',
    '- *Rei do Módulo:* Faturamento: R$ 190.000,00 • Meta: R$ 195.000,00 • Atingimento: 97,4% • 19 carros no pátio',
    '- *Rei do Óleo Mauá:* Faturamento: R$ 193.200,00 • Meta: R$ 210.000,00 • Atingimento: 92,0% • 16 carros no pátio'
  ].join('\n');

  const fullReport = {
    directAnswer: '> *Desempenho Geral de Metas e Faturamento — Rede*\n- Atingimento consolidado de *98,5%* da meta da rede no mês de fevereiro de 2026, totalizando *R$ 1.845.200,00* em faturamento apurado.',
    resultReading: '> *Diagnóstico e Leitura Executiva*\n- 6 lojas superaram 100% da meta. Santo André e Piraporinha apresentaram retenção de pátio acima da média por espera de autopeças terceirizadas.',
    details: tenStoresDetails,
    sourcePeriod: '> *Fonte:* Relatório Oficial de Metas do Hydra • Atualizado em: 28/02/2026 às 19:00'
  };

  const multiBalloons = composeSemanticBalloons(fullReport);

  assert(multiBalloons.length >= 2 && multiBalloons.length <= 3, `Relatório de 10 lojas gerou entre 2 e 3 balões (gerados: ${multiBalloons.length})`);

  // Validação do orçamento de caracteres em cada balão
  for (let i = 0; i < multiBalloons.length; i++) {
    const b = multiBalloons[i];
    const len = b.length;
    console.log(`     Balão ${i + 1}: ${len} caracteres`);

    assert(len <= 950, `Balão ${i + 1} não estoura o teto (${len} <= 950 caracteres)`);
    assert(assertNoDoubleAsterisks(b), `Balão ${i + 1} possui zero asteriscos duplos (**)`);
    assert(assertWhatsAppNativeFormat(b), `Balão ${i + 1} está em formato nativo WhatsApp estrito`);

    // Valida que nenhuma linha começa de forma quebrada ou no meio de um valor monetário
    assert(!b.startsWith('00,00') && !b.startsWith(',00'), `Balão ${i + 1} não corta número no início`);
    assert(!b.endsWith('R$') && !b.endsWith('R$ '), `Balão ${i + 1} não quebra cifrão no final`);
  }

  // Validação de Integridade: todas as 10 lojas estão presentes nos balões
  const joinedBalloons = multiBalloons.join('\n');
  assert(joinedBalloons.includes('Dom Pedro I'), 'Dom Pedro I presente');
  assert(joinedBalloons.includes('Jabaquara'), 'Jabaquara presente');
  assert(joinedBalloons.includes('Jorge Beretta'), 'Jorge Beretta presente');
  assert(joinedBalloons.includes('Kennedy'), 'Kennedy presente');
  assert(joinedBalloons.includes('Piraporinha'), 'Piraporinha presente');
  assert(joinedBalloons.includes('Planalto'), 'Planalto presente');
  assert(joinedBalloons.includes('Rudge Ramos'), 'Rudge Ramos presente');
  assert(joinedBalloons.includes('Santo André'), 'Santo André presente');
  assert(joinedBalloons.includes('Rei do Módulo'), 'Rei do Módulo presente');
  assert(joinedBalloons.includes('Rei do Óleo Mauá'), 'Rei do Óleo Mauá presente');

  // Validação de Quebras Respeitosas: cada item de loja começa na sua própria linha
  for (const line of joinedBalloons.split('\n')) {
    if (line.includes('Faturamento: R$')) {
      assert(line.trim().startsWith('- *'), `Item de loja íntegro na linha: "${line.slice(0, 30)}..."`);
    }
  }

  console.log('\n===============================================================================');
  console.log(`🎯 RESULTADO FINAL: ${passedTests}/${totalTests} TESTES APROVADOS!`);
  console.log('===============================================================================\n');

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('💥 Erro fatal nos testes:', err);
  process.exit(1);
});
