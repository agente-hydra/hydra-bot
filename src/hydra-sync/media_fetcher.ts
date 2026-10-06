/**
 * HYDRA MEDIA FETCHER
 * 
 * Aquisição segura e auditada de arquivos de mídia (Áudio, Imagem, Vídeo e Documentos)
 * a partir da Evolution API v2, endpoints HTTP ou buffers diretos.
 * 
 * Regras estritas de segurança:
 * 1. NUNCA registrar base64, URLs assinadas ou chaves de API nos logs.
 * 2. Validação determinística de MIME por Magic Bytes do conteúdo real.
 * 3. Tetos configuráveis de tamanho (15MB áudio/imagem, 25MB vídeo/documento).
 * 4. Isolamento em /tmp/hydra_media com permissões restritas (0700/0600).
 * 5. Limpeza garantida de arquivos temporários via ciclo withTempMedia.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { InboundPart } from './types/multimodal_contract';

export interface FetcherConfig {
  evolutionUrl?: string;
  evolutionKey?: string;
  instanceName?: string;
  tempDir?: string;
  maxAudioSizeBytes?: number;
  maxImageSizeBytes?: number;
  maxVideoSizeBytes?: number;
  maxDocSizeBytes?: number;
  maxVideoDurationSeconds?: number;
  timeoutMs?: number;
}

const DEFAULT_CONFIG: Required<FetcherConfig> = {
  evolutionUrl: process.env.EVOLUTION_INTERNAL_URL || 'http://172.18.0.4:8080',
  evolutionKey: process.env.EVOLUTION_KEY || '',
  instanceName: process.env.EVOLUTION_INSTANCE || 'hydra',
  tempDir: process.env.HYDRA_MEDIA_TEMP_DIR || '/tmp/hydra-media',
  maxAudioSizeBytes: 15 * 1024 * 1024,      // 15 MB
  maxImageSizeBytes: 15 * 1024 * 1024,      // 15 MB
  maxVideoSizeBytes: 25 * 1024 * 1024,      // 25 MB
  maxDocSizeBytes: 25 * 1024 * 1024,        // 25 MB
  maxVideoDurationSeconds: 60,              // 60 segundos
  timeoutMs: 20000                          // 20 segundos
};

export interface FetchedMedia {
  filePath: string;
  mime: string;
  sizeBytes: number;
  durationSeconds?: number;
  fileName?: string;
  source: 'evolution' | 'chatwoot' | 'direct' | 'url';
}

export type FetchErrorCode = 
  | 'DOWNLOAD_FAILED'
  | 'SIZE_EXCEEDED'
  | 'DURATION_EXCEEDED'
  | 'CORRUPTED'
  | 'MIME_MISMATCH'
  | 'EXPIRED'
  | 'UNSUPPORTED'
  | 'NO_MEDIA';

export type FetchMediaResult = 
  | { success: true; media: FetchedMedia }
  | { success: false; errorCode: FetchErrorCode; errorMessage: string };

/**
 * Validação de Magic Bytes determinística
 */
export function detectMimeByMagicBytes(buf: Buffer): string | null {
  if (!buf || buf.length < 4) return null;

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png';
  }

  // GIF: GIF87a ou GIF89a
  if (buf.subarray(0, 3).toString('ascii') === 'GIF') {
    return 'image/gif';
  }

  // WebP: RIFF....WEBP
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }

  // PDF: %PDF
  if (buf.subarray(0, 4).toString('ascii') === '%PDF') {
    return 'application/pdf';
  }

  // Ogg / Opus: OggS
  if (buf.subarray(0, 4).toString('ascii') === 'OggS') {
    return 'audio/ogg';
  }

  // WAV: RIFF....WAVE
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WAVE') {
    return 'audio/wav';
  }

  // MP3: ID3 ou frame sync 0xFF 0xFB/F3/F2
  if (buf.subarray(0, 3).toString('ascii') === 'ID3') {
    return 'audio/mpeg';
  }
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) {
    return 'audio/mpeg';
  }

  // MP4 / M4A / QuickTime: ftyp box no início
  if (buf.length >= 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp') {
    const majorBrand = buf.subarray(8, 12).toString('ascii');
    if (majorBrand.startsWith('M4A') || majorBrand.startsWith('mp42') || majorBrand.startsWith('isom')) {
      return 'video/mp4';
    }
    return 'video/mp4';
  }

  // Arquivos de texto UTF-8 válidos (CSV / TXT)
  const isAsciiText = buf.subarray(0, Math.min(buf.length, 512)).every(b => b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126));
  if (isAsciiText) {
    return 'text/plain';
  }

  return null;
}

/**
 * Determina extensão apropriada a partir do MIME
 */
export function getExtensionForMime(mime: string): string {
  const clean = mime.toLowerCase().split(';')[0].trim();
  switch (clean) {
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'image/gif': return 'gif';
    case 'audio/ogg': return 'oga';
    case 'audio/mpeg': return 'mp3';
    case 'audio/wav': return 'wav';
    case 'audio/mp4': return 'm4a';
    case 'video/mp4': return 'mp4';
    case 'video/quicktime': return 'mov';
    case 'application/pdf': return 'pdf';
    case 'text/plain': return 'txt';
    case 'text/csv': return 'csv';
    default: return 'bin';
  }
}

/**
 * Garante existência do diretório temporário restrito (modo 0700)
 */
export function ensureSecureTempDir(dirPath: string): void {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
    } else {
      fs.chmodSync(dirPath, 0o700);
    }
  } catch (err: any) {
    console.warn('[MediaFetcher] Aviso ao criar pasta temporária segura:', err?.message || err);
  }
}

/**
 * Limpa arquivo temporário com segurança
 */
export function cleanupTempFile(filePath?: string): void {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err: any) {
    console.warn(`[MediaFetcher] Falha ao deletar arquivo temporário ${filePath}:`, err?.message || err);
  }
}

/**
 * Classe principal de aquisição segura
 */
export class MediaFetcher {
  private config: Required<FetcherConfig>;

  constructor(customConfig?: FetcherConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...customConfig
    };
    ensureSecureTempDir(this.config.tempDir);
  }

  /**
   * Baixa a mídia referenciada em InboundPart com verificação completa de sanidade
   */
  public async fetch(part: InboundPart): Promise<FetchMediaResult> {
    if (part.kind === 'text') {
      return { success: false, errorCode: 'NO_MEDIA', errorMessage: 'Mensagem é texto puro sem mídia anexa' };
    }

    if (part.kind === 'unsupported') {
      return { success: false, errorCode: 'UNSUPPORTED', errorMessage: 'Tipo de mensagem não suportado para download' };
    }

    // Validação de duração declarada para vídeos
    if (part.kind === 'video' && part.mediaRef?.durationSeconds) {
      if (part.mediaRef.durationSeconds > this.config.maxVideoDurationSeconds) {
        return {
          success: false,
          errorCode: 'DURATION_EXCEEDED',
          errorMessage: `Duração do vídeo (${part.mediaRef.durationSeconds}s) excede o limite máximo permitido de ${this.config.maxVideoDurationSeconds}s`
        };
      }
    }

    // 1. Caso de teste ou buffer direto injetado
    if (part.rawPayloadRef?.directBuffer instanceof Buffer) {
      return this.saveBufferToSecureTemp(part.rawPayloadRef.directBuffer, part.mediaRef?.mime || 'application/octet-stream', part);
    }

    // 2. Download via Evolution API v2 (getBase64FromMediaMessage)
    try {
      const evolutionBuffer = await this.fetchFromEvolution(part);
      if (evolutionBuffer) {
        return this.saveBufferToSecureTemp(evolutionBuffer, part.mediaRef?.mime || 'application/octet-stream', part);
      }
    } catch (evoErr: any) {
      console.warn(`[MediaFetcher] Falha ao recuperar mídia via Evolution API: ${evoErr?.message || evoErr}`);
    }

    // 3. Fallback de URL pública/assinada se fornecida
    if (part.mediaRef?.mediaUrl && part.mediaRef.mediaUrl.startsWith('http')) {
      try {
        const urlBuffer = await this.fetchFromHttpUrl(part.mediaRef.mediaUrl);
        return this.saveBufferToSecureTemp(urlBuffer, part.mediaRef.mime, part);
      } catch (urlErr: any) {
        return {
          success: false,
          errorCode: 'DOWNLOAD_FAILED',
          errorMessage: `Não consegui abrir este arquivo da URL remota: ${urlErr?.message || urlErr}`
        };
      }
    }

    return {
      success: false,
      errorCode: 'DOWNLOAD_FAILED',
      errorMessage: 'Não consegui abrir este arquivo. O download ou a decodificação da mídia falhou no transporte.'
    };
  }

  /**
   * Executa requisição autenticada ao getBase64FromMediaMessage da Evolution API v2
   */
  private async fetchFromEvolution(part: InboundPart): Promise<Buffer | null> {
    const rawData = part.rawPayloadRef;
    if (!rawData) return null;

    const urlsToTry = [
      this.config.evolutionUrl,
      'http://172.18.0.4:8080',
      'https://evo.tork.services'
    ];

    const messageData = rawData.message ? rawData : { message: rawData };
    const requestBody = JSON.stringify({
      message: messageData,
      convertToMp4: false
    });

    let lastError: any = null;

    for (const baseUrl of urlsToTry) {
      if (!baseUrl) continue;
      const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/getBase64FromMediaMessage/${this.config.instanceName}`;

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': this.config.evolutionKey,
            'User-Agent': 'Hydra-Multimodal-Fetcher/1.0'
          },
          body: requestBody,
          signal: AbortSignal.timeout(this.config.timeoutMs)
        });

        if (!response.ok) {
          lastError = new Error(`HTTP ${response.status} de ${endpoint}`);
          continue;
        }

        const data: any = await response.json();
        const base64Data = data?.base64 || data?.data?.base64;

        if (typeof base64Data === 'string' && base64Data.length > 0) {
          return Buffer.from(base64Data, 'base64');
        }
      } catch (err: any) {
        lastError = err;
      }
    }

    if (lastError) {
      throw lastError;
    }
    return null;
  }

  /**
   * Baixa arquivo via HTTP/HTTPS direto com timeout e restrição de tamanho
   */
  private async fetchFromHttpUrl(url: string): Promise<Buffer> {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Hydra-Multimodal-Fetcher/1.0' },
      signal: AbortSignal.timeout(this.config.timeoutMs)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ao baixar arquivo`);
    }

    const arrayBuf = await response.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  /**
   * Salva buffer em arquivo temporário com permissões seguras (0600) e valida limites
   */
  private saveBufferToSecureTemp(buf: Buffer, claimedMime: string, part: InboundPart): FetchMediaResult {
    // 1. Verificação de tamanho zero ou corrupção
    if (!buf || buf.length === 0) {
      return {
        success: false,
        errorCode: 'CORRUPTED',
        errorMessage: 'Não consegui abrir este arquivo: arquivo corrompido com 0 bytes'
      };
    }

    const sizeBytes = buf.length;

    // 2. Verificação de teto de tamanho por categoria
    let maxSize = this.config.maxAudioSizeBytes;
    if (part.kind === 'image') maxSize = this.config.maxImageSizeBytes;
    if (part.kind === 'video') maxSize = this.config.maxVideoSizeBytes;
    if (part.kind === 'document') maxSize = this.config.maxDocSizeBytes;

    if (sizeBytes > maxSize) {
      const maxMb = Math.round(maxSize / (1024 * 1024));
      const currentMb = (sizeBytes / (1024 * 1024)).toFixed(1);
      return {
        success: false,
        errorCode: 'SIZE_EXCEEDED',
        errorMessage: `Tamanho do arquivo (${currentMb}MB) excede o limite operacional de ${maxMb}MB`
      };
    }

    // 3. Validação de Magic Bytes
    const detectedMime = detectMimeByMagicBytes(buf);
    const finalMime = detectedMime || claimedMime || 'application/octet-stream';

    // Se detectou um formato binário executável ou MIME incompatível crítico
    if (detectedMime && claimedMime && !claimedMime.includes('octet-stream')) {
      const baseDetected = detectedMime.split('/')[0];
      const baseClaimed = claimedMime.split('/')[0];
      // Exemplo: declarou imagem mas o conteúdo é executável ou texto HTML de erro 403
      if (baseDetected !== baseClaimed && !detectedMime.includes('text') && !claimedMime.includes('text')) {
        return {
          success: false,
          errorCode: 'MIME_MISMATCH',
          errorMessage: `MIME incompatível: declarado ${claimedMime}, mas detectado ${detectedMime}`
        };
      }
    }

    // 4. Gravação segura em arquivo temporário com nome aleatório e chmod 0600
    ensureSecureTempDir(this.config.tempDir);
    const ext = getExtensionForMime(finalMime);
    const randHex = crypto.randomBytes(8).toString('hex');
    const safeFileName = `hydra_${part.kind}_${randHex}_${Date.now()}.${ext}`;
    const targetFilePath = path.join(this.config.tempDir, safeFileName);

    try {
      fs.writeFileSync(targetFilePath, buf, { mode: 0o600 });
      // Assegura permissão de arquivo somente para o usuário atual
      fs.chmodSync(targetFilePath, 0o600);
    } catch (writeErr: any) {
      return {
        success: false,
        errorCode: 'DOWNLOAD_FAILED',
        errorMessage: `Falha ao gravar arquivo temporário seguro: ${writeErr?.message || writeErr}`
      };
    }

    const fetchedMedia: FetchedMedia = {
      filePath: targetFilePath,
      mime: finalMime,
      sizeBytes,
      durationSeconds: part.durationSeconds,
      fileName: part.fileName || safeFileName,
      source: 'evolution'
    };

    return {
      success: true,
      media: fetchedMedia
    };
  }

  /**
   * Padrão RAII seguro: adquire mídia, executa callback de análise e garante limpeza em finally
   */
  public async withTempMedia<T>(
    part: InboundPart,
    callback: (result: FetchMediaResult) => Promise<T>
  ): Promise<T> {
    const fetchResult = await this.fetch(part);
    try {
      return await callback(fetchResult);
    } finally {
      if (fetchResult.success && fetchResult.media.filePath) {
        cleanupTempFile(fetchResult.media.filePath);
      }
    }
  }
}
