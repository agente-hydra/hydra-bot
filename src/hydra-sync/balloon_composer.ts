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

    // 1. Resposta Direta (primeiro card ou conclusão)
    if (!directAnswer && (para.startsWith('>') || lower.includes('conclusão') || lower.includes('resumo'))) {
      directAnswer = para;
      continue;
    }

    // 3. Detalhes pedidos (listas, lojas, métricas, cards)
    detailBlocks.push(para);
  }

  // Se não foi encontrada resposta direta explícita, o primeiro parágrafo é a resposta direta
  if (!directAnswer && detailBlocks.length > 0) {
    directAnswer = detailBlocks.shift();
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
    // Ex: *Item* ou > *Título* ou *Título:* seguido por - *Campo:*
    const isCardHeader = firstLine.startsWith('>') || /^\*[^*]+\*$/.test(firstLine) || /^\*[^*]+:\*$/.test(firstLine);
    const hasFieldBullets = lines.slice(1).some(l => /^\s*-\s+/.test(l));

    if (isCardHeader && hasFieldBullets) {
      // Card indivisível: mantém todo o bloco unido
      items.push(block.trim());
    } else if (lines.length > 1 && lines.every(l => /^\s*-\s+/.test(l))) {
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
