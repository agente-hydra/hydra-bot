/**
 * Hydra — Gerenciador de Cache Contextual Multi-Fatorial e Invalidação por Edição
 * Spec: hydra-os-conversation-context (Versão 2)
 * Responsabilidade: Executor 3 (Compilador, Consultas e Orquestração)
 * Correção F07 & Gate 4: Chave multi-fatorial com segregação de persona e invalidação por mensagem editada
 */

import { CombinedOSSituationReport, CacheContextKey } from './types/conversation_context_contract';
import { ConversationSourceAdapter } from './conversation_source_adapter';

interface CacheEntry {
  readonly report: CombinedOSSituationReport;
  readonly createdAt: number;
  readonly lojaSlug: string;
  readonly osId: number;
  readonly vehiclePlate: string;
  readonly persona: string;
  readonly generationId: number;
  readonly analysisVersion: string;
  readonly erpUpdatedAt: string;
  readonly cursorLastMessageId: number;
  readonly messageSignatures?: Map<number, string>; // messageId -> textContent
}

export class ConversationCacheManager {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly defaultTtlMs: number;
  private hitsCount = 0;
  private missesCount = 0;

  constructor(
    private readonly sourceAdapter: ConversationSourceAdapter,
    defaultTtlMs: number = 300 * 1000
  ) {
    this.defaultTtlMs = defaultTtlMs;
  }

  /**
   * Constrói a chave canônica multi-fatorial da Versão 2.1 (Incidente Linea/Jabaquara):
   * hydra:os_ctx:v2.1:${lojaSlug}:${osId}:${vehiclePlate}:${persona}:${generationId}:${analysisVersion}:${erpUpdatedAt}
   */
  public buildCacheKey(
    lojaSlug: string,
    osId: number,
    persona: string,
    analysisVersion: string = 'v1.0',
    erpUpdatedAt: string = 'latest',
    vehiclePlate: string = 'UNKNOWN',
    generationId: number = 0
  ): string {
    const normPlate = (vehiclePlate || 'UNKNOWN').trim().toUpperCase();
    return `hydra:os_ctx:v2.1:${lojaSlug.toLowerCase()}:${osId}:${normPlate}:${persona.toLowerCase()}:${generationId || 0}:${analysisVersion}:${erpUpdatedAt}`;
  }

  /**
   * Recupera entrada do cache com verificação de TTL, segregação estrita de persona,
   * veículo/placa, geração de memória e detecção de mensagens editadas com mesmo ID (Gate 4 & F07).
   */
  public async get(
    lojaSlugOrKey: string | CacheContextKey,
    osId?: number,
    persona?: string,
    analysisVersion?: string,
    erpUpdatedAt?: string,
    conversationId?: number,
    vehiclePlate?: string,
    generationId?: number,
    isComplementaryRequested?: boolean
  ): Promise<CombinedOSSituationReport | null> {
    let resolvedLoja: string;
    let resolvedOsId: number;
    let resolvedPersona: string;
    let resolvedVersion: string | undefined;
    let resolvedErpUpdated: string | undefined;
    let resolvedConvId = conversationId;
    let resolvedPlate: string | undefined = vehiclePlate;
    let resolvedGenId: number = generationId || 0;

    if (typeof lojaSlugOrKey === 'object') {
      resolvedLoja = lojaSlugOrKey.lojaSlug;
      resolvedOsId = lojaSlugOrKey.osId;
      resolvedPersona = lojaSlugOrKey.userPersona;
      resolvedVersion = lojaSlugOrKey.analysisVersion;
      resolvedErpUpdated = lojaSlugOrKey.erpUpdatedAt;
      resolvedPlate = lojaSlugOrKey.vehiclePlate;
      resolvedGenId = lojaSlugOrKey.memoryGenerationId || 0;
      if (typeof osId === 'number') {
        resolvedConvId = osId;
      }
    } else {
      resolvedLoja = lojaSlugOrKey;
      resolvedOsId = osId ?? 0;
      resolvedPersona = persona ?? 'socio';
      resolvedVersion = analysisVersion;
      resolvedErpUpdated = erpUpdatedAt;
    }

    let matchingEntry: CacheEntry | null = null;
    let matchingKey: string | null = null;

    if (resolvedVersion && resolvedErpUpdated) {
      if (resolvedPlate && resolvedPlate !== 'UNKNOWN') {
        // 1. Busca exata pela chave multi-fatorial completa v2.1
        const exactKey = this.buildCacheKey(
          resolvedLoja,
          resolvedOsId,
          resolvedPersona,
          resolvedVersion,
          resolvedErpUpdated,
          resolvedPlate,
          resolvedGenId
        );
        const entry = this.cache.get(exactKey);
        if (entry) {
          matchingEntry = entry;
          matchingKey = exactKey;
        }
      } else {
        // Se a placa não foi fornecida, procura correspondência estrita por loja, OS, persona, geração, versão e erpUpdated
        const keySuffix = `:${resolvedPersona.toLowerCase()}:${resolvedGenId}:${resolvedVersion}:${resolvedErpUpdated}`;
        const prefix = `hydra:os_ctx:v2.1:${resolvedLoja.toLowerCase()}:${resolvedOsId}:`;
        for (const [key, entry] of this.cache.entries()) {
          if (key.startsWith(prefix) && key.endsWith(keySuffix)) {
            matchingEntry = entry;
            matchingKey = key;
            break;
          }
        }
      }
    } else {
      // 2. Busca prefixada estrita por persona e geração (NUNCA compartilha entre gerente e sócio)
      for (const [key, entry] of this.cache.entries()) {
        if (
          entry.lojaSlug === resolvedLoja.toLowerCase() &&
          entry.osId === resolvedOsId &&
          entry.persona === resolvedPersona.toLowerCase() &&
          entry.generationId === resolvedGenId &&
          (!resolvedPlate || entry.vehiclePlate === resolvedPlate.trim().toUpperCase())
        ) {
          matchingEntry = entry;
          matchingKey = key;
          break;
        }
      }
    }

    if (!matchingEntry || !matchingKey) {
      this.missesCount++;
      return null;
    }

    // 3. Verificação de expiração por TTL
    const now = Date.now();
    if (now - matchingEntry.createdAt > this.defaultTtlMs) {
      this.cache.delete(matchingKey);
      this.missesCount++;
      return null;
    }

    // 4. ESTRATÉGIA DE INVALIDAÇÃO POR EDIÇÃO DE MENSAGEM OU NOVOS WEBHOOKS (Gate 4 & F07):
    // REGRA PÉTREA G10: Leitura de mensagens na API externa é restrita ao Modo Complementar!
    // No modo padrão (isComplementaryRequested !== true), exatamente ZERO chamadas incrementais de mensageria.
    if (resolvedConvId && isComplementaryRequested === true) {
      try {
        // A) Checagem de mensagens novas não notificadas (Lost Webhook)
        const realLatestId = await this.sourceAdapter.getLatestMessageId(resolvedConvId);
        if (realLatestId !== null && realLatestId > matchingEntry.cursorLastMessageId) {
          this.cache.delete(matchingKey);
          this.missesCount++;
          return null;
        }

        // B) Checagem de mensagens editadas mantendo o mesmo messageId
        if (matchingEntry.messageSignatures && matchingEntry.messageSignatures.size > 0) {
          const currentMessages = await this.sourceAdapter.fetchMessages({
            conversationId: resolvedConvId,
            limit: 30
          });

          for (const msg of currentMessages) {
            const cachedSig = matchingEntry.messageSignatures.get(msg.messageId);
            if (cachedSig !== undefined && cachedSig !== msg.textContent.trim()) {
              // MENSAGEM EDITADA COM MESMO ID DETECTADA!
              // Invalidação compulsória: descarta cache anterior para não reter aprovação antiga
              this.cache.delete(matchingKey);
              this.missesCount++;
              return null;
            }
          }
        }
      } catch {
        // Falha no adaptador não bloqueia leitura de cache se não houver edição comprovada
      }
    }

    this.hitsCount++;
    return {
      ...matchingEntry.report,
      cachedResponse: true
    };
  }

  /**
   * Armazena relatório no cache com chave multi-fatorial e assinaturas de mensagens para detecção de edição.
   */
  public set(
    lojaSlugOrKey: string | CacheContextKey,
    osIdOrReport?: number | CombinedOSSituationReport,
    persona?: string,
    versionOrCursor?: string | number,
    erpUpdatedOrReport?: string | CombinedOSSituationReport,
    reportOrCursor?: CombinedOSSituationReport | number,
    cursorLastMessageIdOpt?: number,
    vehiclePlateOpt?: string,
    generationIdOpt?: number
  ): void {
    let lojaSlug: string;
    let osId: number;
    let personaStr: string;
    let analysisVersion: string;
    let erpUpdatedAt: string;
    let report: CombinedOSSituationReport;
    let cursorLastMessageId = 0;
    let vehiclePlate = vehiclePlateOpt;
    let generationId = generationIdOpt ?? 0;

    if (typeof lojaSlugOrKey === 'object') {
      lojaSlug = lojaSlugOrKey.lojaSlug;
      osId = lojaSlugOrKey.osId;
      personaStr = lojaSlugOrKey.userPersona;
      analysisVersion = lojaSlugOrKey.analysisVersion;
      erpUpdatedAt = lojaSlugOrKey.erpUpdatedAt;
      vehiclePlate = lojaSlugOrKey.vehiclePlate;
      generationId = lojaSlugOrKey.memoryGenerationId ?? 0;
      report = osIdOrReport as CombinedOSSituationReport;
      cursorLastMessageId = (typeof persona === 'number' ? persona : 0);
    } else if (typeof versionOrCursor === 'number') {
      // Assinatura de compatibilidade legada: set(lojaSlug, osId, persona, cursorId, report)
      lojaSlug = lojaSlugOrKey;
      osId = osIdOrReport as number;
      personaStr = persona ?? 'socio';
      cursorLastMessageId = versionOrCursor;
      report = erpUpdatedOrReport as CombinedOSSituationReport;
      analysisVersion = report.analysisState?.analysisVersion ?? 'v1.0';
      erpUpdatedAt = report.erpState?.updatedAt ?? 'latest';
      vehiclePlate = vehiclePlate || report.vehiclePlate;
    } else {
      // Assinatura canônica v2.1: set(lojaSlug, osId, persona, analysisVersion, erpUpdatedAt, report, cursorId, plate, genId)
      lojaSlug = lojaSlugOrKey;
      osId = osIdOrReport as number;
      personaStr = persona ?? 'socio';
      analysisVersion = (versionOrCursor as string) ?? 'v1.0';
      erpUpdatedAt = (erpUpdatedOrReport as string) ?? 'latest';
      report = reportOrCursor as CombinedOSSituationReport;
      cursorLastMessageId = cursorLastMessageIdOpt ?? 0;
      vehiclePlate = vehiclePlate || report?.vehiclePlate;
    }

    const finalPlate = (vehiclePlate || report?.vehiclePlate || 'UNKNOWN').trim().toUpperCase();
    const finalGenId = generationId || 0;

    const key = this.buildCacheKey(
      lojaSlug,
      osId,
      personaStr,
      analysisVersion,
      erpUpdatedAt,
      finalPlate,
      finalGenId
    );

    // Mapeia assinaturas de texto das afirmações para detecção de mensagens editadas
    const messageSignatures = new Map<number, string>();
    const allStmts = [
      ...(report.analysisState?.statements ?? []),
      ...(report.conversationState?.statements ?? [])
    ];
    for (const stmt of allStmts) {
      if (stmt.messageId && stmt.rawExcerpt) {
        messageSignatures.set(stmt.messageId, stmt.rawExcerpt.trim());
      }
    }

    this.cache.set(key, {
      report,
      createdAt: Date.now(),
      lojaSlug: lojaSlug.toLowerCase(),
      osId,
      vehiclePlate: finalPlate,
      persona: personaStr.toLowerCase(),
      generationId: finalGenId,
      analysisVersion,
      erpUpdatedAt,
      cursorLastMessageId,
      messageSignatures
    });
  }

  /**
   * Invalidação cirúrgica acionada por webhooks ou atualizações de ERP para uma OS/placa específica.
   */
  public invalidate(lojaSlug: string, osId: number, vehiclePlate?: string): void {
    const prefix = `hydra:os_ctx:v2.1:${lojaSlug.toLowerCase()}:${osId}:`;
    const normPlate = vehiclePlate ? vehiclePlate.trim().toUpperCase() : undefined;
    for (const [key, entry] of this.cache.entries()) {
      if (key.startsWith(prefix)) {
        if (!normPlate || entry.vehiclePlate === normPlate) {
          this.cache.delete(key);
        }
      }
    }
  }

  /**
   * Invalidação cirúrgica para mensagem editada específica em uma conversa.
   */
  public invalidateEditedMessage(conversationId: number, messageId: number): void {
    for (const [key, entry] of this.cache.entries()) {
      if (
        entry.report.conversationState?.conversationId === conversationId ||
        entry.messageSignatures?.has(messageId)
      ) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Invalidação compulsória acionada imediatamente sob /reset ou reparação conversacional ("não foi isso").
   */
  public invalidateOnResetOrRepair(filter?: { lojaSlug?: string; osId?: number; vehiclePlate?: string; generationId?: number }): void {
    if (!filter || (!filter.lojaSlug && !filter.osId && !filter.vehiclePlate && filter.generationId === undefined)) {
      this.clear();
      return;
    }
    for (const [key, entry] of this.cache.entries()) {
      if (filter.lojaSlug && entry.lojaSlug.toLowerCase() !== filter.lojaSlug.toLowerCase()) continue;
      if (filter.osId !== undefined && entry.osId !== filter.osId) continue;
      if (filter.vehiclePlate && entry.vehiclePlate !== filter.vehiclePlate.trim().toUpperCase()) continue;
      if (filter.generationId !== undefined && entry.generationId !== filter.generationId) continue;
      this.cache.delete(key);
    }
  }

  /**
   * Invalida entradas de uma OS que possuam versão de análise diferente da versão informada.
   */
  public invalidateByVersion(lojaSlug: string, osId: number, currentVersion: string): void {
    const prefix = `hydra:os_ctx:v2.1:${lojaSlug.toLowerCase()}:${osId}:`;
    for (const [key, entry] of this.cache.entries()) {
      if (key.startsWith(prefix) && entry.analysisVersion !== currentVersion) {
        this.cache.delete(key);
      }
    }
  }

  public getStats(): { hits: number; misses: number } {
    return { hits: this.hitsCount, misses: this.missesCount };
  }

  public getCacheSize(): number {
    return this.cache.size;
  }

  public clear(): void {
    this.cache.clear();
    this.hitsCount = 0;
    this.missesCount = 0;
  }
}
