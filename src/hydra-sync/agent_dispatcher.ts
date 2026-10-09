import type Database from 'better-sqlite3';
import {
  resolveVehicleTarget,
  getCaseContext,
  formatVehicleSituation,
  isDelayReasonQuery,
  isIndividualVehicleQuery,
  getExtendedTurnState
} from './hybrid_os_coordinator.js';
import type { TurnPendingRequest, OperationType } from './types/conversation_context_contract.js';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  getDatabaseConnection,
  getOSDetails,
  saveConversationMessage,
  getConversationHistory,
  insertAgentFeedback,
  insertAgentInteractionLog,
  getAgyConversationId,
  setAgyConversationId
} from './db_repository.js';

import {
  sanitizeWhatsAppMarkdown,
  assertNoDoubleAsterisks,
  splitIntoWhatsAppBlocks
} from './format_utils.js';
import { composeSemanticBalloons } from './balloon_composer.js';
import {
  composeFullOS360Card,
  composeOSConversationCard,
  isOSConversationQuery,
  composeExecutiveOSSummary,
  composeOSInteractiveListPayload,
  composeOSServicesCard,
  composeOSPartsCard,
  composeOSPaymentsCard,
  composeOSDocumentsCard,
  composeOSHistoryCard,
  type OS360CardParams
} from './os_situation_composer.js';

export { isOSConversationQuery };

import {
  type AllowedOSModule,
  ALLOWED_OS_MODULES,
  OS_MODULE_ROW_ID_REGEX,
  type EvoListPayload,
  translateInteractiveRowToPrompt
} from './types/evo_interactive_contract.js';

export function parseOSModuleIntent(
  text: string,
  activeOsId?: string | number
): { osId?: string; module?: AllowedOSModule } | null {
  const clean = text.trim();

  // 1. Comando exato de rowId vindo de clique em lista (ex: "os_18503_servicos")
  const rowMatch = clean.match(OS_MODULE_ROW_ID_REGEX);
  if (rowMatch) {
    const osId = rowMatch[1];
    const mod = rowMatch[2].toLowerCase() as AllowedOSModule;
    if (ALLOWED_OS_MODULES.includes(mod)) {
      return { osId, module: mod };
    }
  }

  // 2. Normalização de comandos de texto (tolerante a acentos e maiúsculas)
  const norm = clean.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const osNumMatch = norm.match(/\b(\d{3,8})\b/);
  const targetOsId = osNumMatch ? osNumMatch[1] : (activeOsId ? String(activeOsId) : undefined);

  if (!targetOsId) return null;

  if (/\b(servico|servicos|mao de obra)\b/.test(norm)) {
    return { osId: targetOsId, module: 'servicos' };
  }
  if (/\b(peca|pecas|material|materiais|insumo|insumos)\b/.test(norm)) {
    return { osId: targetOsId, module: 'pecas' };
  }
  if (/\b(pagamento|pagamentos|parcela|parcelas|financeiro|saldo)\b/.test(norm)) {
    return { osId: targetOsId, module: 'pagamentos' };
  }
  if (/\b(documento|documentos|checklist|checklists|vistoria|vistorias|nf|nota fiscal|anexo|anexos)\b/.test(norm)) {
    return { osId: targetOsId, module: 'documentos' };
  }
  if (/\b(historico|conversa|conversas|atendimento|chat|whatsapp)\b/.test(norm)) {
    return { osId: targetOsId, module: 'historico' };
  }

  return null;
}

import {
  getLatestTurnState,
  saveTurnState,
  isReplayMessage,
  type TurnState
} from './turn_context_repository.js';

import {
  rewriteIntent,
  type CanonicalIntent,
  STORE_ALIASES,
  normalizarTexto
} from './intent_rewriter.js';

import {
  executeOperationalQuery
} from './operational_adapter.js';

export function isExplicitFinancialQuery(text: string): boolean {
  const normText = normalizarTexto(text);
  return /\b(faturament|faturou|venda|vendas|meta|metas|cmv|ranking|ticket|ticket medio|area|areas|setor|setores)\b/i.test(normText);
}


import {
  registerIncomingMessage,
  markMessageCompleted,
  markMessageFailed
} from './idempotency_repository.js';

import type { TurnContract, MessageBatchPayload, InboundPart, MediaEvidence } from './types/conversation_contract.js';
import {
  hydraDualRouter,
  GLOBAL_TURN_BUDGET_MS,
  recordTurnTelemetry,
  getTurnTelemetry,
  type DualWorkerRouter
} from './dual_worker_router.js';
import {
  getUserProfile,
  interceptCommand,
  isDeterministicCommand,
  type UserProfile
} from './command_interceptor.js';
import {
  executeManagerStoreQuery,
  executeManagerTool,
  composeFactualTemplate,
  isOutsideManagerStore,
  type ConsultedData,
  type ManagerStoreResult
} from './manager_store_access.js';
import {
  buildCriticalReviewerPrompt,
  buildSynthesisPrompt
} from './semantic_prompt.js';
import { retrieveActiveMemories } from './memory_retriever.js';
import { validateAndPersistMemoryCandidates } from './memory_repository.js';
import {
  appendConversationToDailyDiary,
  getDailyDiaryContext
} from './vault_manager.js';
import {
  validateAndSanitizePublicResponse,
  formatPublicMemoryStatus
} from './public_response_guard.js';
import {
  buildRuntimeDiagnostics,
  formatRuntimeDiagnosticsBalloon
} from './runtime_diagnostics.js';
import {
  queryConversationHistory,
  formatConversationHistoryReply
} from './conversation_history_service.js';
import {
  auditTurnExecution
} from './tool_execution_tracker.js';

export {
  sanitizeWhatsAppMarkdown,
  assertNoDoubleAsterisks,
  splitIntoWhatsAppBlocks
};

function loadSystemPrompt(): string {
  try {
    const promptPath = path.resolve(__dirname, 'system_prompt.md');
    let content = '';
    if (fs.existsSync(promptPath)) {
      content = fs.readFileSync(promptPath, 'utf-8');
    } else {
      content = 'Voc? ? Hydra, assistente de intelig?ncia operacional interno da rede Mec?nica Popular.';
    }

    const domainPath = path.resolve('.agent/memory/domain.md');
    if (fs.existsSync(domainPath)) {
      const domainText = fs.readFileSync(domainPath, 'utf-8');
      content += `\n\n# REGRAS DO DOM?NIO OPERACIONAL\n${domainText.slice(0, 1500)}`;
    }
    return content;
  } catch {
    return 'Voc? ? Hydra, assistente de intelig?ncia operacional interno da rede Mec?nica Popular.';
  }
}

export interface DispatcherInput {
  db?: Database.Database;
  phone: string;
  message: string;
  conversationId?: number | string;
  messageId?: number | string;
  queueWaitMs?: number;
  skipIdempotencyCheck?: boolean;
  batch?: MessageBatchPayload;
  parts?: InboundPart[];
  mediaEvidence?: MediaEvidence[];
  remoteJid?: string;
  metadata?: Record<string, any>;
  attachments?: InboundPart[];
}

export interface StageTelemetry {
  queueWaitMs: number;
  intentRewriteMs: number;
  executionDbMs: number;
  llmMs: number;
  formatMs: number;
  totalMs: number;
}

export interface DispatcherOutput {
  messages: string[];
  replyText: string;
  toolsCalled: string[];
  motor: 'AGY_PRIMARY' | 'AGY_SECONDARY' | 'AGY_CLI' | 'FALLBACK_API';
  latenciaMs: number;
  telemetry: StageTelemetry;
  isFeedback: boolean;
  contract?: TurnContract;
  interactiveList?: EvoListPayload;
}

function fmtMoeda(val: number): string {
  return (val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/[\u00A0\u202F]/g, ' ');
}

function extrairLojaSlug(norm: string): string | undefined {
  for (const [alias, slug] of Object.entries(STORE_ALIASES)) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(norm)) return slug;
  }
  return undefined;
}

/**
 * Classifica se a mensagem do usu?rio ? uma contesta??o / feedback humano
 */
function isFeedbackMessage(texto: string): boolean {
  const norm = normalizarTexto(texto);
  const termosFeedback = [
    'ta errado',
    'esta errado',
    'analise errada',
    'relatorio errado',
    'nao ta travado',
    'nao esta travado',
    'ja foi liberado',
    'ja liberou',
    'ja pagou',
    'corrigir',
    'feedback:'
  ];
  return termosFeedback.some(t => norm.includes(t));
}

/**
 * Executa a intelig?ncia do despachante na VPS com suporte a Dual-Engine,
 * Pipeline Determin?stico de Reescrita de Inten??o e Isolamento Estrito de Turnos.
 */
export async function dispatchMessage(input: DispatcherInput): Promise<DispatcherOutput> {
  const startTime = Date.now();
  const queueWaitMs = input.queueWaitMs || 0;
  let intentRewriteMs = 0;
  let executionDbMs = 0;
  let llmMs = 0;
  let formatMs = 0;

  const db = input.db || getDatabaseConnection();
  const phone = (input.phone || '5511999999999').replace(/\D/g, '');
  const rawMsg = input.message || (input as any).text || '';
  const translatedMsg = translateInteractiveRowToPrompt(rawMsg.trim());
  const textoLimpo = translatedMsg.trim();
  const norm = normalizarTexto(textoLimpo);
  const rawMessageId = input.messageId != null ? String(input.messageId) : undefined;
  const rawConvId = input.conversationId != null ? String(input.conversationId) : undefined;

  // Pré-carregamento imediato do perfil para injeção de loja e governança
  const userProfile = getUserProfile(db, phone);
  if (userProfile.persona === 'gerente') {
    input.metadata = {
      ...(input.metadata || {}),
      lojaSlug: userProfile.lojaSlug,
      lojaNome: userProfile.lojaNome,
      memoryGeneration: userProfile.memoryGeneration
    };
  }

  // 0. VERIFICA??O AT?MICA DE IDEMPOT?NCIA E REPLAY
  if (rawMessageId && !input.skipIdempotencyCheck) {
    const idemp = registerIncomingMessage(db, {
      messageId: rawMessageId,
      phone,
      conversationId: rawConvId,
      text: textoLimpo
    });

    if (idemp.isDuplicate) {
      if (idemp.status === 'COMPLETED') {
        const cachedPayload = idemp.existingRecord?.responsePayload;
        let cachedMessages: string[] = [];
        if (cachedPayload) {
          try { cachedMessages = JSON.parse(cachedPayload); } catch {}
        }

        const totalMs = Date.now() - startTime;
        return {
          messages: [], // Replay: 0 mensagens para evitar reenvio duplicado ao WhatsApp
          replyText: '(Replay ignorado)',
          toolsCalled: idemp.existingRecord?.toolsCalled || [],
          motor: (idemp.existingRecord?.motorUsed as any) || 'FALLBACK_API',
          latenciaMs: totalMs,
          telemetry: {
            queueWaitMs,
            intentRewriteMs: 0,
            executionDbMs: 0,
            llmMs: 0,
            formatMs: 0,
            totalMs
          },
          isFeedback: false
        };
      }

      if (idemp.status === 'IN_FLIGHT') {
        const totalMs = Date.now() - startTime;
        return {
          messages: [],
          replyText: '(Em processamento concorrente)',
          toolsCalled: [],
          motor: 'FALLBACK_API',
          latenciaMs: totalMs,
          telemetry: {
            queueWaitMs,
            intentRewriteMs: 0,
            executionDbMs: 0,
            llmMs: 0,
            formatMs: 0,
            totalMs
          },
          isFeedback: false
        };
      }
    }
  }

  // 0.1 TRATAMENTO DE ERRO MULTIMODAL (ÁUDIO INAUDÍVEL OU MÍDIA ILEGÍVEL)
  if (input.mediaEvidence && input.mediaEvidence.length > 0) {
    const unreadableEvidence = input.mediaEvidence.find(e => e.status === 'unreadable' || e.status === 'error');
    if (unreadableEvidence) {
      let friendlyReply = '';
      if (unreadableEvidence.kind === 'audio') {
        friendlyReply = '> *Áudio Inaudível*\n- Não consegui identificar a fala neste áudio (silêncio ou ruído excessivo).\n- Por favor, envie uma mensagem de texto ou grave novamente em um ambiente com menos ruído.';
      } else if (unreadableEvidence.kind === 'image') {
        friendlyReply = '> *Imagem Ilegível*\n- Não foi possível ler com clareza o conteúdo desta imagem.\n- Por favor, envie uma foto mais nítida ou digite a placa ou número da OS diretamente.';
      } else if (unreadableEvidence.kind === 'document') {
        friendlyReply = '> *Documento Ilegível*\n- Não foi possível extrair os dados deste documento.\n- Por favor, envie um PDF legível ou digite as informações necessárias.';
      } else if (unreadableEvidence.kind === 'video') {
        friendlyReply = '> *Vídeo Não Processado*\n- ' + (unreadableEvidence.limitations?.[0] || 'Não foi possível extrair dados claros do vídeo.') + '\n- Por favor, envie um vídeo de até 60s ou digite sua solicitação.';
      } else {
        friendlyReply = '> *Mídia Não Suportada*\n- Não foi possível processar este arquivo.\n- Por favor, envie sua mensagem em texto.';
      }

      const messages = splitIntoWhatsAppBlocks(friendlyReply);
      const totalMs = Date.now() - startTime;

      if (rawMessageId) {
        markMessageCompleted(db, rawMessageId, {
          messages,
          replyText: friendlyReply,
          toolsCalled: ['multimodal_unreadable_fallback'],
          motorUsed: 'FALLBACK_API',
          latenciaMs: totalMs
        });
      }

      return {
        messages,
        replyText: friendlyReply,
        toolsCalled: ['multimodal_unreadable_fallback'],
        motor: 'FALLBACK_API',
        latenciaMs: totalMs,
        telemetry: {
          queueWaitMs,
          intentRewriteMs: 0,
          executionDbMs: 0,
          llmMs: 0,
          formatMs: 0,
          totalMs
        },
        isFeedback: false
      };
    }
  }

  // 0. INTERCEPTAÇÃO DETERMINÍSTICA DE COMANDOS (/reset, /socio, /perfil, /menu, /{loja})
  if (isDeterministicCommand(textoLimpo)) {
    const cmdResult = await interceptCommand({
      phone,
      text: textoLimpo,
      db
    });
    if (cmdResult.handled) {
      const totalMs = Date.now() - startTime;
      if (rawMessageId) {
        markMessageCompleted(db, rawMessageId, {
          messages: cmdResult.messages,
          replyText: cmdResult.replyText || '',
          toolsCalled: [`command:${cmdResult.command}`],
          motorUsed: 'FALLBACK_API',
          latenciaMs: totalMs
        });
      }
      return {
        messages: cmdResult.messages,
        replyText: cmdResult.replyText || '',
        toolsCalled: [`command:${cmdResult.command}`],
        motor: 'FALLBACK_API',
        latenciaMs: totalMs,
        telemetry: {
          queueWaitMs,
          intentRewriteMs: 0,
          executionDbMs: 0,
          llmMs: 0,
          formatMs: 0,
          totalMs
        },
        isFeedback: false
      };
    }
  }

  // 1. FLUXO DE FEEDBACK HUMANO / CONTESTA??O (Status: PENDING)
  if (isFeedbackMessage(textoLimpo)) {
    insertAgentFeedback(db, {
      phone,
      conversation_id: rawConvId ? Number(rawConvId) || undefined : undefined,
      message_id: rawMessageId ? Number(rawMessageId) || undefined : undefined,
      feedback_usuario: textoLimpo,
      status: 'PENDING'
    });

    const replyText = `> *Observa??o catalogada para auditoria operacional*\n- *Mensagem registrada:* "${textoLimpo}"\n- *A??o:* As ordens no banco foram preservadas sem altera??es autom?ticas.`;
    const messages = composeSemanticBalloons(replyText);
    const totalMs = Date.now() - startTime;

    if (rawMessageId) {
      markMessageCompleted(db, rawMessageId, {
        messages,
        replyText,
        toolsCalled: ['record_feedback'],
        motorUsed: 'FALLBACK_API',
        latenciaMs: totalMs
      });
    }

    insertAgentInteractionLog(db, {
      phone,
      conversation_id: rawConvId ? Number(rawConvId) || undefined : undefined,
      message_id: rawMessageId ? Number(rawMessageId) || undefined : undefined,
      pergunta: textoLimpo,
      tools_chamadas: ['record_feedback'],
      resposta_gerada: replyText,
      latencia_ms: totalMs,
      motor_utilizado: 'FALLBACK_API'
    });

    return {
      messages,
      replyText,
      toolsCalled: ['record_feedback'],
      motor: 'FALLBACK_API',
      latenciaMs: totalMs,
      telemetry: {
        queueWaitMs,
        intentRewriteMs: 0,
        executionDbMs: 0,
        llmMs: 0,
        formatMs: 0,
        totalMs
      },
      isFeedback: true
    };
  }

  // 2. RECUPERA??O IMEDIATA DO ESTADO ESTRUTURADO DE TURNO (TTL: 120 minutos)
  // [E3-01]: Carregar o previousState ANTES de corre??es, sauda??es, incompreens?o ou reescrita
  const previousState = getLatestTurnState(db, phone, 120);
  const prevPending = previousState?.filters?.pendingRequest as TurnPendingRequest | undefined;
  const prevVehicleModel = (previousState?.filters?.vehicleModel || prevPending?.targetModel) as string | undefined;
  const prevPlaca = (previousState?.placa || previousState?.filters?.placa || prevPending?.targetPlate) as string | undefined;
  const prevOsId = (previousState?.osId || previousState?.filters?.osId || prevPending?.targetOsId) as string | undefined;
  const prevLojaSlug = (previousState?.lojaSlug || previousState?.filters?.lojaSlug || prevPending?.targetLojaSlug) as string | undefined;

  // 2.1. REPARA??O DE CONTEXTO E CORRE??O CONVERSACIONAL (ANTES de hist?rico, sauda??o e ajuda gen?rica - [E3-01])
  // Normaliza??o de g?ria: 'nn' -> 'nao'
  const normCorrection = norm.replace(/\bnn\b/g, 'nao');
  const isCorrection =
    /\b(nao foi isso( que perguntei)?|nao era isso|nao perguntei isso|estou falando da nossa conversa|da nossa conversa|nada a ver|errou|vc entendeu errado|voce entendeu errado|interpretou errado|perdao n foi isso|desculpe n foi isso)\b/i.test(normCorrection) ||
    normCorrection.startsWith('nao foi isso') ||
    normCorrection.startsWith('nao e isso') ||
    normCorrection.startsWith('nao era isso') ||
    normCorrection.startsWith('errou') ||
    normCorrection.startsWith('nao e nada disso') ||
    normCorrection === 'nao foi isso' ||
    normCorrection === 'nao e isso' ||
    normCorrection === 'nao era isso' ||
    normCorrection === 'nao' ||
    normCorrection === 'nn';

  if (isCorrection) {
    // R02: Preserva foco sem cair em hist?rico ('o que perguntei' n?o vira conversation_history)
    let replyText = 'Entendido, pe?o desculpas pela confus?o anterior.';
    const vTarget = prevPending?.targetModel || prevVehicleModel;
    if (vTarget) {
      replyText = `Entendido, pe?o desculpas pela confus?o. Est?vamos tratando do ve?culo ${vTarget.toUpperCase()}. O que voc? gostaria de saber exatamente sobre este caso?`;
    } else if (prevPlaca || prevOsId) {
      const targetDesc = prevPlaca ? `da placa ${prevPlaca}` : `da OS #${prevOsId}`;
      replyText = `Entendido, pe?o desculpas pela confus?o. Est?vamos tratando ${targetDesc}. O que voc? gostaria de saber exatamente sobre este caso?`;
    }

    const sanitized = validateAndSanitizePublicResponse(replyText);
    const messages = splitIntoWhatsAppBlocks(sanitized.cleanText);
    const totalMs = Date.now() - startTime;

    saveConversationMessage(db, phone, 'user', textoLimpo);
    saveConversationMessage(db, phone, 'assistant', sanitized.cleanText, 'conversation_correction', null);

    saveTurnState(db, {
      phone,
      lastTurnId: previousState?.lastTurnId || ('turn_' + Date.now()),
      lastIntent: 'conversation_correction',
      lojaSlug: prevLojaSlug,
      placa: prevPlaca,
      osId: prevOsId,
      filters: {
        ...(previousState?.filters || {}),
        vehicleModel: prevVehicleModel,
        pendingRequest: prevPending
      },
      lastMessageId: rawMessageId ? Number(rawMessageId) || undefined : undefined,
      lastResponseText: sanitized.cleanText,
      updatedAt: new Date().toISOString()
    });

    if (rawMessageId) {
      markMessageCompleted(db, rawMessageId, {
        messages,
        replyText: sanitized.cleanText,
        toolsCalled: ['conversation_correction'],
        motorUsed: 'FALLBACK_API',
        latenciaMs: totalMs
      });
    }

    insertAgentInteractionLog(db, {
      phone,
      conversation_id: rawConvId ? Number(rawConvId) || undefined : undefined,
      message_id: rawMessageId ? Number(rawMessageId) || undefined : undefined,
      pergunta: textoLimpo,
      tools_chamadas: ['conversation_correction'],
      resposta_gerada: sanitized.cleanText,
      latencia_ms: totalMs,
      motor_utilizado: 'FALLBACK_API'
    });

    appendConversationToDailyDiary(phone, textoLimpo, sanitized.cleanText, {
      turnId: previousState?.lastTurnId || ('turn_' + Date.now())
    });

    return {
      messages,
      replyText: sanitized.cleanText,
      toolsCalled: ['conversation_correction'],
      motor: 'FALLBACK_API',
      latenciaMs: totalMs,
      telemetry: {
        queueWaitMs,
        intentRewriteMs: 0,
        executionDbMs: 0,
        llmMs: 0,
        formatMs: 0,
        totalMs
      },
      isFeedback: false
    };
  }

  // 2.2. DISPONIBILIDADE E PRESEN?A ("ia ta ativa?", "ta ativa?", "hydra ta ativa?") [E3-01 / R05]
  const isAvailability =
    /\b(?:ia|hydra|bot|assistente)?\s*(?:ta|esta|voce ta|vc ta)\s*(?:ativa|online|operacional|funcionando|viva|acordada)\b/i.test(norm) ||
    norm === 'ia ta ativa?' || norm === 'ia ta ativa' || norm === 'ta ativa' || norm === 'ta ativa?';

  if (isAvailability) {
    const replyText = 'Sim, estou ativa e operacional.';
    const messages = splitIntoWhatsAppBlocks(replyText);
    const totalMs = Date.now() - startTime;

    saveConversationMessage(db, phone, 'user', textoLimpo);
    saveConversationMessage(db, phone, 'assistant', replyText, 'availability_check', null);

    // R05: Responder afirma??o de presen?a SEM limpar nem sobrescrever o TurnPendingRequest do ve?culo em foco!
    saveTurnState(db, {
      phone,
      lastTurnId: previousState?.lastTurnId || ('turn_' + Date.now()),
      lastIntent: previousState?.lastIntent || 'other',
      lojaSlug: prevLojaSlug,
      placa: prevPlaca,
      osId: prevOsId,
      filters: {
        ...(previousState?.filters || {}),
        vehicleModel: prevVehicleModel,
        pendingRequest: prevPending
      },
      lastMessageId: rawMessageId ? Number(rawMessageId) || undefined : undefined,
      lastResponseText: replyText,
      updatedAt: new Date().toISOString()
    });

    if (rawMessageId) {
      markMessageCompleted(db, rawMessageId, {
        messages,
        replyText,
        toolsCalled: ['availability_check'],
        motorUsed: 'FALLBACK_API',
        latenciaMs: totalMs
      });
    }

    insertAgentInteractionLog(db, {
      phone,
      conversation_id: rawConvId ? Number(rawConvId) || undefined : undefined,
      message_id: rawMessageId ? Number(rawMessageId) || undefined : undefined,
      pergunta: textoLimpo,
      tools_chamadas: ['availability_check'],
      resposta_gerada: replyText,
      latencia_ms: totalMs,
      motor_utilizado: 'FALLBACK_API'
    });

    return {
      messages,
      replyText,
      toolsCalled: ['availability_check'],
      motor: 'FALLBACK_API',
      latenciaMs: totalMs,
      telemetry: {
        queueWaitMs,
        intentRewriteMs: 0,
        executionDbMs: 0,
        llmMs: 0,
        formatMs: 0,
        totalMs
      },
      isFeedback: false
    };
  }

  // 2.3. INCOMPREENS?O DO OPERADOR ("n?o entendi", "como?") [E3-01 / R04]
  const isDuvida = norm === 'nao entendi' || norm === 'nao compreendi' || norm === 'como assim' || norm === 'como?' || norm === 'como';
  if (isDuvida) {
    let replyText = '';
    if (prevPending?.targetModel || prevVehicleModel) {
      const vTarget = (prevPending?.targetModel || prevVehicleModel || '').toUpperCase();
      replyText = `Estamos verificando a situa??o do ve?culo *${vTarget}*. Como h? mais de uma unidade na rede ou precisamos especificar o ve?culo, por favor informe a placa ou a unidade para prosseguirmos.`;
    } else if (prevPlaca || prevOsId) {
      const targetDesc = prevPlaca ? `da placa *${prevPlaca}*` : `da OS *#${prevOsId}*`;
      replyText = `Estamos verificando os dados ${targetDesc}. O que voc? gostaria de esclarecer sobre este atendimento?`;
    } else {
      const duvidaProfile = userProfile || getUserProfile(db, phone);
      replyText = duvidaProfile.persona === 'gerente'
        ? `Posso consultar faturamento, meta, CMV e OSs apenas da unidade ${duvidaProfile.lojaNome || 'ativa'}. Use /perfil para conferir a loja.`
        : 'Posso consultar m?tricas operacionais, faturamento, metas, CMV e ordens de servi?o da rede ou de uma unidade espec?fica.\n\nVoc? pode perguntar a situa??o de qualquer unidade (ex: "como est? o Jabaquara?"), pedir os carros retidos h? mais tempo ou buscar uma placa espec?fica.';
    }

    const messages = splitIntoWhatsAppBlocks(replyText);
    const totalMs = Date.now() - startTime;

    saveConversationMessage(db, phone, 'user', textoLimpo);
    saveConversationMessage(db, phone, 'assistant', replyText, null, null);

    saveTurnState(db, {
      phone,
      lastTurnId: previousState?.lastTurnId || ('turn_' + Date.now()),
      lastIntent: previousState?.lastIntent || 'other',
      lojaSlug: prevLojaSlug,
      placa: prevPlaca,
      osId: prevOsId,
      filters: {
        ...(previousState?.filters || {}),
        vehicleModel: prevVehicleModel,
        pendingRequest: prevPending
      },
      lastMessageId: rawMessageId ? Number(rawMessageId) || undefined : undefined,
      lastResponseText: replyText,
      updatedAt: new Date().toISOString()
    });

    if (rawMessageId) {
      markMessageCompleted(db, rawMessageId, {
        messages,
        replyText,
        toolsCalled: ['explain_turn_target'],
        motorUsed: 'FALLBACK_API',
        latenciaMs: totalMs
      });
    }

    insertAgentInteractionLog(db, {
      phone,
      conversation_id: rawConvId ? Number(rawConvId) || undefined : undefined,
      message_id: rawMessageId ? Number(rawMessageId) || undefined : undefined,
      pergunta: textoLimpo,
      tools_chamadas: ['explain_turn_target'],
      resposta_gerada: replyText,
      latencia_ms: totalMs,
      motor_utilizado: 'FALLBACK_API'
    });

    return {
      messages,
      replyText,
      toolsCalled: ['explain_turn_target'],
      motor: 'FALLBACK_API',
      latenciaMs: totalMs,
      telemetry: {
        queueWaitMs,
        intentRewriteMs: 0,
        executionDbMs: 0,
        llmMs: 0,
        formatMs: 0,
        totalMs
      },
      isFeedback: false
    };
  }

  // 2.4. SAUDA??ES NATURAIS E AGRADECIMENTOS (Voz Executiva)
  // [E3-01 / R07]: Detector com word boundaries para que "oi" como substring de "foi" N?O seja sauda??o!
  const hasOperKeyword = norm.includes('placa') || norm.includes('os ') || norm.includes('checklist') || norm.includes('patio') || norm.includes('meta') || norm.includes('fatur') || norm.includes('cmv') || norm.includes('linea') || norm.includes('carro') || norm.includes('veiculo');
  const greetingWordPattern = /\b(?:oi|ola|opa|bom dia|boa tarde|boa noite|e ai|fala hydra|ola hydra|oi hydra)\b/i;
  const isGreetingWord = greetingWordPattern.test(norm);
  const isGreeting = !isCorrection && !hasOperKeyword && isGreetingWord && (
    norm.length <= 4 ||
    norm.includes('hydra') ||
    norm.includes('tudo bem') ||
    norm.includes('boa tarde') ||
    norm.includes('bom dia') ||
    norm.includes('boa noite') ||
    norm.length < 20
  );

  const THANKS_WORDS = ['obrigado', 'obrigada', 'valeu', 'agradeco', 'agrade?o', 'muito obrigado', 'valeu mesmo'];
  const isThanks = !hasOperKeyword && (
    THANKS_WORDS.some(t => norm.includes(t)) ||
    norm === 'beleza' || norm === 'show' || norm === 'valeu' || norm === 'ok' || norm === 'perfeito' || norm === 'beleza, obrigado' || norm === 'beleza obrigado'
  );

  if (isGreeting || isThanks) {
    const replyMsg = isThanks ? '? disposi??o. Qualquer d?vida, estou por aqui.' : 'Ol?! Como posso ajudar hoje?';
    const messages = splitIntoWhatsAppBlocks(replyMsg);
    saveConversationMessage(db, phone, 'user', textoLimpo);
    saveConversationMessage(db, phone, 'assistant', replyMsg, null, null);
    const totalMs = Date.now() - startTime;

    if (rawMessageId) {
      markMessageCompleted(db, rawMessageId, {
        messages,
        replyText: replyMsg,
        toolsCalled: [],
        motorUsed: 'FALLBACK_API',
        latenciaMs: totalMs
      });
    }

    insertAgentInteractionLog(db, {
      phone,
      conversation_id: rawConvId ? Number(rawConvId) || undefined : undefined,
      message_id: rawMessageId ? Number(rawMessageId) || undefined : undefined,
      pergunta: textoLimpo,
      tools_chamadas: [],
      resposta_gerada: replyMsg,
      latencia_ms: totalMs,
      motor_utilizado: 'FALLBACK_API'
    });

    return {
      messages: [replyMsg],
      replyText: replyMsg,
      toolsCalled: [],
      motor: 'FALLBACK_API',
      latenciaMs: totalMs,
      telemetry: {
        queueWaitMs,
        intentRewriteMs: 0,
        executionDbMs: 0,
        llmMs: 0,
        formatMs: 0,
        totalMs
      },
      isFeedback: false
    };
  }

  // 2.4. GUARDA DE ESCOPO DE LOJA PARA GERENTE (Zero Vazamento Cross-Store)
  if (userProfile.persona === 'gerente' && isOutsideManagerStore(textoLimpo, userProfile.lojaSlug || 'MPdompedro1')) {
    const replyText = 'No perfil de gerente, você só pode consultar informações da sua unidade. Para acessar dados de outras lojas ou da rede completa, use o comando /socio.';
    const messages = composeSemanticBalloons(replyText);
    const totalMs = Date.now() - startTime;
    return {
      messages,
      replyText,
      toolsCalled: ['manager_scope_denied'],
      motor: 'FALLBACK_API',
      latenciaMs: totalMs,
      telemetry: {
        queueWaitMs,
        intentRewriteMs: 0,
        executionDbMs: 0,
        llmMs: 0,
        formatMs: 0,
        totalMs
      },
      isFeedback: false
    };
  }

  // 2.5. RESOLUÇÃO E COORDENAÇÃO DE VEÍCULO INDIVIDUAL ([E3-02], [E3-03], R01, R06, R08, R09, R10, R11, R12)
  const plateMatch = textoLimpo.match(/\b([A-Z]{3}-?\d[A-Z0-9]\d{2})\b/i);
  const osModuleMatch = textoLimpo.match(OS_MODULE_ROW_ID_REGEX);
  const osMatch = osModuleMatch
    ? [osModuleMatch[0], osModuleMatch[1]]
    : textoLimpo.match(/\b(?:os|ordem)[_\s]*#?\s*(\d{1,8})\b/i);
  let modelMatch = textoLimpo.match(/\b(linea|civic|corolla|hb20|onix|gol|palio|fiesta|compass|renegade|renegate|kwid|argo|cronos|polo|virtus|t-cross|creta|tracker|kicks|voyage|fox|c3|c4|sandero|clio|duster|logan|uno|siena|mobi|strada|saveiro|ka|ecosport|spin|prisma|cruze|fit|city|hr-v|etios|yaris|peugeot|208|308|408|celta|corsa|meriva|zafira|tucson|ix35|up|fusca|bravo|punto|stilo|idea|doblo|amarok|hilux|ranger|s10|l200|frontier|toro|oroch)\b/i);

  // Precedência estrita: consultas financeiras ou de métricas NUNCA são capturadas como veículo
  const isFinancialQuery = isExplicitFinancialQuery(textoLimpo);

  // Resolução de anáfora de OS citada pelo bot no turno anterior imediato
  let inferredOsId = prevOsId;
  if (!inferredOsId && previousState?.lastResponseText) {
    const lastOsMatch = previousState.lastResponseText.match(/\b(?:os|ordem)\s*#?\s*(\d{1,6})\b/i);
    if (lastOsMatch) {
      inferredOsId = lastOsMatch[1];
    }
  }

  let currentStoreSlug: string | undefined = extrairLojaSlug(norm);
  if (!currentStoreSlug) {
    if (norm.includes('jabaquara')) currentStoreSlug = 'MPJabaquara';
    else if (norm.includes('santo andre') || norm.includes('santoandre')) currentStoreSlug = 'MPSantoAndre';
  }

  // R3: Isolamento Estrito de Loja para Gerente (Zero Vazamento Cross-Store)
  if (userProfile.persona === 'gerente' && userProfile.lojaSlug) {
    currentStoreSlug = userProfile.lojaSlug;
  }

  const isDelay = isDelayReasonQuery(textoLimpo) || prevPending?.operation === 'DELAY_REASON';
  const opType: OperationType = isDelay ? 'DELAY_REASON' : 'VEHICLE_SITUATION';

  // R13: Se modelo não foi informado e não há contexto, JAMAIS fazer default para 'linea'
  const currentModel = modelMatch ? modelMatch[1].toLowerCase() : (prevPending?.targetModel || prevVehicleModel);
  const currentPlate = plateMatch ? plateMatch[1].toUpperCase().replace('-', '') : (prevPlaca);
  const currentOsId = osMatch ? osMatch[1] : (prevOsId || inferredOsId);
  const currentStore = userProfile.persona === 'gerente' && userProfile.lojaSlug
    ? userProfile.lojaSlug
    : (currentStoreSlug || (modelMatch ? undefined : prevLojaSlug));

  const isOSConv = isOSConversationQuery(norm);

  const isAnaphoraOSRequest = Boolean(
    (currentOsId || currentPlate || currentModel) && (
      isOSConv ||
      osModuleMatch ||
      norm.includes('detalhe') ||
      norm.includes('detalhes') ||
      norm.includes('fale mais') ||
      norm.includes('me de detalhes') ||
      norm.includes('sobre ela') ||
      norm.includes('dessa os') ||
      norm.includes('da os') ||
      norm.includes('pagamento') ||
      norm.includes('forma') ||
      norm.includes('parcela') ||
      norm.includes('servico') ||
      norm.includes('serviço') ||
      norm.includes('peca') ||
      norm.includes('peça') ||
      norm.includes('documento') ||
      norm.includes('doc') ||
      norm.includes('checklist')
    )
  );

  const isExplicitVehicleRequest = !isFinancialQuery && Boolean(
    modelMatch ||
    plateMatch ||
    osMatch ||
    norm.includes('caso do') ||
    norm.includes('quero saber do') ||
    norm.includes('situacao do') ||
    (prevPending?.deliveryStatus === 'PENDING_CHOICE' && (currentStoreSlug || norm.includes('linea') || norm.includes('por favor') || norm.includes('quero saber'))) ||
    isAnaphoraOSRequest
  );

  // 3. PIPELINE DE REESCRITA DE INTENÇÃO (Gera CanonicalIntent)
  saveConversationMessage(db, phone, 'user', textoLimpo);
  const tRewriteStart = Date.now();
  const canonical = rewriteIntent(textoLimpo, previousState, { batch: input.batch, parts: input.parts, mediaEvidence: input.mediaEvidence });
  intentRewriteMs = Date.now() - tRewriteStart;

  const activeProfile = userProfile || getUserProfile(db, phone);

  // 3.0.1 DIAGN??STICO FACTUAL DE RUNTIME & OBSIDIAN VAULT (Critérios M01 / A01)
  if (canonical.intent === 'runtime_diagnostics' || canonical.contract?.operation === 'runtime_diagnostics') {
    const tDbStart = Date.now();
    const diag = buildRuntimeDiagnostics(db, phone);
    executionDbMs = Date.now() - tDbStart;
    const memStatus = diag.vault.isAccessible ? 'recording_active' : 'recording_unavailable';
    const replyText = formatPublicMemoryStatus(memStatus);
    const messages = splitIntoWhatsAppBlocks(replyText);
    const totalMs = Date.now() - startTime;

    saveConversationMessage(db, phone, 'assistant', replyText, 'runtime_diagnostics', null);
    saveTurnState(db, {
      phone,
      lastTurnId: canonical.turnId,
      lastIntent: 'runtime_diagnostics',
      lojaSlug: canonical.lojaSlug,
      filters: {},
      lastContract: canonical.contract,
      lastMessageId: rawMessageId ? Number(rawMessageId) || undefined : undefined,
      lastResponseText: replyText,
      updatedAt: new Date().toISOString()
    });

    if (rawMessageId) {
      markMessageCompleted(db, rawMessageId, {
        messages,
        replyText,
        toolsCalled: ['runtime_diagnostics'],
        motorUsed: 'FALLBACK_API',
        latenciaMs: totalMs
      });
    }

    insertAgentInteractionLog(db, {
      phone,
      conversation_id: rawConvId ? Number(rawConvId) || undefined : undefined,
      message_id: rawMessageId ? Number(rawMessageId) || undefined : undefined,
      pergunta: textoLimpo,
      tools_chamadas: ['runtime_diagnostics'],
      resposta_gerada: replyText,
      latencia_ms: totalMs,
      motor_utilizado: 'FALLBACK_API'
    });

    return {
      messages,
      replyText,
      toolsCalled: ['runtime_diagnostics'],
      motor: 'FALLBACK_API',
      latenciaMs: totalMs,
      telemetry: {
        queueWaitMs,
        intentRewriteMs,
        executionDbMs,
        llmMs: 0,
        formatMs: 0,
        totalMs
      },
      isFeedback: false,
      contract: canonical.contract
    };
  }

  // 3.0.2 HIST??RICO DE CONVERSA E PRIMEIRA PERGUNTA (Critérios M09 / A05)
  if (canonical.intent === 'conversation_history' || canonical.contract?.operation === 'conversation_history') {
    const tDbStart = Date.now();
    const isFirst = !!canonical.contract?.filters?.isFirstQuestionQuery;
    const histResult = queryConversationHistory(db, { phone, scope: isFirst ? 'all_available' : 'today',
      queryType: isFirst ? 'first_question' : 'recent_turns'
    });
    executionDbMs = Date.now() - tDbStart;
    const replyText = formatConversationHistoryReply(histResult);
    const messages = splitIntoWhatsAppBlocks(replyText);
    const totalMs = Date.now() - startTime;

    saveConversationMessage(db, phone, 'assistant', replyText, 'conversation_history', null);
    saveTurnState(db, {
      phone,
      lastTurnId: canonical.turnId,
      lastIntent: 'conversation_history',
      lojaSlug: canonical.lojaSlug,
      filters: {},
      lastContract: canonical.contract,
      lastMessageId: rawMessageId ? Number(rawMessageId) || undefined : undefined,
      lastResponseText: replyText,
      updatedAt: new Date().toISOString()
    });

    if (rawMessageId) {
      markMessageCompleted(db, rawMessageId, {
        messages,
        replyText,
        toolsCalled: ['conversation_history'],
        motorUsed: 'FALLBACK_API',
        latenciaMs: totalMs
      });
    }

    insertAgentInteractionLog(db, {
      phone,
      conversation_id: rawConvId ? Number(rawConvId) || undefined : undefined,
      message_id: rawMessageId ? Number(rawMessageId) || undefined : undefined,
      pergunta: textoLimpo,
      tools_chamadas: ['conversation_history'],
      resposta_gerada: replyText,
      latencia_ms: totalMs,
      motor_utilizado: 'FALLBACK_API'
    });

    return {
      messages,
      replyText,
      toolsCalled: ['conversation_history'],
      motor: 'FALLBACK_API',
      latenciaMs: totalMs,
      telemetry: {
        queueWaitMs,
        intentRewriteMs,
        executionDbMs,
        llmMs: 0,
        formatMs: 0,
        totalMs
      },
      isFeedback: false,
      contract: canonical.contract
    };
  }

  // 3.0.3 REGISTRO DE PREFER??NCIA EXPL??CITA DE OPERADOR (Critérios M03 / M04 / M08)
  if (canonical.intent === 'memory_preference' || canonical.contract?.operation === 'memory_preference') {
    const tDbStart = Date.now();
    const prefText = canonical.contract?.filters?.preferenceText || textoLimpo;
    const normPref = prefText.toLowerCase();
    const topicKey = normPref.includes('faturamento') ? 'ordem_exibicao'
      : normPref.includes('cmv') ? 'cmv_display_unit'
      : 'preferencia_geral';

    const candidate = {
      memoryType: 'explicit_preference',
      topicKey,
      contentNormalized: prefText,
      evidenceText: textoLimpo,
      confidence: 1.0,
      scopeType: activeProfile.persona === 'gerente' ? 'loja' : 'rede',
      lojaSlug: activeProfile.persona === 'gerente' ? activeProfile.lojaSlug : undefined
    };

    validateAndPersistMemoryCandidates(db, [candidate as any], {
      phone,
      generationId: activeProfile.memoryGeneration || 1,
      effectivePersona: activeProfile.persona,
      activeLojaSlug: activeProfile.lojaSlug,
      turnId: canonical.turnId || ('turn-' + Date.now()),
      rawUserMessage: textoLimpo
    });
    executionDbMs = Date.now() - tDbStart;

    const escopoDesc = activeProfile.persona === 'gerente' ? (activeProfile.lojaNome || activeProfile.lojaSlug) : 'Rede';
    const replyText = sanitizeWhatsAppMarkdown(
      '> *Preferência Registrada no Obsidian Vault*\n- *Preferência:* ' + prefText + '\n- *Escopo:* ' + escopoDesc + '\n- *Status:* Ativa na memória persistente.'
    );
    const messages = splitIntoWhatsAppBlocks(replyText);
    const totalMs = Date.now() - startTime;

    saveConversationMessage(db, phone, 'assistant', replyText, 'memory_preference', null);
    saveTurnState(db, {
      phone,
      lastTurnId: canonical.turnId,
      lastIntent: 'memory_preference',
      lojaSlug: canonical.lojaSlug,
      filters: {},
      lastContract: canonical.contract,
      lastMessageId: rawMessageId ? Number(rawMessageId) || undefined : undefined,
      lastResponseText: replyText,
      updatedAt: new Date().toISOString()
    });

    if (rawMessageId) {
      markMessageCompleted(db, rawMessageId, {
        messages,
        replyText,
        toolsCalled: ['memory_preference'],
        motorUsed: 'FALLBACK_API',
        latenciaMs: totalMs
      });
    }

    insertAgentInteractionLog(db, {
      phone,
      conversation_id: rawConvId ? Number(rawConvId) || undefined : undefined,
      message_id: rawMessageId ? Number(rawMessageId) || undefined : undefined,
      pergunta: textoLimpo,
      tools_chamadas: ['memory_preference'],
      resposta_gerada: replyText,
      latencia_ms: totalMs,
      motor_utilizado: 'FALLBACK_API'
    });

    return {
      messages,
      replyText,
      toolsCalled: ['memory_preference'],
      motor: 'FALLBACK_API',
      latenciaMs: totalMs,
      telemetry: {
        queueWaitMs,
        intentRewriteMs,
        executionDbMs,
        llmMs: 0,
        formatMs: 0,
        totalMs
      },
      isFeedback: false,
      contract: canonical.contract
    };
  }

      // Tratamento ágil de correção conversacional (Tom Executivo)
  if (canonical.intent === 'conversation_correction' || canonical.contract?.operation === 'conversation_correction') {
    const replyText = "Entendido, peço desculpas pela confusão anterior.";
    const sanitized = validateAndSanitizePublicResponse(replyText);
    const messages = splitIntoWhatsAppBlocks(sanitized.cleanText);
    const totalMs = Date.now() - startTime;

    saveConversationMessage(db, phone, 'assistant', sanitized.cleanText, 'conversation_correction', null);
    saveTurnState(db, {
      phone,
      lastTurnId: canonical.turnId,
      lastIntent: 'conversation_correction',
      lojaSlug: canonical.lojaSlug,
      filters: {},
      lastContract: canonical.contract,
      lastMessageId: rawMessageId ? Number(rawMessageId) || undefined : undefined,
      lastResponseText: sanitized.cleanText,
      updatedAt: new Date().toISOString()
    });

    if (rawMessageId) {
      markMessageCompleted(db, rawMessageId, {
        messages,
        replyText: sanitized.cleanText,
        toolsCalled: ['conversation_correction'],
        motorUsed: 'FALLBACK_API',
        latenciaMs: totalMs
      });
    }

    insertAgentInteractionLog(db, {
      phone,
      conversation_id: rawConvId ? Number(rawConvId) || undefined : undefined,
      message_id: rawMessageId ? Number(rawMessageId) || undefined : undefined,
      pergunta: textoLimpo,
      tools_chamadas: ['conversation_correction'],
      resposta_gerada: sanitized.cleanText,
      latencia_ms: totalMs,
      motor_utilizado: 'FALLBACK_API'
    });

    appendConversationToDailyDiary(phone, textoLimpo, sanitized.cleanText, {
      turnId: canonical.turnId
    });

    return {
      messages,
      replyText: sanitized.cleanText,
      toolsCalled: ['conversation_correction'],
      motor: 'FALLBACK_API',
      latenciaMs: totalMs,
      telemetry: {
        queueWaitMs,
        intentRewriteMs,
        executionDbMs: 0,
        llmMs: 0,
        formatMs: 0,
        totalMs
      },
      isFeedback: false,
      contract: canonical.contract
    };
  }

  // A persona de gerente aciona o ciclo do Revisor Crítico de IA (AI Reviewer)
  if (activeProfile.persona === 'gerente') {
    return runManagerAiReviewer({
      db,
      phone,
      message: textoLimpo,
      userProfile: activeProfile,
      canonical,
      previousState,
      startTime,
      rawMessageId,
      rawConvId,
      queueWaitMs,
      intentRewriteMs
    });
  }

  // 3.1. Caso de Ambiguidade / Esclarecimento / Fora de Escopo / Capacidade Indispon?vel
  if (canonical.needsClarification || canonical.contract?.decision === 'clarify' || canonical.contract?.decision === 'out_of_scope' || canonical.contract?.decision === 'unsupported_capability') {
    const clarifText = sanitizeWhatsAppMarkdown(canonical.clarificationMessage || 'Por favor, detalhe se voc? deseja consultar uma loja, placa ou resumo de ordens abertas.');
    const messages = splitIntoWhatsAppBlocks(clarifText);

    saveConversationMessage(db, phone, 'assistant', clarifText, null, null);
    saveTurnState(db, {
      phone,
      lastTurnId: canonical.turnId,
      lastIntent: 'other',
      lojaSlug: undefined,
      filters: {},
      lastContract: canonical.contract,
      lastMessageId: rawMessageId ? Number(rawMessageId) || undefined : undefined,
      lastResponseText: clarifText,
      updatedAt: new Date().toISOString()
    });

    const totalMs = Date.now() - startTime;
    if (rawMessageId) {
      markMessageCompleted(db, rawMessageId, {
        messages,
        replyText: clarifText,
        toolsCalled: ['ask_clarification'],
        motorUsed: 'FALLBACK_API',
        latenciaMs: totalMs
      });
    }

    insertAgentInteractionLog(db, {
      phone,
      conversation_id: rawConvId ? Number(rawConvId) || undefined : undefined,
      message_id: rawMessageId ? Number(rawMessageId) || undefined : undefined,
      pergunta: textoLimpo,
      tools_chamadas: ['ask_clarification'],
      resposta_gerada: clarifText,
      latencia_ms: totalMs,
      motor_utilizado: 'FALLBACK_API'
    });

    return {
      messages,
      replyText: clarifText,
      toolsCalled: ['ask_clarification'],
      motor: 'FALLBACK_API',
      latenciaMs: totalMs,
      telemetry: {
        queueWaitMs,
        intentRewriteMs,
        executionDbMs: 0,
        llmMs: 0,
        formatMs: 0,
        totalMs
      },
      isFeedback: false,
      contract: canonical.contract
    };
  }

    // 4. FLUXO DE CONSULTA OPERACIONAL (DUAL-ENGINE COM ISOLAMENTO DE TURNO & CIRCUITO DE COTA)
  let motor: 'AGY_PRIMARY' | 'AGY_SECONDARY' | 'AGY_CLI' | 'FALLBACK_API' = 'AGY_PRIMARY';
  let toolsCalled: string[] = [];
  let replyText = '';
  let toolToRecord: string | null = null;
  let paramsToRecord: Record<string, any> | null = null;

  const tLlmStart = Date.now();
  try {
    const agyBin = process.env.AGY_BIN_OVERRIDE;
    if (agyBin === '/bin/false' || (agyBin && agyBin.includes('false'))) {
      throw new Error('AGY_BIN_OVERRIDE configurado para bypass');
    }

    const agyConvId = getAgyConversationId(db, phone);

    let socioMemoriesBlock = '';
    try {
      const activeSocioProfile = userProfile || getUserProfile(db, phone);
      const socioMemResult = await retrieveActiveMemories(db, {
        phone,
        generationId: activeSocioProfile.memoryGeneration || 1,
        effectivePersona: 'socio',
        activeLojaSlug: null,
        maxItems: 3
      });
      if (socioMemResult.formattedContext && socioMemResult.formattedContext.trim().length > 0) {
        socioMemoriesBlock = `\n${socioMemResult.formattedContext.trim()}\n`;
      }
    } catch {
      // Degradação graciosa
    }

    const diaryContext = getDailyDiaryContext(phone);
    const diarySection = diaryContext ? `\n${diaryContext}\n` : '';

    const sysPrompt = loadSystemPrompt();

    // Contexto é mantido persistentemente pelo AGY CLI através do agy_conversation_id.
    // Se a conversa já foi inicializada, enviamos o turno novo diretamente ao AGY.
    // Se for o primeiro turno da sessão, anexamos as diretrizes operacionais e ferramentas.
    let safePrompt: string;
    if (agyConvId) {
      safePrompt = `${textoLimpo}\n\n(LEMBRETE DE FORMATAÇÃO HERMES: Em listagens de OSs ou veículos, use SEMPRE traços '----------------------------------------' para separar cada carro e abra cada um com '> *OS #XXXX — MODELO (PLACA)*'. Coloque cada dado em sua linha com bullets verticais. PROIBIDO usar pipes '|' inline agrupando dados na mesma linha.)`;
    } else {
      safePrompt = `${sysPrompt}
${diarySection}${socioMemoriesBlock}
# MENSAGEM DO OPERADOR:
${textoLimpo}

# DIRETRIZ DE ATENDIMENTO (AGENTE AUTÔNOMO COM FERRAMENTAS MCP):
- Você é o Hydra Agent, assistente operacional e financeiro da rede de oficinas.
- Você tem ferramentas MCP do servidor 'hydra-ops' conectadas ao banco SQLite operacional em tempo real:
  * 'getStoreDrilldown' e 'getPatioOverview': situação geral, faturamento, ticket médio e veículos físicos no pátio de uma unidade (veículos em atendimento ativo).
  * 'getChecklistAudit': auditoria de checklists mecânicos ou de entrada pendentes.
  * 'getAgingCars': veículos travados há mais tempo no pátio (> 5 dias).
  * 'searchOS': busca e listagem de ordens de serviço (aceita { loja_slug, status, placa, query } - use para listar OSs em aberto de uma loja!).
  * 'getOSDetails': detalhamento profundo de uma OS (aceita { os_id, loja_slug } - serviços, peças, parcelas financeiras e histórico de atendimento).
  * 'get_os_case_history': histórico consolidado do grafo e atendimento da OS (aceita { os_id, loja_slug } - use SEMPRE que perguntarem o motivo de atraso, o que foi conversado/prometido ao cliente no WhatsApp, se faltam peças ou se o orçamento foi aprovado!).
  * 'getMetasConsolidadas' e 'getFinancialAlerts': faturamento e atingimento de metas.
  * 'semanticSearchOS': busca vetorial semântica de problemas, avarias e serviços.
- REGRA CRÍTICA DE GARGALOS OPERACIONAIS E PÁTIO FÍSICO:
  * 'Veículos em Pátio' são exclusivamente veículos fisicamente na oficina em atendimento ativo (em torno de 1 a 6 por loja, total da rede em torno de 30 a 40 veículos).
  * NUNCA relate 'Pendências de Baixa no ERP' ou 'Divergência entre sistema e pátio' como gargalo operacional da oficina. Os gargalos operacionais são estritamente: (1) Retenção de Pátio (Aging > 5 dias com risco de atraso), (2) Exposição Financeira (Saldo em aberto sem sinal/pagamento), (3) Checklists de Entrada e Mecânico pendentes nos veículos em atendimento.
  * Na auditoria de checklists (getChecklistAudit), audite estritamente os veículos físicos em atendimento (~32 na rede), NUNCA mencione 179 ordens brutas do sistema.
- FORMATO EXECUTIVO OFICIAL (PADRÃO HERMES / BOT DE ANÁLISE HYDRA):
  * Cabeçalho de abertura: '*HYDRA | [Tema]*\n\n[Data] · [Hora]'.
  * Títulos de seção do relatório: Em negrito simples '*Visão geral*', '*Gargalos de pátio*', '*Risco financeiro*', '*Compliance e vistorias*', '*O que fazer agora*'.
  * Ponto Crítico: Use citação nativa '>' EXCLUSIVAMENTE abaixo de '*Ponto crítico*\n> [Frase do ponto crítico]'.
  * CARDS DE ORDENS DE SERVIÇO (PADRÃO HERMES):
    - Em listagens de OSs ou veículos, use SEMPRE traços '----------------------------------------' para separar cada carro.
    - Abra cada card com '> *OS #XXXX — MODELO (PLACA)*' usando a setinha '>'.
    - Cada campo deve vir em sua própria linha com bullets:
      ----------------------------------------
      > *OS #XXXX — MODELO (PLACA)*
      - *Status:* Em Execução • *Pátio:* X dias
      - *Cliente:* Nome do Cliente
      - *Valor:* R$ X.XXX,XX (resta R$ X.XXX,XX)
    - PROIBIÇÃO ABSOLUTA DE PIPES '|' inline juntando dados na mesma linha.
  * POSIÇÃO DE PÁTIO POR UNIDADE E GARGALOS:
    - Nunca agrupe múltiplos carros ou dados na mesma linha com pipes '|'.
    - Use traços '----------------------------------------' e setinha '>' para destacar cada unidade:
      ----------------------------------------
      > *Rudge Ramos (6 veículos)*
      - *Valor em serviço:* R$ 23.773,35
      - *Saldo a receber:* R$ 11.879,54
  * Ações finais: Em lista numerada: '*O que fazer agora*\n1. [Ação 1]\n2. [Ação 2]'.
  * ESTRUTURA DOS BALÕES: O diagnóstico deve vir consolidado em no máximo 1 ou 2 balões elegantes (use '---BLOCK---' apenas se o texto for muito extenso). NUNCA envie um balão avulso por loja!
  * ZERO 'Baixa ERP': Nunca mencione pendências de baixa no ERP em relatórios operacionais de gargalos.
- SEMPRE consulte suas ferramentas MCP antes de responder a fatos ou números operacionais.
- Quando o operador falar de forma curta ou der sequência à conversa (ex: "em aberto por favor", "quais as travas?", "e em Santo André?"), consulte suas ferramentas MCP para detalhar o caso específico.
- Responda em português com linguagem natural, direta e profissional no WhatsApp. Não use markdown tables nem asteriscos triplos.`;
    }

    const routerResult = await hydraDualRouter.routeRequest(safePrompt, {
      conversationId: agyConvId || undefined
    });
    llmMs = Date.now() - tLlmStart;

    if (routerResult.newConversationId && routerResult.newConversationId !== agyConvId) {
      setAgyConversationId(db, phone, routerResult.newConversationId);
    }

    if (routerResult.success && routerResult.rawOutput && !routerResult.rawOutput.includes('Eligibility check failed') && !routerResult.rawOutput.startsWith('error:') && !routerResult.rawOutput.startsWith('Error:')) {
      motor = routerResult.telemetry.motor;
      replyText = sanitizeWhatsAppMarkdown(routerResult.rawOutput);
      const turnAudit = auditTurnExecution(canonical.turnId || ('turn_' + Date.now()), {
        rawOutput: routerResult.rawOutput,
        candidateTools: []
      });
      toolsCalled = turnAudit.toolsCalled.length > 0 ? turnAudit.toolsCalled : ['mcp:hydra-ops'];
      toolToRecord = toolsCalled[0] || 'mcp:hydra-ops';

      // Atualiza o contexto de loja inferido na conversa se o usuário ou LLM citou uma unidade específica
      const detectedStoreMatch = (textoLimpo + ' ' + routerResult.rawOutput).match(/\b(jabaquara|santo\s*andr[eé]|kennedy|reidomodulo|reidooleomaua|saobernardo|saocaetano|maua|ipiranga)\b/i);
      if (detectedStoreMatch) {
        const rawStore = detectedStoreMatch[1].toLowerCase().replace(/\s+/g, '');
        const storeMap: Record<string, string> = {
          jabaquara: 'MPJabaquara',
          santoandre: 'MPSantoAndre',
          kennedy: 'MPkennedy',
          reidomodulo: 'ReiDoModulo',
          reidooleomaua: 'ReiDoOleoMaua',
          saobernardo: 'MPSaoBernardo',
          saocaetano: 'MPSaoCaetano',
          maua: 'MPMaua',
          ipiranga: 'MPIpiranga'
        };
        if (storeMap[rawStore]) {
          canonical.lojaSlug = storeMap[rawStore];
        }
      }
    } else {
      throw new Error(`DualWorkerRouter sem saída válida (motivo: ${routerResult.telemetry.swapReason || 'fallback'})`);
    }
  } catch {
    llmMs = Date.now() - tLlmStart;
    // Motor 2: Fallback Engine Determinístico com Adaptador Desacoplado
    motor = 'FALLBACK_API';
    const tDbStart = Date.now();

    if (isExplicitVehicleRequest && (currentModel || currentPlate || currentOsId)) {
      const resolution = resolveVehicleTarget(db, {
        model: currentModel,
        plate: currentPlate,
        osId: currentOsId,
        storeSlug: currentStore
      });
      if (resolution.status === 'RESOLVED') {
        const osDetail = getOSDetails(db, {
          os_id: resolution.activeOrder.osId,
          loja_slug: resolution.activeOrder.storeSlug
        });
        const os360Params: OS360CardParams = {
          osId: osDetail?.osId ?? resolution.activeOrder.osId,
          lojaSlug: osDetail?.lojaSlug ?? resolution.activeOrder.storeSlug,
          vehicleModel: osDetail?.veiculo ?? resolution.vehicle.model,
          vehiclePlate: osDetail?.placa ?? resolution.vehicle.plate,
          clientName: osDetail?.clienteNome ?? resolution.activeOrder.clientName,
          clientPhone: osDetail?.clienteTelefone ?? resolution.activeOrder.customerPhone,
          clienteTelefone: osDetail?.clienteTelefone ?? resolution.activeOrder.customerPhone,
          responsavel: osDetail?.responsavel,
          statusGrid: osDetail?.status_grid ?? resolution.activeOrder.statusGrid,
          isOpen: osDetail?.isAberta ?? resolution.activeOrder.isOpen,
          daysInYard: osDetail?.diasNoPatio ?? resolution.activeOrder.daysInYard,
          totalAmount: osDetail?.valorTotal ?? resolution.activeOrder.totalAmount,
          remainingBalance: osDetail?.saldoDevedor ?? resolution.activeOrder.remainingBalance,
          servicos: osDetail?.servicos,
          pecas: osDetail?.pecas,
          pagamentos: osDetail?.pagamentos,
          checklists: osDetail?.checklists,
          checklistAudit: osDetail?.checklistAudit,
          temNf: osDetail?.temNf,
          documentosAnexosCount: osDetail?.documentosAnexos?.length,
          extracaoCompleta: osDetail?.extracaoCompleta,
          observacao: osDetail?.observacao,
          historicoCriadoEm: osDetail?.historicoCriadoEm,
          historicoCriadoPor: osDetail?.historicoCriadoPor,
          historicoAtualizadoEm: osDetail?.historicoAtualizadoEm,
          historicoAtualizadoPor: osDetail?.historicoAtualizadoPor,
          documentosAnexos: osDetail?.documentosAnexos
        };
        const moduleIntent = parseOSModuleIntent(textoLimpo, resolution.activeOrder.osId);
        const activeModule = isOSConv ? 'historico' : moduleIntent?.module;
        if (activeModule === 'servicos') replyText = composeOSServicesCard(os360Params);
        else if (activeModule === 'pecas') replyText = composeOSPartsCard(os360Params);
        else if (activeModule === 'pagamentos') replyText = composeOSPaymentsCard(os360Params);
        else if (activeModule === 'documentos') replyText = composeOSDocumentsCard(os360Params);
        else if (activeModule === 'historico') replyText = composeOSHistoryCard(os360Params);
        else replyText = composeExecutiveOSSummary(os360Params);
        toolsCalled = ['resolve_vehicle_target', 'get_os_details'];
      } else if (resolution.status === 'AMBIGUOUS_VEHICLE') {
        replyText = resolution.clarificationPrompt;
        toolsCalled = ['resolve_vehicle_target'];
      } else {
        replyText = formatVehicleSituation(resolution);
        toolsCalled = ['resolve_vehicle_target'];
      }
      executionDbMs = Date.now() - tDbStart;
      toolToRecord = toolsCalled[0] || null;
    } else {
      // Blindagem de Contexto no Fallback: Herdar OS apenas se a consulta for anáfora explícita sobre aquela OS
      if (!canonical.osId && inferredOsId && isAnaphoraOSRequest) {
        canonical.osId = inferredOsId;
      }
      if (!canonical.lojaSlug && currentStore && currentStore !== 'Nenhuma (visão consolidada de rede)') {
        canonical.lojaSlug = currentStore;
      }

      const opResult = await executeOperationalQuery(db, canonical);
      executionDbMs = Date.now() - tDbStart;

      replyText = opResult.replyText;
      toolsCalled = opResult.toolsCalled;
      toolToRecord = opResult.toolsCalled[0] || null;
      paramsToRecord = opResult.filtersApplied;
    }
  }

  // 5. ISOLAMENTO DE SA?DA E PERSIST?NCIA ESTRUTURADA DE ESTADO
  const tFormatStart = Date.now();
  replyText = sanitizeWhatsAppMarkdown(replyText);
  const messages = splitIntoWhatsAppBlocks(replyText);
  formatMs = Date.now() - tFormatStart;

  saveTurnState(db, {
    phone,
    lastTurnId: canonical.turnId,
    lastIntent: canonical.intent,
    lojaSlug: canonical.lojaSlug,
    placa: canonical.placa,
    osId: canonical.osId,
    filters: {
      onlyOpen: canonical.onlyOpen,
      noDeposit: canonical.noDeposit,
      serviceTerms: canonical.serviceTerms,
      sort: canonical.sort,
      focusWorst: canonical.focusWorst || canonical.contract?.filters?.focusWorst,
      subIntent: canonical.subIntent || canonical.contract?.filters?.subIntent,
      scope: canonical.scope || canonical.contract?.scope
    },
    lastContract: canonical.contract,
    lastMessageId: rawMessageId ? Number(rawMessageId) || undefined : undefined,
    lastResponseText: replyText,
    updatedAt: new Date().toISOString()
  });

  saveConversationMessage(db, phone, 'assistant', replyText, toolToRecord, paramsToRecord);

  // Registro epis??dico no Di??rio de Bordo do Obsidian Vault (Hermes-Style)
  appendConversationToDailyDiary(phone, textoLimpo, replyText, {
    turnId: canonical.turnId
  });

  const totalMs = Date.now() - startTime;

  if (rawMessageId) {
    markMessageCompleted(db, rawMessageId, {
      messages,
      replyText,
      toolsCalled,
      motorUsed: motor,
      latenciaMs: totalMs
    });
  }

  insertAgentInteractionLog(db, {
    phone,
    conversation_id: rawConvId ? Number(rawConvId) || undefined : undefined,
    message_id: rawMessageId ? Number(rawMessageId) || undefined : undefined,
    pergunta: textoLimpo,
    tools_chamadas: toolsCalled,
    resposta_gerada: replyText,
    latencia_ms: totalMs,
    motor_utilizado: motor
  });

  return {
    messages,
    replyText,
    toolsCalled,
    motor,
    latenciaMs: totalMs,
    telemetry: {
      queueWaitMs,
      intentRewriteMs,
      executionDbMs,
      llmMs,
      formatMs,
      totalMs
    },
    isFeedback: false,
    contract: canonical.contract
  };
}

export interface ManagerReviewerParams {
  db: Database.Database;
  phone: string;
  message: string;
  userProfile: UserProfile;
  canonical: CanonicalIntent;
  previousState?: TurnState | null;
  startTime: number;
  rawMessageId?: string;
  rawConvId?: string;
  queueWaitMs?: number;
  intentRewriteMs?: number;
  customRouter?: DualWorkerRouter;
  maxTurnBudgetMs?: number;
}

/**
 * Ciclo do Revisor Crítico de IA (AI Reviewer) para Gerente de Loja
 */
export async function runManagerAiReviewer(params: ManagerReviewerParams): Promise<DispatcherOutput> {
  const { db, phone, message, userProfile, canonical, startTime, rawMessageId, rawConvId } = params;
  const textoLimpo = message.trim();
  const correlationId = rawMessageId ? `turn_${rawMessageId}` : `corr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const lojaSlug = userProfile.lojaSlug || 'MPdompedro1';
  const lojaNome = userProfile.lojaNome || lojaSlug;
  const turnBudgetMs = params.maxTurnBudgetMs ?? GLOBAL_TURN_BUDGET_MS;
  const router = params.customRouter || hydraDualRouter;

  // 1. BLOQUEIO DE ESCOPO / OUTRAS LOJAS COM ORIENTAÇÃO /SOCIO
  if (isOutsideManagerStore(textoLimpo, lojaSlug)) {
    const replyText = 'No perfil de gerente, você só pode consultar informações da sua unidade. Para acessar dados de outras lojas ou da rede completa, use o comando /socio.';
    const messages = composeSemanticBalloons(replyText);
    const totalMs = Date.now() - startTime;

    recordTurnTelemetry(db, {
      correlationId,
      persona: 'gerente',
      lojaSlug,
      reviewDecision: 'BLOCKED_SCOPE',
      replanCount: 0,
      workerChosen: 'none',
      latenciaMs: totalMs,
      modelUsed: 'none',
      status: 'BLOCKED'
    });

    saveConversationMessage(db, phone, 'assistant', replyText, 'manager_scope_denied', {
      lojaSlug,
      managerScopeAllowed: false
    });

    saveTurnState(db, {
      phone,
      lastTurnId: canonical.turnId,
      lastIntent: 'other',
      lojaSlug,
      filters: { lojaSlug, scope: 'store' },
      lastMessageId: rawMessageId ? Number(rawMessageId) || undefined : undefined,
      lastResponseText: replyText,
      updatedAt: new Date().toISOString()
    });

    if (rawMessageId) {
      markMessageCompleted(db, rawMessageId, {
        messages, replyText, toolsCalled: ['manager_scope_denied'],
        motorUsed: 'FALLBACK_API', latenciaMs: totalMs
      });
    }

    insertAgentInteractionLog(db, {
      phone,
      conversation_id: rawConvId ? Number(rawConvId) || undefined : undefined,
      message_id: rawMessageId ? Number(rawMessageId) || undefined : undefined,
      pergunta: textoLimpo,
      tools_chamadas: ['manager_scope_denied'],
      resposta_gerada: replyText,
      latencia_ms: totalMs,
      motor_utilizado: 'FALLBACK_API'
    });

    return {
      messages,
      replyText,
      toolsCalled: ['manager_scope_denied'],
      motor: 'FALLBACK_API',
      latenciaMs: totalMs,
      telemetry: {
        queueWaitMs: params.queueWaitMs || 0,
        intentRewriteMs: params.intentRewriteMs || 0,
        executionDbMs: 0,
        llmMs: 0,
        formatMs: 0,
        totalMs
      },
      isFeedback: false,
      contract: canonical.contract
    };
  }

  // 2. PREPARAÇÃO DA CANDIDATA INICIAL E DADOS CONSULTADOS
  let respostaCandidata: string | null = null;
  let dadosConsultados: ConsultedData[] = [];
  let initialTools: string[] = [];

  const initialResult = executeManagerStoreQuery(db, textoLimpo, canonical, lojaSlug);

  if (initialResult.understood && initialResult.allowed && initialResult.toolsCalled[0] !== 'manager_scope_unsupported') {
    respostaCandidata = initialResult.replyText;
    dadosConsultados = [...(initialResult.dadosConsultados || [])];
    initialTools = [...initialResult.toolsCalled];
  } else {
    // Se o roteador inicial NÃO entender a mensagem: encaminhar diretamente à IA
    // sem inventar candidata arbitrária e sem emitir recusa genérica falsa.
    respostaCandidata = null;
    dadosConsultados = [];
    initialTools = [];
  }

  // 3. VERIFICAÇÃO DE SALDO DE TURNO ANTES DO REVISOR
  const elapsedSoFar = Date.now() - startTime;
  const remainingBudgetMs = turnBudgetMs - elapsedSoFar;

  if (remainingBudgetMs <= 1000) {
    const totalMs = Date.now() - startTime;
    const timeoutReply = `> *Aviso Operacional (H-IA-02)*\n- O tempo limite de 50s foi atingido para esta consulta na unidade ${lojaNome}.\n- Por favor, tente novamente ou consulte via /menu.`;
    const messages = composeSemanticBalloons(timeoutReply);

    recordTurnTelemetry(db, {
      correlationId,
      persona: 'gerente',
      lojaSlug,
      reviewDecision: 'TIMEOUT',
      replanCount: 0,
      workerChosen: 'none',
      latenciaMs: totalMs,
      modelUsed: 'gemini-3.8-flash-low',
      errorCode: 'H-IA-02',
      status: 'TIMEOUT'
    });

    return {
      messages,
      replyText: timeoutReply,
      toolsCalled: ['timeout_h_ia_02'],
      motor: 'FALLBACK_API',
      latenciaMs: totalMs,
      telemetry: {
        queueWaitMs: params.queueWaitMs || 0,
        intentRewriteMs: params.intentRewriteMs || 0,
        executionDbMs: 0,
        llmMs: 0,
        formatMs: 0,
        totalMs
      },
      isFeedback: false
    };
  }

  // 3.5. RECUPERAÇÃO DE MEMÓRIAS ATIVAS (RAG COM ISOLAMENTO DE ESCOPO EFETIVO)
  let memoriesFormattedContext = '';
  try {
    const memoryResult = await retrieveActiveMemories(db, {
      phone,
      generationId: userProfile.memoryGeneration || 1,
      effectivePersona: 'gerente',
      activeLojaSlug: lojaSlug,
      maxItems: 3
    });
    memoriesFormattedContext = memoryResult.formattedContext;
  } catch (memErr: any) {
    console.warn('[AgentDispatcher] Falha ao recuperar memórias ativas de gerente:', memErr?.message || memErr);
  }

  // 4. CHAMADA AO REVISOR CRÍTICO DE IA
  const convHistory = getConversationHistory(db, phone, 4);
  const historyBlock = convHistory.slice(0, -1).map(h => `[${h.role === 'user' ? 'Gerente' : 'Hydra'}]: ${h.content}`).join('\n');

  const reviewerPrompt = buildCriticalReviewerPrompt({
    originalMessage: textoLimpo,
    lojaSlug,
    lojaNome,
    persona: 'gerente',
    conversationHistory: historyBlock,
    respostaCandidata,
    dadosConsultados,
    memoriesContext: memoriesFormattedContext
  });

  const reviewEffectiveTimeout = Math.min(40000, remainingBudgetMs);
  const routerResult = await router.routeRequest(reviewerPrompt, { maxTurnBudgetMs: reviewEffectiveTimeout });

  // 5. TRATAMENTO DE TIMEOUT OU FALHA DOS WORKERS -> ENCERRAMENTO LIMPO COM H-IA-02
  if (!routerResult.success || !routerResult.rawOutput) {
    const totalMs = Date.now() - startTime;
    const timeoutReply = `> *Aviso Operacional (H-IA-02)*\n- O tempo limite de inteligência foi atingido para esta consulta na unidade ${lojaNome}.\n- Por favor, tente novamente ou formule uma pergunta mais específica da sua loja.`;
    const messages = composeSemanticBalloons(timeoutReply);

    recordTurnTelemetry(db, {
      correlationId,
      persona: 'gerente',
      lojaSlug,
      reviewDecision: 'TIMEOUT',
      replanCount: 0,
      workerChosen: routerResult.telemetry?.workerChosen || 'none',
      latenciaMs: totalMs,
      modelUsed: 'gemini-3.8-flash-low',
      errorCode: 'H-IA-02',
      status: 'TIMEOUT'
    });

    saveConversationMessage(db, phone, 'assistant', timeoutReply, 'timeout_h_ia_02', null);
    if (rawMessageId) {
      markMessageCompleted(db, rawMessageId, {
        messages, replyText: timeoutReply, toolsCalled: ['timeout_h_ia_02'],
        motorUsed: 'FALLBACK_API', latenciaMs: totalMs
      });
    }

    insertAgentInteractionLog(db, {
      phone,
      conversation_id: rawConvId ? Number(rawConvId) || undefined : undefined,
      message_id: rawMessageId ? Number(rawMessageId) || undefined : undefined,
      pergunta: textoLimpo,
      tools_chamadas: ['timeout_h_ia_02'],
      resposta_gerada: timeoutReply,
      latencia_ms: totalMs,
      motor_utilizado: 'FALLBACK_API'
    });

    return {
      messages,
      replyText: timeoutReply,
      toolsCalled: ['timeout_h_ia_02'],
      motor: 'FALLBACK_API',
      latenciaMs: totalMs,
      telemetry: {
        queueWaitMs: params.queueWaitMs || 0,
        intentRewriteMs: params.intentRewriteMs || 0,
        executionDbMs: 0,
        llmMs: routerResult.telemetry?.durationMs || 0,
        formatMs: 0,
        totalMs
      },
      isFeedback: false
    };
  }

  // 6. PROCESSAMENTO ESTRUTURADO DA DECISÃO DO REVISOR
  let reviewDecision: {
    decisao: 'APROVAR' | 'AJUSTAR' | 'CONSULTAR' | 'ESCLARECER';
    motivo: string;
    resposta?: string;
    ferramenta?: string;
    parametros?: Record<string, any>;
  };

  try {
    let content = routerResult.rawOutput.trim();
    if (content.includes('```json')) content = content.split('```json')[1].split('```')[0].trim();
    else if (content.includes('```')) content = content.split('```')[1].split('```')[0].trim();
    reviewDecision = JSON.parse(content);
  } catch {
    const lower = routerResult.rawOutput.toLowerCase();
    if (lower.includes('consultar') || lower.includes('get_os')) {
      reviewDecision = { decisao: 'CONSULTAR', motivo: 'Consulta complementar necessária', ferramenta: 'get_os_list' };
    } else if (lower.includes('esclarecer') || lower.includes('qual loja') || lower.includes('qual placa')) {
      reviewDecision = { decisao: 'ESCLARECER', motivo: 'Esclarecimento necessário', resposta: routerResult.rawOutput };
    } else if (respostaCandidata) {
      reviewDecision = { decisao: 'APROVAR', motivo: 'Aprovação direta', resposta: respostaCandidata };
    } else {
      reviewDecision = { decisao: 'AJUSTAR', motivo: 'Ajuste direto', resposta: routerResult.rawOutput };
    }
  }

  // SALVAGUARDAS DETERMINÍSTICAS (REGRA DE OURO):
  const normMsg = textoLimpo.toLowerCase();
  const wantsBothOsAndCmv = (normMsg.includes('cmv') && (normMsg.includes('os') || normMsg.includes('ordens')));
  const hasOsInDados = dadosConsultados.some(d => d.fonte.includes('ordens_servico') || d.fonte.includes('os'));
  const wantsOsDetails = /\b(detalhe|detalhes)\b/i.test(normMsg) && /\b(\d{3,6})\b/.test(normMsg);
  const extractedOsMatch = normMsg.match(/\b(\d{3,6})\b/);

  if (wantsBothOsAndCmv && !hasOsInDados) {
    reviewDecision.decisao = 'CONSULTAR';
    reviewDecision.ferramenta = reviewDecision.ferramenta || 'get_os_list';
  } else if (wantsOsDetails && !dadosConsultados.some(d => d.fonte.includes('os_details') || d.fonte.includes('os_detail'))) {
    reviewDecision.decisao = 'CONSULTAR';
    reviewDecision.ferramenta = 'get_os_details';
    reviewDecision.parametros = { osId: extractedOsMatch ? extractedOsMatch[1] : (canonical.osId || '1128') };
  }

  // 6.0. PIGGYBACK DE MEMÓRIA: PERSISTIR CANDIDATOS EMITIDOS PELO REVISOR (ZERO LLM EXTRA)
  if ((reviewDecision as any).candidatosMemoria && Array.isArray((reviewDecision as any).candidatosMemoria) && (reviewDecision as any).candidatosMemoria.length > 0) {
    try {
      validateAndPersistMemoryCandidates(db, (reviewDecision as any).candidatosMemoria, {
        phone,
        generationId: userProfile.memoryGeneration || 1,
        effectivePersona: 'gerente',
        activeLojaSlug: lojaSlug,
        turnId: canonical.turnId || `turn-${Date.now()}`,
        rawUserMessage: textoLimpo
      });
    } catch (memErr: any) {
      console.warn('[AgentDispatcher] Falha ao persistir candidatos de memória:', memErr?.message || memErr);
    }
  }

  let finalReply = '';
  let replanCount = 0;
  const finalTools: string[] = [...initialTools];

  if (reviewDecision.decisao === 'APROVAR') {
    finalReply = reviewDecision.resposta || respostaCandidata || composeFactualTemplate(lojaNome, dadosConsultados);
    finalTools.push('ai_reviewer_approve');
    replanCount = 0;
  } else if (reviewDecision.decisao === 'AJUSTAR') {
    finalReply = reviewDecision.resposta || respostaCandidata || composeFactualTemplate(lojaNome, dadosConsultados);
    finalTools.push('ai_reviewer_adjust');
    replanCount = 0;
  } else if (reviewDecision.decisao === 'ESCLARECER') {
    finalReply = reviewDecision.resposta || 'Por favor, detalhe melhor qual informação da sua unidade você deseja consultar.';
    finalTools.push('ai_reviewer_clarify');
    replanCount = 0;
  } else if (reviewDecision.decisao === 'CONSULTAR') {
    // 6.1. EXECUÇÃO DA FERRAMENTA COMPLEMENTAR (<50ms)
    const toolName = reviewDecision.ferramenta || (wantsOsDetails ? 'get_os_details' : 'get_os_list');
    const toolRes = executeManagerTool(db, toolName, reviewDecision.parametros, lojaSlug);
    dadosConsultados.push({ fonte: toolRes.fonte, periodo: toolRes.periodo, dados: toolRes.dados });
    finalTools.push(toolRes.toolCalled);

    // 6.2. GUARDA DE SEGUNDA CHAMADA LLM CALIBRADA COM LATÊNCIA REAL
    const postToolElapsed = Date.now() - startTime;
    const remainingForSynthesis = turnBudgetMs - postToolElapsed;
    const MIN_REPLAN_LLM_BUDGET_MS = 25000; // Calibrado para o CLI (25–40s)

    if (remainingForSynthesis >= MIN_REPLAN_LLM_BUDGET_MS) {
      try {
        const synthPrompt = buildSynthesisPrompt({ originalMessage: textoLimpo, lojaNome, lojaSlug, dadosConsultados });
        const synthResult = await router.routeRequest(synthPrompt, { maxTurnBudgetMs: Math.min(40000, remainingForSynthesis - 2000) });
        if (synthResult.success && synthResult.rawOutput && !synthResult.rawOutput.startsWith('error:') && !synthResult.rawOutput.startsWith('Error:')) {
          finalReply = synthResult.rawOutput;
        } else {
          finalReply = composeFactualTemplate(lojaNome, dadosConsultados);
        }
      } catch {
        finalReply = composeFactualTemplate(lojaNome, dadosConsultados);
      }
      replanCount = 1;
    } else {
      // Saldo < 25s: compõe diretamente por template factual com os dados da ferramenta
      finalReply = composeFactualTemplate(lojaNome, dadosConsultados);
      replanCount = 1;
    }
  } else {
    finalReply = respostaCandidata || composeFactualTemplate(lojaNome, dadosConsultados);
  }

  // 7. SANITIZAÇÃO, PERSISTÊNCIA E TELEMETRIA DE TURNO
  finalReply = sanitizeWhatsAppMarkdown(finalReply);
  const messages = composeSemanticBalloons(finalReply);
  const totalMs = Date.now() - startTime;

  recordTurnTelemetry(db, {
    correlationId,
    persona: 'gerente',
    lojaSlug,
    reviewDecision: reviewDecision.decisao,
    replanCount,
    workerChosen: routerResult.telemetry?.workerChosen || 'primary',
    latenciaMs: totalMs,
    modelUsed: 'gemini-3.8-flash-low',
    status: 'SUCCESS'
  });

  saveConversationMessage(db, phone, 'assistant', finalReply, finalTools[0] || null, {
    lojaSlug,
    reviewDecision: reviewDecision.decisao,
    replanCount
  });

  saveTurnState(db, {
    phone,
    lastTurnId: canonical.turnId,
    lastIntent: canonical.intent,
    lojaSlug,
    filters: { lojaSlug, scope: 'store' },
    lastMessageId: rawMessageId ? Number(rawMessageId) || undefined : undefined,
    lastResponseText: finalReply,
    updatedAt: new Date().toISOString()
  });

  if (rawMessageId) {
    markMessageCompleted(db, rawMessageId, {
      messages, replyText: finalReply, toolsCalled: finalTools,
      motorUsed: routerResult.telemetry?.motor || 'AGY_PRIMARY', latenciaMs: totalMs
    });
  }

  insertAgentInteractionLog(db, {
    phone,
    conversation_id: rawConvId ? Number(rawConvId) || undefined : undefined,
    message_id: rawMessageId ? Number(rawMessageId) || undefined : undefined,
    pergunta: textoLimpo,
    tools_chamadas: finalTools,
    resposta_gerada: finalReply,
    latencia_ms: totalMs,
    motor_utilizado: routerResult.telemetry?.motor || 'AGY_PRIMARY'
  });

  return {
    messages,
    replyText: finalReply,
    toolsCalled: finalTools,
    motor: routerResult.telemetry?.motor || 'AGY_PRIMARY',
    latenciaMs: totalMs,
    telemetry: {
      queueWaitMs: params.queueWaitMs || 0,
      intentRewriteMs: params.intentRewriteMs || 0,
      executionDbMs: 0,
      llmMs: totalMs - (params.intentRewriteMs || 0),
      formatMs: 0,
      totalMs
    },
    isFeedback: false,
    contract: canonical.contract
  };
}
