/**
 * HYDRA MULTIMODAL CONTRACT (v1.0.0)
 * 
 * Contrato de tipos para ingestão e percepção multimodal entre:
 * - Agente 1: Normalização de evento, aquisição segura e análise de mídia (Áudio, Imagem, Vídeo, Documentos)
 * - Agente 2: Agrupador de mensagens (MessageBatcher), Intent Rewriter e Contexto Conversacional
 * - Agente 3: Reações, Ciclo de Vida e Observabilidade
 * - Camada de Execução Operacional do Hydra
 */

export type MediaKind = 'text' | 'audio' | 'image' | 'video' | 'document' | 'unsupported';
export type MediaType = MediaKind; // Alias para compatibilidade

export interface InboundMediaRef {
  mime: string;
  sizeBytes?: number;
  source: 'evolution' | 'chatwoot' | 'direct' | 'url';
  mediaUrl?: string;
  fileName?: string;
  durationSeconds?: number;
}

/**
 * Parte de entrada normalizada a partir de evento bruto de transporte (Evolution / Chatwoot)
 */
export interface InboundPart {
  messageId: string;              // ID opaco original do WhatsApp
  conversationKey: string;        // conversa/identidade, não só texto ou telefone
  receivedAt: string;             // ISO 8601 string
  kind: MediaKind;
  text?: string;                  // texto ou legenda original
  quotedMessageId?: string;
  mediaRef?: InboundMediaRef;

  remoteJid?: string;             // remoteJid original completo (incluindo @lid ou @s.whatsapp.net)
  phone?: string;                 // Telefone extraído limpo (dígitos)
  isLid?: boolean;                // Flag indicando se é identificador LID
  pushName?: string;              // Nome de exibição do usuário no WhatsApp
  metadata?: Record<string, any>; // Metadados do evento (pushName, instance, etc)

  // Campos de compatibilidade para Agente 2 / MessageBatcher
  partId?: string;
  type?: MediaKind;
  mediaUrl?: string;
  mimeType?: string;
  fileName?: string;
  fileSize?: number;
  durationSeconds?: number;
  timestamp?: number;
  rawPayloadRef?: any;            // Referência opaca em memória para download (não logada)
}

export type CandidateEntityType = 'placa' | 'os' | 'loja' | 'veiculo';

export interface CandidateEntity {
  type: CandidateEntityType;
  value: string;
  confidence: number;             // Grau de certeza 0.0 a 1.0
  sourceContext?: string;         // Contexto de onde foi extraído (ex: " legenda\, \ocr_cabecalho\)
 isUncertain?: boolean; // Sinaliza ambiguidade (ex: 'jorge' vs 'jorginho')
}

export interface VideoTimecode {
 at: string; // Ex: \00:03\ ou \3s\
 observation: string;
 detectedPlate?: string;
 detectedOS?: string;
 timestampSec?: number;
}

export interface VideoTimestampEvidence {
 startSec: number;
 endSec: number;
 description: string;
 detectedPlate?: string;
 detectedOS?: string;
}

export interface FinancialExtractionEvidence {
 label: string;
 value: number;
 unit?: string;
 sourceContext?: string;
}

export type MediaEvidenceStatus = 'ok' | 'partial' | 'unreadable' | 'unsupported' | 'error';

/**
 * Evidência estruturada produzida pelo módulo de análise multimodal
 */
export interface MediaEvidence {
 sourceMessageId?: string;
 kind?: MediaKind;
 transcript?: string; // Fala reconhecida em pt-BR, se houver
 visibleText?: string[]; // OCR/trechos legíveis extraídos
 observations?: string[]; // Fatos visuais descritivos, sem inferir dados do banco
 timecodes?: VideoTimecode[];
 candidateEntities?: CandidateEntity[];
 status?: MediaEvidenceStatus;
 limitations?: string[];

 // Campos de compatibilidade para Agente 2 / MessageBatcher
 evidenceId?: string;
 messageId?: string;
 partId?: string;
 type?: MediaKind;
 transcription?: string; // Alias para transcript
 ocrText?: string; // Alias consolidado de visibleText
 extractedPlates?: string[];
 extractedOSs?: string[];
 extractedFinancialNumbers?: FinancialExtractionEvidence[];
 videoTimestamps?: (VideoTimecode | VideoTimestampEvidence)[];
 confidence?: number;
 sourceDescription?: string;
 discrepancyNote?: string;
 isOutOfScope?: boolean;
 securityNotice?: string;
}

/**
 * Lote agrupado de mensagens da mesma conversa (Encavalamento)
 */
export interface MessageBatchPayload {
 batchId: string;
 conversationKey: string;
 remoteJid?: string;
 messageIds: string[];
 messageJids?: Record<string, string>;
 originalTexts: string[];
 parts: InboundPart[];
 mediaEvidence: MediaEvidence[];
 combinedText: string;
 firstReceivedAt: number;
 lastReceivedAt: number;
 isClosed: boolean;
 isComplement?: boolean;
 supersededBatchId?: string;
}
