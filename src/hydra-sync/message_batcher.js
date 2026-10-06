/**
 * HYDRA CONVERSATION MESSAGE BATCHER (Encavalamento de Mensagens) - ESM JavaScript
 * Janela deslizante de 1.500ms por conversa com teto absoluto de 5.000ms.
 * Suporta concorrência durante geração ("digitando") e resolução de negativas intra-lote.
 */

export class MessageBatcher {
  constructor(options = {}) {
    const envDebounce = process.env.HYDRA_BATCH_DEBOUNCE_MS ? parseInt(process.env.HYDRA_BATCH_DEBOUNCE_MS, 10) : undefined;
    const envMax = process.env.HYDRA_BATCH_MAX_WINDOW_MS ? parseInt(process.env.HYDRA_BATCH_MAX_WINDOW_MS, 10) : undefined;

    this.debounceMs = options.debounceMs ?? (envDebounce !== undefined && !isNaN(envDebounce) ? envDebounce : 1500);
    this.maxWindowMs = options.maxWindowMs ?? (envMax !== undefined && !isNaN(envMax) ? envMax : 5000);
    this.db = options.db || null;
    this.activeBatches = new Map();
    this.seenMessageIds = new Set();
    this.inFlightGenerations = new Map();
    this.obsoleteBatchIds = new Set();

    if (this.db) {
      this.initBatchSchema(this.db);
    }
  }

  getDebounceMs() {
    return this.debounceMs;
  }

  getMaxWindowMs() {
    return this.maxWindowMs;
  }

  initBatchSchema(db) {
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
    } catch (err) {
      console.warn('[MessageBatcher] Falha ao inicializar schema de lotes:', err?.message || err);
    }
  }

  markInFlight(conversationKey, batch) {
    if (!conversationKey || !batch) return;
    this.inFlightGenerations.set(conversationKey, {
      batchId: batch.batchId,
      batch,
      isObsolete: false,
      startedAt: Date.now()
    });
  }

  clearInFlight(conversationKey, batchId) {
    if (!conversationKey) return;
    const current = this.inFlightGenerations.get(conversationKey);
    if (!current) return;
    if (!batchId || current.batchId === batchId) {
      this.inFlightGenerations.delete(conversationKey);
    }
  }

  isInFlight(conversationKey) {
    return this.inFlightGenerations.has(conversationKey);
  }

  getInFlight(conversationKey) {
    return this.inFlightGenerations.get(conversationKey);
  }

  markBatchObsolete(batchId) {
    if (!batchId) return;
    this.obsoleteBatchIds.add(batchId);
    for (const inFlight of this.inFlightGenerations.values()) {
      if (inFlight.batchId === batchId) {
        inFlight.isObsolete = true;
      }
    }
  }

  isBatchObsolete(batchId) {
    if (!batchId) return false;
    if (this.obsoleteBatchIds.has(batchId)) return true;
    for (const inFlight of this.inFlightGenerations.values()) {
      if (inFlight.batchId === batchId && inFlight.isObsolete) {
        return true;
      }
    }
    return false;
  }

  hasActiveBatch(conversationKey) {
    return this.activeBatches.has(conversationKey);
  }

  addMessage(part, evidence, onBatchReady) {
    if (this.seenMessageIds.has(part.messageId)) {
      return { isDuplicate: true, batchId: '' };
    }
    this.seenMessageIds.add(part.messageId);

    const key = part.conversationKey || String(part.messageId.split('@')[0] || part.messageId).replace(/\D/g, '') || 'default';
    const now = Date.now();

    let inFlightBaseBatch = undefined;
    const currentInFlight = this.inFlightGenerations.get(key);
    if (currentInFlight) {
      currentInFlight.isObsolete = true;
      this.obsoleteBatchIds.add(currentInFlight.batchId);
      inFlightBaseBatch = currentInFlight.batch;
    }

    let batch = this.activeBatches.get(key);

    if (!batch || batch.isClosed) {
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
        inFlightBaseBatch
      };

      this.activeBatches.set(key, batch);

      batch.debounceTimer = setTimeout(() => {
        this.closeBatch(key);
      }, this.debounceMs);

      batch.maxCeilingTimer = setTimeout(() => {
        this.closeBatch(key);
      }, this.maxWindowMs);

      this.persistBatchState(batch, 'OPEN');
      return { isDuplicate: false, batchId };
    }

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

    if (batch.debounceTimer) {
      clearTimeout(batch.debounceTimer);
    }

    const elapsed = now - batch.firstReceivedAt;
    const remainingToMax = this.maxWindowMs - elapsed;

    if (remainingToMax <= 0) {
      this.closeBatch(key);
    } else {
      const nextWindow = Math.min(this.debounceMs, remainingToMax);
      batch.debounceTimer = setTimeout(() => {
        this.closeBatch(key);
      }, nextWindow);
    }

    this.persistBatchState(batch, 'UPDATED');
    return { isDuplicate: false, batchId: batch.batchId };
  }

  closeBatch(conversationKey) {
    const batch = this.activeBatches.get(conversationKey);
    if (!batch || batch.isClosed) return null;

    batch.isClosed = true;
    if (batch.debounceTimer) clearTimeout(batch.debounceTimer);
    if (batch.maxCeilingTimer) clearTimeout(batch.maxCeilingTimer);
    batch.debounceTimer = null;
    batch.maxCeilingTimer = null;

    this.activeBatches.delete(conversationKey);

    let combinedText;
    let finalMessageIds = [...batch.messageIds];
    let finalParts = [...batch.parts];
    let finalEvidence = [...batch.mediaEvidence];
    let isComplement = false;
    let supersededBatchId = undefined;

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

    const payload = {
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

    Promise.resolve(batch.callback(payload)).catch(err => {
      console.error(`[MessageBatcher] Erro no processamento do lote #${batch.batchId}:`, err);
    });

    return payload;
  }

  combineTexts(texts, evidence = []) {
    const rawParts = [];

    for (const t of texts) {
      const clean = (t || '').trim();
      if (clean) rawParts.push(clean);
    }

    for (const ev of evidence) {
      if (ev.type === 'audio' && ev.transcription) {
        rawParts.push(ev.transcription.trim());
      }
    }

    if (rawParts.length === 0) return '';
    if (rawParts.length === 1) return rawParts[0];

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

      let previous = rawParts.slice(0, -1).join(' ');
      for (const alias of storeAliases) {
        previous = previous.replace(new RegExp(`\\b(da|do|de|na|no|em)?\\s*${alias}\\b`, 'gi'), '');
      }
      previous = previous.trim().replace(/\s+/g, ' ');

      if (cleanLast.toLowerCase().includes('da rede') || cleanLast.toLowerCase().includes('na rede') || cleanLast.toLowerCase().includes('das lojas')) {
        return `${previous} ${cleanLast}`.trim().replace(/\s+/g, ' ');
      }

      return `${previous} ${cleanLast}`.trim().replace(/\s+/g, ' ');
    }

    return rawParts.join(' ');
  }

  persistBatchState(batch, status, combinedText) {
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

  getMetrics() {
    return {
      activeBatchesCount: this.activeBatches.size,
      inFlightCount: this.inFlightGenerations.size
    };
  }

  destroy() {
    for (const [key, batch] of this.activeBatches.entries()) {
      if (batch.debounceTimer) clearTimeout(batch.debounceTimer);
      if (batch.maxCeilingTimer) clearTimeout(batch.maxCeilingTimer);
    }
    this.activeBatches.clear();
    this.inFlightGenerations.clear();
    this.obsoleteBatchIds.clear();
  }
}
