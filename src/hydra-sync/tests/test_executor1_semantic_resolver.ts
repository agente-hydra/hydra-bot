/**
 * Hydra — Suíte de Testes Isolada do Executor 1 (Versão 2)
 * Spec: hydra-os-conversation-context
 * Responsabilidade: Executor 1 (Interpretação e Semântica de Negócio)
 * Gates da Auditoria: Gate 1 (case: "negation"), Gate 2 (case: "missing_link_evidence")
 */

import { ConversationSemanticResolver } from '../conversation_semantic_resolver';
import { OSSituationComposer } from '../os_situation_composer';
import { SanitizedMessage } from '../types/conversation_context_contract';

let passed = 0;
let failed = 0;

function assert(condition: boolean, id: string, desc: string): void {
  if (condition) {
    passed++;
    console.log(`✅ [PASS] ${id} — ${desc}`);
  } else {
    failed++;
    console.error(`❌ [FAIL] ${id} — ${desc}`);
  }
}

async function runExecutor1Tests(): Promise<void> {
  console.log('='.repeat(80));
  console.log('🧠 EXECUTOR 1: SUÍTE DE TESTES SEMÂNTICOS DE ANÁLISE E NEGAÇÃO (VERSÃO 2)');
  console.log('='.repeat(80));

  const resolver = new ConversationSemanticResolver();
  const composer = new OSSituationComposer();

  // Teste 1: Resolução de Intenções Operacionais e Detecção de Modo Complementar
  {
    const res1 = resolver.resolveIntent('Como está a situação da OS 501?');
    assert(
      res1.isOSSituationQuery && res1.targetOSId === 501 && !res1.isRawHistoryRequested,
      'EX1_T01_INTENT_STANDARD_MODE',
      'Identifica consulta padrão de situação da OS 501 sem pedido de histórico bruto'
    );

    const res2 = resolver.resolveIntent('Como está a OS 501? Leia as últimas mensagens');
    assert(
      Boolean(res2.isOSSituationQuery && res2.targetOSId === 501 && res2.isRawHistoryRequested),
      'EX1_T02_INTENT_COMPLEMENTARY_MODE_REQUESTED',
      'Identifica solicitação explícita de leitura de mensagens recentes (Modo Complementar)'
    );

    const res3 = resolver.resolveIntent('Quais OS estão com cliente aguardando retorno?');
    assert(
      res3.isOSSituationQuery && res3.isAggregatorQuery,
      'EX1_T03_INTENT_AGGREGATOR_QUERY',
      'Identifica pergunta agregadora de OSs aguardando cliente'
    );
  }

  // Teste 2: GATE 1 DA AUDITORIA — case: "negation" (Negação Rigorosa)
  {
    const msgNegApproval: SanitizedMessage = {
      messageId: 10,
      conversationId: 101,
      senderType: 'contact',
      senderName: 'Carlos Souza',
      textContent: 'Nao autorizo o servico de amortecedor, achei muito caro',
      isPrivate: false,
      createdAt: '2026-10-01T10:10:00Z',
      hasAttachments: false
    };
    const stmtNegApproval = resolver.extractStatement(msgNegApproval, 501);

    // GATE 1: NUNCA pode ser CLIENT_APPROVAL
    assert(
      stmtNegApproval?.subject === 'CLIENT_REFUSAL' && 
      stmtNegApproval.polarity === 'NEGATIVE' &&
      stmtNegApproval.confirmation === 'EXPLICIT_CONFIRMED',
      'EX1_GATE1_NEGATION_REFUSAL_NOT_APPROVAL',
      'Gate 1 (Auditoria): "Nao autorizo o servico" é classificado estritamente como CLIENT_REFUSAL e NUNCA CLIENT_APPROVAL'
    );

    const msgNegPay: SanitizedMessage = {
      messageId: 11,
      conversationId: 101,
      senderType: 'contact',
      senderName: 'Carlos Souza',
      textContent: 'Ainda nao fiz o Pix, estou sem limite no aplicativo',
      isPrivate: false,
      createdAt: '2026-10-01T10:15:00Z',
      hasAttachments: false
    };
    const stmtNegPay = resolver.extractStatement(msgNegPay, 501);

    // GATE 1: NUNCA pode ser PAYMENT_CLAIM
    assert(
      stmtNegPay?.subject === 'PAYMENT_REFUSAL' &&
      stmtNegPay.polarity === 'NEGATIVE',
      'EX1_GATE1_NEGATION_UNPAID_NOT_CLAIM',
      'Gate 1 (Auditoria): "Ainda nao fiz o Pix" é classificado como PAYMENT_REFUSAL e NUNCA PAYMENT_CLAIM'
    );
  }

  // Teste 3: GATE 2 DA AUDITORIA — case: "missing_link_evidence" (Vínculo Estrito)
  {
    // Conversa com "Pode fazer", mas sem número da OS nem placa comprovada
    const msgVague: SanitizedMessage = {
      messageId: 20,
      conversationId: 999,
      senderType: 'contact',
      senderName: 'Desconhecido',
      textContent: 'Pode fazer o conserto sim!',
      isPrivate: false,
      createdAt: '2026-10-01T11:00:00Z',
      hasAttachments: false
    };

    const linkEval = resolver.evaluateLink(
      {
        osId: 501,
        lojaSlug: 'sorocaba',
        vehiclePlate: 'ABC1D23',
        customerPhone: '11988881111',
        customerName: 'Carlos Souza',
        openedAt: '2026-10-01T08:00:00Z'
      },
      {
        conversationId: 999,
        inboxId: 1,
        lojaSlug: 'sorocaba',
        contactPhone: '11977770000', // Telefone diferente
        contactName: 'Outra Pessoa',
        messagesSample: [msgVague]
      }
    );

    assert(
      linkEval.link === undefined && !linkEval.isAmbiguous,
      'EX1_GATE2_MISSING_LINK_EVIDENCE_REJECTED',
      'Gate 2 (Auditoria): Conversa sem identificadores inequívocos retorna link undefined e recusa associação'
    );

    // Compositor com ausência de vínculo comprovado
    const reportNoLink = composer.compose({
      osId: 501,
      lojaSlug: 'sorocaba',
      vehiclePlate: 'ABC1D23',
      vehicleModel: 'Honda Civic',
      erpState: {
        status: 'Aguardando Aprovação',
        totalValue: 2400,
        paidValue: 0,
        pendingServices: ['Amortecedores'],
        updatedAt: '2026-10-01T09:00:00Z'
      },
      noLinkConfirmed: true,
      linkInfo: null
    });

    assert(
      reportNoLink.linkInfo === null &&
      !reportNoLink.formattedWhatsAppBalloon.includes('aprovou') &&
      reportNoLink.limitations.some(l => l.includes('Não há conversa de atendimento vinculada')),
      'EX1_GATE2_NO_APPROVAL_ATTRIBUTED_WITHOUT_LINK',
      'Gate 2 (Auditoria): Zero afirmações atribuídas à OS quando não há evidência de vínculo'
    );
  }

  // Teste 4: Classificação de "Ok" e Balão Nativo sem **
  {
    const msgOk: SanitizedMessage = {
      messageId: 30,
      conversationId: 108,
      senderType: 'contact',
      senderName: 'Fernanda Costa',
      textContent: 'Ok',
      isPrivate: false,
      createdAt: '2026-10-04T11:25:00Z',
      hasAttachments: false
    };
    const stmtOk = resolver.extractStatement(msgOk, 508);
    assert(
      stmtOk?.confirmation === 'AMBIGUOUS_GENERIC',
      'EX1_T06_AMBIGUOUS_OK_CLASSIFICATION',
      '"Ok" isolado é classificado com nível de confirmação AMBIGUOUS_GENERIC'
    );

    const report = composer.compose({
      osId: 508,
      lojaSlug: 'sorocaba',
      vehiclePlate: 'POL9900',
      vehicleModel: 'VW Polo',
      erpState: {
        status: 'Orçamento Enviado',
        totalValue: 3100,
        paidValue: 0,
        pendingServices: ['Correia Dentada'],
        updatedAt: '2026-10-04T11:30:00Z'
      },
      analysisState: {
        analysisId: 'ana_508',
        analysisVersion: 'v1.0',
        analyzedUntilTimestamp: '2026-10-04T11:30:00Z',
        statements: stmtOk ? [stmtOk] : [],
        gaps: []
      }
    });

    const balloon = report.formattedWhatsAppBalloon;
    const hasNoDoubleAsterisks = !balloon.includes('**');
    const hasClearSections = balloon.includes('No sistema da oficina:') && balloon.includes('Nas análises de atendimento existentes:');

    assert(
      hasNoDoubleAsterisks && hasClearSections,
      'EX1_T07_WHATSAPP_BALLOON_CLEAN_FORMAT',
      'Balão formatado respeita rigorosamente padrão sem **, com seções limpas'
    );
  }

  // Teste 3: INCIDENTE LINEA / JABAQUARA — Resolução Semântica e Detecção de Reparação
  {
    const q1 = resolver.resolveIntent('fala sobre o linea do jabaquara por favor, qq ta acontecendo?');
    assert(
      q1.isOSSituationQuery && 
      q1.vehicleModel === 'linea' && 
      q1.requestedLojaSlug === 'jabaquara' && 
      q1.operationType === 'VEHICLE_SITUATION',
      'EX1_T08_LINEA_INITIAL_QUERY',
      'Extrai modelo linea, loja jabaquara e define operationType VEHICLE_SITUATION'
    );

    const q2 = resolver.resolveIntent('uaai nao foi isso qu eeu te pedi mano, queor entender qq ta acontecendo com o carro linea do jabaquara');
    assert(
      q2.isOSSituationQuery && 
      q2.vehicleModel === 'linea' && 
      q2.requestedLojaSlug === 'jabaquara' && 
      Boolean(q2.isConversationalCorrection) && 
      q2.operationType === 'VEHICLE_SITUATION',
      'EX1_T08_LINEA_CORRECTION_QUERY',
      'Detecta reparação conversacional ("não foi isso"), preservando modelo linea e loja jabaquara'
    );

    const qCount = resolver.resolveIntent('Quantos Linea temos no Jabaquara?');
    assert(
      qCount.isAggregatorQuery && 
      qCount.vehicleModel === 'linea' && 
      qCount.operationType === 'COUNT_VEHICLES',
      'EX1_T09_COUNT_VEHICLES_OPERATION',
      'Identifica operação de contagem de veículos sem confundir com situação individual'
    );

    const qList = resolver.resolveIntent('Liste os Linea do Jabaquara');
    assert(
      qList.isAggregatorQuery && 
      qList.vehicleModel === 'linea' && 
      qList.operationType === 'LIST_VEHICLES',
      'EX1_T09_LIST_VEHICLES_OPERATION',
      'Identifica operação de listagem de veículos sem confundir com situação individual'
    );

    // Modelos estendidos / catálogo
    assert(
      resolver.extractVehicleModel('Como está o Fiat Linea HLX 1.8?') === 'linea',
      'EX1_T10_EXTRACT_FIAT_LINEA_HLX',
      'Normaliza e extrai modelo a partir de variante complexa Fiat Linea HLX 1.8'
    );
    assert(
      resolver.extractVehicleModel('Qual a situação do Tucson?') === 'tucson',
      'EX1_T10_EXTRACT_TUCSON',
      'Extrai modelo fora da lista básica (Tucson)'
    );

    // Validação dos Novos Balões do Compositor
    const balloonAmbVeh = composer.composeAmbiguousVehicle(
      [
        { plate: 'ABC1D23', vehiclePlate: 'ABC1D23', model: 'Fiat Linea', vehicleModel: 'Fiat Linea', storeSlug: 'jabaquara', lojaSlug: 'jabaquara', activeOrdersCount: 1 },
        { plate: 'XYZ9K88', vehiclePlate: 'XYZ9K88', model: 'Fiat Linea', vehicleModel: 'Fiat Linea', storeSlug: 'jabaquara', lojaSlug: 'jabaquara', activeOrdersCount: 1 }
      ],
      'linea',
      'jabaquara'
    );
    assert(
      balloonAmbVeh.includes('ABC1D23') && balloonAmbVeh.includes('XYZ9K88') && !balloonAmbVeh.includes('**'),
      'EX1_T11_BALLOON_AMBIGUOUS_VEHICLE',
      'Balão de ambiguidade de veículos lista placas e não inventa ano'
    );

    const balloonNoMatch = composer.composeNoMatch('linea', 'jabaquara');
    assert(
      balloonNoMatch.includes('linea') && balloonNoMatch.includes('jabaquara'),
      'EX1_T11_BALLOON_NO_MATCH',
      'Balão de nenhum veículo encontrado preserva alvo solicitado'
    );

    const balloonUnavailable = composer.composeUnavailable('linea', 'jabaquara', 'tempo limite');
    assert(
      balloonUnavailable.includes('linea') && balloonUnavailable.includes('jabaquara') && balloonUnavailable.includes('tempo limite'),
      'EX1_T11_BALLOON_UNAVAILABLE',
      'Balão de erro técnico informa indisponibilidade e preserva o pedido'
    );
  }

  console.log('\n' + '='.repeat(80));
  console.log(`📊 RESULTADO EXECUTOR 1: ${passed} APROVADOS / ${failed} FALHAS`);
  console.log('='.repeat(80));

  if (failed > 0) process.exit(1);
}

runExecutor1Tests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
