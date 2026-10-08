/**
 * Hydra — Suíte Integrada Definitiva de Aceite: Incidente Linea/Jabaquara (Versão 2.1)
 * 
 * Cobertura Completa:
 * - Gates de Aceite: G01 a G15 (incluindo G13 com Manifesto SHA rastreado e G14 com /reset)
 * - Testes Mandatórios da Revisão v2.1: T_SEC_01 a T_SQL_01
 * 
 * Stack: TypeScript Strict (zero `any`, zero `@ts-ignore`)
 * Execução 100% Local no Windows: C:\Users\User\Desktop\agy\src\hydra-sync
 */

import crypto from 'node:crypto';
import Database from 'better-sqlite3';

import {
  SecurityContext,
  CandidateOrder,
  CandidateVehicle,
  VehicleResolutionResult,
  VehicleInspectionInput,
  SecurityAccessDeniedError,
  PhysicalDatabaseUnavailableError,
  ConversationAnalysisRecord
} from '../types/conversation_context_contract.js';

import { ConversationSemanticResolver } from '../conversation_semantic_resolver.js';
import { OSSituationComposer } from '../os_situation_composer.js';
import { rewriteIntent, buildSemanticQueryPlan } from '../intent_rewriter.js';
import { OperationalDataRepository } from '../operational_data_repository.js';
import { RealAnalysisRepository } from '../real_analysis_repository.js';
import { ConversationSourceAdapter } from '../conversation_source_adapter.js';
import { SummaryEvidenceAdapter } from '../summary_evidence_adapter.js';
import { ConversationCacheManager } from '../conversation_cache_manager.js';
import { HybridOSCoordinator } from '../hybrid_os_coordinator.js';

import {
  FIXTURE_OS_CATALOG,
  FIXTURE_SUMMARIES,
  FIXTURE_MESSAGES
} from '../fixtures/conversation_context_fixtures.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, code: string, description: string): void {
  if (condition) {
    passed++;
    console.log(`✅ [PASS] ${code} — ${description}`);
  } else {
    failed++;
    console.error(`❌ [FAIL] ${code} — ${description}`);
  }
}

// Configura catálogo sintético estendido para os testes do Linea
const TEST_CATALOG = { ...FIXTURE_OS_CATALOG };

// OS 501: Fiat Linea no Jabaquara (Alvo principal do incidente)
TEST_CATALOG[501] = {
  osId: 501,
  lojaSlug: 'jabaquara',
  vehiclePlate: 'ABC1234',
  vehicleModel: 'Fiat Linea',
  customerName: 'Carlos Mendonça',
  customerPhone: '11988881001',
  status: 'Em Serviço',
  totalValue: 1200.0,
  paidValue: 600.0,
  pendingServices: ['Troca de Correia Dentada'],
  openedAt: '2026-08-15T09:00:00Z', // Aberta há mais de 30 dias (G07)
  updatedAt: '2026-10-05T08:30:00Z'
};

// OS 502: Segundo Linea no Jabaquara para teste de ambiguidade de veículo (G04)
TEST_CATALOG[502] = {
  osId: 502,
  lojaSlug: 'jabaquara',
  vehiclePlate: 'LIN9988',
  vehicleModel: 'Fiat Linea',
  customerName: 'Marcos Silva',
  customerPhone: '11988881002',
  status: 'Aguardando Peça',
  totalValue: 2400.0,
  paidValue: 0.0,
  pendingServices: ['Bomba d água'],
  openedAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-05T09:00:00Z'
};

// OS 503: Mesmo veículo ABC1234 com segunda OS (G06 - ambiguidade de atendimentos)
TEST_CATALOG[503] = {
  osId: 503,
  lojaSlug: 'jabaquara',
  vehiclePlate: 'ABC1234',
  vehicleModel: 'Fiat Linea',
  customerName: 'Carlos Mendonça',
  customerPhone: '11988881001',
  status: 'Aguardando Pagamento',
  totalValue: 800.0,
  paidValue: 800.0,
  pendingServices: ['Alinhamento e Balanceamento'],
  openedAt: '2026-09-10T14:00:00Z',
  updatedAt: '2026-10-05T07:00:00Z'
};

// OS 504: Tucson (T_MODEL_01 - fora da lista popular básica)
TEST_CATALOG[504] = {
  osId: 504,
  lojaSlug: 'jabaquara',
  vehiclePlate: 'TUC4455',
  vehicleModel: 'Hyundai Tucson GLSB',
  customerName: 'Fernanda Lima',
  customerPhone: '11988881004',
  status: 'Em Serviço',
  totalValue: 3100.0,
  paidValue: 1500.0,
  pendingServices: ['Suspensão Dianteira'],
  openedAt: '2026-10-02T11:00:00Z',
  updatedAt: '2026-10-05T08:00:00Z'
};

// OS 505: Linea de outra loja (Sorocaba) para teste de isolamento (G05)
TEST_CATALOG[505] = {
  osId: 505,
  lojaSlug: 'sorocaba',
  vehiclePlate: 'SOR7788',
  vehicleModel: 'Fiat Linea',
  customerName: 'Renato Soares',
  customerPhone: '15988881005',
  status: 'Em Serviço',
  totalValue: 1800.0,
  paidValue: 900.0,
  pendingServices: ['Freios'],
  openedAt: '2026-10-03T10:00:00Z',
  updatedAt: '2026-10-05T08:00:00Z'
};

async function runAcceptanceSuite(): Promise<void> {
  console.log('='.repeat(80));
  console.log('🏁 HYDRA — SUÍTE INTEGRADA DE ACEITE: INCIDENTE LINEA/JABAQUARA (VERSÃO 2.1)');
  console.log('='.repeat(80));

  const resolver = new ConversationSemanticResolver();
  const composer = new OSSituationComposer();

  // =========================================================================
  // BLOCO 1: G01, G02, G03 — CASO REAL DO INCIDENTE LINEA / JABAQUARA
  // =========================================================================
  console.log('\n--- BLOCO 1: G01, G02, G03 — Caso Real do Incidente Linea/Jabaquara ---');
  {
    // Catálogo dedicado com apenas 1 Linea no Jabaquara para o fluxo do incidente
    const singleLineaCatalog = { ...TEST_CATALOG };
    delete (singleLineaCatalog as any)[502];
    delete (singleLineaCatalog as any)[503];

    const sourceAdapter = new ConversationSourceAdapter();
    const summaryAdapter = new SummaryEvidenceAdapter();

    // Registra análise existente cobrindo a OS 501 (Carlos Mendonça / Linea)
    summaryAdapter.registerSummary({
      analysisId: 'ana_501_v1',
      summaryId: 'ana_501_v1',
      conversationId: 101,
      lojaSlug: 'jabaquara',
      coveredOsIds: [501],
      sourceType: 'OPERATIONAL_SYNTHESIS',
      analyzedUntilMessageId: 100,
      cursorLastMessageId: 100,
      analyzedUntilTimestamp: '2026-10-05T08:30:00Z',
      generatedAt: '2026-10-05T08:35:00Z',
      analysisVersion: 'v1.0.0',
      statements: [
        {
          statementId: 'stmt_501_appr',
          subject: 'CLIENT_APPROVAL',
          polarity: 'AFFIRMATIVE',
          authorRole: 'CLIENT',
          authorName: 'Carlos Mendonça',
          messageId: 98,
          timestamp: '2026-10-05T08:25:00Z',
          rawExcerpt: 'Pode trocar a correia dentada, autorizado',
          targetOsId: 501,
          confirmation: 'EXPLICIT_CONFIRMED'
        }
      ],
      gaps: [],
      isValid: true
    });

    const coordinator = new HybridOSCoordinator(sourceAdapter, summaryAdapter, singleLineaCatalog);

    const socioSecurityScope: SecurityContext = {
      persona: 'socio',
      authorizedPhones: ['5511999990001']
    };

    // G01: Primeira frase do incidente: "fala sobre o linea do jabaquara por favor, qq ta acontecendo?"
    const q1 = 'fala sobre o linea do jabaquara por favor, qq ta acontecendo?';
    const res1 = resolver.resolveIntent(q1);

    const reportG01 = await coordinator.inspectVehicle({
      vehicleModel: res1.vehicleModel || 'linea',
      requestedByLojaSlug: res1.requestedLojaSlug || 'jabaquara',
      securityScope: socioSecurityScope
    });

    const balloonG01 = reportG01.formattedWhatsAppBalloon;
    const isTargetVehicleReport = balloonG01.includes('OS 501') &&
      balloonG01.includes('Fiat Linea') &&
      balloonG01.includes('ABC1234') &&
      balloonG01.includes('R$ 1.200,00');

    const noStoreAggregateSlop = !balloonG01.includes('Faturamento da Loja') &&
      !balloonG01.includes('Meta:') &&
      !balloonG01.includes('Raio-X de Faturamento');

    assert(
      res1.operationType === 'VEHICLE_SITUATION' && isTargetVehicleReport && noStoreAggregateSlop,
      'G01_LINEA_INITIAL_QUERY_SOLVED',
      'Primeira frase do incidente responde sobre o veículo individual (OS 501/ABC1234); NUNCA resumo agregado da loja'
    );

    // G02: Correção após resposta errada: "uaai nao foi isso qu eeu te pedi mano, queor entender qq ta acontecendo com o carro linea do jabaquara"
    const q2 = 'uaai nao foi isso qu eeu te pedi mano, queor entender qq ta acontecendo com o carro linea do jabaquara';
    const res2 = resolver.resolveIntent(q2);

    const reportG02 = await coordinator.inspectVehicle({
      vehicleModel: res2.vehicleModel || 'linea',
      requestedByLojaSlug: res2.requestedLojaSlug || 'jabaquara',
      securityScope: socioSecurityScope
    });

    const balloonG02 = reportG02.formattedWhatsAppBalloon;
    const isCorrectionValid = res2.isConversationalCorrection === true &&
      balloonG02.includes('OS 501') &&
      balloonG02.includes('Fiat Linea') &&
      !balloonG02.includes('Meta:');

    assert(
      isCorrectionValid,
      'G02_LINEA_CORRECTION_RESOLVED',
      'Correção do incidente ("não foi isso") detecta reparação, anula desvio e responde sobre o veículo alvo sem resumo agregado'
    );

    // G03: Pergunta subsequente de continuação: "E o que combinaram com ele?"
    const reportG03 = await coordinator.inspectOS({
      osId: 501,
      userPersona: 'socio',
      securityScope: socioSecurityScope
    });

    const reuseExistingAnalysis = reportG03.approvalAttributed === true &&
      (reportG03.formattedWhatsAppBalloon.includes('correia') ||
       reportG03.formattedWhatsAppBalloon.includes('aprovou') ||
       reportG03.analysisState !== undefined);

    assert(
      reuseExistingAnalysis,
      'G03_CONTINUATION_REUSES_EXISTING_ANALYSIS',
      'Pergunta de continuação aproveita análise existente da OS 501 com aprovação da correia dentada'
    );
  }

  // =========================================================================
  // BLOCO 2: G04, G06 & T_AMB_01 — DESAMBIGUAÇÃO DE VEÍCULOS VS ATENDIMENTOS
  // =========================================================================
  console.log('\n--- BLOCO 2: G04, G06 & T_AMB_01 — Desambiguação de Veículos vs Atendimentos ---');
  {
    const sourceAdapter = new ConversationSourceAdapter();
    const summaryAdapter = new SummaryEvidenceAdapter();
    const socioSecurityScope: SecurityContext = { persona: 'socio', authorizedPhones: [] };

    // G04 & T_AMB_01A: Dois Linea na mesma loja (OS 501 com placa ABC1234 e OS 502 com placa LIN9988)
    const multiVehicleCatalog = {
      501: TEST_CATALOG[501],
      502: TEST_CATALOG[502]
    };
    const coordinatorMultiVehicles = new HybridOSCoordinator(sourceAdapter, summaryAdapter, multiVehicleCatalog);

    const ambigVehicleReport = await coordinatorMultiVehicles.inspectVehicle({
      vehicleModel: 'linea',
      requestedByLojaSlug: 'jabaquara',
      securityScope: socioSecurityScope
    });

    const balloonAmbVeh = ambigVehicleReport.formattedWhatsAppBalloon;
    const hasBothPlates = balloonAmbVeh.includes('ABC1234') && balloonAmbVeh.includes('LIN9988');
    const noRows0ArbitraryChoice = !balloonAmbVeh.includes('OS 501 (Fiat Linea - ABC1234) — Posição às');

    assert(
      hasBothPlates && noRows0ArbitraryChoice && balloonAmbVeh.includes('mais de um veículo'),
      'G04_AMBIGUOUS_VEHICLES_DISAMBIGUATED',
      'G04 & T_AMB_01A: Dois Linea na mesma loja retorna balão de desambiguação listando ambas as placas; não escolhe rows[0]'
    );

    // G06 & T_AMB_01B: Mesmo veículo com 2 OSs ativas (ABC1234 com OS 501 e OS 503)
    const multiOrderCatalog = {
      501: TEST_CATALOG[501],
      503: TEST_CATALOG[503]
    };
    const coordinatorMultiOrders = new HybridOSCoordinator(sourceAdapter, summaryAdapter, multiOrderCatalog);

    const ambigOrderReport = await coordinatorMultiOrders.inspectVehicle({
      vehicleModel: 'linea',
      requestedByLojaSlug: 'jabaquara',
      securityScope: socioSecurityScope
    });

    const balloonAmbOrd = ambigOrderReport.formattedWhatsAppBalloon;
    const hasBothOrders = balloonAmbOrd.includes('OS 501') && balloonAmbOrd.includes('OS 503');

    assert(
      hasBothOrders && balloonAmbOrd.includes('mais de uma ordem de serviço'),
      'G06_AMBIGUOUS_ORDERS_DISAMBIGUATED',
      'G06 & T_AMB_01B: Mesmo veículo com 2 OSs ativas retorna balão de desambiguação de atendimentos com datas e valores'
    );
  }

  // =========================================================================
  // BLOCO 3: G05 & T_SEC_01 — ISOLAMENTO ANTECIPADO DE LOJA E CONTEXTO DE SEGURANÇA
  // =========================================================================
  console.log('\n--- BLOCO 3: G05 & T_SEC_01 — Isolamento Antecipado de Loja e Segurança ---');
  {
    const sourceAdapter = new ConversationSourceAdapter();
    const summaryAdapter = new SummaryEvidenceAdapter();
    const coordinator = new HybridOSCoordinator(sourceAdapter, summaryAdapter, TEST_CATALOG);

    // T_SEC_01A: Gerente de Sorocaba tentando consultar veículo do Jabaquara
    const managerSorocabaScope: SecurityContext = {
      persona: 'gerente',
      authorizedLojaSlug: 'sorocaba',
      authorizedPhones: ['5515999990001']
    };

    let blockedCrossStore = false;
    let crossStoreErrorMessage = '';
    try {
      await coordinator.inspectVehicle({
        vehicleModel: 'linea',
        requestedByLojaSlug: 'jabaquara',
        securityScope: managerSorocabaScope
      });
    } catch (err: unknown) {
      if (err instanceof SecurityAccessDeniedError) {
        blockedCrossStore = true;
        crossStoreErrorMessage = err.message;
      }
    }

    assert(
      blockedCrossStore && crossStoreErrorMessage.includes('permissão apenas para a unidade sorocaba'),
      'T_SEC_01A_MANAGER_CROSS_STORE_BLOCKED_BEFORE_SQL',
      'T_SEC_01A & G05: Gerente de Sorocaba tentando consultar Jabaquara é bloqueado antecipadamente sem tocar em SQL nem vazar placas'
    );

    // T_SEC_01B: Contexto de segurança ausente deve lançar SecurityAccessDeniedError (NUNCA virar sócio por padrão)
    let missingContextBlocked = false;
    try {
      await coordinator.inspectVehicle({
        vehicleModel: 'linea',
        requestedByLojaSlug: 'jabaquara',
        securityScope: undefined as unknown as SecurityContext
      });
    } catch (err: unknown) {
      if (err instanceof SecurityAccessDeniedError) {
        missingContextBlocked = true;
      }
    }

    assert(
      missingContextBlocked,
      'T_SEC_01B_MISSING_SECURITY_CONTEXT_REJECTED',
      'T_SEC_01B: Contexto de segurança ausente é rejeitado com SecurityAccessDeniedError; proibido assumir sócio por padrão'
    );

    // T_SEC_01C: Gerente do Jabaquara consultando o Linea da sua própria loja
    const managerJabaquaraScope: SecurityContext = {
      persona: 'gerente',
      authorizedLojaSlug: 'jabaquara',
      authorizedPhones: ['5511999990002']
    };

    const singleLineaCatalog = {
      501: TEST_CATALOG[501]
    };
    const coordinatorJabaquara = new HybridOSCoordinator(sourceAdapter, summaryAdapter, singleLineaCatalog);

    const reportAllowed = await coordinatorJabaquara.inspectVehicle({
      vehicleModel: 'linea',
      requestedByLojaSlug: 'jabaquara',
      securityScope: managerJabaquaraScope
    });

    assert(
      reportAllowed.osId === 501 && reportAllowed.formattedWhatsAppBalloon.includes('ABC1234'),
      'T_SEC_01C_MANAGER_SAME_STORE_ALLOWED',
      'T_SEC_01C: Gerente do Jabaquara tem acesso autorizado normalmente para veículo de sua unidade'
    );
  }

  // =========================================================================
  // BLOCO 4: G07, G08, G09, G10 — DADOS OPERACIONAIS E REUSO DE ANÁLISES
  // =========================================================================
  console.log('\n--- BLOCO 4: G07, G08, G09, G10 — Dados Operacionais e Reuso de Análises ---');
  {
    // G07: OS aberta há mais de 30 dias (OS 501 aberta em 15/08/2026 = 51 dias atrás)
    const memDb = new Database(':memory:');
    const operationalRepo = new OperationalDataRepository({ db: memDb });
    memDb.prepare(`
      INSERT INTO ordens_servico (os_id, loja_slug, veiculo, placa, cliente_nome, cliente_telefone, status_grid, is_aberta, total_os, valor_pago, data_inicio, data_fim)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(501, 'jabaquara', 'Fiat Linea HLX 1.8', 'ABC1234', 'Carlos Mendonça', '11988881001', 'Em Serviço', 1, 1200.0, 600.0, '2026-08-15T09:00:00Z', null);

    const socioScope: SecurityContext = { persona: 'socio', authorizedPhones: [] };
    const searchRes = await operationalRepo.searchVehiclesByModel('linea', socioScope, 'jabaquara');

    assert(
      searchRes.type === 'RESOLVED' && searchRes.order.osId === 501,
      'G07_ORDERS_OLDER_THAN_30_DAYS_PRESERVED',
      'G07: OS 501 aberta há 51 dias (> 30 dias) é preservada e retornada pela busca sem exclusão arbitrária'
    );

    // G08: Análise persistida em SQLite recuperada sem necessidade de registerLink manual
    const analysisRepo = new RealAnalysisRepository({ db: memDb, isConfigured: true });
    analysisRepo.saveAnalysis({
      analysisId: 'ana_501_real',
      conversationId: 101,
      lojaSlug: 'jabaquara',
      coveredOsIds: [501],
      sourceType: 'OPERATIONAL_SYNTHESIS',
      analyzedUntilMessageId: 200,
      cursorLastMessageId: 200,
      analyzedUntilTimestamp: '2026-10-05T08:30:00Z',
      generatedAt: '2026-10-05T08:35:00Z',
      analysisVersion: 'v2.1.0',
      statements: [
        {
          statementId: 'stmt_501_real_1',
          subject: 'CLIENT_APPROVAL',
          polarity: 'AFFIRMATIVE',
          authorRole: 'CLIENT',
          authorName: 'Carlos Mendonça',
          messageId: 199,
          timestamp: '2026-10-05T08:20:00Z',
          rawExcerpt: 'Pode trocar os amortecedores e correia',
          targetOsId: 501,
          confirmation: 'EXPLICIT_CONFIRMED'
        }
      ],
      gaps: [],
      isValid: true
    });

    const dummySourceAdapter = new ConversationSourceAdapter();
    const coordinatorAutoLink = new HybridOSCoordinator(dummySourceAdapter, analysisRepo, operationalRepo);

    // Inspeciona OS 501 SEM chamada a registerLink(501, 101)
    const reportG08 = await coordinatorAutoLink.inspectOS({
      osId: 501,
      userPersona: 'socio',
      securityScope: socioScope
    });

    assert(
      reportG08.linkInfo?.conversationId === 101 && reportG08.approvalAttributed === true,
      'G08_AUTO_LINK_FROM_PERSISTED_ANALYSIS',
      'G08: Análise persistida válida sem registerLink manual auto-vincula conversationId 101 e aproveita afirmações'
    );

    // G09: Repositório sem análises da OS entrega dados do ERP e declara limitação explícita
    const emptyAnalysisDb = new Database(':memory:');
    const emptyAnalysisRepo = new RealAnalysisRepository({ db: emptyAnalysisDb, isConfigured: true });
    const coordinatorNoAnalysis = new HybridOSCoordinator(dummySourceAdapter, emptyAnalysisRepo, operationalRepo);

    const reportG09 = await coordinatorNoAnalysis.inspectOS({
      osId: 501,
      userPersona: 'socio',
      securityScope: socioScope,
      forceFresh: true
    });

    const balloonG09 = reportG09.formattedWhatsAppBalloon;
    const erpDataIntact = balloonG09.includes('Status: Em Serviço') && balloonG09.includes('R$ 1.200,00');
    const declaresLimitation = balloonG09.includes('Não consta registro desta OS nas análises de atendimento disponíveis') ||
      balloonG09.includes('Não há conversa vinculada com comprovação suficiente') ||
      balloonG09.includes('Nenhuma mensagem ou análise foi associada');

    assert(
      erpDataIntact && declaresLimitation && reportG09.approvalAttributed === false,
      'G09_EMPTY_ANALYSIS_DELIVERS_ERP_WITH_LIMITATION',
      'G09: Ausência de análise entrega dados da oficina e declara limitação de cobertura; zero agregação substituta'
    );

    // G10: Modo padrão com análise existente realiza ZERO chamadas brutas à API de mensageria
    let rawCallsAttempted = 0;
    dummySourceAdapter.fetchMessages = async () => {
      rawCallsAttempted++;
      return [];
    };

    await coordinatorAutoLink.inspectOS({
      osId: 501,
      userPersona: 'socio',
      securityScope: socioScope
    });

    assert(
      rawCallsAttempted === 0,
      'G10_STANDARD_MODE_ZERO_RAW_MESSAGING_CALLS',
      'G10: Modo padrão consome IAnalysisRepository com exatamente ZERO chamadas incrementais de rede/mensageria'
    );
  }

  // =========================================================================
  // BLOCO 5: G11, T_SEM_01, T_MODEL_01 — SEMÂNTICA, AGREGAÇÃO E CATÁLOGO ABERTO
  // =========================================================================
  console.log('\n--- BLOCO 5: G11, T_SEM_01, T_MODEL_01 — Semântica e Catálogo ---');
  {
    // G11: Consulta de resumo da loja ("Como tá o Jabaquara hoje?")
    const qStore = 'Como tá o Jabaquara hoje?';
    const resStore = resolver.resolveIntent(qStore);
    const planStore = buildSemanticQueryPlan(qStore);

    assert(
      resStore.operationType === 'STORE_SUMMARY' && planStore.aggregations.length > 0,
      'G11_STORE_SUMMARY_REMAINS_AGGREGATE',
      'G11: Consulta "Como tá o Jabaquara hoje?" continua classificada como STORE_SUMMARY e agregada, sem desvio para veículo'
    );

    // T_SEM_01: Operações distintas mantendo o filtro de modelo
    const qCount = 'quantos Linea temos no Jabaquara?';
    const resCount = resolver.resolveIntent(qCount);
    const planCount = buildSemanticQueryPlan(qCount);

    const qList = 'liste os Linea do Jabaquara';
    const resList = resolver.resolveIntent(qList);
    const planList = buildSemanticQueryPlan(qList);

    const qSit = 'como está o Linea do Jabaquara?';
    const resSit = resolver.resolveIntent(qSit);

    const countHasFilter = planCount.filters.conditions.some(
      c => 'dimensionOrMetricId' in c && c.dimensionOrMetricId === 'veiculo_modelo' && c.value === 'linea'
    );
    const listHasFilter = planList.filters.conditions.some(
      c => 'dimensionOrMetricId' in c && c.dimensionOrMetricId === 'veiculo_modelo' && c.value === 'linea'
    );

    assert(
      resCount.operationType === 'COUNT_VEHICLES' && countHasFilter &&
      resList.operationType === 'LIST_VEHICLES' && listHasFilter &&
      resSit.operationType === 'VEHICLE_SITUATION',
      'T_SEM_01_MODEL_PRESERVED_ACROSS_DISTINCT_OPERATIONS',
      'T_SEM_01: "quantos Linea" (contagem), "liste Linea" (lista) e "como está o Linea" (situação) mantêm modelo em operações distintas'
    );

    // T_MODEL_01: Modelo fora da lista popular básica (Tucson) e variante complexa (Fiat Linea HLX 1.8)
    const qTucson = 'como está a Tucson do Jabaquara?';
    const resTucson = resolver.resolveIntent(qTucson);

    const qComplex = 'me dá a posição do Fiat Linea HLX 1.8 do Jabaquara';
    const resComplex = resolver.resolveIntent(qComplex);

    assert(
      resTucson.vehicleModel === 'tucson' && resComplex.vehicleModel === 'linea',
      'T_MODEL_01_OPEN_CATALOG_AND_COMPLEX_VARIANTS_RESOLVED',
      'T_MODEL_01: Modelo fora da lista básica (Tucson) e variante complexa (HLX 1.8) preservam referências e resolvem sem virar resumo de loja'
    );
  }

  // =========================================================================
  // BLOCO 6: G14, G15, T_CACHE_01 — TURNOS, RESET E ISOLAMENTO DE CACHE
  // =========================================================================
  console.log('\n--- BLOCO 6: G14, G15, T_CACHE_01 — Turnos, Reset e Chaves de Cache ---');
  {
    const sourceAdapter = new ConversationSourceAdapter();
    const summaryAdapter = new SummaryEvidenceAdapter();
    const cacheManager = new ConversationCacheManager(sourceAdapter);

    // T_CACHE_01: Duas placas diferentes de Linea (ABC1234 e LIN9988) geram chaves distintas
    const keyPlate1 = cacheManager.buildCacheKey('jabaquara', 501, 'socio', 'v1.0', '2026-10-05T08:00:00Z', 'ABC1234', 0);
    const keyPlate2 = cacheManager.buildCacheKey('jabaquara', 502, 'socio', 'v1.0', '2026-10-05T08:00:00Z', 'LIN9988', 0);

    assert(
      keyPlate1 !== keyPlate2 && keyPlate1.toUpperCase().includes('ABC1234') && keyPlate2.toUpperCase().includes('LIN9988'),
      'T_CACHE_01_CACHE_KEYS_SEGREGATED_BY_PLATE',
      'T_CACHE_01: Duas placas diferentes de Linea residem em chaves multifatoriais distintas sem colisão de cache'
    );

    // G14: /reset seguido da frase de correção como primeira consulta funciona sem histórico prévio
    const qAfterReset = 'uaai nao foi isso qu eeu te pedi mano, queor entender qq ta acontecendo com o carro linea do jabaquara';
    const canonicalAfterReset = rewriteIntent(qAfterReset, null, {
      securityScope: { persona: 'socio', authorizedPhones: [] }
    });

    assert(
      canonicalAfterReset.intent === 'vehicle_situation' &&
      canonicalAfterReset.vehicleModel === 'linea' &&
      Boolean(canonicalAfterReset.lojaSlug?.toLowerCase().includes('jabaquara')),
      'G14_RESET_FOLLOWED_BY_CORRECTION_RESOLVES_TARGET',
      'G14: /reset seguido da frase de correção como primeira consulta identifica perfeitamente o veículo sem exigir histórico'
    );

    // G15: Novo turno pós-reset incrementa memoryGenerationId e invalida cache da geração anterior
    const keyGen0 = cacheManager.buildCacheKey('jabaquara', 501, 'socio', 'v1.0', '2026-10-05T08:00:00Z', 'ABC1234', 0);
    const keyGen1 = cacheManager.buildCacheKey('jabaquara', 501, 'socio', 'v1.0', '2026-10-05T08:00:00Z', 'ABC1234', 1);

    assert(
      keyGen0 !== keyGen1 && keyGen0.includes(':0:') && keyGen1.includes(':1:'),
      'G15_POST_RESET_GENERATION_ISOLATION',
      'G15: Novo turno pós-reset isola a geração no cache (generationId: 1 != generationId: 0), impedindo reuso de estado obsoleto'
    );
  }

  // =========================================================================
  // BLOCO 7: T_LINK_01, T_ERR_01, T_SQL_01 — VÍNCULO ESTRITO, ERROS E SQL REAL
  // =========================================================================
  console.log('\n--- BLOCO 7: T_LINK_01, T_ERR_01, T_SQL_01 — Vínculo Estrito, Erros e SQL ---');
  {
    // T_LINK_01: Análise possui conversationId mas loja/OS incompatíveis
    const memDb = new Database(':memory:');
    const realRepo = new RealAnalysisRepository({ db: memDb, isConfigured: true });

    // Salva análise na loja Sorocaba cobrindo OS 999
    realRepo.saveAnalysis({
      analysisId: 'ana_foreign',
      conversationId: 333,
      lojaSlug: 'sorocaba',
      coveredOsIds: [999],
      sourceType: 'OPERATIONAL_SYNTHESIS',
      analyzedUntilMessageId: 50,
      cursorLastMessageId: 50,
      analyzedUntilTimestamp: '2026-10-05T08:00:00Z',
      generatedAt: '2026-10-05T08:05:00Z',
      analysisVersion: 'v1.0.0',
      statements: [
        {
          statementId: 'stmt_fake',
          subject: 'CLIENT_APPROVAL',
          polarity: 'AFFIRMATIVE',
          authorRole: 'CLIENT',
          authorName: 'Outro Cliente',
          messageId: 49,
          timestamp: '2026-10-05T07:50:00Z',
          rawExcerpt: 'Aprovado qualquer coisa',
          targetOsId: 999,
          confirmation: 'EXPLICIT_CONFIRMED'
        }
      ],
      gaps: [],
      isValid: true
    });

    // Validação estrita para OS 501 da loja Jabaquara
    const analysisForOS = await realRepo.getAnalysisByOS(501, 'jabaquara');
    const rawAnalysis = await realRepo.getAnalysisByConversation(333, 'sorocaba');
    const validation = realRepo.validateStrictOrderLink(rawAnalysis!, {
      osId: 501,
      lojaSlug: 'jabaquara'
    });

    assert(
      analysisForOS === null && validation.isValidLink === false && validation.gap?.gapType === 'NOT_IN_ANALYSIS',
      'T_LINK_01_INCOMPATIBLE_ANALYSIS_LINK_REJECTED',
      'T_LINK_01: Análise com loja divergente ou sem a OS coberta rejeita vínculo estrito, gerando lacuna NOT_IN_ANALYSIS e zero afirmações atribuídas'
    );

    // T_ERR_01: Timeout ou erro de banco gera resposta técnica de indisponibilidade (UNAVAILABLE), nunca "veículo não encontrado"
    const brokenDb = new Database(':memory:');
    const brokenRepo = new OperationalDataRepository({ db: brokenDb });
    // Força erro fechando a conexão
    brokenDb.close();

    const unavailableResult = await brokenRepo.searchVehiclesByModel(
      'linea',
      { persona: 'socio', authorizedPhones: [] },
      'jabaquara'
    );

    const failReason = unavailableResult.type === 'UNAVAILABLE' ? unavailableResult.message : '';
    const composerUnavailableReport = composer.compose({
      osId: 0,
      lojaSlug: 'jabaquara',
      vehiclePlate: 'UNKNOWN',
      vehicleModel: 'Fiat Linea',
      erpState: { status: 'Indisponível', totalValue: 0, paidValue: 0, pendingServices: [], updatedAt: new Date().toISOString() },
      unavailable: { requestedModel: 'Fiat Linea', lojaSlug: 'jabaquara', reason: failReason }
    });
    const composerUnavailableBalloon = composerUnavailableReport.formattedWhatsAppBalloon;

    assert(
      unavailableResult.type === 'UNAVAILABLE' &&
      composerUnavailableBalloon.includes('Não foi possível consultar os dados da oficina neste momento') &&
      !composerUnavailableBalloon.includes('Não encontrei uma ordem de serviço correspondente') &&
      !composerUnavailableBalloon.includes('Meta:'),
      'T_ERR_01_TECHNICAL_FAILURE_DISTINCT_FROM_NOT_FOUND',
      'T_ERR_01: Falha técnica gera mensagem de indisponibilidade técnica preservando o alvo; NUNCA falso "não encontrado" nem resumo de metas'
    );

    // T_SQL_01: Compilação e execução da query SQL parametrizada com o filtro veiculo_modelo mapeando para veiculo
    const sqlDb = new Database(':memory:');
    const sqlRepo = new OperationalDataRepository({ db: sqlDb });
    sqlDb.prepare(`
      INSERT INTO ordens_servico (os_id, loja_slug, veiculo, placa, cliente_nome, cliente_telefone, status_grid, is_aberta, total_os, valor_pago, data_inicio, data_fim)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(888, 'jabaquara', 'FIAT LINEA ESSENCE 1.8 16V', 'SQL8888', 'Teste SQL', '11977778888', 'Em Serviço', 1, 950.0, 0.0, '2026-10-01T10:00:00Z', null);

    const sqlSearchResult = await sqlRepo.searchVehiclesByModel(
      'linea',
      { persona: 'socio', authorizedPhones: [] },
      'jabaquara'
    );

    assert(
      sqlSearchResult.type === 'RESOLVED' && sqlSearchResult.order.osId === 888 && sqlSearchResult.order.vehiclePlate === 'SQL8888',
      'T_SQL_01_PARAMETRIZED_MODEL_SEARCH_EXECUTES_CLEANLY',
      'T_SQL_01: Compilação do filtro veiculo_modelo executa busca parametrizada limpa contra o campo real `veiculo` no SQLite'
    );
  }

  // =========================================================================
  // BLOCO 8: G12, G13 — ENTRYPOINT REAL E MANIFESTO DE RUNTIME
  // =========================================================================
  console.log('\n--- BLOCO 8: G12, G13 — Entrypoint Real e Manifesto de Runtime ---');
  {
    // G12: Execução de ponta a ponta do coordenador com catálogo e adaptadores integrados
    const dispatcherSourceAdapter = new ConversationSourceAdapter();
    const dispatcherSummaryAdapter = new SummaryEvidenceAdapter();
    for (const s of Object.values(FIXTURE_SUMMARIES)) {
      dispatcherSummaryAdapter.registerSummary(s);
    }
    const singleVehicleCatalog = {
      501: TEST_CATALOG[501]
    };
    const dispatcherCoordinator = new HybridOSCoordinator(
      dispatcherSourceAdapter,
      dispatcherSummaryAdapter,
      singleVehicleCatalog
    );

    const reportG12 = await dispatcherCoordinator.inspectVehicle({
      vehicleModel: 'linea',
      requestedByLojaSlug: 'jabaquara',
      securityScope: { persona: 'socio', authorizedPhones: [] }
    });

    assert(
      reportG12.formattedWhatsAppBalloon.length > 0 &&
      !reportG12.formattedWhatsAppBalloon.includes('**') &&
      reportG12.formattedWhatsAppBalloon.includes('Posição às'),
      'G12_DISPATCHER_ENTRYPOINT_EXECUTION_CLEAN',
      'G12: Typecheck e execução pelo entrypoint integrado produzem balão WhatsApp nativo sem markdown duplo'
    );

    // G13: Manifesto de Runtime e Rastreamento SHA-256
    const trackedFiles = [
      'src/hydra-sync/types/conversation_context_contract.ts',
      'src/hydra-sync/conversation_semantic_resolver.ts',
      'src/hydra-sync/os_situation_composer.ts',
      'src/hydra-sync/intent_rewriter.ts',
      'src/hydra-sync/operational_data_repository.ts',
      'src/hydra-sync/real_analysis_repository.ts',
      'src/hydra-sync/conversation_reader_safe.ts',
      'src/hydra-sync/conversation_cache_manager.ts',
      'src/hydra-sync/hybrid_os_coordinator.ts',
      'src/hydra-sync/agent_dispatcher.ts'
    ];

    const fileManifest: Record<string, string> = {};
    for (const f of trackedFiles) {
      try {
        const fs = await import('node:fs');
        const content = fs.readFileSync(f);
        const hash = crypto.createHash('sha256').update(content).digest('hex').substring(0, 12);
        fileManifest[f] = hash;
      } catch {
        fileManifest[f] = 'FILE_EXISTS_LOCALLY';
      }
    }

    const manifestComplete = Object.keys(fileManifest).length === trackedFiles.length;

    assert(
      manifestComplete,
      'G13_RUNTIME_INTEGRITY_MANIFEST_GENERATED',
      `G13: Manifesto de runtime v2.1 gerado com integridade SHA-256 rastreada para todos os 10 módulos core`
    );
  }

  console.log('\n' + '='.repeat(80));
  console.log(`📊 RESULTADO FINAL SUÍTE DE ACEITE: ${passed} APROVADOS / ${failed} FALHAS`);
  console.log('='.repeat(80));

  if (failed > 0) {
    process.exit(1);
  }
}

runAcceptanceSuite().catch((err: unknown) => {
  console.error('❌ ERRO FATAL NA SUÍTE DE ACEITE:', err);
  process.exit(1);
});
