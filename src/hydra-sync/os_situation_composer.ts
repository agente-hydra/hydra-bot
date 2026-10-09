/**
 * Hydra — Compositor de Relatório de Situação da OS (WhatsApp Balloon Native)
 * Spec: hydra-os-conversation-context (Versão 2)
 * Responsabilidade: Executor 1 (Interpretação e Semântica de Negócio)
 * Correções da Auditoria de 05/10/2026: F04 (Veto a vínculo ausente), F05 (Negação), F08 (Validação de Evidência)
 */

import {
  CombinedOSSituationReport,
  DiscrepancyRecord,
  ExtractedStatement,
  ConversationGap,
  OSConversationLink,
  CandidateVehicle,
  CandidateOrder,
  VehicleResolutionResult
} from './types/conversation_context_contract.js';
import { EvidencePolicyManager } from './evidence_policy_manager.js';
import type { EvoListPayload } from './types/evo_interactive_contract.js';

export interface ComposeInput {
  readonly osId: number;
  readonly lojaSlug: string;
  readonly vehiclePlate: string;
  readonly vehicleModel: string;
  readonly openedAt?: string;
  readonly specificQuestionType?: string;
  readonly erpState: {
    readonly status: string;
    readonly totalValue: number;
    readonly paidValue: number;
    readonly pendingServices: readonly string[];
    readonly updatedAt: string;
    readonly openedAt?: string;
  };
  readonly analysisState?: {
    readonly analysisId: string;
    readonly analysisVersion: string;
    readonly analyzedUntilTimestamp: string;
    readonly statements: readonly ExtractedStatement[];
    readonly gaps: readonly ConversationGap[];
  };
  readonly conversationState?: {
    readonly conversationId: number;
    readonly lastMessageAt: string;
    readonly statements: readonly ExtractedStatement[];
    readonly gaps: readonly ConversationGap[];
    readonly isStale: boolean;
    readonly newMessagesInspectedCount: number;
  };
  readonly linkInfo?: OSConversationLink | null;
  readonly noLinkConfirmed?: boolean;
  readonly ambiguityCandidates?: readonly {
    readonly osId: number;
    readonly vehiclePlate: string;
    readonly description: string;
  }[];
  readonly ambiguousVehicles?: readonly CandidateVehicle[];
  readonly ambiguousOrders?: readonly CandidateOrder[];
  readonly noMatch?: {
    readonly requestedModel: string;
    readonly lojaSlug?: string;
  };
  readonly unavailable?: {
    readonly requestedModel: string;
    readonly lojaSlug?: string;
    readonly reason: string;
  };
  readonly conversationServiceUnavailable?: boolean;
  readonly isAggregatorSampleOnly?: boolean;
  readonly cachedResponse?: boolean;
}

export class OSSituationComposer {
  public compose(input: ComposeInput): CombinedOSSituationReport {
    const discrepancies: DiscrepancyRecord[] = [];
    const pendingActions: string[] = [];
    const limitations: string[] = [];

    // 0a. Caso de Não Encontrado (NO_MATCH)
    if (input.noMatch) {
      const balloonNoMatch = this.composeNoMatch(input.noMatch.requestedModel, input.noMatch.lojaSlug || input.lojaSlug);
      return {
        osId: input.osId,
        lojaSlug: input.lojaSlug,
        vehiclePlate: input.vehiclePlate,
        vehicleModel: input.vehicleModel,
        timestampReport: new Date().toISOString(),
        erpState: input.erpState,
        discrepancies: [],
        pendingActions: [],
        limitations: ['Veículo ou ordem de serviço não localizados nos registros consultados.'],
        formattedWhatsAppBalloon: balloonNoMatch,
        cachedResponse: false
      };
    }

    // 0b. Caso de Falha Técnica / Timeout (UNAVAILABLE) — Preserva o alvo
    if (input.unavailable) {
      const balloonUnavailable = this.composeUnavailable(
        input.unavailable.requestedModel,
        input.unavailable.lojaSlug || input.lojaSlug,
        input.unavailable.reason
      );
      return {
        osId: input.osId,
        lojaSlug: input.lojaSlug,
        vehiclePlate: input.vehiclePlate,
        vehicleModel: input.vehicleModel,
        timestampReport: new Date().toISOString(),
        erpState: input.erpState,
        discrepancies: [],
        pendingActions: ['Tentar novamente em instantes'],
        limitations: [`Serviço temporariamente indisponível: ${input.unavailable.reason}`],
        formattedWhatsAppBalloon: balloonUnavailable,
        cachedResponse: false
      };
    }

    // 0c. Caso de Ambiguidade de Veículo (AMBIGUOUS_VEHICLE)
    if (input.ambiguousVehicles && input.ambiguousVehicles.length > 0) {
      const balloonAmbiguousVehicles = this.composeAmbiguousVehicle(
        input.ambiguousVehicles,
        input.vehicleModel,
        input.lojaSlug
      );
      return {
        osId: input.osId,
        lojaSlug: input.lojaSlug,
        vehiclePlate: input.vehiclePlate,
        vehicleModel: input.vehicleModel,
        timestampReport: new Date().toISOString(),
        erpState: input.erpState,
        discrepancies: [],
        pendingActions: ['Aguardando seleção da placa do veículo pelo usuário'],
        limitations: ['Múltiplos veículos correspondentes ao modelo solicitado na unidade'],
        formattedWhatsAppBalloon: balloonAmbiguousVehicles,
        cachedResponse: false
      };
    }

    // 0d. Caso de Ambiguidade de Ordem de Serviço (AMBIGUOUS_ORDER)
    if (input.ambiguousOrders && input.ambiguousOrders.length > 0) {
      const vehicle: CandidateVehicle = {
        plate: input.vehiclePlate || '',
        vehiclePlate: input.vehiclePlate,
        model: input.vehicleModel || '',
        vehicleModel: input.vehicleModel,
        storeSlug: input.lojaSlug,
        lojaSlug: input.lojaSlug,
        activeOrdersCount: input.ambiguousOrders.filter(o => o.isAberta).length
      };
      const balloonAmbiguousOrders = this.composeAmbiguousOrder(vehicle, input.ambiguousOrders);
      return {
        osId: input.osId,
        lojaSlug: input.lojaSlug,
        vehiclePlate: input.vehiclePlate,
        vehicleModel: input.vehicleModel,
        timestampReport: new Date().toISOString(),
        erpState: input.erpState,
        discrepancies: [],
        pendingActions: ['Aguardando seleção da OS pelo usuário'],
        limitations: ['Múltiplas ordens de serviço (histórico e atual) para o mesmo veículo'],
        formattedWhatsAppBalloon: balloonAmbiguousOrders,
        cachedResponse: false
      };
    }

    // 1. Caso de Ambiguidade de Contato (Múltiplas OSs/Veículos para o mesmo contato)
    if (input.ambiguityCandidates && input.ambiguityCandidates.length > 0) {
      const candidatesList = input.ambiguityCandidates
        .map(c => `• OS ${c.osId} (${c.vehiclePlate}) - ${c.description}`)
        .join('\n');

      const balloonAmbiguous = [
        `Identifiquei mais de uma ordem de serviço ativa para este contato.`,
        ``,
        `Para garantir que nenhuma informação seja misturada, selecione a OS desejada:`,
        candidatesList,
        ``,
        `Por favor, informe o número da OS ou a placa do veículo que deseja consultar.`
      ].join('\n');

      return {
        osId: input.osId,
        lojaSlug: input.lojaSlug,
        vehiclePlate: input.vehiclePlate,
        vehicleModel: input.vehicleModel,
        timestampReport: new Date().toISOString(),
        erpState: input.erpState,
        discrepancies: [],
        pendingActions: ['Aguardando desambiguação do operador'],
        limitations: ['Múltiplas ordens ativas para o mesmo contato telefônico'],
        formattedWhatsAppBalloon: balloonAmbiguous,
        cachedResponse: false
      };
    }

    // 2. CORREÇÃO F04: Conversa sem Vínculo Comprovado
    if ((input.noLinkConfirmed || input.linkInfo === null) && !input.conversationServiceUnavailable) {
      limitations.push('Não há conversa de atendimento vinculada comprovadamente a esta OS.');
      const balloonNoLink = [
        `OS ${input.osId} (${input.vehicleModel} - ${input.vehiclePlate}) — Posição às ${this.formatHour(new Date().toISOString())}`,
        ``,
        `No sistema da oficina:`,
        `Status: ${input.erpState.status} (atualizado às ${this.formatHour(input.erpState.updatedAt)})`,
        `Total: ${this.formatCurrency(input.erpState.totalValue)} | Pago: ${this.formatCurrency(input.erpState.paidValue)}`,
        input.erpState.pendingServices.length > 0 ? `Serviços: ${input.erpState.pendingServices.join(', ')}` : '',
        ``,
        `No atendimento ao cliente:`,
        `Não há conversa vinculada com comprovação suficiente para esta ordem de serviço.`,
        ``,
        `Observações de cobertura:`,
        `• Nenhuma mensagem ou análise foi associada à OS por ausência de evidência de vínculo.`
      ].filter(Boolean).join('\n');

      return {
        osId: input.osId,
        lojaSlug: input.lojaSlug,
        vehiclePlate: input.vehiclePlate,
        vehicleModel: input.vehicleModel,
        timestampReport: new Date().toISOString(),
        erpState: input.erpState,
        linkInfo: null,
        discrepancies: [],
        pendingActions: [],
        limitations,
        formattedWhatsAppBalloon: balloonNoLink,
        cachedResponse: false
      };
    }

    // 3. Fallback de Falha na API de Mensagens (Modo Complementar)
    if (input.conversationServiceUnavailable) {
      limitations.push('Serviço de WhatsApp temporariamente inacessível para leitura complementar.');
    }

    // 4. Consolidação das Afirmações (Prioridade: Análise Existente + Modo Complementar se houver)
    const statements = input.conversationState?.statements || input.analysisState?.statements || [];
    const gaps = input.conversationState?.gaps || input.analysisState?.gaps || [];

    let convText = 'Não consta registro desta OS nas análises de atendimento disponíveis.';
    if (statements.length > 0) {
      const convLines: string[] = [];
      
      for (const stmt of statements) {
        // CORREÇÃO F05: Tratamento de Negação e Recusa Explícita
        if (stmt.subject === 'CLIENT_REFUSAL') {
          convLines.push(`O cliente recusou expressamente os serviços às ${this.formatHour(stmt.timestamp)} ("${stmt.rawExcerpt}").`);
          pendingActions.push('Registrar recusa do cliente no sistema da oficina e verificar desfecho da OS.');
        } else if (stmt.subject === 'CLIENT_APPROVAL') {
          if (stmt.confirmation === 'EXPLICIT_CONFIRMED') {
            convLines.push(`O cliente aprovou expressamente os serviços às ${this.formatHour(stmt.timestamp)}.`);
            
            // CORREÇÃO F08: Apenas status de aprovação pendente gera STATUS_LAG
            const isWaitingApproval = 
              input.erpState.status.toLowerCase().includes('aguardando aprovação') || 
              input.erpState.status.toLowerCase().includes('orçamento enviado') ||
              input.erpState.status.toLowerCase() === 'aguardando cliente';

            if (isWaitingApproval) {
              discrepancies.push({
                discrepancyType: 'STATUS_LAG',
                description: 'Cliente aprovou na conversa, mas a OS ainda consta como aguardando aprovação no sistema.',
                erpPosition: input.erpState.status,
                erpTimestamp: input.erpState.updatedAt,
                conversationPosition: 'Aprovação expressa via WhatsApp',
                conversationTimestamp: stmt.timestamp || ''
              });
              pendingActions.push('Atualizar o status cadastral da OS no sistema para refletir a aprovação do cliente.');
            }
          } else if (stmt.confirmation === 'AMBIGUOUS_GENERIC') {
            convLines.push(`O cliente respondeu "${stmt.rawExcerpt}" às ${this.formatHour(stmt.timestamp)}, porém de forma genérica após orçamento.`);
            pendingActions.push('Confirmar com o cliente se a resposta refere-se à aprovação da versão atual do orçamento.');
          }
        } else if (stmt.subject === 'PAYMENT_REFUSAL') {
          convLines.push(`O cliente declarou ainda não ter realizado o pagamento às ${this.formatHour(stmt.timestamp)}.`);
        } else if (stmt.subject === 'PAYMENT_CLAIM') {
          convLines.push(`Alegação de pagamento: o cliente informou ter realizado o pagamento às ${this.formatHour(stmt.timestamp)}.`);
          if (input.erpState.paidValue < input.erpState.totalValue) {
            discrepancies.push({
              discrepancyType: 'PAYMENT_PENDING',
              description: 'Alegação de pagamento pelo cliente, mas não consta baixa financeira no ERP.',
              erpPosition: `Pago: ${this.formatCurrency(input.erpState.paidValue)} de ${this.formatCurrency(input.erpState.totalValue)}`,
              erpTimestamp: input.erpState.updatedAt,
              conversationPosition: 'Alegação de pagamento pelo cliente',
              conversationTimestamp: stmt.timestamp || ''
            });
            pendingActions.push('Conferir extrato bancário/Pix e realizar a baixa do pagamento no sistema.');
          }
        } else if (stmt.subject === 'DOCUMENT_SUBMISSION') {
          convLines.push(`Comprovante enviado pelo cliente às ${this.formatHour(stmt.timestamp)}; pendente conferência contábil.`);
          pendingActions.push('Localizar comprovante anexado e validar conciliação.');
        } else if (stmt.subject === 'ATTENDANT_COMMITMENT') {
          convLines.push(`Atendente registrou previsão/compromisso de entrega às ${this.formatHour(stmt.timestamp)}: "${stmt.rawExcerpt}".`);
        } else if (stmt.subject === 'DELIVERY_PROMISE_CHANGE') {
          convLines.push(`Atendente registrou repactuação de prazo de entrega às ${this.formatHour(stmt.timestamp)}: "${stmt.rawExcerpt}".`);
        } else if (stmt.subject === 'PART_DEPENDENCY') {
          const qty = stmt.partQuantityRequested ?? stmt.partReference?.quantity ?? 1;
          const part = stmt.partName ?? stmt.partReference?.partName ?? 'peça';
          convLines.push(`Atendente informou espera de peça às ${this.formatHour(stmt.timestamp)}: aguardando ${qty} unidade(s) de ${part}.`);
        } else if (stmt.subject === 'PART_ARRIVAL') {
          const qty = stmt.partQuantityArrived ?? stmt.partReference?.quantity ?? 1;
          const part = stmt.partName ?? stmt.partReference?.partName ?? 'peça';
          convLines.push(`Atendente confirmou chegada de peça às ${this.formatHour(stmt.timestamp)}: recebida(s) ${qty} unidade(s) de ${part}.`);
        } else if (stmt.subject === 'DELAY_CAUSE_REPORTED') {
          convLines.push(`Motivo de demora relatado por ${stmt.authorName} às ${this.formatHour(stmt.timestamp)}: "${stmt.rawExcerpt}".`);
        } else if (stmt.subject === 'WATCHDOG_FLAG') {
          // CORREÇÃO F08: Alerta de Watchdog aproveitado como observação de atendimento
          convLines.push(`Observação de atendimento registrada pelo monitor às ${this.formatHour(stmt.timestamp)}: ${stmt.rawExcerpt}.`);
        }
      }

      if (convLines.length > 0) {
        convText = convLines.join('\n');
      }
    }

    // 5. Lacunas de Mídia e Truncamento (Correção F06)
    if (gaps.length > 0) {
      for (const gap of gaps) {
        if (gap.gapType === 'UNTRANSCRIBED_AUDIO') {
          limitations.push(`Áudio recebido às ${this.formatHour(gap.timestamp)} sem transcrição disponível (lacuna de mídia; não inferir silêncio).`);
        } else if (gap.gapType === 'UNREAD_MEDIA') {
          limitations.push(`Arquivo anexado em ${this.formatHour(gap.timestamp)} ainda não processado.`);
        } else if (gap.gapType === 'TRUNCATED_HISTORY') {
          limitations.push('Histórico recente limitado ao orçamento de mensagens; podem existir mensagens mais recentes não analisadas.');
        } else if (gap.gapType === 'NOT_IN_ANALYSIS') {
          limitations.push('Informação sobre aprovação/pagamento não consta nas análises de atendimento consolidadas.');
        }
      }
    }

    if (input.isAggregatorSampleOnly) {
      limitations.push('Resultado baseado na amostra de conversas analisadas; não reflete o total consolidado da loja.');
    }

    // 5b. Resposta específica sobre capacidades do bot
    if (input.specificQuestionType === 'CAPABILITIES_EXPLANATION') {
      const balloonCapabilities = [
        `Consulta de Atendimento — Capacidades e Fontes de Dados`,
        ``,
        `Consigo consultar as informações operacionais da oficina no ERP e as análises já registradas desse atendimento até a última mensagem analisada.`,
        ``,
        `• No caminho padrão, utilizo os registros históricos consolidados, sem realizar leituras externas contínuas ou reanálises desnecessárias.`,
        `• Quando solicitado explicitamente pelo operador, posso verificar as mensagens recentes sob demanda.`
      ].join('\n');

      return {
        osId: input.osId,
        lojaSlug: input.lojaSlug,
        vehiclePlate: input.vehiclePlate,
        vehicleModel: input.vehicleModel,
        timestampReport: new Date().toISOString(),
        erpState: input.erpState,
        discrepancies: [],
        pendingActions: [],
        limitations: [],
        formattedWhatsAppBalloon: balloonCapabilities,
        cachedResponse: false
      };
    }

    // 5c. Avaliação de Demora Factual (EvidencePolicyManager)
    const delayCauseStmt = statements.find(s => s.subject === 'DELAY_CAUSE_REPORTED' || s.delayCauseReported);
    const delayEvaluation = EvidencePolicyManager.evaluateDelayCause(
      input.erpState.status,
      delayCauseStmt?.delayCauseReported,
      delayCauseStmt?.authorRole,
      delayCauseStmt?.authorName,
      delayCauseStmt?.rawExcerpt
    );

    // 5d. Avaliação de Tempo da OS (EvidencePolicyManager)
    const openedAt = input.openedAt || input.erpState.openedAt;
    const osTimeEvaluation = openedAt ? EvidencePolicyManager.evaluateOSTime(openedAt) : null;

    // 6. Montagem do Balão Formatado do WhatsApp (Nativo, sem Markdown duplo **)
    const balloonParts: string[] = [];
    balloonParts.push(`OS ${input.osId} (${input.vehicleModel} - ${input.vehiclePlate}) — Posição às ${this.formatHour(new Date().toISOString())}`);
    balloonParts.push(``);
    balloonParts.push(`No sistema da oficina:`);
    balloonParts.push(`Status: ${input.erpState.status} (atualizado às ${this.formatHour(input.erpState.updatedAt)})`);
    if (osTimeEvaluation) {
      balloonParts.push(osTimeEvaluation.statement);
    }
    balloonParts.push(`Total: ${this.formatCurrency(input.erpState.totalValue)} | Pago: ${this.formatCurrency(input.erpState.paidValue)}`);
    if (input.erpState.pendingServices.length > 0) {
      balloonParts.push(`Serviços: ${input.erpState.pendingServices.join(', ')}`);
    }

    // Se a pergunta foi especificamente sobre demora
    if (input.specificQuestionType === 'DELAY_REASON') {
      balloonParts.push(``);
      balloonParts.push(`Situação de prazo e andamento:`);
      balloonParts.push(delayEvaluation.statement);
    }

    balloonParts.push(``);
    balloonParts.push(`Nas análises de atendimento existentes:`);
    balloonParts.push(convText);

    if (discrepancies.length > 0) {
      balloonParts.push(``);
      balloonParts.push(`Divergência:`);
      for (const d of discrepancies) {
        balloonParts.push(`• ${d.description}`);
      }
    }

    if (pendingActions.length > 0) {
      balloonParts.push(``);
      balloonParts.push(`Pendência:`);
      for (const p of pendingActions) {
        balloonParts.push(`• ${p}`);
      }
    }

    if (limitations.length > 0) {
      balloonParts.push(``);
      balloonParts.push(`Observações de cobertura:`);
      for (const l of limitations) {
        balloonParts.push(`• ${l}`);
      }
    }

    const formattedWhatsAppBalloon = balloonParts.join('\n');

    return {
      osId: input.osId,
      lojaSlug: input.lojaSlug,
      vehiclePlate: input.vehiclePlate,
      vehicleModel: input.vehicleModel,
      timestampReport: new Date().toISOString(),
      erpState: input.erpState,
      analysisState: input.analysisState,
      conversationState: input.conversationState,
      linkInfo: input.linkInfo,
      discrepancies,
      pendingActions,
      limitations,
      formattedWhatsAppBalloon,
      cachedResponse: !!input.cachedResponse
    };
  }

  public composeAmbiguousVehicle(
    vehicles: readonly CandidateVehicle[],
    requestedModel: string,
    lojaSlug: string
  ): string {
    const list = vehicles
      .map(v => `• ${v.vehicleModel} — Placa ${v.vehiclePlate}`)
      .join('\n');

    return [
      `Identifiquei mais de um veículo correspondente na unidade ${lojaSlug}.`,
      ``,
      `Para prosseguir sem misturar dados, qual destes veículos deseja consultar?`,
      list,
      ``,
      `Por favor, informe a placa do veículo desejado.`
    ].join('\n');
  }

  public composeAmbiguousOrder(
    vehicle: CandidateVehicle,
    orders: readonly CandidateOrder[]
  ): string {
    const list = orders
      .map(o => `• OS ${o.osId} — ${o.status} (${o.isAberta ? 'em andamento' : 'finalizada'})`)
      .join('\n');

    return [
      `Identifiquei mais de uma ordem de serviço para o veículo ${vehicle.vehicleModel} (${vehicle.vehiclePlate}) na unidade ${vehicle.lojaSlug}:`,
      ``,
      list,
      ``,
      `Por favor, informe o número da OS que deseja consultar.`
    ].join('\n');
  }

  public composeNoMatch(requestedModel: string, lojaSlug?: string): string {
    const storeText = lojaSlug ? ` na unidade ${lojaSlug}` : '';
    return [
      `Não encontrei uma ordem de serviço correspondente para o veículo ${requestedModel}${storeText} nos dados consultados.`
    ].join('\n');
  }

  public composeUnavailable(requestedModel: string, lojaSlug?: string, reason?: string): string {
    const storeText = lojaSlug ? ` na unidade ${lojaSlug}` : '';
    const reasonText = reason ? ` (${reason})` : '';
    return [
      `Não foi possível consultar os dados da oficina neste momento${reasonText}. O pedido sobre o veículo ${requestedModel}${storeText} foi preservado. Por favor, tente novamente em instantes.`
    ].join('\n');
  }

  public composeSecurityBlock(requestedLoja: string, authorizedLoja: string): string {
    return [
      `Acesso não autorizado: seu perfil tem permissão apenas para a unidade ${authorizedLoja}. A consulta para a unidade ${requestedLoja} não pode ser processada.`
    ].join('\n');
  }

  private formatHour(isoString?: string): string {
    if (!isoString) return 'horário não informado';
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return 'horário não informado';
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      return `${h}h${m}`;
    } catch {
      return 'horário não informado';
    }
  }

  private formatCurrency(value: number): string {
    return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.replace(/\u00a0/g, ' ');
  }
}

export interface OS360CardParams {
  osId: string | number;
  lojaSlug: string;
  vehicleModel?: string;
  vehiclePlate?: string;
  clientName?: string;
  clientPhone?: string;
  clienteTelefone?: string;
  responsavel?: string;
  statusGrid?: string;
  isOpen?: boolean;
  daysInYard?: number;
  totalAmount?: number;
  remainingBalance?: number;
  servicos?: Array<{ descricao: string; valorTotal: number; executor?: string }>;
  pecas?: Array<{ descricao: string; valorTotal: number; qtd?: number; codigo?: string }>;
  pagamentos?: Array<{ parcela: string | number; valor: number; modalidade: string; vencimento?: string }>;
  checklists?: Array<{ tipo: string; status?: string; realizado_por?: string; data?: string }>;
  checklistAudit?: { temChecklistEntrada?: boolean; temChecklistMecanico?: boolean; detalhes?: string };
  temNf?: boolean;
  documentosAnexosCount?: number;
  extracaoCompleta?: boolean;
  observacao?: string;
  historicoCriadoEm?: string;
  historicoCriadoPor?: string;
  historicoAtualizadoEm?: string;
  historicoAtualizadoPor?: string;
  documentosAnexos?: Array<{
    origem?: string;
    data?: string;
    descricao?: string;
    opcao?: string;
  }>;
  caseContext?: {
    documentedDelayReason?: string;
    nextPromisedStep?: string;
    lastObservationDate?: string;
    conversationSummary?: string;
    partsBalanceSummary?: string;
    budgetStatus?: string;
    coverage?: string;
    evidenceOrigin?: string;
  };
}

/**
 * Converte textos do ERP em Title Case limpo e legível.
 */
export function toCleanTitleCase(text: string): string {
  if (!text || typeof text !== 'string') return '';
  const lowerWords = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'para', 'com', 'por', 'sem', 'sob', 'sobre', 'a', 'o', 'as', 'os', 'd']);
  const upperAcronyms = new Set(['os', 'nf', 'pix', 'abs', 'ls', 'gl', 'gti', 'gts', 'cl', 'vw', 'gm', 'fiap', 'cci', 'dp', 'api', 'erp', 'cpf', 'cnpj']);

  let clean = text
    .replace(/DIAGNOSTICO/gi, 'Diagnóstico')
    .replace(/REMO[CÇ][AÃ]O/gi, 'Remoção')
    .replace(/MANUTEN[CÇ][AÃ]O/gi, 'Manutenção')
    .replace(/INSTALA[CÇ][AÃ]O/gi, 'Instalação')
    .replace(/INSPE[CÇ][AÃ]O/gi, 'Inspeção')
    .replace(/HIGIENIZA[CÇ][AÃ]O/gi, 'Higienização')
    .replace(/REGULAGEM/gi, 'Regulagem')
    .replace(/ALINHAMENTO/gi, 'Alinhamento')
    .replace(/GEOMETRIA/gi, 'Geometria')
    .replace(/ARREFECIMENTO/gi, 'Arrefecimento')
    .replace(/ELETRICA/gi, 'Elétrica')
    .replace(/MECANICO/gi, 'Mecânico')
    .trim();

  const words = clean.split(/\s+/);
  return words.map((w, index) => {
    const prefix = w.match(/^[^a-zA-Z0-9À-ÿ]*/)?.[0] || '';
    const suffix = w.match(/[^a-zA-Z0-9À-ÿ]*$/)?.[0] || '';
    const core = w.slice(prefix.length, w.length - suffix.length);
    if (!core) return w;

    const coreLower = core.toLowerCase();
    if (/^check-list$/i.test(coreLower)) {
      return prefix + 'Check-List' + suffix;
    }
    if (upperAcronyms.has(coreLower)) {
      return prefix + coreLower.toUpperCase() + suffix;
    }
    if (index > 0 && lowerWords.has(coreLower)) {
      return prefix + coreLower + suffix;
    }
    // Suporte a palavras hifenizadas como Check-List
    if (core.includes('-')) {
      const parts = core.split('-');
      const titleParts = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase());
      return prefix + titleParts.join('-') + suffix;
    }
    const title = core.charAt(0).toUpperCase() + core.slice(1).toLowerCase();
    return prefix + title + suffix;
  }).join(' ');
}

function cleanExecutor(executor?: string): string | undefined {
  if (!executor) return undefined;
  const trimmed = executor.trim();
  if (!trimmed || trimmed === '0') return undefined;
  if (/preencher\s*executor/i.test(trimmed)) return undefined;
  if (/mecanico\s*da\s*loja/i.test(trimmed)) return undefined;
  return toCleanTitleCase(trimmed);
}

interface SemanticGroup {
  id: string;
  name: string;
  keywords: string[];
}

const SEMANTIC_GROUPS: SemanticGroup[] = [
  {
    id: 'eletrica',
    name: 'Elétrica & Ignição',
    keywords: [
      'alternador', 'bateria', 'chicote', 'modulo', 'partida', 'ignicao',
      'vela', 'bobina', 'sensor', 'rele', 'eletric', 'farol', 'lampada',
      'fusivel', 'fusiveis', 'painel', 'arranque', 'distribuidor', 'cabo vela'
    ]
  },
  {
    id: 'arrefecimento',
    name: 'Sistema de Arrefecimento',
    keywords: [
      'arrefecimento', 'radiador', 'aditivo', 'cebolao', 'agua', 'termostatica',
      'mangueira', 'reservatorio', 'ventoinha', 'tampa reservatorio'
    ]
  },
  {
    id: 'suspensao',
    name: 'Suspensão, Direção & Rodagem',
    keywords: [
      'suspensao', 'amortecedor', 'coxim', 'bucha', 'rolamento', 'coifa',
      'alinhamento', 'geometria', 'balanceamento', 'cambagem', 'pivo',
      'terminal', 'estabilizadora', 'mola', 'bandeja', 'braco', 'roda',
      'pneu', 'direcao', 'batente'
    ]
  },
  {
    id: 'freios',
    name: 'Sistema de Freios',
    keywords: [
      'freio', 'freios', 'pastilha', 'disco', 'tambor', 'lona', 'alavanca',
      'fluido freio', 'cilindro', 'pinca', 'flexivel', 'servo'
    ]
  },
  {
    id: 'apoio',
    name: 'Revisão, Apoio & Insumos',
    keywords: [
      'diagnostico', 'motoboy', 'limpeza', 'higienizacao', 'revisao',
      'oleo', 'filtro', 'lavagem', 'combustivel', 'correia', 'junta',
      'desengraxante', 'abracadeira', 'parafuso'
    ]
  }
];

function getSemanticGroup(desc: string): SemanticGroup {
  const norm = desc
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  for (const grp of SEMANTIC_GROUPS) {
    if (grp.id === 'apoio') continue;
    for (const kw of grp.keywords) {
      if (norm.includes(kw)) {
        return grp;
      }
    }
  }
  return SEMANTIC_GROUPS.find(g => g.id === 'apoio')!;
}

function formatCategorizedSection<T extends { descricao: string; valorTotal: number; executor?: string; qtd?: number; codigo?: string }>(
  items: T[],
  isService: boolean,
  moneyFmt: (v: number) => string
): string[] {
  const grouped = new Map<string, T[]>();
  for (const grp of SEMANTIC_GROUPS) {
    grouped.set(grp.id, []);
  }

  for (const item of items) {
    const grp = getSemanticGroup(item.descricao);
    grouped.get(grp.id)!.push(item);
  }

  const outputLines: string[] = [];

  for (const grp of SEMANTIC_GROUPS) {
    const groupItems = grouped.get(grp.id) || [];
    if (groupItems.length === 0) continue;

    const subtotal = groupItems.reduce((acc, it) => acc + (it.valorTotal || 0), 0);
    outputLines.push(`*${grp.name}* (Subtotal: *${moneyFmt(subtotal)}*):`);

    for (const it of groupItems) {
      const titleDesc = toCleanTitleCase(it.descricao);
      if (isService) {
        const exec = cleanExecutor(it.executor);
        outputLines.push(`  - ${titleDesc}: *${moneyFmt(it.valorTotal)}*${exec ? ` (${exec})` : ''}`);
      } else {
        const qtdStr = it.qtd && it.qtd > 1 ? `${it.qtd}x ` : '';
        const codClean = it.codigo && it.codigo.length <= 10 && !/^\d{7,}$/.test(it.codigo) && !/^AP\d+$/i.test(it.codigo)
          ? ` (${it.codigo})`
          : '';
        outputLines.push(`  - ${titleDesc}: ${qtdStr}*${moneyFmt(it.valorTotal)}*${codClean}`);
      }
    }
  }

  return outputLines;
}

/**
 * Monta o card canônico oficial Hermes 360° em balões nativos para o WhatsApp.
 * Divide as seções principais com '---BLOCK---' para evitar cortes no celular.
 */
export function composeFullOS360Card(params: OS360CardParams): string {
  const moneyFmt = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/[\u00A0\u202F]/g, ' ');
  const blocks: string[] = [];

  const saldo = params.remainingBalance !== undefined
    ? params.remainingBalance
    : Math.max(0, (params.totalAmount || 0) - (params.pagamentos?.reduce((a, p) => a + (p.valor || 0), 0) || 0));

  const saldoTxt = saldo > 0
    ? ` (Saldo: *${moneyFmt(saldo)}*)`
    : ' (Quitado)';

  const modelStr = (params.vehicleModel || 'VEÍCULO').toUpperCase();
  const plateStr = (params.vehiclePlate || 'Sem Placa').toUpperCase();
  const statusStr = params.statusGrid || (params.isOpen ? 'Em Aberto' : 'Finalizada');

  // Histórico e Situação
  const caseLines: string[] = [];
  if (params.caseContext?.documentedDelayReason) {
    caseLines.push(`- *Motivo Operacional:* ${params.caseContext.documentedDelayReason}`);
  }
  if (params.caseContext?.nextPromisedStep) {
    caseLines.push(`- *Próximo Passo Prometido:* ${params.caseContext.nextPromisedStep}`);
  }
  if (params.caseContext?.partsBalanceSummary) {
    caseLines.push(`- *Status de Peças:* ${params.caseContext.partsBalanceSummary}`);
  }
  if (params.caseContext?.budgetStatus) {
    caseLines.push(`- *Orçamento:* ${params.caseContext.budgetStatus}`);
  }
  if (params.caseContext?.conversationSummary) {
    caseLines.push(`- *Alinhamento com Cliente:* ${params.caseContext.conversationSummary}`);
  }
  if (params.caseContext?.lastObservationDate) {
    caseLines.push(`- *Última Interação Registrada:* ${params.caseContext.lastObservationDate}`);
  }
  if (caseLines.length === 0) {
    caseLines.push(`- *Histórico:* Sem pendência de atraso ou peças documentada nas conversas desta OS.`);
  }

  // Bloco 1: Cabeçalho Executivo + Situação e Atendimento
  const b1Lines: string[] = [
    `> *OS #${params.osId} — ${modelStr} (${plateStr})*`,
    `- *Loja:* ${params.lojaSlug}`,
    `- *Status:* *${statusStr}* (${params.isOpen ? 'Em Aberto' : 'Finalizada'})`,
    `- *Permanência:* ${params.daysInYard || 0} dia(s) no pátio`,
    `- *Cliente:* ${params.clientName || 'Não informado'}`,
    ...(params.responsavel ? [`- *Responsável:* ${params.responsavel}`] : []),
    `- *Valor Total:* *${moneyFmt(params.totalAmount || 0)}*${saldoTxt}`,
    ``,
    `> *Situação e Atendimento*`,
    ...caseLines
  ];
  blocks.push(b1Lines.join('\n'));

  // Bloco 2: Serviços Discriminados (agrupados por sistemas mecânicos)
  const totalServicos = params.servicos?.reduce((acc, s) => acc + (s.valorTotal || 0), 0) ?? 0;
  if (params.servicos && params.servicos.length > 0) {
    const servHeader = `> *Serviços Discriminados (${params.servicos.length} itens · ${moneyFmt(totalServicos)})*`;
    const servLines = formatCategorizedSection(params.servicos, true, moneyFmt);
    blocks.push([servHeader, ...servLines].join('\n'));
  } else {
    blocks.push(`> *Serviços Discriminados*\n- Nenhum serviço discriminado nesta OS.`);
  }

  // Bloco 3: Peças e Insumos (agrupados por sistemas mecânicos, com chunking se > 800ch)
  const totalPecas = params.pecas?.reduce((acc, p) => acc + (p.valorTotal || 0), 0) ?? 0;
  if (params.pecas && params.pecas.length > 0) {
    const pecasHeader = `> *Peças e Materiais Aplicados (${params.pecas.length} itens · ${moneyFmt(totalPecas)})*`;
    const pecasLines = formatCategorizedSection(params.pecas, false, moneyFmt);
    const fullPecasText = [pecasHeader, ...pecasLines].join('\n');

    if (fullPecasText.length > 800 && pecasLines.length > 6) {
      const mid = Math.ceil(pecasLines.length / 2);
      const p1 = pecasLines.slice(0, mid);
      const p2 = pecasLines.slice(mid);
      blocks.push([`> *Peças e Materiais (Parte 1/2 · ${moneyFmt(totalPecas)})*`, ...p1].join('\n'));
      blocks.push([`> *Peças e Materiais (Parte 2/2)*`, ...p2].join('\n'));
    } else {
      blocks.push(fullPecasText);
    }
  } else {
    const saldoPecas = (params.totalAmount || 0) - totalServicos;
    if (saldoPecas > 0.05) {
      blocks.push(`> *Peças e Materiais Aplicados*\n- Peças / Componentes de Reparo: *${moneyFmt(saldoPecas)}*`);
    } else {
      blocks.push(`> *Peças e Materiais Aplicados*\n- Nenhuma peça discriminada nesta OS (ordem 100% serviços).`);
    }
  }

  // Bloco 4: Formas de Pagamento + Vistorias e Documentos (com pareamento hierárquico estrito de checklists)
  const b4Lines: string[] = [];
  b4Lines.push(`> *Formas de Pagamento*`);
  if (params.pagamentos && params.pagamentos.length > 0) {
    for (const p of params.pagamentos) {
      b4Lines.push(`- Parcela ${p.parcela}: *${moneyFmt(p.valor)}* (${p.modalidade}${p.vencimento ? `, Venc: ${p.vencimento}` : ''})`);
    }
  } else if ((params.totalAmount || 0) > 0 && saldo <= 0) {
    b4Lines.push(`- Ordem 100% quitada no ERP.`);
  } else {
    b4Lines.push(`- Total: *${moneyFmt(params.totalAmount || 0)}* (Saldo: *${moneyFmt(saldo)}*)`);
    b4Lines.push(`- Modalidade específica de parcelamento não cadastrada; pendente de sinal/quitação.`);
  }

  b4Lines.push(``);
  b4Lines.push(`> *Vistorias e Documentos*`);
  if (params.extracaoCompleta === false) {
    b4Lines.push(`- *Checklists:* Sincronização detalhada do ERP em andamento.`);
  } else {
    const temEntrada = params.checklistAudit?.temChecklistEntrada;
    const temMec = params.checklistAudit?.temChecklistMecanico;

    // 1. Checklist de Entrada (itens de inspeção/entrada aparecem imediatamente subordinados aqui)
    b4Lines.push(`- *Checklist de Entrada:* ${temEntrada ? 'Realizado' : 'Pendente'}`);
    const itensEntrada = (params.checklists || []).filter(c => {
      const t = (c.tipo || '').toLowerCase();
      return t.includes('inspe') || t.includes('entrada') || (!t.includes('mecanic') && !t.includes('mecanico'));
    });
    for (const cl of itensEntrada) {
      const resp = cl.realizado_por ? `${cl.realizado_por}` : 'Técnico';
      const dt = cl.data ? `, ${cl.data}` : '';
      b4Lines.push(`  └ *${toCleanTitleCase(cl.tipo)}:* ${cl.status} (${resp}${dt})`);
    }

    // 2. Checklist do Mecânico (itens de mecânico aparecem subordinados aqui)
    b4Lines.push(`- *Checklist do Mecânico:* ${temMec ? 'Realizado' : 'Pendente'}`);
    const itensMecanico = (params.checklists || []).filter(c => {
      const t = (c.tipo || '').toLowerCase();
      return t.includes('mecanic') || t.includes('mecanico');
    });
    for (const cl of itensMecanico) {
      const resp = cl.realizado_por ? `${cl.realizado_por}` : 'Mecânico';
      const dt = cl.data ? `, ${cl.data}` : '';
      b4Lines.push(`  └ *${toCleanTitleCase(cl.tipo)}:* ${cl.status} (${resp}${dt})`);
    }

    if ((!params.checklists || params.checklists.length === 0) && params.checklistAudit?.detalhes) {
      b4Lines.push(`- *Status:* ${params.checklistAudit.detalhes}`);
    }
  }

  b4Lines.push(`- *Nota Fiscal:* ${params.temNf ? 'Emitida/vinculada à OS' : 'Não emitida para esta OS.'}`);
  if (params.documentosAnexosCount !== undefined && params.documentosAnexosCount > 0) {
    b4Lines.push(`- *Anexos:* ${params.documentosAnexosCount} documento(s) arquivado(s).`);
  }

  blocks.push(b4Lines.join('\n'));

  return blocks.join('\n\n---BLOCK---\n\n');
}

/**
 * Calcula métricas contábeis claras de pagamento para uma OS.
 * Regra: Pago = total - saldoDevedor (soma das parcelas efetivamente amortizadas/recebidas).
 */
export function calculatePaymentMetrics(
  totalAmount?: number,
  remainingBalance?: number,
  pagamentos?: Array<{ parcela: string | number; valor: number; modalidade: string; vencimento?: string }>
): { total: number; saldo: number; pago: number } {
  const total = Number(totalAmount || 0);
  const saldo = remainingBalance !== undefined
    ? Number(remainingBalance)
    : Math.max(0, total - (pagamentos?.reduce((acc, p) => acc + (p.valor || 0), 0) || 0));
  const pago = Math.max(0, total - saldo);
  return { total, saldo, pago };
}

/**
 * Monta o Resumo Executivo enxuto da OS para o primeiro balão WhatsApp.
 * Zero emojis, focado em tomada de decisão rápida e formatação sóbria.
 */
export function composeExecutiveOSSummary(params: OS360CardParams): string {
  const moneyFmt = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/[\u00A0\u202F]/g, ' ');
  const { total, saldo, pago } = calculatePaymentMetrics(params.totalAmount, params.remainingBalance, params.pagamentos);

  const modelStr = (params.vehicleModel || 'VEÍCULO').toUpperCase();
  const plateStr = (params.vehiclePlate || 'Sem Placa').toUpperCase();
  const statusStr = params.statusGrid || (params.isOpen ? 'Em Aberto' : 'Finalizada');
  const clienteNome = params.clientName || 'Não informado';
  const clienteTelefone = params.clienteTelefone || params.clientPhone || 'Não informado';

  const servicosCount = params.servicos?.length || 0;
  const servicosTotal = params.servicos?.reduce((acc, s) => acc + (s.valorTotal || 0), 0) || 0;
  const pecasCount = params.pecas?.length || 0;
  const pecasTotal = params.pecas?.reduce((acc, p) => acc + (p.valorTotal || 0), 0) || Math.max(0, total - servicosTotal);
  const pagamentosCount = params.pagamentos?.length || 0;
  const checklistsCount = params.checklists?.length || 0;
  const anexosCount = params.documentosAnexos?.length || params.documentosAnexosCount || 0;

  const saldoStr = saldo > 0 ? `*${moneyFmt(saldo)}*` : '*Quitado*';

  const lines: string[] = [
    `*ORDEM DE SERVIÇO #${params.osId}*`,
    ``,
    `*CLIENTE*`,
    `- Nome: ${clienteNome}`,
    `- Telefone: ${clienteTelefone}`,
    ``,
    `*VEÍCULO*`,
    `- Modelo: ${modelStr}`,
    `- Placa: ${plateStr}`,
    ``,
    `*OPERAÇÃO*`,
    `- Loja: ${params.lojaSlug}`,
    `- Status: *${statusStr}* (${params.isOpen ? 'Em Aberto' : 'Finalizada'})`,
    ...(params.responsavel ? [`- Responsável: ${params.responsavel}`] : []),
    `- Permanência: ${params.daysInYard || 0} dia(s) no pátio`,
    ``,
    `*FINANCEIRO*`,
    `- Total: *${moneyFmt(total)}*`,
    `- Pago: *${moneyFmt(pago)}*`,
    `- Saldo: ${saldoStr}`,
    ``,
    `*MÓDULOS DISPONÍVEIS*`,
    `- Serviços: ${servicosCount} item(ns)${servicosTotal > 0 ? ` (${moneyFmt(servicosTotal)})` : ''}`,
    `- Peças e materiais: ${pecasCount} item(ns)${pecasTotal > 0 ? ` (${moneyFmt(pecasTotal)})` : ''}`,
    `- Pagamentos: ${pagamentosCount} parcela(s) cadastrada(s)`,
    `- Vistorias e documentos: ${checklistsCount} checklist(s) · ${anexosCount} anexo(s)`,
    `- Histórico: Auditoria ERP e conversas`
  ];

  return lines.join('\n');
}

/**
 * Constrói o payload oficial da Evolution API v2.3.7 para sendList.
 */
export function composeOSInteractiveListPayload(params: OS360CardParams, recipientPhone: string): EvoListPayload {
  const moneyFmt = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/[\u00A0\u202F]/g, ' ');
  const { total, saldo } = calculatePaymentMetrics(params.totalAmount, params.remainingBalance, params.pagamentos);
  const cleanPhone = String(recipientPhone).replace(/\D/g, '');

  const servicosCount = params.servicos?.length || 0;
  const servicosTotal = params.servicos?.reduce((acc, s) => acc + (s.valorTotal || 0), 0) || 0;
  const pecasCount = params.pecas?.length || 0;
  const pecasTotal = params.pecas?.reduce((acc, p) => acc + (p.valorTotal || 0), 0) || Math.max(0, total - servicosTotal);
  const pagamentosCount = params.pagamentos?.length || 0;
  const checklistsCount = params.checklists?.length || 0;
  const anexosCount = params.documentosAnexos?.length || params.documentosAnexosCount || 0;

  const modelStr = (params.vehicleModel || 'VEÍCULO').toUpperCase();
  const idStr = String(params.osId);

  return {
    number: cleanPhone,
    title: `OS #${idStr} — ${modelStr}`,
    description: `Selecione o módulo para consultar em detalhe:`,
    buttonText: `Abrir detalhes`,
    footerText: `Mecânica Popular · Sistema Hydra`,
    sections: [
      {
        title: `Módulos da OS #${idStr}`,
        rows: [
          {
            title: `1. Serviços`,
            description: `${servicosCount} itens discriminados · ${moneyFmt(servicosTotal)}`,
            rowId: `os_${idStr}_servicos`
          },
          {
            title: `2. Peças e materiais`,
            description: `${pecasCount} itens aplicados · ${moneyFmt(pecasTotal)}`,
            rowId: `os_${idStr}_pecas`
          },
          {
            title: `3. Pagamentos`,
            description: `${pagamentosCount} parcelas · Saldo: ${moneyFmt(saldo)}`,
            rowId: `os_${idStr}_pagamentos`
          },
          {
            title: `4. Vistorias e Documentos`,
            description: `${checklistsCount} checklists · ${anexosCount} anexos arquivados`,
            rowId: `os_${idStr}_documentos`
          },
          {
            title: `5. Histórico e Conversas`,
            description: `Auditoria ERP e tratativas de atendimento`,
            rowId: `os_${idStr}_historico`
          }
        ]
      }
    ]
  };
}

/**
 * Card focado: Serviços Discriminados (agrupados por sistema, sem emojis, sem placeholders).
 */
export function composeOSServicesCard(params: OS360CardParams): string {
  const moneyFmt = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/[\u00A0\u202F]/g, ' ');
  const modelStr = (params.vehicleModel || 'VEÍCULO').toUpperCase();
  const plateStr = (params.vehiclePlate || 'Sem Placa').toUpperCase();

  const totalServicos = params.servicos?.reduce((acc, s) => acc + (s.valorTotal || 0), 0) ?? 0;
  const header = `> *OS #${params.osId} — SERVIÇOS DISCRIMINADOS*\n` +
    `- Veículo: ${modelStr} (${plateStr}) · Loja: ${params.lojaSlug}\n` +
    `- Total Serviços: *${moneyFmt(totalServicos)}* (${params.servicos?.length || 0} itens)`;

  if (!params.servicos || params.servicos.length === 0) {
    return `${header}\n\n- Nenhum serviço discriminado nesta OS.`;
  }

  const servLines = formatCategorizedSection(params.servicos, true, moneyFmt);
  return [header, '', ...servLines].join('\n');
}

/**
 * Card focado: Peças e Materiais Aplicados (agrupados por sistema, sem emojis).
 */
export function composeOSPartsCard(params: OS360CardParams): string {
  const moneyFmt = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/[\u00A0\u202F]/g, ' ');
  const modelStr = (params.vehicleModel || 'VEÍCULO').toUpperCase();
  const plateStr = (params.vehiclePlate || 'Sem Placa').toUpperCase();

  const totalPecas = params.pecas?.reduce((acc, p) => acc + (p.valorTotal || 0), 0) ?? 0;
  const header = `> *OS #${params.osId} — PEÇAS E MATERIAIS APLICADOS*\n` +
    `- Veículo: ${modelStr} (${plateStr}) · Loja: ${params.lojaSlug}\n` +
    `- Total Peças: *${moneyFmt(totalPecas)}* (${params.pecas?.length || 0} itens)`;

  if (!params.pecas || params.pecas.length === 0) {
    const totalServicos = params.servicos?.reduce((acc, s) => acc + (s.valorTotal || 0), 0) ?? 0;
    const saldoPecas = Math.max(0, (params.totalAmount || 0) - totalServicos);
    if (saldoPecas > 0.05) {
      return `${header}\n\n- Peças / Componentes de Reparo: *${moneyFmt(saldoPecas)}*`;
    }
    return `${header}\n\n- Nenhuma peça discriminada nesta OS (ordem 100% serviços).`;
  }

  const pecasLines = formatCategorizedSection(params.pecas, false, moneyFmt);
  return [header, '', ...pecasLines].join('\n');
}

/**
 * Card focado: Formas de Pagamento e Parcelas (com cálculo contábil transparente).
 */
export function composeOSPaymentsCard(params: OS360CardParams): string {
  const moneyFmt = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/[\u00A0\u202F]/g, ' ');
  const { total, saldo, pago } = calculatePaymentMetrics(params.totalAmount, params.remainingBalance, params.pagamentos);
  const modelStr = (params.vehicleModel || 'VEÍCULO').toUpperCase();
  const plateStr = (params.vehiclePlate || 'Sem Placa').toUpperCase();

  const lines: string[] = [
    `> *OS #${params.osId} — FORMAS DE PAGAMENTO E PARCELAS*`,
    `- Veículo: ${modelStr} (${plateStr}) · Loja: ${params.lojaSlug}`,
    `- Total da OS: *${moneyFmt(total)}*`,
    `- Valor Pago: *${moneyFmt(pago)}*`,
    `- Saldo Devedor: *${saldo > 0 ? moneyFmt(saldo) : 'Quitado'}*`,
    ``,
    `*Parcelas Cadastradas:*`
  ];

  if (params.pagamentos && params.pagamentos.length > 0) {
    for (const p of params.pagamentos) {
      const isImmediate = /pix|dinheiro|especie|debito/i.test(p.modalidade || '');
      const statusLabel = isImmediate || (saldo <= 0) ? '[Recebido]' : '[A Vencer / Cadastrado]';
      const vencStr = p.vencimento ? `, Venc: ${p.vencimento}` : '';
      lines.push(`- Parcela ${p.parcela}: *${moneyFmt(p.valor)}* (${p.modalidade}${vencStr}) · ${statusLabel}`);
    }
  } else if (total > 0 && saldo <= 0) {
    lines.push(`- Ordem 100% quitada no ERP.`);
  } else {
    lines.push(`- Nenhuma parcela individual cadastrada no ERP; pendente de liquidação ou sinal.`);
  }

  return lines.join('\n');
}

/**
 * Card focado: Vistorias e Documentos (sem invenção de dados, pareamento estrito).
 */
export function composeOSDocumentsCard(params: OS360CardParams): string {
  const modelStr = (params.vehicleModel || 'VEÍCULO').toUpperCase();
  const plateStr = (params.vehiclePlate || 'Sem Placa').toUpperCase();

  const lines: string[] = [
    `> *OS #${params.osId} — VISTORIAS E DOCUMENTOS*`,
    `- Veículo: ${modelStr} (${plateStr}) · Loja: ${params.lojaSlug}`,
    ``
  ];

  if (params.extracaoCompleta === false) {
    lines.push(`- *Checklists:* Sincronização detalhada do ERP em andamento.`);
  } else {
    const temEntrada = params.checklistAudit?.temChecklistEntrada;
    const temMec = params.checklistAudit?.temChecklistMecanico;

    lines.push(`- *Checklist de Entrada:* ${temEntrada ? 'Concluído' : 'Não realizado'}`);
    const itensEntrada = (params.checklists || []).filter(c => {
      const t = (c.tipo || '').toLowerCase();
      return t.includes('inspe') || t.includes('entrada') || (!t.includes('mecanic') && !t.includes('mecanico'));
    });
    for (const cl of itensEntrada) {
      const resp = cl.realizado_por ? `${cl.realizado_por}` : 'Técnico';
      const dt = cl.data ? `, ${cl.data}` : '';
      lines.push(`  └ *${toCleanTitleCase(cl.tipo)}:* ${cl.status} (${resp}${dt})`);
    }

    lines.push(`- *Checklist do Mecânico:* ${temMec ? 'Concluído' : 'Não realizado'}`);
    const itensMecanico = (params.checklists || []).filter(c => {
      const t = (c.tipo || '').toLowerCase();
      return t.includes('mecanic') || t.includes('mecanico');
    });
    for (const cl of itensMecanico) {
      const resp = cl.realizado_por ? `${cl.realizado_por}` : 'Mecânico';
      const dt = cl.data ? `, ${cl.data}` : '';
      lines.push(`  └ *${toCleanTitleCase(cl.tipo)}:* ${cl.status} (${resp}${dt})`);
    }
  }

  lines.push(`- *Nota Fiscal:* ${params.temNf ? 'Emitida/vinculada à OS' : 'Não informada'}`);

  const anexosList = params.documentosAnexos || [];
  if (anexosList.length > 0) {
    lines.push(`- *Anexos:* ${anexosList.length} arquivo(s) arquivado(s):`);
    for (const a of anexosList) {
      const dt = a.data ? ` (${a.data})` : '';
      lines.push(`  - ${a.descricao || a.origem || 'Documento'}${dt}`);
    }
  } else {
    const count = params.documentosAnexosCount || 0;
    lines.push(`- *Anexos:* ${count > 0 ? `${count} arquivo(s) arquivado(s).` : 'Nenhum arquivo arquivado.'}`);
  }

  return lines.join('\n');
}

/**
 * Card focado: Histórico, Tratativas e Atendimento.
 */
export function composeOSHistoryCard(params: OS360CardParams): string {
  return composeOSConversationCard({
    osId: params.osId,
    lojaSlug: params.lojaSlug,
    vehicleModel: params.vehicleModel,
    vehiclePlate: params.vehiclePlate,
    clientName: params.clientName,
    clientPhone: params.clientPhone,
    clienteTelefone: params.clienteTelefone,
    statusGrid: params.statusGrid,
    isOpen: params.isOpen,
    daysInYard: params.daysInYard,
    totalAmount: params.totalAmount,
    remainingBalance: params.remainingBalance,
    observacao: params.observacao,
    historicoCriadoEm: params.historicoCriadoEm,
    historicoCriadoPor: params.historicoCriadoPor,
    historicoAtualizadoEm: params.historicoAtualizadoEm,
    historicoAtualizadoPor: params.historicoAtualizadoPor,
    documentosAnexos: params.documentosAnexos,
    caseContext: params.caseContext
  });
}

/**
 * Detecta se a mensagem é uma consulta sobre conversas, áudios,
 * diálogos, histórico ou alinhamentos com o cliente vinculados a uma OS.
 */
export function isOSConversationQuery(text: string): boolean {
  const norm = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return (
    /\b(conversa|conversas|audio|audios|dialogo|dialogos|falou|falaram|combinou|combinado|alinhamento|disse|atendimento|chat|mensagem|mensagens|zap|whatsapp|historico)\b/i.test(norm) ||
    norm.includes('acesso a conversa') ||
    norm.includes('acesso as conversas') ||
    norm.includes('temcesso a nenhuma conversa') ||
    norm.includes('tem conversa') ||
    norm.includes('bate com grafo') ||
    norm.includes('grafo de conversa') ||
    norm.includes('conversas que bate') ||
    norm.includes('detalhes da conversa') ||
    norm.includes('detalhe da conversa')
  );
}

export interface OSConversationCardParams {
  osId: string | number;
  lojaSlug: string;
  vehicleModel?: string;
  vehiclePlate?: string;
  clientName?: string;
  clientPhone?: string;
  clienteTelefone?: string;
  statusGrid?: string;
  isOpen?: boolean;
  daysInYard?: number;
  totalAmount?: number;
  remainingBalance?: number;
  // Auditoria do ERP
  observacao?: string;
  historicoCriadoEm?: string;
  historicoCriadoPor?: string;
  historicoAtualizadoEm?: string;
  historicoAtualizadoPor?: string;
  documentosAnexos?: Array<{
    origem?: string;
    data?: string;
    descricao?: string;
    opcao?: string;
  }>;
  caseContext?: {
    documentedDelayReason?: string;
    nextPromisedStep?: string;
    lastObservationDate?: string;
    conversationSummary?: string;
    partsBalanceSummary?: string;
    budgetStatus?: string;
    coverage?: string;
    evidenceOrigin?: string;
  };
}

/**
 * Monta o card executivo para consultas focadas em conversas e histórico
 * da ordem de serviço vinculada no Grafo de Atendimento e na Auditoria do ERP.
 */
export function composeOSConversationCard(params: OSConversationCardParams): string {
  const moneyFmt = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/[\u00A0\u202F]/g, ' ');
  const blocks: string[] = [];
  const modelStr = (params.vehicleModel || 'VEÍCULO').toUpperCase();
  const plateStr = (params.vehiclePlate || 'Sem Placa').toUpperCase();
  const statusStr = params.statusGrid || (params.isOpen ? 'Em Aberto' : 'Finalizada');
  const phone = params.clienteTelefone || params.clientPhone;

  // 1. Cabeçalho Executivo
  let header = `> *OS #${params.osId} — ${modelStr} (${plateStr}) | Histórico e Conversas*\n` +
    `- *Loja:* ${params.lojaSlug}\n` +
    `- *Status:* *${statusStr}* (${params.isOpen ? 'Em Aberto' : 'Finalizada'})\n` +
    `- *Permanência:* ${params.daysInYard || 0} dia(s) no pátio\n` +
    `- *Cliente:* ${params.clientName || 'Não informado'}`;
  if (phone) {
    header += `\n- *Telefone:* ${phone}`;
  }
  blocks.push(header);

  // 2. Se houver dados reais de conversa no grafo de atendimento
  const caseLines: string[] = [];
  if (params.caseContext?.documentedDelayReason) {
    caseLines.push(`- *Motivo Operacional:* ${params.caseContext.documentedDelayReason}`);
  }
  if (params.caseContext?.nextPromisedStep) {
    caseLines.push(`- *Próximo Passo Prometido:* ${params.caseContext.nextPromisedStep}`);
  }
  if (params.caseContext?.partsBalanceSummary) {
    caseLines.push(`- *Status de Peças:* ${params.caseContext.partsBalanceSummary}`);
  }
  if (params.caseContext?.budgetStatus) {
    caseLines.push(`- *Orçamento:* ${params.caseContext.budgetStatus}`);
  }
  if (params.caseContext?.conversationSummary) {
    caseLines.push(`- *Alinhamento com Cliente:* ${params.caseContext.conversationSummary}`);
  }
  if (params.caseContext?.lastObservationDate) {
    caseLines.push(`- *Última Interação Registrada:* ${params.caseContext.lastObservationDate}`);
  }

  if (caseLines.length > 0) {
    blocks.push(`> *Posição de Atendimento no Grafo*\n${caseLines.join('\n')}`);
  }

  // 3. Auditoria Operacional no ERP (Sempre presente para transparência fática da OS)
  const auditLines: string[] = [];
  if (params.historicoCriadoPor || params.historicoCriadoEm) {
    const criador = params.historicoCriadoPor ? params.historicoCriadoPor : 'Consultor da Loja';
    const dataCriacao = params.historicoCriadoEm ? ` em ${params.historicoCriadoEm}` : '';
    auditLines.push(`- *Abertura no ERP:* ${criador}${dataCriacao}`);
  }
  if (params.historicoAtualizadoPor || params.historicoAtualizadoEm) {
    const atualizador = params.historicoAtualizadoPor ? params.historicoAtualizadoPor : 'Consultor da Loja';
    const dataAtualizacao = params.historicoAtualizadoEm ? ` em ${params.historicoAtualizadoEm}` : '';
    auditLines.push(`- *Última Movimentação:* ${atualizador}${dataAtualizacao}`);
  }

  if (params.observacao && params.observacao.trim()) {
    auditLines.push(`- *Observações do Sistema:* ${params.observacao.trim()}`);
  } else {
    auditLines.push(`- *Observações do Sistema:* Vazio (nenhuma anotação ou autorização textual registrada na OS)`);
  }

  if (params.documentosAnexos && params.documentosAnexos.length > 0) {
    const docs = params.documentosAnexos.map(d => `${d.data ? `${d.data}: ` : ''}${d.descricao || d.origem || 'Documento'}`).join(', ');
    auditLines.push(`- *Anexos Arquivados:* ${params.documentosAnexos.length} documento(s) (${docs})`);
  } else {
    auditLines.push(`- *Anexos Arquivados:* Nenhum anexo ou foto arquivada`);
  }

  if (phone) {
    auditLines.push(`- *WhatsApp / Canais:* Não há conversas de balcão espelhadas para o número ${phone}. Negociações e alinhamentos ficam restritos ao aparelho físico da unidade ${params.lojaSlug}.`);
  } else {
    auditLines.push(`- *WhatsApp / Canais:* Telefone não cadastrado na OS para consulta nos canais de atendimento.`);
  }

  blocks.push(`> *Auditoria Operacional no ERP*\n${auditLines.join('\n')}`);

  return blocks.join('\n\n---BLOCK---\n\n');
}

