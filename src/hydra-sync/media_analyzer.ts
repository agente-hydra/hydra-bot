/**
 * HYDRA MEDIA ANALYZER
 * 
 * Percepção multimodal e extração de evidências estruturadas para o Hydra:
 * - Áudio: Transcrição em pt-BR via Whisper (base/tiny), extração de entidades (OS, placas, lojas, valores, negações)
 * - Imagem/Print: OCR via Tesseract (por+eng), descrição visual, extração de OS/placas/metas
 * - Vídeo: Extração de áudio + amostragem de quadros com timecodes (VideoTimecode[]) via FFmpeg + OCR
 * - Documentos (PDF): Extração com preservação de layout/tabelas via pdftotext
 * - Defesa ativa contra Prompt Injection: instruções adversariais em mídias são marcadas e neutralizadas
 * - Isolamento operacional: nunca substitui os dados oficiais do banco por valores do anexo sem auditoria
 */

import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  InboundPart,
  MediaEvidence,
  CandidateEntity,
  VideoTimecode,
  FinancialExtractionEvidence
} from './types/multimodal_contract';
import { FetchedMedia, MediaFetcher, FetcherConfig, cleanupTempFile } from './media_fetcher';
import { normalizeInboundMessage, isMultimodalKind } from './inbound_message_normalizer';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PYTHON_TRANSCRIBE_SCRIPT = fs.existsSync(path.resolve(__dirname, 'scripts/transcribe_audio.py'))
  ? path.resolve(__dirname, 'scripts/transcribe_audio.py')
  : (fs.existsSync('/home/operacional/hydra-multimodal/src/hydra-sync/scripts/transcribe_audio.py')
    ? '/home/operacional/hydra-multimodal/src/hydra-sync/scripts/transcribe_audio.py'
    : '/opt/bots/src/hydra-sync/scripts/transcribe_audio.py');

export interface AnalyzerConfig extends FetcherConfig {
  audioTranscriber?: (filePath: string) => Promise<{ transcript: string; error?: string }>;
}

// Catálogo de lojas conhecidas da rede Hydra para reconciliação
const STORE_CATALOG: Array<{ slug: string; aliases: string[]; canonicalName: string }> = [
  { slug: 'MPSantoAndre', aliases: ['santo andré', 'santo andre', 'sto andre', 'sto andré'], canonicalName: 'Santo André' },
  { slug: 'MPJorgeBeretta', aliases: ['jorge beretta', 'jorge'], canonicalName: 'Jorge Beretta' },
  { slug: 'MPJorgeBeretta', aliases: ['jorginho'], canonicalName: 'Jorge Beretta (Ambiguidade: Loja ou Profissional)' },
  { slug: 'MPMaster', aliases: ['master'], canonicalName: 'Master' },
  { slug: 'MPJabaquara', aliases: ['jabaquara'], canonicalName: 'Jabaquara' },
  { slug: 'MPdompedro1', aliases: ['dom pedro 1', 'dom pedro i', 'dom pedro', 'd. pedro'], canonicalName: 'Dom Pedro' },
  { slug: 'MPkennedy', aliases: ['kennedy'], canonicalName: 'Kennedy' },
  { slug: 'MPpiraporinha', aliases: ['piraporinha'], canonicalName: 'Piraporinha' },
  { slug: 'MPplanalto', aliases: ['planalto'], canonicalName: 'Planalto' },
  { slug: 'MPrudge', aliases: ['rudge ramos', 'rudge'], canonicalName: 'Rudge Ramos' },
  { slug: 'ReiDoModulo', aliases: ['rei do módulo', 'rei do modulo', 'modulo', 'módulo'], canonicalName: 'Rei do Módulo' },
  { slug: 'ReiDoOleoMaua', aliases: ['rei do óleo mauá', 'rei do oleo maua', 'rei do oleo', 'rei do óleo', 'mauá', 'maua'], canonicalName: 'Rei do Óleo Mauá' }
];

// Padrões de detecção de injeção de prompt / instruções adversariais
const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(?:previous|all|as|todas\s+as)\s+(?:instructions|instru[çc][õo]es|diretrizes)/i,
  /ignore\s+o\s+sistema/i,
  /voc[êe]\s+agora\s+[ée]\s+(?:um|uma)/i,
  /mande\s+(?:dados|todas\s+as\s+senhas|clientes|tabelas)/i,
  /(?:drop|truncate)\s+table/i,
  /delete\s+from\s+[a-z_]+/i,
  /mostre\s+(?:a\s+chave|senhas|tokens|secrets)/i,
  /system\s+prompt/i
];

/**
 * Executa comando child_process de forma assíncrona protegida
 */
function execPromise(file: string, args: string[], options: { timeout?: number; maxBuffer?: number } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: options.timeout || 30000,
        maxBuffer: options.maxBuffer || 10 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stdout, stderr }));
        } else {
          resolve({ stdout: String(stdout), stderr: String(stderr) });
        }
      }
    );
  });
}

/**
 * Extrai placas automotivas padrão Brasil (Mercosul e Tradicional)
 */
export function extractPlates(text: string): CandidateEntity[] {
  if (!text) return [];
  const entities: CandidateEntity[] = [];
  const seen = new Set<string>();

  // 1. Mercosul: 3 letras, 1 número, 1 letra, 2 números (ex: BRA2E19)
  const mercosulRegex = /\b([A-Z]{3}[0-9][A-Z0-9][0-9]{2})\b/gi;
  let match: RegExpExecArray | null;
  while ((match = mercosulRegex.exec(text)) !== null) {
    const rawVal = match[1].toUpperCase();
    if (!seen.has(rawVal)) {
      seen.add(rawVal);
      entities.push({
        type: 'placa',
        value: rawVal,
        confidence: 0.95,
        sourceContext: `Padrão Mercosul identificado: ${rawVal}`
      });
    }
  }

  // 2. Tradicional: 3 letras, traço opcional, 4 números (ex: ABC-1234, ABC1234)
  const standardRegex = /\b([A-Z]{3})[- ]?([0-9]{4})\b/gi;
  while ((match = standardRegex.exec(text)) !== null) {
    const rawVal = `${match[1].toUpperCase()}-${match[2]}`;
    if (!seen.has(rawVal)) {
      seen.add(rawVal);
      entities.push({
        type: 'placa',
        value: rawVal,
        confidence: 0.95,
        sourceContext: `Padrão Brasileiro tradicional identificado: ${rawVal}`
      });
    }
  }

  return entities;
}

/**
 * Extrai números de Ordens de Serviço
 */
export function extractOSNumbers(text: string): CandidateEntity[] {
  if (!text) return [];
  const entities: CandidateEntity[] = [];
  const seen = new Set<string>();

  const explicitRegex = /(?:O\.?S\.?|ordem\s+de\s+servi[çc]o|servi[çc]o|n[úu]mero|num)\s*[:#.-]?\s*([0-9]{3,7})\b/gi;
  let match: RegExpExecArray | null;
  while ((match = explicitRegex.exec(text)) !== null) {
    const osNum = match[1];
    if (!seen.has(osNum)) {
      seen.add(osNum);
      entities.push({
        type: 'os',
        value: osNum,
        confidence: 0.9,
        sourceContext: `Referência explícita a OS: ${osNum}`
      });
    }
  }

  return entities;
}

export function normalizarTexto(txt: string): string {
  return (txt || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Extrai lojas mencionadas e trata ambiguidades ("jorge" vs "jorginho")
 */
export function extractStoreEntities(text: string): CandidateEntity[] {
  if (!text) return [];
  const norm = normalizarTexto(text);
  const entities: CandidateEntity[] = [];
  const seenSlugs = new Set<string>();

  if (norm.includes('da rede') || norm.includes('na rede') || norm.includes('das lojas') || norm.includes('todas as lojas')) {
    entities.push({
      type: 'loja',
      value: 'REDE',
      confidence: 0.98,
      sourceContext: 'Consulta global de rede solicitada'
    });
    seenSlugs.add('REDE');
  }

  for (const store of STORE_CATALOG) {
    for (const alias of store.aliases) {
      const normAlias = normalizarTexto(alias);
      const regex = new RegExp(`\\b${normAlias.replace(/\\s+/g, '\\s+')}\\b`, 'i');
      if (regex.test(norm)) {
        const isJorginho = alias === 'jorginho';
        if (!seenSlugs.has(store.slug)) {
          seenSlugs.add(store.slug);
          entities.push({
            type: 'loja',
            value: store.slug,
            confidence: isJorginho ? 0.65 : 0.92,
            sourceContext: `Loja reconhecida pelo termo "${alias}" (${store.canonicalName})`,
            isUncertain: isJorginho
          });
        }
        break;
      }
    }
  }

  return entities;
}

/**
 * Extrai valores monetários e financeiros
 */
export function extractFinancialValues(text: string): FinancialExtractionEvidence[] {
  if (!text) return [];
  const items: FinancialExtractionEvidence[] = [];

  const moneyRegex = /R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})?|[0-9]+(?:,[0-9]{2})?)/gi;
  let match: RegExpExecArray | null;
  while ((match = moneyRegex.exec(text)) !== null) {
    const rawVal = match[1].replace(/\./g, '').replace(',', '.');
    const num = parseFloat(rawVal);
    if (!isNaN(num)) {
      items.push({
        label: 'Valor Monetário',
        value: num,
        unit: 'BRL',
        sourceContext: match[0]
      });
    }
  }

  const metaRegex = /(meta|realizado|faturamento|cmv|ticket\s+m[ée]dio)\s*[:=-]?\s*(?:R\$\s*)?([0-9]+(?:[.,][0-9]{2})?)/gi;
  while ((match = metaRegex.exec(text)) !== null) {
    const label = match[1];
    const val = parseFloat(match[2].replace(',', '.'));
    if (!isNaN(val)) {
      items.push({
        label: label.toUpperCase(),
        value: val,
        unit: 'BRL',
        sourceContext: match[0]
      });
    }
  }

  return items;
}

/**
 * Sanitiza e verifica proteção contra Prompt Injection em textos extraídos
 */
export function sanitizeAndInspectInjection(text: string): { cleanText: string; securityNotice?: string; wasInjected: boolean } {
  if (!text) return { cleanText: '', wasInjected: false };

  let wasInjected = false;
  let cleanText = text;

  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(cleanText)) {
      wasInjected = true;
      cleanText = cleanText.replace(pattern, '[CONTEÚDO ADVERSARIAL REMOVIDO]');
    }
  }

  if (wasInjected) {
    return {
      cleanText,
      wasInjected: true,
      securityNotice: '[Segurança] Instruções de prompt injection ou quebra de escopo detectadas e neutralizadas. A operação continua estritamente limitada ao escopo automotivo da rede.'
    };
  }

  return { cleanText, wasInjected: false };
}

/**
 * Classe principal de análise multimodal
 */
export class MediaAnalyzer {
  private config: AnalyzerConfig;
  private fetcher: MediaFetcher;

  constructor(customConfig?: AnalyzerConfig) {
    this.config = customConfig || {};
    this.fetcher = new MediaFetcher(customConfig);
  }

  /**
   * Processa mídia a partir de InboundPart e arquivo baixado
   */
  public async analyze(part: InboundPart, media: FetchedMedia): Promise<MediaEvidence> {
    switch (part.kind) {
      case 'audio':
        return this.analyzeAudio(part, media);
      case 'image':
        return this.analyzeImage(part, media);
      case 'video':
        return this.analyzeVideo(part, media);
      case 'document':
        return this.analyzeDocument(part, media);
      default:
        return {
          sourceMessageId: part.messageId,
          kind: part.kind,
          status: 'unsupported',
          limitations: [`Tipo de mídia '${part.kind}' não suportado para análise sensorial.`]
        };
    }
  }

  /**
   * 1. Áudio: Transcrição Whisper pt-BR + Extração de OS, placas, lojas, CMV e negações
   */
  public async analyzeAudio(part: InboundPart, media: FetchedMedia): Promise<MediaEvidence> {
    const evidenceId = `ev_audio_${part.messageId}`;
    try {
      let result: any = {};

      if (this.config.audioTranscriber) {
        result = await this.config.audioTranscriber(media.filePath);
      } else {
        const { stdout } = await execPromise('python3', [
          PYTHON_TRANSCRIBE_SCRIPT,
          media.filePath,
          'base'
        ], { timeout: 120000 });

        try {
          result = JSON.parse(stdout.trim());
        } catch {
          result = { transcript: '', error: 'Falha ao decodificar resposta do Whisper' };
        }
      }

      const rawTranscript = (result.transcript || '').trim();

      // Caso 1: Áudio sem fala inteligível, silêncio ou ruído puro
      if (!rawTranscript || rawTranscript.length < 2 || rawTranscript === '[música]' || rawTranscript === '[ruído]') {
        return {
          sourceMessageId: part.messageId,
          kind: 'audio',
          evidenceId,
          status: 'unreadable',
          observations: ['Áudio sem fala inteligível, silêncio ou apenas ruído de fundo'],
          limitations: ['Áudio sem fala inteligível. Não foi possível identificar comandos de voz no áudio. Favor enviar mensagem de texto ou regravar com menos ruído.'],
          candidateEntities: [] // NÃO cria pedido genérico de OS para silêncio
        };
      }

      // Caso 2: Fala reconhecida com sucesso
      const { cleanText, securityNotice, wasInjected } = sanitizeAndInspectInjection(rawTranscript);

      const plates = extractPlates(cleanText);
      const oss = extractOSNumbers(cleanText);
      const stores = extractStoreEntities(cleanText);
      const financial = extractFinancialValues(cleanText);

      const allEntities = [...plates, ...oss, ...stores];
      const observations: string[] = [`Áudio transcrito em português com ${cleanText.length} caracteres.`];
      const limitations: string[] = [];

      // Tratamento de negação/correção explícita no áudio
      const lower = cleanText.toLowerCase();
      if (lower.includes('não da ') || lower.includes('nao da ') || lower.includes('não, ') || lower.includes('esquece ')) {
        observations.push('Detectada correção ou negação explícita no comando de áudio.');
      }

      // Identifica ambiguidade de loja ("jorginho")
      const uncertainStore = stores.find(s => s.isUncertain);
      if (uncertainStore) {
        limitations.push('Menção a "Jorginho" pode se referir à unidade Jorge Beretta ou a um funcionário. Requer confirmação se a consulta depender da loja.');
      }

      if (wasInjected && securityNotice) {
        limitations.push(securityNotice);
      }

      const status = uncertainStore ? 'partial' : 'ok';

      return {
        sourceMessageId: part.messageId,
        kind: 'audio',
        evidenceId,
        status,
        transcript: cleanText,
        transcription: cleanText,
        candidateEntities: allEntities,
        observations,
        limitations: limitations.length > 0 ? limitations : undefined,
        extractedPlates: plates.map(p => p.value),
        extractedOSs: oss.map(o => o.value),
        extractedFinancialNumbers: financial,
        confidence: uncertainStore ? 0.75 : 0.95,
        securityNotice
      };
    } catch (err: any) {
      return {
        sourceMessageId: part.messageId,
        kind: 'audio',
        evidenceId,
        status: 'unreadable',
        observations: ['Áudio sem fala inteligível, silêncio ou apenas ruído de fundo'],
        limitations: ['Áudio sem fala inteligível. Não foi possível identificar comandos de voz no áudio. Favor enviar mensagem de texto ou regravar com menos ruído.'],
        candidateEntities: [] // NÃO cria pedido genérico de OS para silêncio ou erro
      };
    }
  }

  /**
   * 2. Imagem/Print: OCR via Tesseract (por+eng) + descrição visual + separação visto vs oficial
   */
  public async analyzeImage(part: InboundPart, media: FetchedMedia): Promise<MediaEvidence> {
    const evidenceId = `ev_img_${part.messageId}`;
    try {
      const { stdout } = await execPromise('tesseract', [
        media.filePath,
        'stdout',
        '-l', 'por+eng'
      ], { timeout: 25000 });

      const rawText = stdout || '';
      const visibleLines = rawText
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0);

      // Verificação de legibilidade: menos de 5 caracteres e sem legenda
      if (visibleLines.length === 0 || rawText.trim().length < 5) {
        return {
          sourceMessageId: part.messageId,
          kind: 'image',
          evidenceId,
          status: 'unreadable',
          observations: ['Imagem com resolução insuficiente, muito desfocada ou sem texto legível identificável.'],
          limitations: ['Não foi possível extrair dados operacionais legíveis da imagem. Envie o número da OS ou a placa por texto.']
        };
      }

      const fullText = visibleLines.join(' ');
      const { cleanText, securityNotice, wasInjected } = sanitizeAndInspectInjection(fullText);

      const plates = extractPlates(cleanText);
      const oss = extractOSNumbers(cleanText);
      const stores = extractStoreEntities(cleanText);
      const financial = extractFinancialValues(cleanText);

      const allEntities = [...plates, ...oss, ...stores];
      const observations: string[] = [];
      const limitations: string[] = [];

      // Categorização do tipo de imagem com base nos termos vistos
      const normText = normalizarTexto(cleanText);
      if (normText.includes('ordem de servico') || normText.includes('checklist') || normText.includes('pecas') || normText.includes('servicos') || oss.length > 0) {
        observations.push('Ficha impressa ou digital de Ordem de Serviço / Checklist com itens e cabeçalho.');
      } else if (normText.includes('meta') || normText.includes('realizado') || normText.includes('faturamento') || normText.includes('cmv')) {
        observations.push('Captura de tela (print) de dashboard ou relatório diário de metas financeiras.');
      } else if (plates.length > 0) {
        observations.push('Registro visual com placa automotiva identificada.');
      } else {
        observations.push('Documento ou foto operacional com trechos de texto identificados.');
      }

      // Regra de separação: dados no print/imagem são evidências não confirmadas na base oficial
      observations.push('Nota técnica: Valores e dados vistos na imagem são evidências do usuário e devem ser auditados contra o banco oficial.');

      if (wasInjected && securityNotice) {
        limitations.push(securityNotice);
      }

      const status = allEntities.length > 0 ? 'ok' : 'partial';
      if (status === 'partial') {
        limitations.push('Nenhuma placa ou número de OS inequívoco foi identificado no print.');
      }

      return {
        sourceMessageId: part.messageId,
        kind: 'image',
        evidenceId,
        status,
        visibleText: visibleLines,
        ocrText: cleanText,
        candidateEntities: allEntities,
        observations,
        limitations: limitations.length > 0 ? limitations : undefined,
        extractedPlates: plates.map(p => p.value),
        extractedOSs: oss.map(o => o.value),
        extractedFinancialNumbers: financial,
        confidence: allEntities.length > 0 ? 0.9 : 0.6,
        securityNotice
      };
    } catch (err: any) {
      return {
        sourceMessageId: part.messageId,
        kind: 'image',
        evidenceId,
        status: 'error',
        limitations: [`Falha na execução de OCR na imagem: ${err?.message || err}`]
      };
    }
  }

  /**
   * 3. Vídeo: Amostragem de quadros com timecodes + extração de áudio via FFmpeg
   */
  public async analyzeVideo(part: InboundPart, media: FetchedMedia): Promise<MediaEvidence> {
    const evidenceId = `ev_vid_${part.messageId}`;
    const tempDir = path.dirname(media.filePath);
    const audioWavPath = path.join(tempDir, `audio_${path.basename(media.filePath)}.wav`);
    const framePaths: string[] = [];

    try {
      let durationSec = Math.max(media.durationSeconds || 0, part.durationSeconds || 0);
      try {
        const { stdout: probeOut } = await execPromise('ffprobe', [
          '-v', 'error',
          '-show_entries', 'format=duration',
          '-of', 'default=noprint_wrappers=1:nokey=1',
          media.filePath
        ], { timeout: 10000 });
        const parsedDur = parseFloat(probeOut.trim());
        if (!isNaN(parsedDur) && parsedDur > 0) {
          durationSec = Math.max(durationSec, parsedDur);
        }
      } catch {}

      if (durationSec > 60) {
        return {
          sourceMessageId: part.messageId,
          kind: 'video',
          evidenceId,
          status: 'unsupported',
          limitations: [`Vídeo tem ${Math.round(durationSec)}s, excedendo o teto máximo permitido de 60s para análise em tempo real.`]
        };
      }

      let videoTranscript: string | undefined = undefined;
      try {
        await execPromise('ffmpeg', [
          '-i', media.filePath,
          '-vn',
          '-acodec', 'pcm_s16le',
          '-ar', '16000',
          '-ac', '1',
          audioWavPath,
          '-y'
        ], { timeout: 15000 });

        if (fs.existsSync(audioWavPath) && fs.statSync(audioWavPath).size > 1000) {
          const audioEvidence = await this.analyzeAudio(part, {
            filePath: audioWavPath,
            mime: 'audio/wav',
            sizeBytes: fs.statSync(audioWavPath).size,
            source: 'evolution'
          });
          if (audioEvidence.status === 'ok' && audioEvidence.transcript) {
            videoTranscript = audioEvidence.transcript;
          }
        }
      } catch (audioErr: any) {}

      const sampleTimes: number[] = [0];
      if (durationSec > 2) {
        sampleTimes.push(Math.round(durationSec / 2));
      }
      if (durationSec > 4) {
        sampleTimes.push(Math.min(Math.round(durationSec - 1), 59));
      }

      const timecodes: VideoTimecode[] = [];
      const aggregatedPlates: CandidateEntity[] = [];
      const aggregatedOSs: CandidateEntity[] = [];
      const observations: string[] = [
        `Vídeo de ${Math.round(durationSec)}s analisado com extração de ${sampleTimes.length} quadros temporais.`
      ];

      for (const sec of sampleTimes) {
        const frameFile = path.join(tempDir, `frame_${sec}_${path.basename(media.filePath)}.png`);
        framePaths.push(frameFile);

        const timeStr = `00:00:${sec < 10 ? '0' : ''}${sec}`;
        try {
          await execPromise('ffmpeg', [
            '-ss', timeStr,
            '-i', media.filePath,
            '-vframes', '1',
            frameFile,
            '-y'
          ], { timeout: 10000 });

          if (fs.existsSync(frameFile)) {
            const { stdout: ocrOut } = await execPromise('tesseract', [
              frameFile,
              'stdout',
              '-l', 'por+eng'
            ], { timeout: 15000 });

            const textFrame = ocrOut.trim();
            const plates = extractPlates(textFrame);
            const oss = extractOSNumbers(textFrame);

            aggregatedPlates.push(...plates);
            aggregatedOSs.push(...oss);

            timecodes.push({
              at: `${sec}s`,
              observation: textFrame ? `Texto visual detectado: "${textFrame.slice(0, 100)}"` : 'Quadro visual sem texto legível',
              detectedPlate: plates[0]?.value,
              detectedOS: oss[0]?.value,
              timestampSec: sec
            });
          }
        } catch {}
      }

      if (videoTranscript) {
        observations.push(`Áudio falado detectado no vídeo: "${videoTranscript}"`);
      } else {
        observations.push('Vídeo sem faixa de áudio ou fala inteligível.');
      }

      const allEntities = [...aggregatedPlates, ...aggregatedOSs];
      if (videoTranscript) {
        allEntities.push(...extractStoreEntities(videoTranscript));
      }

      return {
        sourceMessageId: part.messageId,
        kind: 'video',
        evidenceId,
        status: 'ok',
        transcript: videoTranscript,
        timecodes,
        candidateEntities: allEntities,
        observations,
        extractedPlates: aggregatedPlates.map(p => p.value),
        extractedOSs: aggregatedOSs.map(o => o.value),
        confidence: allEntities.length > 0 ? 0.9 : 0.7
      };
    } catch (err: any) {
      return {
        sourceMessageId: part.messageId,
        kind: 'video',
        evidenceId,
        status: 'error',
        limitations: [`Falha na análise do vídeo: ${err?.message || err}`]
      };
    } finally {
      cleanupTempFile(audioWavPath);
      for (const f of framePaths) {
        cleanupTempFile(f);
      }
    }
  }

  /**
   * 4. Documentos (PDF / Texto): Extração de tabelas com layout e indicação de páginas
   */
  public async analyzeDocument(part: InboundPart, media: FetchedMedia): Promise<MediaEvidence> {
    const evidenceId = `ev_doc_${part.messageId}`;
    try {
      let docText = '';

      if (media.mime.includes('pdf')) {
        const { stdout } = await execPromise('pdftotext', [
          '-layout',
          media.filePath,
          '-'
        ], { timeout: 25000 });
        docText = stdout || '';
      } else {
        docText = fs.readFileSync(media.filePath, 'utf-8');
      }

      const pages = docText.split('\x0c').filter(p => p.trim().length > 0);
      const totalPages = Math.max(pages.length, 1);

      if (!docText.trim()) {
        return {
          sourceMessageId: part.messageId,
          kind: 'document',
          evidenceId,
          status: 'unreadable',
          observations: ['Documento sem conteúdo textual extraível ou arquivo em branco.'],
          limitations: ['Não foi possível extrair dados textuais do documento fornecido.']
        };
      }

      const { cleanText, securityNotice, wasInjected } = sanitizeAndInspectInjection(docText);

      const plates = extractPlates(cleanText);
      const oss = extractOSNumbers(cleanText);
      const stores = extractStoreEntities(cleanText);
      const financial = extractFinancialValues(cleanText);

      const allEntities = [...plates, ...oss, ...stores];
      const observations: string[] = [
        `Documento de ${totalPages} página(s) processado preservando estrutura tabular.`,
        'Valores do documento são evidências fornecidas pelo usuário e NÃO substituem as métricas oficiais do banco da rede.'
      ];
      const limitations: string[] = [];

      if (financial.length > 0) {
        observations.push(`Detectados ${financial.length} valores financeiros ou de metas no documento.`);
      }

      if (wasInjected && securityNotice) {
        limitations.push(securityNotice);
      }

      return {
        sourceMessageId: part.messageId,
        kind: 'document',
        evidenceId,
        status: 'ok',
        visibleText: cleanText.split('\n').map(l => l.trim()).filter(l => l.length > 0).slice(0, 50),
        ocrText: cleanText.slice(0, 2000),
        candidateEntities: allEntities,
        observations,
        limitations: limitations.length > 0 ? limitations : undefined,
        extractedPlates: plates.map(p => p.value),
        extractedOSs: oss.map(o => o.value),
        extractedFinancialNumbers: financial,
        confidence: 0.92,
        securityNotice
      };
    } catch (err: any) {
      return {
        sourceMessageId: part.messageId,
        kind: 'document',
        evidenceId,
        status: 'error',
        limitations: [`Falha na leitura do documento: ${err?.message || err}`]
      };
    }
  }
}

/**
 * Função de entrada unificada de ponta a ponta para o Agente 2 e Despachante
 */
export async function processInboundMultimodal(
  rawPayload: any,
  options?: AnalyzerConfig
): Promise<{ part: InboundPart | null; evidence?: MediaEvidence }> {
  const part = normalizeInboundMessage(rawPayload);
  if (!part) {
    return { part: null };
  }

  if (!isMultimodalKind(part.kind)) {
    return { part };
  }

  const analyzer = new MediaAnalyzer(options);
  const fetcher = new MediaFetcher(options);

  const evidence = await fetcher.withTempMedia(part, async (fetchResult) => {
    if (!fetchResult.success) {
      return {
        sourceMessageId: part.messageId,
        kind: part.kind,
        status: 'error' as const,
        limitations: [fetchResult.errorMessage]
      };
    }
    return analyzer.analyze(part, fetchResult.media);
  });

  return { part, evidence };
}
