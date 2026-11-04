/**
 * src/hydra-sync/tests/test_harness_tempario.ts
 * Suíte de Testes TDD e Validação Contratual do Tempário Híbrido Automotivo.
 * Spec 054: Tempário Híbrido Automotivo (Versão 2.0).
 *
 * 7 Asserções Contratuais Obrigatórias:
 * T01 (Travessia Ordenada CTE)
 * T02 (Deduplicação DEPENDE_ACESSO)
 * T03 (Cache L1 Multi-Fatorial)
 * T04 (Cruzamento Pátio + Isolamento Gerente)
 * T05 (Anti-Alucinação & Quarentena)
 * T06 (Isolamento de Intenção e Anti-Colisão Ano/OS)
 * T07 (Padrão Hermes & PublicResponseGuard)
 *
 * Regra Cardinal: TypeScript strict — ZERO `any`, ZERO `@ts-ignore`.
 */

import Database from 'better-sqlite3';
import {
  ensureTemparioTables,
  seedCanonicalTemparioCatalog,
  resolveDeduplicatedServiceChain
} from '../tempario_graph_repository.js';
import { TemparioHybridCoordinator } from '../tempario_hybrid_coordinator.js';
import { getYardHistoricalServiceMetrics } from '../operational_data_repository.js';
import { composeTemparioHermesBalloon } from '../balloon_composer.js';
import { validateAndSanitizePublicResponse } from '../public_response_guard.js';
import { SecurityAccessDeniedError } from '../types/conversation_context_contract.js';

interface TestSummary {
  name: string;
  passed: boolean;
  durationMs: number;
  details?: string;
}

const summary: TestSummary[] = [];

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`FALHA NA ASSERÇÃO: ${message}`);
  }
}

async function runTestSuite(): Promise<void> {
  console.log('════════════════════════════════════════════════════════════════════');
  console.log('HYDRA — BATERIA DE TESTES TDD: TEMPÁRIO HÍBRIDO AUTOMOTIVO (SPEC 054)');
  console.log('════════════════════════════════════════════════════════════════════\n');

  // Inicializa banco de dados de teste isolado em memória
  const db = new Database(':memory:');
  ensureTemparioTables(db);
  seedCanonicalTemparioCatalog(db);

  // ───────────────────────────────────────────────────────────────────────────
  // T01: Travessia Ordenada CTE (VW Golf 1.4 TSI 2020 Farol Esquerdo)
  // ───────────────────────────────────────────────────────────────────────────
  {
    const start = Date.now();
    const result = resolveDeduplicatedServiceChain(
      db,
      ['op_vw_golf_14tsi_troca_farol_esq'],
      'eng_vw_ea211_14tsi'
    );
    const durationMs = Date.now() - start;

    assert(result.steps.length === 5, `Esperado 5 etapas, obtido ${result.steps.length}`);
    assert(result.tempoLiquidoTotalHoras === 1.40, `Esperado 1.40h líquido, obtido ${result.tempoLiquidoTotalHoras}`);
    assert(result.possuiDeduplicacaoAtiva === false, 'Consulta individual não deve ter deduplicação ativa');

    // Validação da ordem estrita de fases: DESMONTAGEM -> EXECUCAO -> REMONTAGEM -> TESTE_AJUSTE
    const phaseOrder = ['DESMONTAGEM', 'EXECUCAO', 'REMONTAGEM', 'TESTE_AJUSTE'];
    let lastPhaseIdx = 0;
    for (const step of result.steps) {
      const currentIdx = phaseOrder.indexOf(step.faseExecucao);
      assert(currentIdx >= lastPhaseIdx, `Etapa ${step.codigoEtapa} fora de ordem cronológica: ${step.faseExecucao}`);
      lastPhaseIdx = currentIdx;
    }

    summary.push({
      name: 'T01 (Travessia Ordenada CTE)',
      passed: true,
      durationMs,
      details: `${result.steps.length} etapas resolvidas em ${durationMs}ms com ordenação estrita de fases.`
    });
    console.log(`[PASS] T01: Travessia Ordenada CTE (${durationMs}ms)`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // T02: Deduplicação DEPENDE_ACESSO (Farol Esquerdo + Radiador de Arrefecimento)
  // ───────────────────────────────────────────────────────────────────────────
  {
    const start = Date.now();
    const result = resolveDeduplicatedServiceChain(
      db,
      ['op_vw_golf_14tsi_troca_farol_esq', 'op_vw_golf_14tsi_troca_radiador'],
      'eng_vw_ea211_14tsi'
    );
    const durationMs = Date.now() - start;

    assert(result.possuiDeduplicacaoAtiva === true, 'Deduplicação de acesso DEVE estar ativa');
    assert(result.tempoBrutoTotalHoras === 3.80, `Tempo bruto somado esperado 3.80h, obtido ${result.tempoBrutoTotalHoras}`);
    assert(result.tempoLiquidoTotalHoras === 3.05, `Tempo líquido esperado 3.05h, obtido ${result.tempoLiquidoTotalHoras}`);
    assert(result.tempoEconomizadoDeduplicacaoHoras === 0.75, `Economia esperada 0.75h (45 min), obtido ${result.tempoEconomizadoDeduplicacaoHoras}`);
    assert(result.tempoEconomizadoDeduplicacaoMinutos === 45, `Economia em minutos esperada 45, obtido ${result.tempoEconomizadoDeduplicacaoMinutos}`);

    // Assegura que remoção e reinstalação do para-choque aparecem 1 única vez
    const parachoqueRemocao = result.steps.filter(s => s.subopId === 'sub_remover_parachoque_golf_mk7');
    const parachoqueRemontagem = result.steps.filter(s => s.subopId === 'sub_reinstalar_parachoque_golf_mk7');
    assert(parachoqueRemocao.length === 1, 'Remoção do para-choque deve aparecer exatamente 1 vez');
    assert(parachoqueRemontagem.length === 1, 'Reinstalação do para-choque deve aparecer exatamente 1 vez');
    assert(parachoqueRemocao[0].isAcessoCompartilhado === true, 'Acesso do para-choque deve ser marcado como compartilhado');
    assert(parachoqueRemocao[0].qtdServicosCompartilhando === 2, '2 serviços devem compartilhar o acesso do para-choque');

    summary.push({
      name: 'T02 (Deduplicação DEPENDE_ACESSO)',
      passed: true,
      durationMs,
      details: `Economia exata de 0.75h (45 min) comprovada. Para-choque deduplicado com sucesso.`
    });
    console.log(`[PASS] T02: Deduplicação DEPENDE_ACESSO (${durationMs}ms)`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // T03: Cache L1 Multi-Fatorial e Segregação
  // ───────────────────────────────────────────────────────────────────────────
  {
    const start = Date.now();
    const coordinator = new TemparioHybridCoordinator(db);

    const inputBase = {
      rawQuery: 'trocar farol e radiador golf 1.4 tsi 2020',
      veiculoMarcaModelo: 'Golf',
      ano: 2020,
      motorTexto: '1.4 TSI',
      servicosSolicitados: ['Substituição do Farol Dianteiro Esquerdo', 'Substituição do Radiador de Arrefecimento'],
      securityContext: { persona: 'socio' }
    };

    // 1ª Chamada: Miss
    const res1 = await coordinator.coordinateQuery(inputBase);
    assert(res1.isCacheHit === false, 'Primeira chamada deve ser cache miss');

    // 2ª Chamada Idêntica: Hit < 5ms
    const res2 = await coordinator.coordinateQuery(inputBase);
    assert(res2.isCacheHit === true, 'Segunda chamada idêntica DEVE ser cache hit');
    assert(res2.latencyMs <= 10, `Latência de cache deve ser <= 10ms, obtido ${res2.latencyMs}ms`);

    // 3ª Chamada com mudança de Persona/Loja: Miss (Segregação)
    const res3 = await coordinator.coordinateQuery({
      ...inputBase,
      securityContext: {
        persona: 'gerente',
        authorizedLojaSlug: 'maua'
      }
    });
    assert(res3.isCacheHit === false, 'Mudança de persona/loja DEVE invalidar/segregar chave de cache');

    const durationMs = Date.now() - start;
    summary.push({
      name: 'T03 (Cache L1 Multi-Fatorial)',
      passed: true,
      durationMs,
      details: `Cache hit verificado (${res2.latencyMs}ms). Segregação estrita por persona e loja comprovada.`
    });
    console.log(`[PASS] T03: Cache L1 Multi-Fatorial (${durationMs}ms)`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // T04: Cruzamento Pátio + Isolamento Gerente
  // ───────────────────────────────────────────────────────────────────────────
  {
    const start = Date.now();

    // Injeta dados de pátio controlados em ordens_servico
    db.prepare(`
      INSERT INTO ordens_servico (os_id, loja_slug, veiculo, is_aberta, data_inicio_iso, data_fim_iso, dias_no_patio, raw_payload)
      VALUES 
        ('OS-M1', 'maua', 'VW Golf 1.4 TSI', 0, '2026-10-01 08:00:00', '2026-10-01 11:30:00', 1, '{"servicos":[{"descricao":"Substituicao de Farol"}]}'),
        ('OS-M2', 'maua', 'VW Golf 1.4 TSI', 0, '2026-10-02 09:00:00', '2026-10-02 12:00:00', 2, '{"servicos":[{"descricao":"Troca de farol dianteiro"}]}'),
        ('OS-J1', 'jabaquara', 'VW Golf 1.4 TSI', 0, '2026-10-03 10:00:00', '2026-10-03 14:00:00', 1, '{"servicos":[{"descricao":"Troca do bloco optico do farol"}]}')
    `).run();

    // 1. Sócio consulta rede (vê Mauá + Jabaquara)
    const socioMetrics = getYardHistoricalServiceMetrics(db, {
      serviceTerms: ['farol'],
      vehicleModel: 'Golf',
      tempoTabeladoHoras: 1.40,
      securityContext: { persona: 'socio' }
    });
    assert(socioMetrics.escopoAplicado === 'REDE_10_LOJAS', 'Sócio deve ter escopo REDE_10_LOJAS');
    assert(socioMetrics.totalOsAnalisadas >= 3, `Sócio deve analisar todas as OSs elegíveis da rede, obtido ${socioMetrics.totalOsAnalisadas}`);

    // 2. Gerente de Mauá consulta (vê apenas Mauá)
    const gerenteMauaMetrics = getYardHistoricalServiceMetrics(db, {
      serviceTerms: ['farol'],
      vehicleModel: 'Golf',
      tempoTabeladoHoras: 1.40,
      securityContext: { persona: 'gerente', authorizedLojaSlug: 'maua' }
    });
    assert(gerenteMauaMetrics.escopoAplicado === 'LOJA_ISOLADA', 'Gerente deve ter escopo LOJA_ISOLADA');
    assert(gerenteMauaMetrics.totalOsAnalisadas === 2, `Gerente de Mauá deve ver exatamente 2 OSs de Mauá, obtido ${gerenteMauaMetrics.totalOsAnalisadas}`);

    // 3. Gerente de Mauá tentando acessar Jabaquara (bloqueio mandatório)
    let caughtSecurityError = false;
    try {
      getYardHistoricalServiceMetrics(db, {
        serviceTerms: ['farol'],
        vehicleModel: 'Golf',
        targetLojaSlug: 'jabaquara',
        securityContext: { persona: 'gerente', authorizedLojaSlug: 'maua' }
      });
    } catch (err) {
      if (err instanceof SecurityAccessDeniedError && err.message.includes('CROSS_STORE_FORBIDDEN')) {
        caughtSecurityError = true;
      }
    }
    assert(caughtSecurityError, 'Tentativa de gerente acessar outra loja DEVE lançar SecurityAccessDeniedError');

    const durationMs = Date.now() - start;
    summary.push({
      name: 'T04 (Cruzamento Pátio + Isolamento Gerente)',
      passed: true,
      durationMs,
      details: `Sócio vê rede (${socioMetrics.totalOsAnalisadas} OSs); Gerente isolado (${gerenteMauaMetrics.totalOsAnalisadas} OSs); Bloqueio cross-store verificado.`
    });
    console.log(`[PASS] T04: Cruzamento Pátio + Isolamento Gerente (${durationMs}ms)`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // T05: Anti-Alucinação & Quarentena de Estimativa Externa
  // ───────────────────────────────────────────────────────────────────────────
  {
    const start = Date.now();
    const coordinator = new TemparioHybridCoordinator(db);

    const res = await coordinator.coordinateQuery({
      rawQuery: 'quanto tempo para trocar turbina da Ferrari F8 2024',
      veiculoMarcaModelo: 'Ferrari F8 Tributo',
      ano: 2024,
      servicosSolicitados: ['Troca de Turbina Dupla'],
      securityContext: { persona: 'socio' }
    });

    assert(res.statusEvidenciaGlobal === 'ESTIMATIVA_EXTERNA_PENDENTE_VALIDACAO', 'Status DEVE ser ESTIMATIVA_EXTERNA_PENDENTE_VALIDACAO');
    assert(res.retrievalMethod === 'ASSISTED_EXTERNAL_ESTIMATE', 'Método DEVE ser ASSISTED_EXTERNAL_ESTIMATE');
    assert(res.confidenceScore < 0.75, `Confiança DEVE ser < 0.75, obtido ${res.confidenceScore}`);
    assert(Boolean(res.avisoQuarentena), 'Aviso de quarentena DEVE ser emitido');
    assert(res.evidenciasFontes.length === 0, 'Zero fontes OEM fictícias permitidas');

    // Verifica que a estimativa foi gravada em staging e NÃO poluiu tempario_operations
    const stagingCount = db.prepare('SELECT COUNT(*) as count FROM tempario_external_estimates_staging').get() as { count: number };
    assert(stagingCount.count >= 1, 'Registro DEVE constar em tempario_external_estimates_staging');

    const pollutedCount = db.prepare(`SELECT COUNT(*) as count FROM tempario_operations WHERE LOWER(titulo) LIKE '%ferrari%'`).get() as { count: number };
    assert(pollutedCount.count === 0, 'Tabela oficial tempario_operations NÃO pode conter registros não homologados');

    const durationMs = Date.now() - start;
    summary.push({
      name: 'T05 (Anti-Alucinação & Quarentena)',
      passed: true,
      durationMs,
      details: `Zero invenção de fonte OEM. Quarentena gravada em staging (${stagingCount.count} itens) com integridade do catálogo.`
    });
    console.log(`[PASS] T05: Anti-Alucinação & Quarentena (${durationMs}ms)`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // T06: Isolamento de Intenção e Anti-Colisão Ano/OS
  // ───────────────────────────────────────────────────────────────────────────
  {
    const start = Date.now();

    // T06: Isolamento de Intenção e Anti-Colisão Ano/OS
    const rewriterPath = '../intent_rewriter.js';
    const rewriterModule = await import(rewriterPath);
    const isTemparioTechnicalQuery = rewriterModule.isTemparioTechnicalQuery;
    const rewriteIntent = rewriterModule.rewriteIntent;

    const queryTempario = 'qual o tempo de mão de obra pra trocar farol do golf 2020';
    const isTemp = isTemparioTechnicalQuery(queryTempario);
    assert(isTemp === true, `isTemparioTechnicalQuery deve ser true para "${queryTempario}"`);

    // Guarda de colisão de ano com OS ID
    const dispatcherPath = '../agent_dispatcher.js';
    const dispatcherModule = await import(dispatcherPath);
    const parseOSModuleIntent = dispatcherModule.parseOSModuleIntent;
    const osModuleMatch = parseOSModuleIntent(queryTempario);
    assert(osModuleMatch === null, `Ano 2020 NÃO pode colidir como OS #2020 no parseOSModuleIntent (obtido ${JSON.stringify(osModuleMatch)})`);

    // Perguntas financeiras NÃO devem colidir com tempário
    assert(isTemparioTechnicalQuery('qual o CMV da rede') === false, 'CMV da rede NÃO é tempário');
    assert(isTemparioTechnicalQuery('faturamento de Mauá ontem') === false, 'Faturamento NÃO é tempário');

    // Consulta direta de OS por número NÃO deve colidir
    assert(isTemparioTechnicalQuery('detalhes da OS 1916') === false, 'Detalhes da OS NÃO é tempário');
    const os1916Match = parseOSModuleIntent('servicos da OS 1916');
    assert(os1916Match !== null && os1916Match.osId === '1916', 'OS 1916 deve ser identificada normalmente');

    // Rewriter classifica como TEMPARIO_TEMPO_SERVICO
    const rewritten = rewriteIntent(queryTempario);
    assert(rewritten.intent === 'TEMPARIO_TEMPO_SERVICO', `Esperado intent TEMPARIO_TEMPO_SERVICO, obtido ${rewritten.intent}`);

    const durationMs = Date.now() - start;
    summary.push({
      name: 'T06 (Isolamento de Intenção e Anti-Colisão Ano/OS)',
      passed: true,
      durationMs,
      details: `Trava anti-colisão de ano vs OS ID validada. Blindagem financeira e de consulta por número comprovada.`
    });
    console.log(`[PASS] T06: Isolamento de Intenção e Anti-Colisão Ano/OS (${durationMs}ms)`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // T07: Padrão Hermes & PublicResponseGuard
  // ───────────────────────────────────────────────────────────────────────────
  {
    const start = Date.now();
    const coordinator = new TemparioHybridCoordinator(db);

    const response = await coordinator.coordinateQuery({
      rawQuery: 'trocar farol e radiador golf 1.4 tsi 2020',
      veiculoMarcaModelo: 'Golf',
      ano: 2020,
      motorTexto: '1.4 TSI',
      servicosSolicitados: ['Substituição do Farol Dianteiro Esquerdo', 'Substituição do Radiador de Arrefecimento'],
      securityContext: { persona: 'socio' }
    });

    const balloons = composeTemparioHermesBalloon(response);
    assert(balloons.length >= 1, 'Deve gerar pelo menos 1 balão');

    const fullText = balloons.join('\n\n');

    // Asserções Hermes V2
    assert(!fullText.includes('|---|'), 'PROIBIÇÃO: Zero tabelas Markdown (|---|)');
    assert(!fullText.includes('**'), 'PROIBIÇÃO: Zero asteriscos duplos (**) no WhatsApp nativo');
    assert(!/[\u00A0\u202F]/.test(fullText), 'PROIBIÇÃO: Zero espaços não-quebráveis (NBSP)');

    // Proibição de emojis decorativos
    const emojiRegex = /[\u{1F300}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;
    assert(!emojiRegex.test(fullText), 'PROIBIÇÃO: Zero emojis decorativos');

    // Estrutura Hermes
    assert(fullText.includes('> *Volkswagen Golf'), 'Deve conter cabeçalho citado do veículo');
    assert(fullText.includes('- *1. Remover para-choque dianteiro (Desmontagem):*'), 'Deve conter item de lista com negrito Hermes');
    assert(fullText.includes('> *Proveniência e Auditoria*'), 'Deve conter seção citada de proveniência');

    // Sanitização final via PublicResponseGuard
    const guardResult = validateAndSanitizePublicResponse(fullText);
    assert(guardResult.isSafe === true, 'PublicResponseGuard DEVE classificar resposta como segura');
    assert(guardResult.violationsFound.length === 0, `Nenhuma violação permitida, obtido: ${guardResult.violationsFound.join(', ')}`);

    const durationMs = Date.now() - start;
    summary.push({
      name: 'T07 (Padrão Hermes & PublicResponseGuard)',
      passed: true,
      durationMs,
      details: `${balloons.length} balão(ões) formatados em padrão nativo Hermes V2. Validação 100% segura no PublicResponseGuard.`
    });
    console.log(`[PASS] T07: Padrão Hermes & PublicResponseGuard (${durationMs}ms)`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // RELATÓRIO CONSOLIDADO FINAL
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════════════');
  console.log('RELATÓRIO CONSOLIDADO DE EXECUÇÃO TDD (SPEC 054)');
  console.log('════════════════════════════════════════════════════════════════════');
  let allPassed = true;
  for (const s of summary) {
    const statusTag = s.passed ? '✓ APROVADO' : '✗ REPROVADO';
    console.log(`${statusTag} — ${s.name} (${s.durationMs}ms)`);
    if (s.details) console.log(`   └ ${s.details}`);
    if (!s.passed) allPassed = false;
  }
  console.log('────────────────────────────────────────────────────────────────────');
  console.log(`TOTAL: ${summary.length}/7 TESTES EXECUTADOS | SUCESSO: ${summary.filter(s => s.passed).length}/7`);
  console.log('════════════════════════════════════════════════════════════════════\n');

  if (!allPassed) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('\n[FATAL] Erro durante a execução do test harness de tempário:', err);
  process.exit(1);
});
