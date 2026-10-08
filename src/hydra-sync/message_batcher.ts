/**
 * HYDRA MESSAGE BATCHER (Frente A)
 * Agrupador inteligente de mensagens encavaladas por conversa.
 * 
 * Regras:
 * 1. Agrupamento estrito por conversationKey (telefone / JID), NUNCA entre pessoas diferentes.
 * 2. Janela deslizante de 1.500ms: estende ao chegar nova mensagem, até o teto máximo de 5.000ms (5s).
 *    Configurável via parâmetros ou variáveis de ambiente HYDRA_BATCH_DEBOUNCE_MS e HYDRA_BATCH_MAX_WINDOW_MS.
 * 3. Preserva ordem, todas as partes brutas (InboundPart), textos originais e todos os messageIds.
 * 4. Concorrência e Complemento durante Geração:
 *    Se uma nova mensagem chegar enquanto a IA já estiver gerando resposta ("digitando"), preserva a ordem
 *    e impede o envio da resposta obsoleta. Agrupa o complemento e produz uma resposta unificada atualizada.
 * 5. Deduplicação: mensagem com mesmo messageId é ignorada; mensagem com texto idêntico e novo ID é aceita.
 * 6. Resolução de correções e negativas: "não, da rede" / "não, de Santo André" anula imediatamente o escopo anterior.
 * 7. Zero timers órfãos: timers cancelados pontualmente em fechamento ou reinicialização.
 * 8. Sem presença presa: o timer de espera do lote NÃO dispara "digitando". Digitando inicia apenas
 *    quando o lote fechado é despachado para processamento.
 */

import Database from 'better-sqlite3';
import { InboundPart, MediaEvidence, MessageBatchPayload } from './types/multimodal_contract.js';

export interface BatcherOptions {
  debounceMs?: number;    // Janela padrão deslizante (default: 1500ms)
  maxWindowMs?: number;   // Teto máximo absoluto (default: 5000ms)
  db?: Database.Database; // Conexão SQLite opcional para persistência de estado
}

interface ActiveBatchInternal {
  batchId: string;
  conversationKey: string;
  messageIds: string[];
  originalTexts: string[];
  parts: InboundPart[];
  mediaEvidence: MediaEvidence[];
  firstReceivedAt: number;
  lastReceivedAt: number;
  debounceTimer: NodeJS.Timeout | null;
  maxCeilingTimer: NodeJS.Timeout | null;
  isClosed: boolean;
  callback: (batch: MessageBatchPayload) => Promise<void>;
  inFlightBaseBatch?: MessageBatchPayload;
}

export class MessageBatcher {
  private debounceMs: number;
  private maxWindowMs: number;
  private db?: Database.Database;
  private activeBatches = new Map<string, ActiveBatchInternal>();
  private seenMessageIds = new Set<string>();

  // Rastreamento de gerações ativas (concorrência e cancelamento de respostas obsoletas)
  private inFlightGenerations = new Map<string, {
    batchId: string;
    batch: MessageBatchPayload;
    isObsolete: boolean;
    startedAt: number;
  }>();
  private obsoleteBatchIds = new Set<string>();

  constructor(options?: BatcherOptions) {
    const envDebounce = process.env.HYDRA_BATCH_DEBOUNCE_MS ? parseInt(process.env.HYDRA_BATCH_DEBOUNCE_MS, 10) : undefined;
    const envMax = process.env.HYDRA_BATCH_MAX_WINDOW_MS ? parseInt(process.env.HYDRA_BATCH_MAX_WINDOW_MS, 10) : undefined;

    this.debounceMs = options?.debounceMs ?? (envDebounce !== undefined && !isNaN(envDebounce) ? envDebounce : 1500);
    this.maxWindowMs = options?.maxWindowMs ?? (envMax !== undefined && !isNaN(envMax) ? envMax : 5000);
    this.db = options?.db;

    if (this.db) {
      this.initBatchSchema(this.db);
    }
  }

  public getDebounceMs(): number {
    return this.debounceMs;
  }

  public getMaxWindowMs(): number {
    return this.maxWindowMs;
  }

  private initBatchSchema(db: Database.Database): void {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS hydra_message_batches (
          batch_id TEXT PRIMARY KEY,
          conversation_key TEXT NOT NULL,
          message_ids TEXT NOT NULL,
          combined_text TEXT NOT NULL,
          part_count INTEGER NOT NULL,
          status TEXT NOT NULL,
          first_received_at TEXT NOT NULL,
          closed_at TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS hydra_batch_messages (
          message_id TEXT PRIMARY KEY,
          batch_id TEXT NOT NULL,
          conversation_key TEXT NOT NULL,
          text TEXT,
          media_type TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
    } catch (err: any) {
      console.warn('[MessageBatcher] Falha ao inicializar schema de lotes:', err?.message || err);
    }
  }

  /**
   * Marca o início da geração de resposta pelo despachante/IA ("digitando")
   */
  public markInFlight(conversationKey: string, batch: MessageBatchPayload): void {
    if (!conversationKey || !batch) return;
    this.inFlightGenerations.set(conversationKey, {
      batchId: batch.batchId,
      batch,
      isObsolete: false,
      startedAt: Date.now()
    });
  }

  /**
   * Remove o estado de geração ativa após conclusão ou envio
   */
  public clearInFlight(conversationKey: string, batchId?: string): void {
    if (!conversationKey) return;
    const current = this.inFlightGenerations.get(conversationKey);
    if (!current) return;
    if (!batchId || current.batchId === batchId) {
      this.inFlightGenerations.delete(conversationKey);
    }
  }

  /**
   * Verifica se a IA está atualmente gerando resposta para esta conversa
   */
  public isInFlight(conversationKey: string): boolean {
    return this.inFlightGenerations.has(conversationKey);
  }

  /**
   * Retorna os dados da geração ativa em voo
   */
  public getInFlight(conversationKey: string) {
    return this.inFlightGenerations.get(conversationKey);
  }

  /**
   * Marca explicitamente um lote como obsoleto (para descarte seguro de resposta)
   */
  public markBatchObsolete(batchId: string): void {
    if (!batchId) return;
    this.obsoleteBatchIds.add(batchId);
    for (const inFlight of this.inFlightGenerations.values()) {
      if (inFlight.batchId === batchId) {
        inFlight.isObsolete = true;
      }
    }
  }

  /**
   * Verifica se um lote foi tornado obsoleto
   */
  public isBatchObsolete(batchId: string): boolean {
    if (!batchId) return false;
    if (this.obsoleteBatchIds.has(batchId)) return true;
    for (const inFlight of this.inFlightGenerations.values()) {
      if (inFlight.batchId === batchId && inFlight.isObsolete) {
        return true;
      }
    }
    return false;
  }

  /**
   * Verifica se há um lote acumulando mensagens ativamente para a conversa
   */
  public hasActiveBatch(conversationKey: string): boolean {
    return this.activeBatches.has(conversationKey);
  }

  /**
   * Adiciona uma parte de mensagem à fila da conversa.
   * Se houver uma geração em andamento para esta conversa, marca a geração anterior como
   * obsoleta e prepara a unificação do complemento.
   */
  public addMessage(
    part: InboundPart,
    evidence: MediaEvidence[] | undefined,
    onBatchReady: (batch: MessageBatchPayload) => Promise<void>
  ): { isDuplicate: boolean; batchId: string } {
    // Deduplicação estrita de messageId
    if (this.seenMessageIds.has(part.messageId)) {
      return { isDuplicate: true, batchId: '' };
    }
    this.seenMessageIds.add(part.messageId);

    const key = part.conversationKey || String(part.messageId.split('@')[0] || part.messageId).replace(/\D/g, '') || 'default';
    const now = Date.now();

    // Detecção de mensagem durante geração ativa:
    // Se a IA já estiver gerando resposta ("digitando") para esta conversa,
    // a resposta em geração tornou-se obsoleta.
    let inFlightBaseBatch: MessageBatchPayload | undefined = undefined;
    const currentInFlight = this.inFlightGenerations.get(key);
    if (currentInFlight) {
      currentInFlight.isObsolete = true;
      this.obsoleteBatchIds.add(currentInFlight.batchId);
      inFlightBaseBatch = currentInFlight.batch;
    }

    let batch = this.activeBatches.get(key);

    if (!batch || batch.isClosed) {
      // Cria novo lote para esta conversa
      const batchId = `batch_${key}_${now}_${Math.random().toString(36).slice(2, 6)}`;
      batch = {
        batchId,
        conversationKey: key,
        messageIds: [part.messageId],
        originalTexts: part.text ? [part.text] : [],
        parts: [part],
        mediaEvidence: evidence ? [...evidence] : [],
        firstReceivedAt: now,
        lastReceivedAt: now,
        debounceTimer: null,
        maxCeilingTimer: null,
        isClosed: false,
        callback: onBatchReady,
        inFlightBaseBatch: inFlightBaseBatch || undefined
      };

      this.activeBatches.set(key, batch);

      // Timer 1: Janela deslizante de debounce (default: 1500ms)
      batch.debounceTimer = setTimeout(() => {
        this.closeBatch(key);
      }, this.debounceMs);

      // Timer 2: Teto máximo absoluto (default: 5000ms)
      batch.maxCeilingTimer = setTimeout(() => {
        this.closeBatch(key);
      }, this.maxWindowMs);

      this.persistBatchState(batch, 'OPEN');
      return { isDuplicate: false, batchId };
    }

    // Lote existente aberto: adiciona a nova mensagem
    batch.messageIds.push(part.messageId);
    if (part.text) {
      batch.originalTexts.push(part.text);
    }
    batch.parts.push(part);
    if (evidence) {
      batch.mediaEvidence.push(...evidence);
    }
    batch.lastReceivedAt = now;
    batch.callback = onBatchReady;
    if (inFlightBaseBatch && !batch.inFlightBaseBatch) {
      batch.inFlightBaseBatch = inFlightBaseBatch;
    }

    // Reseta o timer deslizante se ainda não tiver atingido o teto
    if (batch.debounceTimer) {
      clearTimeout(batch.debounceTimer);
    }

    const elapsed = now - batch.firstReceivedAt;
    const remainingToMax = this.maxWindowMs - elapsed;

    if (remainingToMax <= 0) {
      // Teto atingido: fecha imediatamente
      this.closeBatch(key);
    } else {
      // Estende até Math.min(debounceMs, remainingToMax)
      const nextWindow = Math.min(this.debounceMs, remainingToMax);
      batch.debounceTimer = setTimeout(() => {
        this.closeBatch(key);
      }, nextWindow);
    }

    this.persistBatchState(batch, 'UPDATED');
    return { isDuplicate: false, batchId: batch.batchId };
  }

  /**
   * Fecha o lote ativo e despacha para processamento.
   * Se houver complemento de geração em voo, unifica os textos e IDs.
   */
  public closeBatch(conversationKey: string): MessageBatchPayload | null {
    const batch = this.activeBatches.get(conversationKey);
    if (!batch || batch.isClosed) return null;

    batch.isClosed = true;
    if (batch.debounceTimer) clearTimeout(batch.debounceTimer);
    if (batch.maxCeilingTimer) clearTimeout(batch.maxCeilingTimer);
    batch.debounceTimer = null;
    batch.maxCeilingTimer = null;

    this.activeBatches.delete(conversationKey);

    let combinedText: string;
    let finalMessageIds = [...batch.messageIds];
    let finalParts = [...batch.parts];
    let finalEvidence = [...batch.mediaEvidence];
    let isComplement = false;
    let supersededBatchId: string | undefined = undefined;

    if (batch.inFlightBaseBatch) {
      isComplement = true;
      supersededBatchId = batch.inFlightBaseBatch.batchId;
      combinedText = this.combineTexts(
        [batch.inFlightBaseBatch.combinedText, ...batch.originalTexts],
        [...batch.inFlightBaseBatch.mediaEvidence, ...batch.mediaEvidence]
      );
      finalMessageIds = Array.from(new Set([...batch.inFlightBaseBatch.messageIds, ...batch.messageIds]));
      finalParts = [...batch.inFlightBaseBatch.parts, ...batch.parts];
      finalEvidence = [...batch.inFlightBaseBatch.mediaEvidence, ...batch.mediaEvidence];
    } else {
      combinedText = this.combineTexts(batch.originalTexts, batch.mediaEvidence);
    }

    const payload: MessageBatchPayload = {
      batchId: batch.batchId,
      conversationKey: batch.conversationKey,
      messageIds: finalMessageIds,
      originalTexts: [...batch.originalTexts],
      parts: finalParts,
      mediaEvidence: finalEvidence,
      combinedText,
      firstReceivedAt: batch.firstReceivedAt,
      lastReceivedAt: batch.lastReceivedAt,
      isClosed: true,
      isComplement,
      supersededBatchId
    };

    this.persistBatchState(batch, 'CLOSED', combinedText);

    // Dispara callback assíncrono para a fila de processamento
    Promise.resolve(batch.callback(payload)).catch(err => {
      console.error(`[MessageBatcher] Erro no processamento do lote #${batch.batchId}:`, err);
    });

    return payload;
  }

  /**
   * Combina de forma inteligente os textos de mensagens encavaladas,
   * aplicando resolução de correções ("não, da rede" / "não, de Santo André")
   * e anulando o escopo negado anterior.
   */
  public combineTexts(texts: string[], evidence: MediaEvidence[] = []): string {
    const rawParts: string[] = [];

    for (const t of texts) {
      const clean = (t || '').trim();
      if (clean) rawParts.push(clean);
    }

    // Se houver transcrição de áudio, anexa como texto
    for (const ev of evidence) {
      if (ev.type === 'audio' && ev.transcription) {
        rawParts.push(ev.transcription.trim());
      }
    }

    if (rawParts.length === 0) return '';
    if (rawParts.length === 1) return rawParts[0];

    // Detecção de correção explícita no último segmento
    const lastPart = rawParts[rawParts.length - 1];
    const lastPartNorm = lastPart.toLowerCase().trim();
    const isCorrection = 
      lastPartNorm.startsWith('não,') || 
      lastPartNorm.startsWith('nao,') || 
      lastPartNorm.startsWith('esquece,') || 
      lastPartNorm.startsWith('muda pra') ||
      lastPartNorm.startsWith('troca pra') ||
      lastPartNorm.includes('não da ') ||
      lastPartNorm.includes('nao da ') ||
      lastPartNorm.includes('não de ') ||
      lastPartNorm.includes('nao de ') ||
      lastPartNorm.includes(', não ') ||
      lastPartNorm.includes(', nao ');

    if (isCorrection) {
      const cleanLast = lastPart
        .replace(/^(não,|nao,|esquece,|muda pra|troca pra)\s*/i, '')
        .trim();

      const storeAliases = [
        'jorge beretta', 'jorge', 'beretta',
        'santo andre', 'santo andré', 'sto andre',
        'dom pedro i', 'dom pedro 1', 'dom pedro',
        'piraporinha', 'pirapora',
        'jabaquara', 'jaba',
        'rudge ramos', 'rudge',
        'kennedy',
        'planalto',
        'rei do oleo maua', 'rei do oleo', 'oleo maua', 'maua',
        'rei do modulo', 'rei modulo', 'modulo',
        'master'
      ];

      // Remove menções de lojas anteriores do texto prévio para anular o escopo negado!
      let previous = rawParts.slice(0, -1).join(' ');
      for (const alias of storeAliases) {
        previous = previous.replace(new RegExp(`\\b(da|do|de|na|no|em)?\\s*${alias}\\b`, 'gi'), '');
      }
      previous = previous.trim().replace(/\s+/g, ' ');

      // Se a última parte diz "da rede", substitui qualquer menção de loja anterior por "da rede"
      if (cleanLast.toLowerCase().includes('da rede') || cleanLast.toLowerCase().includes('na rede') || cleanLast.toLowerCase().includes('das lojas')) {
        return `${previous} ${cleanLast}`.trim().replace(/\s+/g, ' ');
      }

      // Se a última parte corrige para uma loja ("de Santo André")
      return `${previous} ${cleanLast}`.trim().replace(/\s+/g, ' ');
    }

    // Junção natural de frases complementares ("qual o CMV" + "da rede" -> "qual o CMV da rede")
    return rawParts.join(' ');
  }

  private persistBatchState(batch: ActiveBatchInternal, status: string, combinedText?: string): void {
    if (!this.db) return;
    try {
      this.db.prepare(`
        INSERT OR REPLACE INTO hydra_message_batches (
          batch_id, conversation_key, message_ids, combined_text, part_count, status, first_received_at, closed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        batch.batchId,
        batch.conversationKey,
        JSON.stringify(batch.messageIds),
        combinedText || batch.originalTexts.join(' '),
        batch.parts.length,
        status,
        new Date(batch.firstReceivedAt).toISOString(),
        batch.isClosed ? new Date().toISOString() : null
      );
    } catch {}
  }

  /**
   * Retorna métricas de lotes ativos para telemetria
   */
  public getMetrics(): { activeBatchesCount: number; inFlightCount: number } {
    return {
      activeBatchesCount: this.activeBatches.size,
      inFlightCount: this.inFlightGenerations.size
    };
  }

  /**
   * Limpa recursos ao encerrar
   */
  public destroy(): void {
    for (const [key, batch] of this.activeBatches.entries()) {
      if (batch.debounceTimer) clearTimeout(batch.debounceTimer);
      if (batch.maxCeilingTimer) clearTimeout(batch.maxCeilingTimer);
    }
    this.activeBatches.clear();
    this.inFlightGenerations.clear();
    this.obsoleteBatchIds.clear();
  }
}
