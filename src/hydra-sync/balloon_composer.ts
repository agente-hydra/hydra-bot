/**
 * HYDRA BALLOON COMPOSER (Frente C, Frente 3 & Executor 2)
 * Compositor semântico de balões de WhatsApp para respostas executivas e operacionais.
 * 
 * Regras:
 * 1. Ordem Semântica de Leitura Estrita:
 *    1. Resposta direta (conclusão executiva)
 *    2. Leitura dos indicadores / resultado (o que os números indicam)
 *    3. Detalhamento (tabela convertida em cards ou lista limpa de lojas / OSs)
 *    4. Rodapé com fonte e data/hora
 * 2. Orçamento de Caracteres:
 *    - Faixa ideal: 600 a 900 caracteres por balão [E2-04].
 *    - Preferência por 1 a 3 balões.
 *    - Respostas curtas (<600 caracteres) permanecem intactas em 1 único balão [E2-04].
 * 3. Quebras Respeitosas (Card-Aware):
 *    - Quebra APENAS por seção ou grupo de lojas/itens.
 *    - NUNCA quebra no meio de um card, item de lista, número ou valor financeiro.
 *    - Título de card (*Item*) e seus campos (- *Campo:* valor) NUNCA são separados.
 * 4. Barreira Anti-Balão Vazio [E2-05]:
 *    - Proibir despacho de balões contendo apenas palavras isoladas (ex: "Entendi." sozinho).
 *    - Introdução curta permanece junto no mesmo balão.
 * 5. Eliminação de Tabelas Markdown [E2-02]:
 *    - Converte tabelas (|---|) em cards nativos de WhatsApp com *Item* e campos (- *Coluna:* valor).
 * 6. Política Zero Emoji [E2-01]:
 *    - Expurgar emojis decorativos; permitir no máximo 1 em alerta operacional comprovado (>30 dias).
 * 7. Sanitização Nativa Estrita:
 *    - Zero asteriscos duplos (** -> *).
 *    - Zero títulos CommonMark (#) soltos.
 */

import {
  sanitizeWhatsAppMarkdown,
  assertNoDoubleAsterisks,
  assertWhatsAppNativeFormat,
  alignWhatsAppList,
  purgeDecorativeEmojis,
  enforceAntiEmptyBalloons,
  convertMarkdownTableToNativeBlocks
} from './format_utils.js';
import type { ComposedBalloonsResult } from './types/language_contract.js';
import type {
  TemparioHybridQueryResponse,
  TemparioDetailChoice,
  TemparioPresentationOptions
} from './types/tempario_contract.js';
import type { VehiclePlateRecord } from './types/plate_lookup_contract.js';

export interface SemanticPayload {
  /** 1. Resposta direta (conclusão executiva) */
  directAnswer?: string;
  /** 2. Leitura dos indicadores / resultado (o que os números indicam) */
  resultReading?: string;
  /** Alias para leitura dos indicadores */
  indicatorsReading?: string;
  /** 3. Detalhes pedidos (tabela compacta ou lista limpa) */
  details?: string | string[];
  /** Declaração explícita de incompletude quando houver dados parciais */
  incompletenessDeclaration?: string;
  /** 4. Fonte/período ou rodapé com data/hora */
  sourcePeriod?: string;
  /** Alias para rodapé */
  footer?: string;
}

export interface ParsedSemanticSections {
  directAnswer?: string;
  resultReading?: string;
  details?: string;
  incompletenessDeclaration?: string;
  sourcePeriod?: string;
}

export type SemanticReportSections = SemanticPayload;

export function formatCurrencyBRL(val: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val).replace(/\u00a0/g, ' ');
}

export function formatPercentBR(val: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(val / 100).replace(/\u00a0/g, ' ');
}

export interface BalloonComposerOptions {
  minBalloonChars?: number; // default: 600 [E2-04]
  maxBalloonChars?: number; // default: 900 [E2-04]
  maxBalloons?: number;     // default: 3
  enforceAntiEmpty?: boolean; // default: true [E2-05]
  allowCriticalAlertEmoji?: boolean;
}

/**
 * Converte qualquer tabela Markdown (| Col1 | Col2 | ...) em lista limpa WhatsApp nativa (- *Col1:* ...).
 * Suporta alinhamentos, múltiplos cabeçalhos e formata os dados com separador visual elegante (•).
 */
export function convertMarkdownTablesToWhatsAppLists(text: string): string {
  if (!text || !text.includes('|')) return text;

  const lines = text.split('\n');
  const resultLines: string[] = [];
  let inTable = false;
  let tableHeaderCols: string[] = [];
  let tableDataRows: string[][] = [];

  const flushTable = () => {
    if (tableHeaderCols.length > 0 && tableDataRows.length > 0) {
      // Processa cada linha de dados
      for (const row of tableDataRows) {
        if (row.length === 0) continue;

        const firstCol = row[0];
        const remainingCols: string[] = [];

        for (let c = 1; c < row.length; c++) {
          const header = tableHeaderCols[c] || '';
          const val = row[c];
          if (!val) continue;

          if (header && !header.toLowerCase().includes('coluna')) {
            remainingCols.push(`${header}: ${val}`);
          } else {
            remainingCols.push(val);
          }
        }

        const cleanEntity = firstCol.replace(/^\*+|\*+$/g, '').trim();
        const firstColFormatted = `*${cleanEntity}:*`;

        if (remainingCols.length > 0) {
          resultLines.push(`- ${firstColFormatted} ${remainingCols.join(' • ')}`);
        } else {
          resultLines.push(`- *${cleanEntity}*`);
        }
      }
    } else if (tableDataRows.length > 0) {
      // Tabela sem cabeçalho explícito
      for (const row of tableDataRows) {
        if (row.length > 0) {
          const clean = row[0].replace(/^\*+|\*+$/g, '').trim();
          resultLines.push(`- *${clean}:* ${row.slice(1).join(' • ')}`);
        }
      }
    }

    inTable = false;
    tableHeaderCols = [];
    tableDataRows = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Linha de tabela (começa e termina com '|')
    if (line.startsWith('|') && line.endsWith('|')) {
      const cols = line
        .split('|')
        .slice(1, -1)
        .map(c => c.trim());

      // Linha separadora (|---| ou |:---|)
      const isSeparator = cols.every(c => /^[:\s\-]+$/.test(c));

      if (isSeparator) {
        continue;
      }

      if (!inTable) {
        inTable = true;
        tableHeaderCols = cols;
      } else {
        tableDataRows.push(cols);
      }
    } else {
      if (inTable) {
        flushTable();
      }
      resultLines.push(lines[i]);
    }
  }

  if (inTable) {
    flushTable();
  }

  return resultLines.join('\n');
}

/**
 * Normaliza e reordena texto bruto ou estruturado em seções semânticas:
 * 1. Resposta direta -> 2. Leitura dos indicadores -> 3. Detalhes pedidos -> 4. Rodapé com fonte/período
 */
export function parseSemanticSections(raw: string | SemanticPayload): ParsedSemanticSections {
  if (typeof raw === 'object' && raw !== null) {
    const detailsStr = Array.isArray(raw.details)
      ? raw.details.map(d => sanitizeWhatsAppMarkdown(d)).join('\n\n')
      : (raw.details ? sanitizeWhatsAppMarkdown(raw.details) : undefined);

    const reading = raw.resultReading || raw.indicatorsReading;
    const footer = raw.sourcePeriod || raw.footer;

    return {
      directAnswer: raw.directAnswer ? sanitizeWhatsAppMarkdown(raw.directAnswer) : undefined,
      resultReading: reading ? sanitizeWhatsAppMarkdown(reading) : undefined,
      details: detailsStr,
      incompletenessDeclaration: raw.incompletenessDeclaration ? sanitizeWhatsAppMarkdown(raw.incompletenessDeclaration) : undefined,
      sourcePeriod: footer ? sanitizeWhatsAppMarkdown(footer) : undefined
    };
  }

  const text = convertMarkdownTablesToWhatsAppLists(String(raw || ''));
  const paragraphs = text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  let directAnswer: string | undefined;
  let resultReading: string | undefined;
  const detailBlocks: string[] = [];
  let sourcePeriod: string | undefined;

  for (const para of paragraphs) {
    const lower = para.toLowerCase();

    // 4. Rodapé com fonte e data/hora
    if (
      lower.includes('fonte:') ||
      lower.includes('período:') ||
      lower.includes('periodo:') ||
      lower.includes('base de dados:') ||
      lower.includes('atualizado em:') ||
      lower.includes('data de referência:') ||
      lower.includes('data de referencia:') ||
      lower.startsWith('_atualizado') ||
      lower.startsWith('atualizado') ||
      lower.startsWith('_fonte') ||
      lower.startsWith('_dados atualizados')
    ) {
      sourcePeriod = para;
      continue;
    }

    // 2. Leitura dos Indicadores / Leitura do Resultado
    if (
      lower.includes('leitura dos indicadores') ||
      lower.includes('leitura de indicadores') ||
      lower.includes('leitura do resultado') ||
      lower.includes('leitura operacional') ||
      lower.includes('indicadores principais') ||
      lower.includes('indicadores:') ||
      lower.includes('diagnóstico') ||
      lower.includes('diagnostico') ||
      lower.includes('o que os números indicam') ||
      lower.includes('o que os numeros indicam') ||
      lower.includes('análise executiva') ||
      lower.includes('analise executiva')
    ) {
      if (!resultReading) {
        resultReading = para;
        continue;
      }
    }

    // 1. Resposta Direta (conclusão ou resumo, nunca um card de OS individual)
    const isOsCard = /^>?\s*\*?OS\s*#?\d+/i.test(para);
    if (!isOsCard && !directAnswer && (para.startsWith('>') || lower.includes('conclusão') || lower.includes('resumo'))) {
      directAnswer = para;
      continue;
    }

    // 3. Detalhes pedidos (listas, lojas, métricas, cards)
    detailBlocks.push(para);
  }

  // Se não foi encontrada resposta direta explícita e o primeiro parágrafo NÃO for um card de OS, ele é a resposta direta
  if (!directAnswer && detailBlocks.length > 0) {
    if (!/^>?\s*\*?OS\s*#?\d+/i.test(detailBlocks[0])) {
      directAnswer = detailBlocks.shift();
    }
  }

  return {
    directAnswer: directAnswer ? sanitizeWhatsAppMarkdown(directAnswer) : undefined,
    resultReading: resultReading ? sanitizeWhatsAppMarkdown(resultReading) : undefined,
    details: detailBlocks.length > 0 ? sanitizeWhatsAppMarkdown(detailBlocks.join('\n\n')) : undefined,
    sourcePeriod: sourcePeriod ? sanitizeWhatsAppMarkdown(sourcePeriod) : undefined
  };
}

/**
 * Divide uma seção de detalhes em unidades atômicas indivisíveis com inteligência Card-Aware [E2-04].
 * Garante que nenhuma unidade de card quebre internamente nem separe título de campos.
 */
export function splitIntoAtomicItems(detailsText: string): string[] {
  if (!detailsText) return [];

  // Primeiro divide por quebras de blocos lógicos duplas (\n\n)
  const blocks = detailsText
    .split(/\n\s*\n/)
    .map(b => b.trim())
    .filter(b => b.length > 0);

  const items: string[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trimEnd()).filter(l => l.length > 0);
    if (lines.length === 0) continue;

    const firstLine = lines[0].trim();
    // É um card com título e campos subordinados?
    // Ex: *Item* ou > *Título* ou *Título:* seguido por - *Campo:* ou └ Status:
    const isCardHeader =
      firstLine.startsWith('>') ||
      /^\*[^*]+\*$/.test(firstLine) ||
      /^\*[^*]+:\*$/.test(firstLine) ||
      /^\*OS\s*#?\d+/i.test(firstLine);

    // Reconhece tanto bullets (-) quanto joelhos (└) como linhas filhas de card atômico
    const hasFieldBullets = lines.slice(1).some(l => /^\s*(?:[-•]|└)\s+/.test(l));

    if (isCardHeader && hasFieldBullets) {
      // Card indivisível: mantém todo o bloco unido
      items.push(block.trim());
    } else if (lines.length > 1 && lines.every(l => /^\s*(?:[-•]|└)\s+/.test(l))) {
      // Lista uniforme de itens independentes (- Loja A, - Loja B)
      for (const line of lines) {
        if (line.trim()) items.push(line.trim());
      }
    } else {
      // Bloco geral / parágrafo
      items.push(block.trim());
    }
  }

  return items;
}

/**
 * [E2-04]: Compõe balões semânticos de WhatsApp por Unidade de Assunto:
 * - Ordem: (1) Resposta direta -> (2) Leitura dos indicadores -> (3) Detalhamento -> (4) Rodapé com fonte e data/hora
 * - Orçamento de 600 a 900 caracteres por balão (preferência 1 a 3 balões).
 * - Respostas curtas (<600 caracteres) permanecem intactas em 1 único balão.
 * - Card-Aware: nunca corta dentro de card nem separa título de campos.
 * - Barreira Anti-Balão Vazio [E2-05]: proíbe despacho de balões contendo apenas palavras isoladas.
 * - Zero duplo asterisco (**) e zero emojis decorativos garantidos.
 */
export function composeSemanticBalloons(
  input: string | SemanticPayload,
  options?: BalloonComposerOptions
): string[] {
  const minBudget = options?.minBalloonChars ?? 600;
  const maxBudget = options?.maxBalloonChars ?? 900;
  const maxBalloons = options?.maxBalloons ?? 3;

  // 1. Extração estruturada das 4 seções semânticas
  const sections = parseSemanticSections(input);

  const directAnswer = sections.directAnswer ? sanitizeWhatsAppMarkdown(sections.directAnswer) : '';
  const resultReading = sections.resultReading ? sanitizeWhatsAppMarkdown(sections.resultReading) : '';
  const details = sections.details ? sanitizeWhatsAppMarkdown(sections.details) : '';
  const incompleteness = sections.incompletenessDeclaration ? sanitizeWhatsAppMarkdown(sections.incompletenessDeclaration) : '';
  const sourcePeriod = sections.sourcePeriod ? sanitizeWhatsAppMarkdown(sections.sourcePeriod) : '';

  // 2. Se o conteúdo total for curto (< 600 chars ou <= maxBudget), preserva em balão único [E2-04]
  const fullText = [directAnswer, resultReading, details, incompleteness, sourcePeriod]
    .filter(Boolean)
    .join('\n\n')
    .trim();

  if (fullText.length < 600 || fullText.length <= maxBudget) {
    const singleBalloon = purgeDecorativeEmojis(sanitizeWhatsAppMarkdown(fullText), options);
    return [singleBalloon];
  }

  // 3. Empacotamento Inteligente em Balões Semânticos com Respeito aos Limites
  const balloons: string[] = [];
  let currentBalloon = '';

  const pushCurrentBalloon = () => {
    const trimmed = currentBalloon.trim();
    if (trimmed.length > 0) {
      balloons.push(sanitizeWhatsAppMarkdown(trimmed));
      currentBalloon = '';
    }
  };

  const tryAppendToCurrent = (content: string): boolean => {
    if (!content || !content.trim()) return true;
    const separator = currentBalloon ? '\n\n' : '';
    const projectedLength = currentBalloon.length + separator.length + content.length;

    // Se couber até o teto máximo
    if (projectedLength <= maxBudget) {
      currentBalloon += separator + content;
      return true;
    }
    return false;
  };

  // Seção 1: Resposta Direta (sempre inicia o Balão 1)
  if (directAnswer) {
    currentBalloon = directAnswer;
  }

  // Seção 2: Leitura dos Indicadores / Leitura do Resultado
  if (resultReading) {
    if (!tryAppendToCurrent(resultReading)) {
      // Não coube no Balão 1 com a Resposta Direta: fecha Balão 1 e inicia novo
      pushCurrentBalloon();
      currentBalloon = resultReading;
    }
  }

  // Seção 3: Detalhes Pedidos (itens atômicos de lojas / OSs / cards)
  if (details) {
    const atomicItems = splitIntoAtomicItems(details);

    for (const item of atomicItems) {
      if (!currentBalloon) {
        currentBalloon = item;
        continue;
      }

      // Separador entre cards/itens: se for card com quebra interna usa \n\n, senão \n
      const separator = item.includes('\n') || currentBalloon.includes('\n') ? '\n\n' : '\n';
      const projectedLength = currentBalloon.length + separator.length + item.length;

      // Se cabe no balão atual sem estourar maxBudget
      if (projectedLength <= maxBudget) {
        currentBalloon += separator + item;
      } else {
        // Se o balão atual já atingiu tamanho saudável (>= minBudget), fecha e abre novo
        if (currentBalloon.length >= minBudget) {
          pushCurrentBalloon();
          currentBalloon = item;
        } else if (projectedLength <= (maxBudget + 50) && balloons.length < (maxBalloons - 1)) {
          // Pequena margem para evitar fragmentação indevida de último item
          currentBalloon += separator + item;
        } else {
          pushCurrentBalloon();
          currentBalloon = item;
        }
      }
    }
  }

  // Seção 3.1: Declaração de Incompletude (se houver dados parciais)
  if (incompleteness) {
    if (!tryAppendToCurrent(incompleteness)) {
      pushCurrentBalloon();
      currentBalloon = incompleteness;
    }
  }

  // Seção 4: Rodapé com Fonte e Data/Hora
  if (sourcePeriod) {
    if (!tryAppendToCurrent(sourcePeriod)) {
      if (balloons.length < maxBalloons - 1) {
        pushCurrentBalloon();
        currentBalloon = sourcePeriod;
      } else {
        // Se atingiu o limite de balões, anexa no último balão
        currentBalloon += '\n\n' + sourcePeriod;
      }
    }
  }

  pushCurrentBalloon();

  // 4. Sanitização final de cada balão e política de Zero Emoji [E2-01]
  const sanitizedBalloons = balloons
    .map(b => purgeDecorativeEmojis(sanitizeWhatsAppMarkdown(b), options))
    .filter(b => b.trim().length > 0);

  // 5. Barreira Anti-Balão Vazio [E2-05]: proíbe despacho de balões contendo apenas palavras isoladas
  return enforceAntiEmptyBalloons(sanitizedBalloons);
}

/**
 * [E2-04]: Compositor Semântico Estruturado com metadados para telemetria e validação:
 * Retorna ComposedBalloonsResult contendo balões, contagens e flags de validação.
 */
export function composeSemanticBalloonsStructured(
  input: string | SemanticPayload,
  options?: BalloonComposerOptions
): ComposedBalloonsResult {
  const balloons = composeSemanticBalloons(input, options);
  const totalChars = balloons.reduce((sum, b) => sum + b.length, 0);

  const EMOJI_REGEX = /(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})/gu;
  const emojisCount = balloons.reduce((count, b) => {
    const m = b.match(EMOJI_REGEX);
    return count + (m ? m.length : 0);
  }, 0);

  const isStructuredCard = balloons.some(b =>
    b.includes('> *') || /^\*[^*]+\*\n\s*-\s+\*/m.test(b) || b.includes('\n- *')
  );

  return {
    balloons,
    totalChars,
    balloonCount: balloons.length,
    emojisCount,
    isStructuredCard,
    sanitized: true
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SUCESSO PARCIAL, ZERO DETERMINÍSTICO E RESILIÊNCIA MULTICOMPONENTE (E4-E3.1)
// ─────────────────────────────────────────────────────────────────────────────

export interface QueryComponentExecution {
  componentId: string;
  name?: string;
  capabilityId?: string;
  priority?: number;
  status: 'SUCCESS' | 'PARTIAL' | 'TIMEOUT' | 'UNSUPPORTED' | 'DENIED';
  replyText?: string;
  renderedContent?: string;
  data?: any;
  errorMessage?: string;
  unavailableNotice?: string;
}

export interface PartialSuccessComposerOptions extends BalloonComposerOptions {
  components: QueryComponentExecution[];
  lojaNome?: string;
  lojaSlug?: string;
  timestamp?: string;
}

/**
 * Compositor de Sucesso Parcial (E4-E3.1):
 * Quando um componente de consulta falhar (ex: timeout de OSs), renderiza os componentes
 * bem-sucedidos (ex: faturamento oficial) e anexa aviso factual estrito sobre os indisponíveis.
 */
export function composePartialSuccessBalloon(
  options: PartialSuccessComposerOptions
): string[] {
  const { components, minBalloonChars, maxBalloonChars, maxBalloons } = options;
  const composerOpts: BalloonComposerOptions = {
    minBalloonChars,
    maxBalloonChars,
    maxBalloons
  };

  const successful = components.filter(c => c.status === 'SUCCESS' || (c.status === 'PARTIAL' && (c.renderedContent || c.replyText)));
  const failed = components.filter(c => c.status === 'TIMEOUT' || c.status === 'UNSUPPORTED' || c.status === 'DENIED' || (c.status === 'PARTIAL' && !c.renderedContent && !c.replyText));

  const sections: string[] = [];

  // 1. Renderiza componentes bem-sucedidos
  for (const comp of successful) {
    const text = comp.renderedContent || comp.replyText;
    if (text && text.trim()) {
      sections.push(text.trim());
    }
  }

  // 2. Anexa avisos factuais sobre componentes indisponíveis
  for (const comp of failed) {
    let notice = comp.unavailableNotice;
    if (!notice) {
      const isOs = (comp.componentId || '').toLowerCase().includes('os') || (comp.capabilityId || '').toLowerCase().includes('os');
      if (comp.status === 'TIMEOUT') {
        notice = isOs
          ? '> *Aviso Operacional:* A listagem de ordens de serviço atingiu o tempo limite e não pôde ser carregada. O faturamento acima reflete a posição oficial mais recente.'
          : `> *Aviso Operacional:* A consulta ${comp.name || comp.componentId} atingiu o tempo limite e não pôde ser concluída. Os demais dados refletem a posição oficial disponível.`;
      } else if (comp.status === 'DENIED') {
        notice = `> *Aviso Operacional:* A consulta ${comp.name || comp.componentId} foi bloqueada pelas políticas de acesso da unidade.`;
      } else {
        notice = `> *Aviso Operacional:* A consulta ${comp.name || comp.componentId} não está disponível no momento (${comp.errorMessage || 'capacidade não suportada'}).`;
      }
    }
    sections.push(notice);
  }

  const combinedText = sections.join('\n\n');
  return composeSemanticBalloons(combinedText, composerOpts);
}

export interface FinancialMetricExtraction {
  lojaSlug: string;
  lojaNome?: string;
  periodo?: string;
  metric?: 'FATURAMENTO_DIA' | 'FATURAMENTO_MES' | 'CMV' | string;
  status: 'SUCCESS' | 'TIMEOUT' | 'EXTRACTION_FAILED' | 'CORRUPTED';
  hasExplicitTotalZero?: boolean; // Obrigatório: só true se a linha TOTAL = 0,00 na planilha oficial
  value?: number;
  lastKnownValidValue?: number;
  lastKnownValidDate?: string;
  lastKnownValidHour?: string;
}

/**
 * Distinção determinística de zero financeiro vs extração indisponível (E4-E3.1):
 * - Zero (R$ 0,00): só afirmado se houver extração técnica com linha TOTAL = 0,00 no relatório oficial.
 * - Falha / Timeout de extração: emite aviso explícito e preserva posição com frescor STALE, nunca zero.
 */
export function formatDeterministicFinancialBalloon(
  extraction: FinancialMetricExtraction
): {
  replyText: string;
  freshness: 'FRESH' | 'STALE';
  execution: 'SUCCESS' | 'PARTIAL';
  isZeroConfirmed: boolean;
  balloons: string[];
} {
  const lojaNome = extraction.lojaNome || extraction.lojaSlug;

  // CASO 1: Sucesso técnico comprovado
  if (extraction.status === 'SUCCESS') {
    if (extraction.value === 0 && extraction.hasExplicitTotalZero) {
      // Zero oficial comprovado
      const replyText = `> *${lojaNome} — Vendas*\nSem vendas registradas hoje na unidade ${lojaNome} até o momento.`;
      return {
        replyText: sanitizeWhatsAppMarkdown(replyText),
        freshness: 'FRESH',
        execution: 'SUCCESS',
        isZeroConfirmed: true,
        balloons: composeSemanticBalloons(replyText)
      };
    }

    const valFormatted = Number(extraction.value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const replyText = `> *${lojaNome} — Vendas*\n- *Faturamento:* ${valFormatted}\n- *Posição:* ${extraction.periodo || 'hoje'}`;
    return {
      replyText: sanitizeWhatsAppMarkdown(replyText),
      freshness: 'FRESH',
      execution: 'SUCCESS',
      isZeroConfirmed: false,
      balloons: composeSemanticBalloons(replyText)
    };
  }

  // CASO 2: Falha, Timeout ou Corrupção — NUNCA afirmar zero
  const lastValFormatted = extraction.lastKnownValidValue !== undefined
    ? Number(extraction.lastKnownValidValue).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : null;

  let notice = `> *Aviso Operacional:*\nA extração de vendas de hoje para a unidade ${lojaNome} está temporariamente indisponível.`;
  if (lastValFormatted && extraction.lastKnownValidDate) {
    const horaStr = extraction.lastKnownValidHour ? ` às ${extraction.lastKnownValidHour}` : '';
    notice += ` A última posição válida registrada foi de ${lastValFormatted} em ${extraction.lastKnownValidDate}${horaStr}.`;
  } else {
    notice += ` A posição anterior foi preservada com frescor STALE.`;
  }

  return {
    replyText: sanitizeWhatsAppMarkdown(notice),
    freshness: 'STALE',
    execution: 'PARTIAL',
    isZeroConfirmed: false,
    balloons: composeSemanticBalloons(notice)
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSITOR HERMES: TEMPÁRIO TÉCNICO AUTOMOTIVO (SPEC 054)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compõe o balão Hermes nativo para consultas de Tempário Técnico Automotivo (Spec 054).
 * Regras estritas:
 * - Citações com `> *Título*`
 * - Listas com `- *Campo:* Valor`
 * - Zero emojis decorativos
 * - Zero tabelas Markdown (|---|)
 * - Zero asteriscos duplos (**)
 * - Zero NBSP (\u00A0 ou \u202F)
 */
function formatHoursAndMin(hours: number): string {
  const totalMin = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const hStr = hours.toFixed(2).replace('.', ',');
  if (h > 0 && m > 0) {
    return `${hStr}h (${h}h ${m} min)`;
  }
  return `${hStr}h (${totalMin} min)`;
}

export function composeTemparioHermesBalloon(
  response: TemparioHybridQueryResponse
): string[] {
  const sections: string[] = [];

  // 1. Cabeçalho Principal
  sections.push('*HYDRA | Tempário Técnico Automotivo*');

  // 2. Card do Veículo e Motor
  if (response.veiculo) {
    const v = response.veiculo;
    const anoStr = v.anoInicio === v.anoFim ? `${v.anoInicio}` : `${v.anoInicio}-${v.anoFim}`;
    const engineStr = response.motor ? ` · Motor ${response.motor.descricaoComercial}` : '';
    const servicosTitulos = response.operacoesResolvidas.length > 0
      ? response.operacoesResolvidas.map(o => o.titulo).join(' + ')
      : (response.cadeiaExecucao.steps.map(s => s.titulo).join(' + ') || 'Serviço sob consulta');

    const dificuldades = response.operacoesResolvidas.map(o => o.grauDificuldade);
    const dificuldadeStr = dificuldades.includes('ESPECIALISTA') ? 'Especialista'
      : (dificuldades.includes('ALTO') ? 'Alto'
      : (dificuldades.includes('MEDIO') ? 'Médio' : 'Baixo'));

    sections.push(
      `> *${v.marca} ${v.modelo} (${anoStr})${engineStr}*\n` +
      `- *Serviços consultados:* ${servicosTitulos}\n` +
      `- *Grau de dificuldade:* ${dificuldadeStr}`
    );
  } else {
    sections.push(
      `> *Veículo sob Estimativa Provisória*\n` +
      `- *Aviso:* ${response.avisoQuarentena || 'Veículo ou serviço não localizado no catálogo homologado OEM.'}\n` +
      `- *Status de evidência:* Estimativa externa pendente de validação`
    );
  }

  // 3. Sequência de Execução Otimizada (Grafo de Acesso)
  if (response.cadeiaExecucao.steps.length > 0) {
    const stepLines: string[] = ['*Sequência de execução otimizada (Grafo de Acesso)*'];
    for (const step of response.cadeiaExecucao.steps) {
      const faseLabel = step.faseExecucao === 'DESMONTAGEM' ? 'Desmontagem'
        : (step.faseExecucao === 'EXECUCAO' ? 'Execução'
        : (step.faseExecucao === 'REMONTAGEM' ? 'Remontagem' : 'Teste e Ajuste'));

      let line = `- *${step.ordemExecucaoFinal}. ${step.titulo} (${faseLabel}):* *${step.tempoHoras.toFixed(2).replace('.', ',')}h* (${step.tempoMinutos} min)`;
      if (step.ferramentas && step.ferramentas.length > 0) {
        line += `\n  Ferramentas: ${step.ferramentas.join(', ')}`;
      }
      if (step.torqueEspecificado) {
        line += ` (Torque: ${step.torqueEspecificado})`;
      }
      if (step.isAcessoCompartilhado) {
        line += `\n  Acesso compartilhado entre os serviços (contabilizado 1 única vez)`;
      }
      stepLines.push(line);
    }
    sections.push(stepLines.join('\n'));
  }

  // 3.1. Precificação Comercial de Mão de Obra (Taxa da Rede: R$ 270,00/h)
  const cadeia = response.cadeiaExecucao;
  const taxaPadrao = cadeia.taxaHorariaPadrao || 270.00;
  const valorBruto = cadeia.valorMaoDeObraBrutoSemAssociativa ?? Math.round(cadeia.tempoBrutoTotalHoras * taxaPadrao * 100) / 100;
  const valorLiquido = cadeia.valorMaoDeObraSugerido ?? Math.round(cadeia.tempoLiquidoTotalHoras * taxaPadrao * 100) / 100;
  const economiaReais = cadeia.economiaMaoDeObraReais ?? Math.round(cadeia.tempoEconomizadoDeduplicacaoHoras * taxaPadrao * 100) / 100;

  const precoLines: string[] = [
    `*Valores de Mão de Obra (Taxa da Rede: R$ ${taxaPadrao.toFixed(2).replace('.', ',')}/h)*`,
    `- *Tempo bruto somado (sem pacote):* ${formatHoursAndMin(cadeia.tempoBrutoTotalHoras)} (R$ ${valorBruto.toFixed(2).replace('.', ',')})`
  ];

  if (cadeia.possuiDeduplicacaoAtiva && cadeia.tempoEconomizadoDeduplicacaoHoras > 0) {
    precoLines.push(
      `- *Desconto por acesso compartilhado:* *-${cadeia.tempoEconomizadoDeduplicacaoHoras.toFixed(2).replace('.', ',')}h* (-R$ ${economiaReais.toFixed(2).replace('.', ',')})`
    );
  }

  precoLines.push(`- *Tempo líquido cobrado:* *${formatHoursAndMin(cadeia.tempoLiquidoTotalHoras)}*`);
  precoLines.push(`- *Total Mão de Obra a Cobrar:* *R$ ${valorLiquido.toFixed(2).replace('.', ',')}*`);
  sections.push(precoLines.join('\n'));

  // 3.2. Associativa de Peças Necessárias
  if (cadeia.pecasNecessarias && cadeia.pecasNecessarias.length > 0) {
    const pecasLines: string[] = ['*Associativa de Peças Necessárias*'];
    for (const p of cadeia.pecasNecessarias) {
      const statusPeca = p.obrigatoria ? 'Obrigatória' : 'Preventiva recomendada';
      const spec = p.especificacaoTecnica ? ` [${p.especificacaoTecnica}]` : '';
      pecasLines.push(`- [x] ${p.nomePeca} (${p.quantidade} ${p.unidade})${spec} — ${statusPeca}`);
    }
    sections.push(pecasLines.join('\n'));
  }

  // 3.3. Ferramentas Especiais Exigidas na Bancada
  if (cadeia.ferramentasNecessarias && cadeia.ferramentasNecessarias.length > 0) {
    const ferrLines: string[] = ['*Ferramentas Especiais Exigidas na Bancada*'];
    for (const ferr of cadeia.ferramentasNecessarias) {
      ferrLines.push(`- ${ferr}`);
    }
    if (cadeia.torquesEspecificados && cadeia.torquesEspecificados.length > 0) {
      ferrLines.push(`- *Torques Críticos:* ${cadeia.torquesEspecificados.join('; ')}`);
    }
    sections.push(ferrLines.join('\n'));
  }

  // 4. Comparativo: Tempo Tabelado vs. Realidade de Pátio
  const comp = response.comparativoPatio;
  const compLines: string[] = [
    '*Comparativo: Tempo Tabelado vs. Realidade de Pátio*',
    `- *Tempo bruto somado (sem grafo):* ${formatHoursAndMin(cadeia.tempoBrutoTotalHoras)}`
  ];

  if (cadeia.possuiDeduplicacaoAtiva && cadeia.tempoEconomizadoDeduplicacaoHoras > 0) {
    compLines.push(
      `- *Economia por acesso compartilhado:* *-${cadeia.tempoEconomizadoDeduplicacaoHoras.toFixed(2).replace('.', ',')}h* (-${cadeia.tempoEconomizadoDeduplicacaoMinutos} min)`
    );
  }

  compLines.push(`- *Tempo tabelado líquido (Manual OEM):* *${formatHoursAndMin(cadeia.tempoLiquidoTotalHoras)}*`);

  if (comp.temHistoricoRede && comp.tempoMedioExecucaoHoras !== null) {
    const escopoDesc = comp.escopoAplicado === 'LOJA_ISOLADA' && comp.lojaFiltroSlug
      ? `na unidade ${comp.lojaFiltroSlug}`
      : 'na rede';

    compLines.push(`- *Tempo médio de execução ${escopoDesc} (${comp.totalOsAnalisadas} OSs):* *${formatHoursAndMin(comp.tempoMedioExecucaoHoras)}*`);
    if (comp.leadTimeMedioPatioDias !== null) {
      compLines.push(`- *Permanência média em pátio (Lead Time):* *${comp.leadTimeMedioPatioDias.toFixed(1).replace('.', ',')} dias*`);
    }
    if (comp.gargalosFatuaisComprovados.length > 0) {
      compLines.push(`- *Gargalos documentados nas OSs:* ${comp.gargalosFatuaisComprovados.join('; ')}`);
    }
  } else {
    compLines.push(`- *Histórico de pátio:* ${comp.declaracaoLimitacaoFactual}`);
  }
  sections.push(compLines.join('\n'));

  // 5. Proveniência e Auditoria
  const auditLines: string[] = ['> *Proveniência e Auditoria*'];
  const statusDesc = response.statusEvidenciaGlobal === 'HOMOLOGADO_OEM'
    ? 'Manual Oficial OEM (Homologado)'
    : (response.statusEvidenciaGlobal === 'HISTORICO_OS_REDE'
    ? 'Histórico Factual de Ordens de Serviço'
    : 'Estimativa Externa Pendente de Validação');

  auditLines.push(`- *Classificação:* ${statusDesc}`);

  if (response.evidenciasFontes && response.evidenciasFontes.length > 0) {
    const fontes = response.evidenciasFontes.map(f => {
      let desc = f.nomeDocumento;
      if (f.capituloSecao) desc += ` (${f.capituloSecao}`;
      if (f.paginaTabela) desc += `, ${f.paginaTabela}`;
      if (f.capituloSecao) desc += `)`;
      return desc;
    }).join('; ');
    auditLines.push(`- *Fonte:* ${fontes}`);
  } else if (response.avisoQuarentena) {
    auditLines.push(`- *Quarentena:* ${response.avisoQuarentena}`);
  }

  auditLines.push(`- *Confiança da recuperação:* ${Math.round(response.confidenceScore * 100)}%`);
  sections.push(auditLines.join('\n'));

  const rawFullText = sections.join('\n\n');
  const sanitized = sanitizeWhatsAppMarkdown(rawFullText);

  // Garante eliminação de NBSP
  const cleanNBSP = sanitized.replace(/[\u00A0\u202F]/g, ' ');

  return composeSemanticBalloons(cleanNBSP);
}

/**
 * Formata a resposta inicial executiva e compacta de tempário (Spec 063: Progressive Disclosure).
 * Retorna 1 único balão legível para WhatsApp com Valores, Tempo Líquido, Economia de Acesso
 * e um Menu Interativo de Aprofundamento (1 a 4).
 */
export function composeTemparioExecutiveBalloon(
  response: TemparioHybridQueryResponse,
  options?: TemparioPresentationOptions
): string[] {
  const sections: string[] = [];

  // 1. Cabeçalho Executivo
  const v = response.veiculo;
  const m = response.motor;
  const marcaPura = (v?.marca && v.marca !== 'Nacional' && v.marca !== 'Multimarcas') ? `${v.marca} ` : '';
  const modeloPuro = v?.modelo ? (v.modelo.charAt(0).toUpperCase() + v.modelo.slice(1)) : 'Veículo';
  let vehicleDesc = v ? `${marcaPura}${modeloPuro}` : 'Veículo';
  if (response.isEstimativaReferencia) {
    vehicleDesc = 'Linha Passeio Padrão (Estimativa de Referência)';
  } else {
    if (v && v.anoInicio && v.anoFim) {
      vehicleDesc += v.anoInicio === v.anoFim ? ` (${v.anoInicio})` : ` (${v.anoInicio}-${v.anoFim})`;
    }
    if (m && m.descricaoComercial && m.descricaoComercial !== 'Motor Padrão') {
      vehicleDesc += ` · Motor ${m.descricaoComercial}`;
    }
  }

  const servicosTexto = response.operacoesResolvidas.length > 0
    ? response.operacoesResolvidas.map(o => o.titulo).join(' + ')
    : (response.cadeiaExecucao.steps.length > 0
        ? response.cadeiaExecucao.steps.map(s => s.titulo.replace(/\s*\(Pesquisa Técnica Web\)/gi, '')).join(' + ')
        : 'Serviços Mecânicos Solicitados');

  const isRef = Boolean(response.isEstimativaReferencia);
  const placaLabel = options?.placaConsultada ? options.placaConsultada.toUpperCase() : '';

  const headerLines: string[] = [
    '*HYDRA | Tempário Técnico & Mão de Obra*',
    ''
  ];

  if (isRef) {
    const titlePlaca = placaLabel ? `Placa ${placaLabel} · ` : '';
    headerLines.push(`> *${titlePlaca}${servicosTexto} (Estimativa de Referência)*`);
    if (placaLabel) {
      headerLines.push(`- *Placa consultada:* ${placaLabel}`);
    }
    headerLines.push(`- *Serviços:* ${servicosTexto}`);
    const diag = response.diagnosticoPlaca || 'Placa sem cadastro no ERP da rede (referência padrão para linha passeio)';
    headerLines.push(`- *Identificação veicular:* ${diag}`);
  } else {
    headerLines.push(`> *${vehicleDesc}*`);
    if (options?.placaConsultada) {
      headerLines.push(`- *Placa consultada:* ${options.placaConsultada}`);
    }
    headerLines.push(`- *Serviços:* ${servicosTexto}`);
  }
  sections.push(headerLines.join('\n'));

  // 2. Resumo de Mão de Obra (Taxa da Rede: R$ 270,00/h)
  const cadeia = response.cadeiaExecucao;
  const taxaPadrao = cadeia.taxaHorariaPadrao || 270.00;
  const valorLiquido = cadeia.valorMaoDeObraSugerido ?? Math.round(cadeia.tempoLiquidoTotalHoras * taxaPadrao * 100) / 100;
  const economiaReais = cadeia.economiaMaoDeObraReais ?? Math.round(cadeia.tempoEconomizadoDeduplicacaoHoras * taxaPadrao * 100) / 100;

  const precoLines: string[] = [
    `*Resumo de Mão de Obra (Taxa da Rede: R$ ${taxaPadrao.toFixed(2).replace('.', ',')}/h)*`
  ];

  if (isRef) {
    const minHoras = (cadeia.tempoLiquidoTotalHoras * 0.85).toFixed(2).replace('.', ',');
    const maxHoras = (cadeia.tempoLiquidoTotalHoras * 1.25).toFixed(2).replace('.', ',');
    const minVal = (valorLiquido * 0.85).toFixed(2).replace('.', ',');
    const maxVal = (valorLiquido * 1.25).toFixed(2).replace('.', ',');
    precoLines.push(
      `- *Tempo líquido sugerido:* *${formatHoursAndMin(cadeia.tempoLiquidoTotalHoras)}* (Faixa típica: ${minHoras}h a ${maxHoras}h)`,
      `- *Total Mão de Obra a Cobrar:* *R$ ${valorLiquido.toFixed(2).replace('.', ',')}* (R$ ${minVal} a R$ ${maxVal})`
    );
  } else {
    precoLines.push(
      `- *Tempo líquido cobrado:* *${formatHoursAndMin(cadeia.tempoLiquidoTotalHoras)}*`,
      `- *Total Mão de Obra a Cobrar:* *R$ ${valorLiquido.toFixed(2).replace('.', ',')}*`
    );
  }

  if (cadeia.possuiDeduplicacaoAtiva && cadeia.tempoEconomizadoDeduplicacaoHoras > 0) {
    precoLines.push(
      `- *Economia por acesso compartilhado:* *-${cadeia.tempoEconomizadoDeduplicacaoHoras.toFixed(2).replace('.', ',')}h* (-R$ ${economiaReais.toFixed(2).replace('.', ',')})`
    );
  }

  const qtdEtapas = cadeia.steps?.length || 1;
  precoLines.push(`- *Complexidade técnica:* Média (${qtdEtapas} etapas no grafo de acesso)`);
  sections.push(precoLines.join('\n'));

  // Se for estimativa de referência, convida a refinar o carro
  if (isRef) {
    const refineMsg = placaLabel
      ? `💡 _Para cravar o tempo exato e salvar a placa *${placaLabel}* no banco, qual é o modelo e ano do carro (ex: Corsa 1.4, Palio 1.0, Onix 1.0)?_`
      : `💡 _Para cravar o tempo exato para o seu veículo, informe o modelo e ano (ex: Corsa 1.4, Palio 1.0)._`;
    sections.push(refineMsg);
  }

  // Se o usuário pediu peças diretamente:
  if (options?.includePecasDirectly && cadeia.pecasNecessarias && cadeia.pecasNecessarias.length > 0) {
    const pecasLines: string[] = ['*Associativa de Peças Necessárias*'];
    for (const p of cadeia.pecasNecessarias) {
      const statusPeca = p.obrigatoria ? 'Obrigatória' : 'Preventiva recomendada';
      const spec = p.especificacaoTecnica ? ` [${p.especificacaoTecnica}]` : '';
      pecasLines.push(`- [x] ${p.nomePeca} (${p.quantidade} ${p.unidade})${spec} — ${statusPeca}`);
    }
    sections.push(pecasLines.join('\n'));
  }

  // Se o usuário pediu ferramentas diretamente:
  if (options?.includeFerramentasDirectly && cadeia.ferramentasNecessarias && cadeia.ferramentasNecessarias.length > 0) {
    const ferrLines: string[] = ['*Ferramentas Especiais Exigidas na Bancada*'];
    for (const ferr of cadeia.ferramentasNecessarias) {
      ferrLines.push(`- ${ferr}`);
    }
    if (cadeia.torquesEspecificados && cadeia.torquesEspecificados.length > 0) {
      ferrLines.push(`- *Torques Críticos:* ${cadeia.torquesEspecificados.join('; ')}`);
    }
    sections.push(ferrLines.join('\n'));
  }

  // Se não pediu tudo diretamente, adiciona o Menu Interativo
  if (!options?.includePecasDirectly && !options?.includeFerramentasDirectly) {
    const qtdPecas = cadeia.pecasNecessarias?.length || 0;
    const qtdFerr = cadeia.ferramentasNecessarias?.length || 0;

    const menuLines: string[] = [
      '----------------------------------------',
      '*Deseja ver o detalhamento técnico?*',
      `1️⃣ *Peças necessárias* (${qtdPecas > 0 ? `${qtdPecas} itens` : 'consultar lista'})`,
      `2️⃣ *Ferramentas de bancada e torques* (${qtdFerr > 0 ? `${qtdFerr} itens` : 'consultar'})`,
      '3️⃣ *Passo a passo da montagem* (sequência otimizada)',
      '4️⃣ *Tudo completo* (relatório técnico integral)',
      '',
      '_Responda com o número (1, 2, 3 ou 4) ou escreva o que precisa (ex: "peças" ou "ferramentas")._'
    ];
    sections.push(menuLines.join('\n'));
  }

  const rawFullText = sections.join('\n\n');
  const sanitized = sanitizeWhatsAppMarkdown(rawFullText).replace(/[\u00A0\u202F]/g, ' ');

  // O balão executivo é retornado como 1 único balão focado
  return [sanitized];
}

/**
 * Formata o balão cirúrgico de detalhamento de acordo com a escolha do operador (Spec 063).
 */
export function composeTemparioDetailBalloon(
  choice: TemparioDetailChoice,
  response: TemparioHybridQueryResponse
): string[] {
  if (choice === 'COMPLETO') {
    return composeTemparioHermesBalloon(response);
  }

  const sections: string[] = [];
  const v = response.veiculo;
  const m = response.motor;
  const marcaPura = (v?.marca && v.marca !== 'Nacional' && v.marca !== 'Multimarcas') ? `${v.marca} ` : '';
  const modeloPuro = v?.modelo ? (v.modelo.charAt(0).toUpperCase() + v.modelo.slice(1)) : 'Veículo';
  let vehicleDesc = v ? `${marcaPura}${modeloPuro}` : 'Veículo';
  if (response.isEstimativaReferencia) {
    vehicleDesc = 'Linha Passeio Padrão (Estimativa de Referência)';
  } else {
    if (v && v.anoInicio && v.anoFim) {
      vehicleDesc += v.anoInicio === v.anoFim ? ` (${v.anoInicio})` : ` (${v.anoInicio}-${v.anoFim})`;
    }
    if (m && m.descricaoComercial && m.descricaoComercial !== 'Motor Padrão') {
      vehicleDesc += ` · Motor ${m.descricaoComercial}`;
    }
  }

  const servicosTexto = response.operacoesResolvidas.length > 0
    ? response.operacoesResolvidas.map(o => o.titulo).join(' + ')
    : 'Serviços Mecânicos Solicitados';

  const cadeia = response.cadeiaExecucao;

  if (choice === 'PECAS') {
    sections.push(
      `*HYDRA | Peças Necessárias*\n\n> *${vehicleDesc}*\n- *Serviço:* ${servicosTexto}`
    );

    if (cadeia.pecasNecessarias && cadeia.pecasNecessarias.length > 0) {
      const pecasObrigatorias = cadeia.pecasNecessarias.filter(p => p.obrigatoria);
      const pecasPreventivas = cadeia.pecasNecessarias.filter(p => !p.obrigatoria);

      if (pecasObrigatorias.length > 0) {
        const lines = ['*Peças Obrigatórias para Montagem*'];
        for (const p of pecasObrigatorias) {
          const spec = p.especificacaoTecnica ? ` [${p.especificacaoTecnica}]` : '';
          lines.push(`- [x] ${p.nomePeca} (${p.quantidade} ${p.unidade})${spec}`);
        }
        sections.push(lines.join('\n'));
      }

      if (pecasPreventivas.length > 0) {
        const lines = ['*Itens Preventivos Recomendados*'];
        for (const p of pecasPreventivas) {
          const spec = p.especificacaoTecnica ? ` [${p.especificacaoTecnica}]` : '';
          lines.push(`- [ ] ${p.nomePeca} (${p.quantidade} ${p.unidade})${spec} — Opcional/Recomendado`);
        }
        sections.push(lines.join('\n'));
      }
    } else {
      sections.push('Nenhuma peça obrigatória adicional registrada para este procedimento.');
    }
  } else if (choice === 'FERRAMENTAS') {
    sections.push(
      `*HYDRA | Ferramental & Torques de Bancada*\n\n> *${vehicleDesc}*\n- *Serviço:* ${servicosTexto}`
    );

    if (cadeia.ferramentasNecessarias && cadeia.ferramentasNecessarias.length > 0) {
      const ferrLines = ['*Ferramental Especial Exigido na Bancada*'];
      for (const f of cadeia.ferramentasNecessarias) {
        ferrLines.push(`- ${f}`);
      }
      sections.push(ferrLines.join('\n'));
    }

    if (cadeia.torquesEspecificados && cadeia.torquesEspecificados.length > 0) {
      const torqueLines = ['*Torques Críticos Tabelados pela Montadora*'];
      for (const t of cadeia.torquesEspecificados) {
        torqueLines.push(`- ${t}`);
      }
      sections.push(torqueLines.join('\n'));
    }

    if ((!cadeia.ferramentasNecessarias || cadeia.ferramentasNecessarias.length === 0) &&
        (!cadeia.torquesEspecificados || cadeia.torquesEspecificados.length === 0)) {
      sections.push('Ferramentas manuais convencionais de oficina mecânica.');
    }
  } else if (choice === 'PASSOS') {
    sections.push(
      `*HYDRA | Sequência Técnica de Execução*\n\n> *${vehicleDesc}*\n- *Serviço:* ${servicosTexto}`
    );

    if (cadeia.steps && cadeia.steps.length > 0) {
      const stepLines = ['*Passo a Passo Otimizado (Grafo de Acesso)*'];
      for (const step of cadeia.steps) {
        const faseLabel = step.faseExecucao === 'PRE_REQUISITO' ? 'Pré-Requisito'
          : step.faseExecucao === 'DESMONTAGEM' ? 'Desmontagem'
          : step.faseExecucao === 'ACESSO' ? 'Acesso'
          : step.faseExecucao === 'EXECUCAO' ? 'Execução'
          : step.faseExecucao === 'REMONTAGEM' ? 'Remontagem'
          : 'Finalização e Teste';

        let line = `- *${step.ordemExecucaoFinal}. ${step.titulo} (${faseLabel}):* *${step.tempoHoras.toFixed(2).replace('.', ',')}h* (${step.tempoMinutos} min)`;
        if (step.ferramentas && step.ferramentas.length > 0) {
          line += `\n  Ferramentas: ${step.ferramentas.join(', ')}`;
        }
        if (step.torqueEspecificado) {
          line += ` (Torque: ${step.torqueEspecificado})`;
        }
        if (step.isAcessoCompartilhado) {
          line += `\n  Acesso compartilhado entre os serviços (contabilizado 1 única vez)`;
        }
        stepLines.push(line);
      }
      sections.push(stepLines.join('\n'));
    }
  }

  const rawFullText = sections.join('\n\n');
  const sanitized = sanitizeWhatsAppMarkdown(rawFullText).replace(/[\u00A0\u202F]/g, ' ');
  return [sanitized];
}

/**
 * Compõe balão honesto e direto quando uma placa não consta no histórico das lojas nem na base externa,
 * solicitando o modelo do veículo para vincular à placa e calcular o tempário sem alucinação (Spec 066).
 */
export function composeUnresolvedPlateTemparioBalloon(params: {
  readonly placa: string;
  readonly servicos: readonly string[];
}): string[] {
  const servicosLimpos = params.servicos
    .map(s => s.replace(/\b[A-Z]{3}-?[0-9][A-Z0-9][0-9]{2}\b/gi, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' + ') || 'Serviço mecânico solicitado';

  const lines: string[] = [
    '*HYDRA | Tempário Técnico & Mão de Obra*',
    '',
    `> *Identificação de Placa Pendente — ${params.placa.toUpperCase()}*`,
    `- *Serviço solicitado:* ${servicosLimpos}`,
    '- *Status no sistema:* Placa sem Ordem de Serviço anterior na rede e não localizada na base externa',
    '',
    `Qual é o *modelo e ano* desse veículo (ex: *Corsa 1.4 2010*, *Palio 1.0 2012*, *Onix 1.0*)?`,
    `_Responda apenas o carro/ano que já vinculo à placa *${params.placa.toUpperCase()}* e calculo a mão de obra exata (R$ 270,00/h)._`
  ];

  const rawText = lines.join('\n');
  const sanitized = sanitizeWhatsAppMarkdown(rawText).replace(/[\u00A0\u202F]/g, ' ');
  return [sanitized];
}

/**
 * Compõe balão visual Hermes V2 para exibição de dados cadastrais veiculares por placa (Spec 064).
 */
export function composePlateVehicleBalloon(record: VehiclePlateRecord): string[] {
  const anoStr = record.anoModelo
    ? (record.anoFabricacao && record.anoFabricacao !== record.anoModelo
        ? ` (${record.anoFabricacao}/${record.anoModelo})`
        : ` (${record.anoModelo})`)
    : '';

  const header = `*HYDRA | Consulta Veicular por Placa*\n\n> *${record.modeloCompleto}${anoStr}*`;

  const details: string[] = [];
  details.push(`- *Placa:* ${record.placaFormatada}`);

  const corComb: string[] = [];
  if (record.cor) corComb.push(`*Cor:* ${record.cor}`);
  if (record.combustivel) corComb.push(`*Combustível:* ${record.combustivel}`);
  if (corComb.length > 0) {
    details.push(`- ${corComb.join(' · ')}`);
  }

  const loc: string[] = [];
  if (record.municipio) loc.push(record.municipio);
  if (record.uf) loc.push(record.uf);
  if (loc.length > 0) {
    details.push(`- *Município:* ${loc.join(' / ')}`);
  }

  const mec: string[] = [];
  if (record.motor) mec.push(`*Motor:* ${record.motor}`);
  if (record.potencia) mec.push(`*Potência:* ${record.potencia} cv`);
  if (record.cilindrada) mec.push(`*Cilindradas:* ${record.cilindrada} cc`);
  if (mec.length > 0) {
    details.push(`- ${mec.join(' · ')}`);
  }

  if (record.chassiMascarado) {
    details.push(`- *Chassi:* \`${record.chassiMascarado}\``);
  }

  const situacao = record.situacao ? (record.situacao === 'CIRCULACAO' ? 'Em circulação (Regular)' : record.situacao) : 'Em circulação (Regular)';
  details.push(`- *Situação cadastral:* ${situacao}`);

  const fonte = record.origemDados === 'ORDENS_SERVICO_REDE'
    ? '_Dados recuperados do histórico operacional da rede de oficinas._'
    : '_Dados obtidos via Base Nacional de Registro Veicular (APIBrasil)._';

  const balloonText = `${header}\n${details.join('\n')}\n\n${fonte}`;
  const sanitized = sanitizeWhatsAppMarkdown(balloonText).replace(/[\u00A0\u202F]/g, ' ');
  return [sanitized];
}
