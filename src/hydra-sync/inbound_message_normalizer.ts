/**
 * HYDRA INBOUND MESSAGE NORMALIZER
 * 
 * Normaliza eventos brutos de webhook (Evolution API v2 e Chatwoot)
 * para o contrato padronizado InboundPart.
 * 
 * Responsabilidades:
 * 1. Desempacotar wrappers do WhatsApp/Baileys (ephemeralMessage, viewOnceMessage, etc.)
 * 2. Mapear tipos: text, audio, image, video, document, unsupported
 * 3. Extrair referências de mídia (mime, tamanho, duração, filename)
 * 4. Extrair contexto de resposta citada (quotedMessageId)
 * 5. Identificar remetente e conversa de forma opaca e isolada
 */

import { InboundPart, MediaKind, InboundMediaRef } from './types/multimodal_contract';

/**
 * Desempacota recursivamente wrappers de mensagens do WhatsApp
 */
export function unwrapInnerMessage(rawMessage: any): { type: string; message: any } {
  if (!rawMessage || typeof rawMessage !== 'object') {
    return { type: 'unknown', message: {} };
  }

  let current = rawMessage;

  // Desempacota camadas de wrappers comuns
  while (current) {
    if (current.ephemeralMessage?.message) {
      current = current.ephemeralMessage.message;
    } else if (current.viewOnceMessage?.message) {
      current = current.viewOnceMessage.message;
    } else if (current.viewOnceMessageV2?.message) {
      current = current.viewOnceMessageV2.message;
    } else if (current.documentWithCaptionMessage?.message) {
      current = current.documentWithCaptionMessage.message;
    } else {
      break;
    }
  }

  // Detecta a chave do tipo de mensagem interna
  const keys = Object.keys(current);
  const recognizedTypes = [
    'conversation',
    'extendedTextMessage',
    'audioMessage',
    'imageMessage',
    'videoMessage',
    'documentMessage',
    'stickerMessage',
    'contactMessage',
    'contactsArrayMessage',
    'locationMessage',
    'liveLocationMessage',
    'pollCreationMessage',
    'reactionMessage'
  ];

  for (const t of recognizedTypes) {
    if (t in current) {
      return { type: t, message: current };
    }
  }

  // Se tem apenas uma chave ou chave arbitrária
  const firstKey = keys[0] || 'unknown';
  return { type: firstKey, message: current };
}

/**
 * Normaliza um evento bruto de webhook em uma InboundPart padronizada
 */
export function normalizeInboundMessage(rawPayload: any): InboundPart | null {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return null;
  }

  // 1. Filtragem de mensagens de saída (fromMe) e atualizações de status
  if (
    rawPayload?.data?.key?.fromMe === true ||
    rawPayload?.message_type === 'outgoing' ||
    rawPayload?.event === 'messages.update' ||
    rawPayload?.data?.status
  ) {
    return null;
  }

  // 2. Extração de Identificadores (Evolution v2 ou Chatwoot)
  const rawKey = rawPayload?.data?.key;
  const rawMessageId = rawKey?.id || rawPayload?.id || rawPayload?.message_id;
  const rawRemoteJid = String(
    rawKey?.remoteJid ||
    rawPayload?.sender?.phone_number ||
    rawPayload?.sender ||
    rawPayload?.phone ||
    ''
  ).trim();

  const isLid = rawRemoteJid.includes('@lid');

  // Extração de telefone e identificadores limpos
  let phone = '';
  if (isLid) {
    const candidatePhone =
      rawKey?.participantPn ||
      rawPayload?.data?.participantPn ||
      rawPayload?.sender?.phone_number ||
      rawPayload?.sender ||
      '';
    phone = String(candidatePhone).replace(/\D/g, '');
    if (!phone) {
      phone = rawRemoteJid.replace('@lid', '').replace(/\D/g, '');
    }
  } else {
    phone = rawRemoteJid.replace('@s.whatsapp.net', '').replace(/\D/g, '');
  }

  // conversationKey: mantém remoteJid limpo, LID limpo ou telefone
  const conversationKey = isLid
    ? rawRemoteJid.replace('@lid', '').trim()
    : (rawRemoteJid.replace('@s.whatsapp.net', '').trim() || phone || 'default_conversation');

  const messageId = String(rawMessageId || `${conversationKey}_${Date.now()}`);
  const pushName = rawPayload?.data?.pushName || rawPayload?.pushName || rawPayload?.sender?.name;

  const metadata: Record<string, any> = {
    remoteJid: rawRemoteJid,
    isLid,
    phone,
    pushName,
    instance: rawPayload?.instance,
    event: rawPayload?.event,
    sender: rawPayload?.data?.sender || rawPayload?.sender,
    participant: rawKey?.participant || rawPayload?.data?.participant,
    source: rawPayload?.data ? 'evolution' : (rawPayload?.content !== undefined ? 'chatwoot' : 'direct')
  };

  // Timestamp ISO
  let receivedAt = new Date().toISOString();
  const rawTs = rawPayload?.data?.messageTimestamp || rawPayload?.created_at;
  if (rawTs) {
    const tsNum = typeof rawTs === 'string' ? Number(rawTs) : rawTs;
    if (!isNaN(tsNum)) {
      // Se estiver em segundos (Unix), multiplica por 1000
      const millis = tsNum < 1e11 ? tsNum * 1000 : tsNum;
      receivedAt = new Date(millis).toISOString();
    } else {
      try {
        receivedAt = new Date(rawTs).toISOString();
      } catch {}
    }
  }

  // 3. Suporte a payload Chatwoot/Simples (content direto)
  if (rawPayload.content !== undefined && !rawPayload.data) {
    const textContent = String(rawPayload.content || '').trim();
    return {
      messageId,
      conversationKey,
      remoteJid: rawRemoteJid,
      phone,
      isLid,
      pushName,
      metadata,
      receivedAt,
      kind: 'text',
      text: textContent || undefined,
      partId: `part_${messageId}`,
      type: 'text',
      timestamp: Date.now()
    };
  }

  // 4. Desempacota payload da Evolution API v2 (Baileys)
  const rootMessage = rawPayload?.data?.message;
  if (!rootMessage) {
    // Pode ser evento sem mensagem ou unsupported
    return null;
  }

  const { type: innerType, message: innerMsg } = unwrapInnerMessage(rootMessage);

  // Extração de mensagem citada (quotedMessage)
  let quotedMessageId: string | undefined = undefined;
  const contextInfo =
    innerMsg?.extendedTextMessage?.contextInfo ||
    innerMsg?.imageMessage?.contextInfo ||
    innerMsg?.audioMessage?.contextInfo ||
    innerMsg?.videoMessage?.contextInfo ||
    innerMsg?.documentMessage?.contextInfo ||
    rootMessage?.extendedTextMessage?.contextInfo;

  if (contextInfo?.stanzaId) {
    quotedMessageId = String(contextInfo.stanzaId);
  }

  // 5. Mapeamento por Kind
  let kind: MediaKind = 'unsupported';
  let text: string | undefined = undefined;
  let mediaRef: InboundMediaRef | undefined = undefined;
  let fileName: string | undefined = undefined;
  let durationSeconds: number | undefined = undefined;

  switch (innerType) {
    case 'conversation': {
      kind = 'text';
      text = String(innerMsg.conversation || '').trim() || undefined;
      break;
    }

    case 'extendedTextMessage': {
      kind = 'text';
      text = String(innerMsg.extendedTextMessage?.text || '').trim() || undefined;
      break;
    }

    case 'audioMessage': {
      kind = 'audio';
      const audio = innerMsg.audioMessage;
      durationSeconds = audio?.seconds ? Number(audio.seconds) : undefined;
      mediaRef = {
        mime: audio?.mimetype || 'audio/ogg; codecs=opus',
        sizeBytes: audio?.fileLength ? Number(audio.fileLength) : undefined,
        source: 'evolution',
        durationSeconds
      };
      break;
    }

    case 'imageMessage': {
      kind = 'image';
      const img = innerMsg.imageMessage;
      text = img?.caption ? String(img.caption).trim() : undefined;
      mediaRef = {
        mime: img?.mimetype || 'image/jpeg',
        sizeBytes: img?.fileLength ? Number(img.fileLength) : undefined,
        source: 'evolution'
      };
      break;
    }

    case 'videoMessage': {
      kind = 'video';
      const vid = innerMsg.videoMessage;
      text = vid?.caption ? String(vid.caption).trim() : undefined;
      durationSeconds = vid?.seconds ? Number(vid.seconds) : undefined;
      mediaRef = {
        mime: vid?.mimetype || 'video/mp4',
        sizeBytes: vid?.fileLength ? Number(vid.fileLength) : undefined,
        source: 'evolution',
        durationSeconds
      };
      break;
    }

    case 'documentMessage': {
      kind = 'document';
      const doc = innerMsg.documentMessage;
      fileName = doc?.fileName ? String(doc.fileName) : undefined;
      text = doc?.caption ? String(doc.caption).trim() : fileName;
      mediaRef = {
        mime: doc?.mimetype || 'application/pdf',
        sizeBytes: doc?.fileLength ? Number(doc.fileLength) : undefined,
        source: 'evolution',
        fileName
      };
      break;
    }

    default: {
      // Stickers, localizações, contatos, reações são marcados como unsupported
      kind = 'unsupported';
      text = undefined;
      break;
    }
  }

  const inboundPart: InboundPart = {
    messageId,
    conversationKey,
    remoteJid: rawRemoteJid,
    phone,
    isLid,
    pushName,
    metadata,
    receivedAt,
    kind,
    text,
    quotedMessageId,
    mediaRef,

    // Compatibilidade com Agente 2
    partId: `part_${messageId}`,
    type: kind,
    fileName,
    durationSeconds,
    fileSize: mediaRef?.sizeBytes,
    mimeType: mediaRef?.mime,
    timestamp: Date.now(),
    rawPayloadRef: rawPayload?.data // Referência opaca em memória para download
  };

  return inboundPart;
}

/**
 * Verifica se a parte contém mídia que precisa de análise sensorial
 */
export function isMultimodalKind(kind: MediaKind): boolean {
  return kind === 'audio' || kind === 'image' || kind === 'video' || kind === 'document';
}
