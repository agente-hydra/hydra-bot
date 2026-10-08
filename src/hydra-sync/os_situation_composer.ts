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
} from './types/conversation_context_contract';
import { EvidencePolicyManager } from './evidence_policy_manager';

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
  responsavel?: string;
  statusGrid?: string;
  isOpen?: boolean;
  daysInYard?: number;
  totalAmount?: number;
  remainingBalance?: number;
  servicos?: Array<{ descricao: string; valorTotal: number; executor?: string }>;
  pecas?: Array<{ descricao: string; valorTotal: number; qtd?: number; codigo?: string }>;
  pagamentos?: Array<{ parcela: number; valor: number; modalidade: string; vencimento?: string }>;
  checklists?: Array<{ tipo: string; status: string; realizado_por?: string; data?: string }>;
  checklistAudit?: { temChecklistEntrada?: boolean; temChecklistMecanico?: boolean; detalhes?: string };
  temNf?: boolean;
  documentosAnexosCount?: number;
  extracaoCompleta?: boolean;
  caseContext?: {
    documentedDelayReason?: string;
    nextPromisedStep?: string;
    lastObservationDate?: string;
    conversationSummary?: string;
    partsBalanceSummary?: string;
    budgetStatus?: string;
  };
}

/**
 * Monta o card canônico oficial Hermes 360° com os 6 blocos obrigatórios
 * e divisores visuais delimitados para o WhatsApp.
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

  // 1. Cabeçalho Executivo
  const modelStr = (params.vehicleModel || 'VEÍCULO').toUpperCase();
  const plateStr = (params.vehiclePlate || 'Sem Placa').toUpperCase();
  const statusStr = params.statusGrid || (params.isOpen ? 'Em Aberto' : 'Finalizada');

  blocks.push(
    `> *OS #${params.osId} — ${modelStr} (${plateStr})*\n` +
    `- *Loja:* ${params.lojaSlug}\n` +
    `- *Status:* *${statusStr}* (${params.isOpen ? 'Em Aberto' : 'Finalizada'})\n` +
    `- *Permanência:* ${params.daysInYard || 0} dia(s) no pátio\n` +
    `- *Cliente:* ${params.clientName || 'Não informado'}\n` +
    (params.responsavel ? `- *Responsável:* ${params.responsavel}\n` : '') +
    `- *Valor Total:* *${moneyFmt(params.totalAmount || 0)}*${saldoTxt}`
  );

  // 2. Situação e Atendimento (Grafo / Histórico)
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
  blocks.push(`----------------------------------------\n> *Situação e Atendimento*\n${caseLines.join('\n')}`);

  // 3. Serviços Discriminados
  if (params.servicos && params.servicos.length > 0) {
    const servicosLines = params.servicos.map(s => 
      `- ${s.descricao}: *${moneyFmt(s.valorTotal)}*${s.executor ? ` (${s.executor})` : ''}`
    ).join('\n');
    blocks.push(`----------------------------------------\n> *Serviços Discriminados*\n${servicosLines}`);
  } else {
    blocks.push(`----------------------------------------\n> *Serviços Discriminados*\n- Nenhum serviço discriminado nesta OS.`);
  }

  // 4. Peças e Materiais Aplicados (Obrigatório - Nunca omitir)
  if (params.pecas && params.pecas.length > 0) {
    const pecasLines = params.pecas.map(p => 
      `- ${p.descricao}: ${p.qtd || 1}x *${moneyFmt(p.valorTotal)}*${p.codigo ? ` (${p.codigo})` : ''}`
    ).join('\n');
    blocks.push(`----------------------------------------\n> *Peças e Materiais Aplicados*\n${pecasLines}`);
  } else {
    const totServ = params.servicos?.reduce((acc, s) => acc + (s.valorTotal || 0), 0) ?? 0;
    const saldoPecas = (params.totalAmount || 0) - totServ;
    if (saldoPecas > 0.05) {
      blocks.push(`----------------------------------------\n> *Peças e Materiais Aplicados*\n- Peças / Componentes de Reparo: *${moneyFmt(saldoPecas)}*`);
    } else {
      blocks.push(`----------------------------------------\n> *Peças e Materiais Aplicados*\n- Nenhuma peça discriminada nesta OS (ordem 100% serviços).`);
    }
  }

  // 5. Formas de Pagamento
  if (params.pagamentos && params.pagamentos.length > 0) {
    const pagLines = params.pagamentos.map(p => 
      `- Parcela ${p.parcela}: *${moneyFmt(p.valor)}* (${p.modalidade}${p.vencimento ? `, Venc: ${p.vencimento}` : ''})`
    ).join('\n');
    blocks.push(`----------------------------------------\n> *Formas de Pagamento*\n${pagLines}`);
  } else if ((params.totalAmount || 0) > 0 && saldo <= 0) {
    blocks.push(`----------------------------------------\n> *Formas de Pagamento*\n- Ordem 100% quitada no ERP.`);
  } else {
    blocks.push(`----------------------------------------\n> *Formas de Pagamento*\n- Total: *${moneyFmt(params.totalAmount || 0)}* (Saldo: *${moneyFmt(saldo)}*)\n- Modalidade específica de parcelamento não cadastrada; pendente de sinal/quitação.`);
  }

  // 6. Vistorias e Documentos
  const docLines: string[] = [];
  if (params.extracaoCompleta === false) {
    docLines.push(`- *Checklists:* Sincronização detalhada do ERP em andamento.`);
  } else {
    const temEntrada = params.checklistAudit?.temChecklistEntrada;
    const temMec = params.checklistAudit?.temChecklistMecanico;
    docLines.push(`- *Checklist de Entrada:* ${temEntrada ? '✅ Realizado' : '⚠️ Pendente'}`);
    docLines.push(`- *Checklist do Mecânico:* ${temMec ? '✅ Realizado' : '⚠️ Pendente'}`);
    if (params.checklists && params.checklists.length > 0) {
      for (const cl of params.checklists) {
        docLines.push(`  └ *${cl.tipo}:* ${cl.status} (${cl.realizado_por || 'Técnico'}, ${cl.data})`);
      }
    } else if (params.checklistAudit?.detalhes) {
      docLines.push(`- *Status:* ${params.checklistAudit.detalhes}`);
    }
  }
  docLines.push(`- *Nota Fiscal:* ${params.temNf ? 'Emitida/vinculada à OS' : 'Não emitida para esta OS.'}`);
  if (params.documentosAnexosCount !== undefined && params.documentosAnexosCount > 0) {
    docLines.push(`- *Anexos:* ${params.documentosAnexosCount} documento(s) arquivado(s).`);
  }
  blocks.push(`----------------------------------------\n> *Vistorias e Documentos*\n${docLines.join('\n')}`);

  return blocks.join('\n\n');
}

/**
 * Detecta se a mensagem é uma consulta sobre conversas, áudios,
 * diálogos ou alinhamentos com o cliente vinculados a uma OS.
 */
export function isOSConversationQuery(text: string): boolean {
  const norm = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return (
    /\b(conversa|conversas|audio|audios|dialogo|dialogos|falou|falaram|combinou|combinado|alinhamento|disse|atendimento|chat|mensagem|mensagens|zap|whatsapp)\b/i.test(norm) ||
    norm.includes('acesso a conversa') ||
    norm.includes('acesso as conversas') ||
    norm.includes('temcesso a nenhuma conversa') ||
    norm.includes('tem conversa') ||
    norm.includes('bate com grafo') ||
    norm.includes('grafo de conversa') ||
    norm.includes('conversas que bate')
  );
}

export interface OSConversationCardParams {
  osId: string | number;
  lojaSlug: string;
  vehicleModel?: string;
  vehiclePlate?: string;
  clientName?: string;
  statusGrid?: string;
  isOpen?: boolean;
  daysInYard?: number;
  totalAmount?: number;
  remainingBalance?: number;
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
 * da ordem de serviço vinculada no Grafo de Atendimento.
 */
export function composeOSConversationCard(params: OSConversationCardParams): string {
  const moneyFmt = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/[\u00A0\u202F]/g, ' ');
  const blocks: string[] = [];
  const modelStr = (params.vehicleModel || 'VEÍCULO').toUpperCase();
  const plateStr = (params.vehiclePlate || 'Sem Placa').toUpperCase();
  const statusStr = params.statusGrid || (params.isOpen ? 'Em Aberto' : 'Finalizada');

  // Cabeçalho
  blocks.push(
    `> *OS #${params.osId} — ${modelStr} (${plateStr}) | Histórico e Conversas*\n` +
    `- *Loja:* ${params.lojaSlug}\n` +
    `- *Status:* *${statusStr}* (${params.isOpen ? 'Em Aberto' : 'Finalizada'})\n` +
    `- *Permanência:* ${params.daysInYard || 0} dia(s) no pátio\n` +
    `- *Cliente:* ${params.clientName || 'Não informado'}`
  );

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
    blocks.push(`----------------------------------------\n> *Posição de Atendimento no Grafo*\n${caseLines.join('\n')}`);
  } else {
    blocks.push(
      `----------------------------------------\n` +
      `> *Posição de Atendimento no Grafo*\n` +
      `- Não há conversa de atendimento vinculada comprovadamente a esta OS no Grafo de Atendimento até o momento.\n` +
      `- Os registros operacionais disponíveis são os consolidados no ERP:\n` +
      `  └ Total da OS: *${moneyFmt(params.totalAmount || 0)}* (Saldo: *${moneyFmt(params.remainingBalance || 0)}*)\n` +
      `  └ Permanência: *${params.daysInYard || 0} dia(s) no pátio*`
    );
  }

  return blocks.join('\n\n');
}

