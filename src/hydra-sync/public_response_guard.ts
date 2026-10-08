/**
 * src/hydra-sync/public_response_guard.ts
 * Barreira de Proteção Pública, Sanitização Anti-Vazamento e Projeção Humana de Estado.
 */

import {
  MemoryFunctionalStatus,
  PublicGuardPolicy,
  PublicSanitizationResult,
  PublicMemoryStatusReply
} from './types/public_guard_contract.js';

import {
  PublicFormattingPolicy,
  TableToBlockResult,
  TableParsedRow,
  TableParsedCell
} from './types/language_contract.js';

import { InFlightAbortRegistry } from './command_interceptor.js';
import { sanitizeWhatsAppMarkdown, assertNoDoubleAsterisks } from './format_utils.js';

export interface ExtendedPublicGuardPolicy extends PublicGuardPolicy {
  allowEmojis?: boolean;
  maxCriticalAlertEmojis?: number; // Teto: 1
  convertMarkdownTables?: boolean;
  forbidDoubleAsterisks?: boolean;
  forbidCommonMarkHeaders?: boolean;
  forbidExcessiveInformality?: boolean;
}

export const DEFAULT_PUBLIC_GUARD_POLICY: ExtendedPublicGuardPolicy = {
  blockFilePaths: true,
  blockInternalSchemas: true,
  blockToolNames: true,
  blockInternalPrompts: true,
  blockInfrastructure: true,
  blockCredentials: true,
  maxSanitizationReplacements: 50,
  allowEmojis: false,
  maxCriticalAlertEmojis: 1,
  convertMarkdownTables: true,
  forbidDoubleAsterisks: true,
  forbidCommonMarkHeaders: true,
  forbidExcessiveInformality: true
};

export const PUBLIC_DISCLAIMER_INTERNAL_REFUSAL = 
  'Detalhes técnicos internos não são disponibilizados por aqui. Posso explicar o que consigo fazer na operação das lojas.';

/**
 * Remove emojis decorativos do texto conforme a política estrita de formatação do WhatsApp.
 * - Elimina emojis em saudações, despedidas, títulos e itens normais.
 * - Se options?.allowOneCriticalAlert for true, OU se o texto contiver alerta operacional crítico comprovado
 *   (ex: veículo retido há mais de 30 ou 180 dias), preserva no MÁXIMO 1 emoji de alerta (ex: ⚠️)
 *   e expurga todos os demais.
 */
export function purgeDecorativeEmojis(
  text: string,
  options?: { allowOneCriticalAlert?: boolean }
): string {
  if (!text) return '';

  const emojiRegex = /(?:\p{Extended_Pictographic}\uFE0F?|\p{Emoji_Presentation})/gu;
  const criticalAlertPattern = /\b(?:retid[oa]s?|parad[oa]s?|perman[eê]ncia)\s+(?:h[aá]\s+)?(?:mais\s+de\s+)?(?:30|60|90|180|\d{2,})\s+dias\b/i;
  const hasCriticalContext = options?.allowOneCriticalAlert ?? (
    criticalAlertPattern.test(text) ||
    /\b180\s+dias\b/i.test(text) ||
    /alerta\s+cr[ií]tico/i.test(text) ||
    /\*Aten[cç][aã]o:\*/i.test(text)
  );

  if (!hasCriticalContext) {
    // 0 emojis tolerados
    let cleaned = text.replace(emojiRegex, '');
    cleaned = cleaned.replace(/ +([,.!?:;])/g, '$1');
    cleaned = cleaned.replace(/[ \t]{2,}/g, ' ');
    return cleaned.trim();
  }

  // Alerta crítico: permite no máximo 1 emoji (o primeiro emoji de alerta encontrado ou o primeiro emoji)
  let preservedCount = 0;
  let cleaned = text.replace(emojiRegex, (match) => {
    if (preservedCount === 0) {
      preservedCount++;
      return match;
    }
    return '';
  });

  cleaned = cleaned.replace(/ +([,.!?:;])/g, '$1');
  cleaned = cleaned.replace(/[ \t]{2,}/g, ' ');
  return cleaned.trim();
}

/**
 * Converte deterministicamente tabelas Markdown (| col | col |) em cards nativos de WhatsApp (- *Campo:* valor).
 * Preserva 100% dos dados sem perda de células ou rótulos.
 */
export function convertMarkdownTableToNativeBlocks(text: string): TableToBlockResult {
  if (!text || !text.includes('|')) {
    return {
      hasTable: false,
      originalTableText: '',
      convertedBlocksText: text || '',
      rowsProcessed: 0,
      dataPreserved: true
    };
  }

  const lines = text.split('\n');
  const tableLineIndices: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.split('|').length >= 3) {
      tableLineIndices.push(i);
    }
  }

  if (tableLineIndices.length < 2) {
    return {
      hasTable: false,
      originalTableText: '',
      convertedBlocksText: text,
      rowsProcessed: 0,
      dataPreserved: true
    };
  }

  let currentOutput = text;
  let totalRows = 0;
  let hasAnyTable = false;
  let fullOriginalTable = '';

  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && trimmed.split('|').length >= 3) {
      const tableGroup: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
        tableGroup.push(lines[i].trim());
        i++;
      }

      if (tableGroup.length >= 2) {
        hasAnyTable = true;
        const originalTableChunk = tableGroup.join('\n');
        fullOriginalTable += (fullOriginalTable ? '\n\n' : '') + originalTableChunk;

        // Extrai headers (primeira linha)
        const rawHeaders = tableGroup[0]
          .split('|')
          .map(c => c.trim())
          .filter(Boolean);

        // Linhas de dados (ignora separadores como |---|---|)
        const dataLines = tableGroup.slice(1).filter(line => !/^\|[\s\-:|]+\|$/.test(line));

        const cardBlocks: string[] = [];
        for (let r = 0; r < dataLines.length; r++) {
          totalRows++;
          const cells = dataLines[r]
            .split('|')
            .map(c => c.trim())
            .filter(Boolean);

          const itemTitle = `*Item ${r + 1}*`;
          const fieldLines: string[] = [];

          for (let c = 0; c < rawHeaders.length; c++) {
            const h = rawHeaders[c] || `Campo ${c + 1}`;
            const val = cells[c] !== undefined ? cells[c] : '—';
            fieldLines.push(`- *${h}:* ${val}`);
          }

          cardBlocks.push(`${itemTitle}\n${fieldLines.join('\n')}`);
        }

        const convertedChunk = cardBlocks.join('\n\n');
        currentOutput = currentOutput.replace(originalTableChunk, convertedChunk);
      }
    } else {
      i++;
    }
  }

  return {
    hasTable: hasAnyTable,
    originalTableText: fullOriginalTable,
    convertedBlocksText: currentOutput,
    rowsProcessed: totalRows,
    dataPreserved: true
  };
}

/**
 * Detecta se o balão contém apenas saudações soltas ou confirmações monossilábicas
 * desprovidas de contexto operacional (ex: "Entendi.", "Ok.", "Certo.").
 */
export function isInvalidIsolatedBalloon(balloon: string): boolean {
  if (!balloon) return true;
  const trimmed = balloon.trim();
  if (trimmed.length === 0) return true;

  const fragmentPatterns = [
    /^(?:entendi|ok|certo|compreendido|anotado|perfeito|beleza)\.?$/i,
    /^(?:ol[aá]|bom dia|boa tarde|boa noite)\.?$/i
  ];

  if (trimmed.length < 25) {
    for (const pat of fragmentPatterns) {
      if (pat.test(trimmed)) {
        return true;
      }
    }
  }

  return false;
}

export interface InFlightDeliveryStatus {
  phone: string;
  jobId: string;
  status: 'DELIVERED_ALL' | 'DELIVERED_PARTIAL' | 'ABORTED' | 'FAILED';
  deliveredCount: number;
  totalCount: number;
  deliveredIndices: number[];
  abortedAt?: number;
  failedAt?: number;
  error?: string;
}

/**
 * Despacha balões de resposta sequencialmente com checagem atômica de cancelamento em voo
 * e suporte idempotente a entrega parcial.
 */
export async function dispatchBalloonsWithInFlightGuard(params: {
  phone: string;
  jobId: string;
  balloons: string[];
  abortRegistry?: InFlightAbortRegistry;
  alreadyDeliveredIndices?: number[];
  sendFn: (phone: string, balloon: string, index: number) => Promise<{ success: boolean; messageId?: string; error?: string }>;
  onPartialStatus?: (status: InFlightDeliveryStatus) => void | Promise<void>;
}): Promise<InFlightDeliveryStatus> {
  const cleanPhone = String(params.phone || '').replace(/\D/g, '');
  const registry = params.abortRegistry || InFlightAbortRegistry.getInstance();
  const validBalloons = params.balloons.filter(b => b && b.trim().length > 0 && !isInvalidIsolatedBalloon(b));
  const totalCount = validBalloons.length;
  const deliveredIndices = [...(params.alreadyDeliveredIndices || [])];

  if (totalCount === 0) {
    return {
      phone: cleanPhone,
      jobId: params.jobId,
      status: 'DELIVERED_ALL',
      deliveredCount: 0,
      totalCount: 0,
      deliveredIndices: []
    };
  }

  for (let i = 0; i < totalCount; i++) {
    // 1. Checagem atômica em voo antes de despachar cada balão
    if (registry.isAborted(cleanPhone, params.jobId)) {
      const isPartial = deliveredIndices.length > 0;
      const status: InFlightDeliveryStatus = {
        phone: cleanPhone,
        jobId: params.jobId,
        status: isPartial ? 'DELIVERED_PARTIAL' : 'ABORTED',
        deliveredCount: deliveredIndices.length,
        totalCount,
        deliveredIndices,
        abortedAt: i,
        error: 'CANCELADO_EM_VOO'
      };
      if (params.onPartialStatus) {
        await params.onPartialStatus(status);
      }
      return status;
    }

    // 2. Idempotência: pula balões já entregues para evitar duplicidade de reenvio
    if (deliveredIndices.includes(i)) {
      continue;
    }

    // 3. Envio do balão atual
    const balloonText = validBalloons[i];
    try {
      const sendRes = await params.sendFn(cleanPhone, balloonText, i);

      if (sendRes.success) {
        deliveredIndices.push(i);
      } else {
        const isPartial = deliveredIndices.length > 0;
        const status: InFlightDeliveryStatus = {
          phone: cleanPhone,
          jobId: params.jobId,
          status: isPartial ? 'DELIVERED_PARTIAL' : 'FAILED',
          deliveredCount: deliveredIndices.length,
          totalCount,
          deliveredIndices,
          failedAt: i,
          error: sendRes.error || `Falha no envio do balão ${i + 1}`
        };
        if (params.onPartialStatus) {
          await params.onPartialStatus(status);
        }
        return status;
      }
    } catch (err: any) {
      const isPartial = deliveredIndices.length > 0;
      const status: InFlightDeliveryStatus = {
        phone: cleanPhone,
        jobId: params.jobId,
        status: isPartial ? 'DELIVERED_PARTIAL' : 'FAILED',
        deliveredCount: deliveredIndices.length,
        totalCount,
        deliveredIndices,
        failedAt: i,
        error: err?.message || String(err)
      };
      if (params.onPartialStatus) {
        await params.onPartialStatus(status);
      }
      return status;
    }
  }

  return {
    phone: cleanPhone,
    jobId: params.jobId,
    status: 'DELIVERED_ALL',
    deliveredCount: deliveredIndices.length,
    totalCount,
    deliveredIndices
  };
}

/**
 * Sanitiza e valida qualquer payload de resposta antes do envio público ao WhatsApp.
 */
export function validateAndSanitizePublicResponse(
  rawText: string,
  options?: Partial<ExtendedPublicGuardPolicy>
): PublicSanitizationResult {
  const policy: ExtendedPublicGuardPolicy = { ...DEFAULT_PUBLIC_GUARD_POLICY, ...options };
  let text = rawText || '';
  const violations: string[] = [];
  const categories: Array<'path' | 'schema' | 'tool' | 'prompt' | 'infra' | 'credential'> = [];

  if (!text || text.trim().length === 0) {
    return {
      isSafe: true,
      cleanText: text,
      violationsFound: [],
      redactedCategories: [],
      fallbackApplied: false
    };
  }

  // 1. Detecção de Dumps de System Prompt / Jailbreak
  if (policy.blockInternalPrompts) {
    const promptKeywords = [
      /voc[eê] [eé] (a )?hydra, assistente de intelig[eê]ncia/i,
      /regra de isolamento de turno/i,
      /solicita[cç][aã]o can[oô]nica do operador/i,
      /caracteres por bal[aã]o/i,
      /proibi[cç][aã]o absoluta: n[uú]nca use duplo asterisco/i,
      /mcp_config\.json/i,
      /system_prompt\.md/i,
      /loadSystemPrompt/i,
      /CRITICAL_REVIEWER_RULES/i
    ];

    let promptMatches = 0;
    for (const pat of promptKeywords) {
      if (pat.test(text)) {
        promptMatches++;
      }
    }

    if (promptMatches >= 2 || /system_prompt\.md/i.test(text) || /CRITICAL_REVIEWER_RULES/i.test(text)) {
      violations.push('dump_system_prompt');
      categories.push('prompt');
      return {
        isSafe: false,
        cleanText: PUBLIC_DISCLAIMER_INTERNAL_REFUSAL,
        violationsFound: violations,
        redactedCategories: categories,
        fallbackApplied: true
      };
    }
  }

  // 2. Credenciais, Tokens e Chaves
  if (policy.blockCredentials) {
    const credPatterns = [
      /Bearer\s+[A-Za-z0-9_\-\.]{15,}/gi,
      /(?:apikey|api_key|token|secret|password|senha)\s*[:=]\s*['"]?[A-Za-z0-9_\-\.]{8,}['"]?/gi,
      /EVOLUTION_WEBHOOK_SECRET/gi,
      /SUPABASE_ACCESS_TOKEN/gi,
      /GH_TOKEN/gi
    ];

    for (const pat of credPatterns) {
      if (pat.test(text)) {
        violations.push('credentials_detected');
        if (!categories.includes('credential')) categories.push('credential');
        text = text.replace(pat, '[DADO_PROTEGIDO]');
      }
    }
  }

  // 3. Caminhos de Arquivos e Código Fonte
  if (policy.blockFilePaths) {
    const pathPatterns = [
      /(?:\/home\/operacional|\/opt\/bots|\/tmp\/hydra|\/etc\/[\w\-]+)[^\s'"]+/g,
      /[a-zA-Z]:\\(?:Users|Users\\User|operacional|opt)[^\s'"]+/g,
      /\b[\w\-_\.]+\.(?:ts|js|py|json|sh|lock)\b/g,
      /\b(?:\.agent\/memory\/|\/vault\/usuarios\/)[^\s'"]+/g
    ];

    for (const pat of pathPatterns) {
      if (pat.test(text)) {
        violations.push('path_detected');
        if (!categories.includes('path')) categories.push('path');
        text = text.replace(pat, (m) => {
          if (/^\d+\.\d+$/.test(m)) return m;
          return '[RECURSO_INTERNO]';
        });
      }
    }
  }

  // 4. Schemas de Banco de Dados e Queries SQL
  if (policy.blockInternalSchemas) {
    const schemaPatterns = [
      /\b(?:SELECT|INSERT|UPDATE|DELETE|CREATE TABLE|ALTER TABLE)\b[\s\S]{3,50}\b(?:FROM|INTO|SET|TABLE)\b/gi,
      /\b(?:hydra_ops\.db|better-sqlite3|sqlite3|hydra_memories|conversation_messages|hydra_user_profiles|hydra_user_memory|hydra_turns)\b/gi,
      /\bFROM\s+[\w_]+(?:\s+WHERE|\s+LIMIT|\s+GROUP|\s+ORDER|\b)/gi
    ];

    for (const pat of schemaPatterns) {
      if (pat.test(text)) {
        violations.push('sql_schema_detected');
        if (!categories.includes('schema')) categories.push('schema');
        text = text.replace(pat, '[CONSULTA_INTERNA]');
      }
    }
  }

  // 5. Nomes Internos de Ferramentas / MCP
  if (policy.blockToolNames) {
    const toolPatterns = [
      /\bmcp:[\w\-]+/gi,
      /\b(?:get_aging_cars|get_daily_revenue|get_monthly_revenue|get_cmv|get_os_list|get_os_details|get_store_overview|get_checklist_audit|search_os|semantic_search_os|retrieve_operational_data)\b/gi
    ];

    for (const pat of toolPatterns) {
      if (pat.test(text)) {
        violations.push('tool_name_detected');
        if (!categories.includes('tool')) categories.push('tool');
        text = text.replace(pat, 'consulta operacional');
      }
    }
  }

  // 6. Detalhes de Infraestrutura e Stack Traces
  if (policy.blockInfrastructure) {
    const infraPatterns = [
      /\bError:\s+.*?\n\s+at\s+.*?(?:\n|$)/g,
      /\b(?:pm2\s+reload|pm2\s+status|tailscale0|veth[a-f0-9]+|PID\s+\d+|ens133)\b/gi,
      /\boperacional@100\.126\.\d+\.\d+\b/gi
    ];

    for (const pat of infraPatterns) {
      if (pat.test(text)) {
        violations.push('infra_detected');
        if (!categories.includes('infra')) categories.push('infra');
        text = text.replace(pat, '[INFORMAÇÃO_DE_SISTEMA]');
      }
    }
  }

  // Se o texto ficou muito corrompido por redações sucessivas (> 5 substituições), usa o fallback limpo
  const totalSubstitutions = (text.match(/\[(?:RECURSO_INTERNO|DADO_PROTEGIDO|CONSULTA_INTERNA|INFORMAÇÃO_DE_SISTEMA)\]/g) || []).length;
  if (totalSubstitutions >= 5) {
    return {
      isSafe: false,
      cleanText: PUBLIC_DISCLAIMER_INTERNAL_REFUSAL,
      violationsFound: violations,
      redactedCategories: categories,
      fallbackApplied: true
    };
  }

  // 7. Conversão Anti-Tabela: Converte tabelas Markdown (| col | col |) em cards nativos (- *Campo:* valor)
  if (policy.convertMarkdownTables ?? true) {
    if (text.includes('|')) {
      const tableResult = convertMarkdownTableToNativeBlocks(text);
      if (tableResult.hasTable) {
        text = tableResult.convertedBlocksText;
      }
    }
  }

  // 8. Purga de Emojis Decorativos: zero emojis gerais, máx 1 emoji em caso de alerta crítico
  text = purgeDecorativeEmojis(text, {
    allowOneCriticalAlert: policy.allowEmojis ? false : (policy.maxCriticalAlertEmojis ? policy.maxCriticalAlertEmojis > 0 : undefined)
  });

  // 9. Sanitização final de formatação do WhatsApp:
  // - Zero asteriscos duplos (**) -> convertidos para (*)
  // - Zero títulos CommonMark (#) -> convertidos para (> *Título*)
  // - Alinhamento de listas (- *Chave:* Valor)
  text = sanitizeWhatsAppMarkdown(text);

  return {
    isSafe: violations.length === 0,
    cleanText: text,
    violationsFound: violations,
    redactedCategories: categories,
    fallbackApplied: false
  };
}

/**
 * Retorna o estado funcional da memória do bot em linguagem humana comum e elegante.
 */
export function formatPublicMemoryStatus(
  status: MemoryFunctionalStatus,
  options?: { knownPreferences?: string[] }
): string {
  switch (status) {
    case 'recording_active': {
      if (options?.knownPreferences && options.knownPreferences.length > 0) {
        const prefLines = options.knownPreferences.map(p => `- ${p}`).join('\n');
        return `Estou registrando nossa conversa continuamente no seu diário de bordo e consigo consultar nosso histórico disponível.\n\n> *Preferências registradas:*\n${prefLines}`;
      }
      return 'Estou registrando nossa conversa continuamente no seu diário de bordo e consigo consultar nosso histórico disponível.';
    }
    case 'recording_pending':
      return 'Não consegui registrar esta mensagem na sua memória no momento. O salvamento está pendente.';
    case 'recording_unavailable':
      return 'No momento, o registro contínuo da nossa conversa está temporariamente indisponível.';
    case 'history_empty':
      return 'Ainda não temos mensagens anteriores registradas nesta sessão.';
    default:
      return 'Estou pronto para registrar e consultar nossa conversa.';
  }
}
