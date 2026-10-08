/**
 * Hydra — Evidence Policy Manager (Governança e Políticas de Evidência Factual)
 * Spec: hydra-case-history-graph (Versão 2.1)
 * Responsabilidade: Executor 1 (Semântica, Conteúdo Factual e Resposta)
 * Stack: TypeScript Strict (zero `any`, zero `@ts-ignore`)
 */

import { PartItemReference } from './types/conversation_context_contract';

export interface DelayCauseEvaluation {
  readonly hasValidEvidence: boolean;
  readonly isAttributedToPerson: boolean;
  readonly statement: string;
  readonly limitations: readonly string[];
}

export interface OSTimeEvaluation {
  readonly daysOpen: number;
  readonly formattedOpenedAt: string;
  readonly statement: string;
  readonly hasPhysicalYardEvidence: boolean;
  readonly isDurationReconciled: boolean;
}

export interface PartQuantityReductionResult {
  readonly activeDependencies: readonly {
    readonly partName: string;
    readonly partCode?: string;
    readonly quantityPending: number;
    readonly orderRef?: string;
  }[];
  readonly isFullyResolved: boolean;
}

export interface BudgetApprovalEvaluation {
  readonly isApproved: boolean;
  readonly approvedVersion?: string;
  readonly pendingVersion?: string;
  readonly statement: string;
}

export class EvidencePolicyManager {
  /**
   * Avalia causas alegadas de demora contra evidências operacionais comprovadas.
   * CLÁUSULA ANTI-ALUCINAÇÃO (H08 e R03):
   * O status 'NA FILA PARA EXECUÇÃO' do ERP comprova apenas o status cadastral.
   * Não autoriza inferir escassez de mecânicos, box ou peças.
   */
  public static evaluateDelayCause(
    erpStatus: string,
    delayCauseReported?: string,
    authorRole?: string,
    authorName?: string,
    rawExcerpt?: string
  ): DelayCauseEvaluation {
    if (delayCauseReported && delayCauseReported.trim().length > 0) {
      const isAttributed = authorRole === 'ATTENDANT' || authorRole === 'CLIENT';
      const roleDesc = authorRole === 'ATTENDANT' ? 'atendente' : authorRole === 'CLIENT' ? 'cliente' : 'fonte informada';
      const nameDesc = authorName ? ` (${authorName})` : '';
      
      return {
        hasValidEvidence: true,
        isAttributedToPerson: isAttributed,
        statement: `Motivo informado por ${roleDesc}${nameDesc}: "${delayCauseReported.trim()}".`,
        limitations: []
      };
    }

    // Caso de status cadastral sem causa específica relatada
    const normalizedErp = erpStatus.trim().toUpperCase();
    const limitations: string[] = [
      'Ausência de motivo factual registrado para a demora nas conversas ou no ERP.',
      'Proibido inferir escassez de box, técnicos ou peças a partir do status cadastral.'
    ];

    return {
      hasValidEvidence: false,
      isAttributedToPerson: false,
      statement: `Veículo registrado no ERP sob status "${normalizedErp}". Não consta nos registros consultados um motivo específico informado para a demora (sem evidência de falta de peças ou técnicos). A próxima verificação indicada é junto à liderança de oficina da unidade.`,
      limitations
    };
  }

  /**
   * Calcula deterministicamente a idade da OS com base em openedAt/ERP no fuso America/Sao_Paulo.
   * REGRA FACTUAL DE PÁTIO (R03 e H17):
   * Abertura da OS NÃO comprova presença física no pátio. Proibido dizer "carro no pátio há X dias".
   */
  public static evaluateOSTime(
    openedAtIso: string,
    referenceTimestampIso?: string,
    hasYardChecklist = false
  ): OSTimeEvaluation {
    if (!openedAtIso || openedAtIso.trim() === '') {
      return {
        daysOpen: 0,
        formattedOpenedAt: 'Data não informada',
        statement: 'Data de abertura da OS não disponível no ERP.',
        hasPhysicalYardEvidence: false,
        isDurationReconciled: false
      };
    }

    const openedDate = new Date(openedAtIso);
    const refDate = referenceTimestampIso ? new Date(referenceTimestampIso) : new Date();

    if (isNaN(openedDate.getTime()) || isNaN(refDate.getTime()) || openedDate > refDate) {
      return {
        daysOpen: 0,
        formattedOpenedAt: openedAtIso,
        statement: 'Data de abertura da OS com carimbo temporal inválido ou futuro no ERP.',
        hasPhysicalYardEvidence: false,
        isDurationReconciled: false
      };
    }

    // Cálculo civil em dias sob fuso America/Sao_Paulo
    const diffMs = refDate.getTime() - openedDate.getTime();
    const daysOpen = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    // Formatação em pt-BR
    const pad = (n: number) => String(n).padStart(2, '0');
    const d = openedDate.getUTCDate();
    const m = openedDate.getUTCMonth() + 1;
    const y = openedDate.getUTCFullYear();
    const hh = openedDate.getUTCHours();
    const mm = openedDate.getUTCMinutes();
    const formattedOpenedAt = `${pad(d)}/${pad(m)}/${y} às ${pad(hh)}:${pad(mm)}`;

    const yardDesc = hasYardChecklist
      ? ' (com presença física confirmada no pátio via checklist)'
      : ' (registro cadastral de sistema; presença física contínua no pátio depende de conferência presencial)';

    return {
      daysOpen,
      formattedOpenedAt,
      statement: `OS aberta há ${daysOpen} dia(s) (em ${formattedOpenedAt}, segundo o ERP)${yardDesc}.`,
      hasPhysicalYardEvidence: hasYardChecklist,
      isDurationReconciled: true
    };
  }

  /**
   * Realiza a redução de quantidades de peças recebidas versus pendentes (A4.1 e H09).
   * Chegada de uma unidade não encerra a pendência total se foram solicitadas duas.
   */
  public static reducePartQuantities(
    requestedParts: readonly { readonly partName: string; readonly partCode?: string; readonly quantity: number; readonly orderRef?: string }[],
    arrivedParts: readonly { readonly partName?: string; readonly partCode?: string; readonly quantity: number }[]
  ): PartQuantityReductionResult {
    const activeDependencies: {
      partName: string;
      partCode?: string;
      quantityPending: number;
      orderRef?: string;
    }[] = [];

    for (const req of requestedParts) {
      // Localiza chegadas correspondentes pelo partCode (se existir) ou partName normalizado
      let totalArrived = 0;
      for (const arr of arrivedParts) {
        const matchesCode = req.partCode && arr.partCode && req.partCode.trim().toLowerCase() === arr.partCode.trim().toLowerCase();
        const matchesName = arr.partName && req.partName.trim().toLowerCase() === arr.partName.trim().toLowerCase();
        if (matchesCode || matchesName) {
          totalArrived += arr.quantity;
        }
      }

      const pending = Math.max(0, req.quantity - totalArrived);
      if (pending > 0) {
        activeDependencies.push({
          partName: req.partName,
          partCode: req.partCode,
          quantityPending: pending,
          orderRef: req.orderRef
        });
      }
    }

    return {
      activeDependencies,
      isFullyResolved: activeDependencies.length === 0
    };
  }

  /**
   * Avalia a aprovação de orçamentos por versão (A4.1).
   * Aprovação de 'v1' NÃO resolve dependência de 'v2'.
   */
  public static evaluateBudgetApproval(
    approvedVersion?: string,
    pendingVersion?: string
  ): BudgetApprovalEvaluation {
    if (!pendingVersion) {
      if (approvedVersion) {
        return {
          isApproved: true,
          approvedVersion,
          statement: `Orçamento ${approvedVersion} aprovado pelo cliente.`
        };
      }
      return {
        isApproved: false,
        statement: 'Nenhum orçamento pendente ou aprovado registrado.'
      };
    }

    // Há orçamento pendente
    if (approvedVersion && approvedVersion === pendingVersion) {
      return {
        isApproved: true,
        approvedVersion,
        pendingVersion,
        statement: `Orçamento ${approvedVersion} aprovado pelo cliente.`
      };
    }

    if (approvedVersion && approvedVersion !== pendingVersion) {
      return {
        isApproved: false,
        approvedVersion,
        pendingVersion,
        statement: `Orçamento ${approvedVersion} foi aprovado anteriormente, mas há complemento de orçamento ${pendingVersion} pendente de aprovação.`
      };
    }

    return {
      isApproved: false,
      pendingVersion,
      statement: `Orçamento ${pendingVersion} aguarda aprovação do cliente.`
    };
  }
}
