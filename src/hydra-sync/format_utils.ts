/**
 * HYDRA FORMAT UTILS (Frente C & Frente 2)
 * Utilitários determinísticos de formatação e sanitização nativa para WhatsApp.
 * 
 * Regras:
 * 1. Zero asteriscos duplos (**) e zero underscores duplos (__) — apenas negrito simples (*) e itálico simples (_).
 * 2. Conversão de tabelas Markdown em cards nativos de WhatsApp (*Item / OS*, - *Coluna:* Valor) [E2-02].
 * 3. Política de Zero Emoji com exceção estrita de teto 1 para alerta crítico comprovado [E2-01].
 * 4. Alinhamento uniforme de listas com recuo e negrito em pares chave-valor (- *Chave:* Valor).
 * 5. Prevenção de quebras no meio de identificadores literais (#426, placas, valores monetários).
 * 6. Barreira Anti-Balão Vazio: nunca despachar balões com palavras isoladas ("Entendi." sozinho) [E2-05].
 */

import type { TableToBlockResult } from './types/language_contract.js';

export function fmtMoeda(val: number): string {
  return (val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export interface GoalAchievementCalculation {
  faturamentoMes: number;
  metaMes: number;
  faturamento: number;
  meta: number;
  percentualAtingimento: number; // Ex: 88.5
  valorFaltante: number; // Ex: 15000 se não bateu, 0 se bateu
  superavit: number; // Ex: 5000 se bateu, 0 se não bateu
  volumeOS?: number;
  ticketMedio?: number;
  isMetaAlcancada: boolean;
  statusTexto: string;
  atingimentoFormatado: string; // Ex: "88,5%"
  valorFaltanteFormatado: string; // Ex: "R$ 15.000,00"
  lojaSlug?: string;
  lojaNome?: string;
  posicaoHora?: string;
  [key: string]: any;
}

/**
 * Calcula métricas de atingimento de meta de forma unificada e determinística.
 */
export function calculateGoalMetrics(
  faturamento: number,
  meta: number,
  extra?: {
    volumeOS?: number;
    ticketMedio?: number;
    lojaSlug?: string;
    lojaNome?: string;
    posicaoHora?: string;
    [key: string]: any;
  }
): GoalAchievementCalculation {
  const fat = Math.max(0, Number(faturamento) || 0);
  const metaVal = Math.max(0, Number(meta) || 0);

  let percentualAtingimento = 0;
  let valorFaltante = 0;
  let superavit = 0;
  let isMetaAlcancada = false;

  if (metaVal > 0) {
    percentualAtingimento = (fat / metaVal) * 100;
    if (fat >= metaVal) {
      isMetaAlcancada = true;
      superavit = fat - metaVal;
      valorFaltante = 0;
    } else {
      isMetaAlcancada = false;
      valorFaltante = metaVal - fat;
      superavit = 0;
    }
  } else {
    percentualAtingimento = fat > 0 ? 100 : 0;
    isMetaAlcancada = fat > 0;
    valorFaltante = 0;
    superavit = fat;
  }

  const pctAtingFmt = `${percentualAtingimento.toFixed(1).replace('.', ',')}%`;
  const valorFaltanteFmt = fmtMoeda(valorFaltante);
  const statusTexto = isMetaAlcancada
    ? `Meta alcançada (${pctAtingFmt})`
    : `Falta ${valorFaltanteFmt} (${pctAtingFmt} atingido)`;

  return {
    faturamentoMes: fat,
    metaMes: metaVal,
    faturamento: fat,
    meta: metaVal,
    percentualAtingimento,
    valorFaltante,
    superavit,
    volumeOS: extra?.volumeOS,
    ticketMedio: extra?.ticketMedio,
    isMetaAlcancada,
    statusTexto,
    atingimentoFormatado: pctAtingFmt,
    valorFaltanteFormatado: valorFaltanteFmt,
    lojaSlug: extra?.lojaSlug,
    lojaNome: extra?.lojaNome,
    posicaoHora: extra?.posicaoHora,
    ...extra
  };
}

/**
 * Normaliza e alinha visualmente listas para WhatsApp:
 * - Padroniza marcadores: '- ' para primeiro nível, '  - ' para sub-itens
 * - Remove espaços extras entre o marcador e o texto
 * - Garante espaçamento uniforme em campos chave-valor: '- *Chave:* Valor'
 * - Corrige espaços antes de dois pontos ('*Chave* : ' -> '*Chave:* ')
 */
export function alignWhatsAppList(text: string): string {
  if (!text) return '';

  const lines = text.split('\n');
  const aligned: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Ignora linhas de bloco ou separadores
    if (line.trim().startsWith('---BLOCK---') || /^[-*_]{3,}/.test(line.trim())) {
      aligned.push(line);
      continue;
    }

    // Detecta item de lista (com marcador -, •, + ou * seguido OBRIGATORIAMENTE de espaço)
    // Se começar com '*', só é item de lista se houver espaço após o asterisco (* item)
    // Se não tiver espaço (*Negrito*), NÃO é marcador de lista!
    const isBoldHeading = /^\s*\*([^*]+)\*(?:\s*)$/.test(line);
    const listMatch = !isBoldHeading ? line.match(/^(\s*)([-•+]|\*(?=\s))\s+(.*)$/) : null;
    if (listMatch) {
      const indent = listMatch[1];
      const rawContent = listMatch[3].trim();
      // Subnível se tiver 2 ou mais espaços de indentação
      const prefix = indent.length >= 2 ? '  - ' : '- ';

      let formattedContent = rawContent;

      // Corrige caso "*Chave* : Valor" ou "*Chave*: Valor" -> "*Chave:* Valor"
      formattedContent = formattedContent.replace(/^\*([^*:\n]+)\*\s*:\s*/, '*$1:* ');

      // Corrige caso "Chave: Valor" onde Chave não tem negrito ainda
      if (!formattedContent.startsWith('*')) {
        formattedContent = formattedContent.replace(/^([A-Za-zÀ-ÖØ-öø-ÿ0-9\s/—–-]{2,30}):\s+(?!\*)/, (_m, key) => {
          return `*${key.trim()}:* `;
        });
      }

      aligned.push(`${prefix}${formattedContent}`);
    } else {
      aligned.push(line);
    }
  }

  return aligned.join('\n');
}

/**
 * [E2-01]: Política de Zero Emoji para WhatsApp Executivo e Operacional:
 * - Regex Unicode estrita (/\p{Extended_Pictographic}/gu) para expurgar emojis em saudações, despedidas, títulos, itens e rankings.
 * - Teto máximo: 1 emoji em caso de alerta operacional comprovado por regra de negócio (ex: veículo retido há mais de 30 dias).
 * - Preferir sempre o texto "*Atenção:*" em vez de emoji.
 */
export function purgeDecorativeEmojis(
  text: string,
  options?: {
    allowCriticalAlertEmoji?: boolean;
    maxCriticalAlertEmojis?: number;
  }
): string {
  if (!text || typeof text !== 'string') return '';

  // 1. Verifica se há regra de negócio de alerta crítico comprovado (ex: veículo retido há mais de 30 dias)
  const hasProvenCriticalAlert =
    options?.allowCriticalAlertEmoji === true ||
    /\b(?:retid[ao]s?\s+h[áa]\s+mais\s+de\s+(?:3[0-9]|[4-9][0-9]|\d{3,})\s+dias|mais\s+de\s+(?:3[0-9]|[4-9][0-9]|\d{3,})\s+dias\s+no\s+p[áa]tio|dias_no_patio\s*>\s*30)\b/i.test(text);

  const maxAlertEmojis = hasProvenCriticalAlert ? (options?.maxCriticalAlertEmojis ?? 1) : 0;
  const ALERT_EMOJIS = new Set(['🚨', '⚠️', '❗', '🛑', '⚡']);

  // Regex Unicode estrita para Extended_Pictographic cobrindo variantes e sequências ZWJ
  const EMOJI_REGEX = /(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:[\uFE0E\uFE0F]|\uD83C[\uDFFB-\uDFFF])?(?:\u200D(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:[\uFE0E\uFE0F]|\uD83C[\uDFFB-\uDFFF])?)*/gu;

  let alertEmojisUsed = 0;

  let result = text.replace(EMOJI_REGEX, (match, offset, fullString) => {
    // Se for emoji de alerta e estiver dentro do teto permitido para alerta crítico comprovado
    if (ALERT_EMOJIS.has(match) && alertEmojisUsed < maxAlertEmojis) {
      alertEmojisUsed++;
      return match;
    }

    // Se for um emoji de alerta que estamos removendo, verificar se convém substituir por "*Atenção:*"
    if (ALERT_EMOJIS.has(match)) {
      const remaining = fullString.slice(offset + match.length).trim();
      if (!remaining.toLowerCase().startsWith('atenção:') && !remaining.toLowerCase().startsWith('*atenção:*')) {
        const before = fullString.slice(0, offset).trim();
        if (before.endsWith('>') || before.endsWith('\n') || before === '') {
          return '*Atenção:* ';
        }
      }
    }

    // Todos os demais emojis (saudações, despedidas, títulos, itens e rankings) são expurgados
    return '';
  });

  // Limpeza de espaços duplicados deixados pela remoção do emoji
  result = result
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[ \t]+/gm, (m) => m) // preserva indentação
    .replace(/ \n/g, '\n')
    .trim();

  return result;
}

/**
 * [E2-02]: Conversor Estruturado Anti-Tabela:
 * Analisa tabelas Markdown com barras (|) emitidas pelo modelo ou renderizadores.
 * Converte deterministicamente cada linha em cards nativos de WhatsApp:
 * *Item / OS*
 * - *Coluna A:* Valor A
 * - *Coluna B:* Valor B
 * Preserva 100% dos dados, rótulos e valores sem perda de células.
 */
export function convertMarkdownTableToNativeBlocks(text: string): TableToBlockResult {
  if (!text || !text.includes('|')) {
    return {
      hasTable: false,
      originalTableText: text,
      convertedBlocksText: text,
      rowsProcessed: 0,
      dataPreserved: true
    };
  }

  const lines = text.split('\n');
  const convertedLines: string[] = [];
  let inTable = false;
  let tableHeaders: string[] = [];
  let tableDataRows: string[][] = [];
  let totalRowsProcessed = 0;
  let hasAnyTable = false;

  const flushCurrentTable = () => {
    if (tableHeaders.length > 0 && tableDataRows.length > 0) {
      hasAnyTable = true;
      const cards: string[] = [];

      for (let r = 0; r < tableDataRows.length; r++) {
        const row = tableDataRows[r];
        if (row.length === 0) continue;

        // O primeiro campo vira o cabeçalho do card: *Item / OS*
        const firstColVal = row[0].replace(/^\*+|\*+$/g, '').trim();
        const firstHeader = tableHeaders[0] ? tableHeaders[0].trim() : 'Item';

        let cardTitle = '';
        if (firstColVal.toLowerCase().startsWith(firstHeader.toLowerCase())) {
          cardTitle = `*${firstColVal}*`;
        } else if (
          firstHeader.toLowerCase().includes('item') ||
          firstHeader.toLowerCase().includes('loja') ||
          firstHeader.toLowerCase().includes('unidade')
        ) {
          cardTitle = `*${firstColVal}*`;
        } else if (firstHeader.toLowerCase() === 'os') {
          cardTitle = firstColVal.startsWith('#') ? `*OS ${firstColVal}*` : `*OS #${firstColVal}*`;
        } else {
          cardTitle = `*${firstHeader}: ${firstColVal}*`;
        }

        const fieldLines: string[] = [];
        for (let c = 1; c < Math.max(tableHeaders.length, row.length); c++) {
          const header = (tableHeaders[c] || `Coluna ${c + 1}`).trim();
          const val = (row[c] !== undefined ? row[c] : '-').trim();
          fieldLines.push(`- *${header}:* ${val || '-'}`);
        }

        const card = fieldLines.length > 0
          ? `${cardTitle}\n${fieldLines.join('\n')}`
          : cardTitle;

        cards.push(card);
        totalRowsProcessed++;
      }

      convertedLines.push(cards.join('\n\n'));
    } else if (tableDataRows.length > 0) {
      // Tabela sem linha de cabeçalho
      hasAnyTable = true;
      const cards: string[] = [];
      for (const row of tableDataRows) {
        if (row.length === 0) continue;
        const first = row[0].replace(/^\*+|\*+$/g, '').trim();
        const otherFields = row.slice(1).map((val, idx) => `- *Campo ${idx + 1}:* ${val}`);
        cards.push(otherFields.length > 0 ? `*${first}*\n${otherFields.join('\n')}` : `*${first}*`);
        totalRowsProcessed++;
      }
      convertedLines.push(cards.join('\n\n'));
    }

    inTable = false;
    tableHeaders = [];
    tableDataRows = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Linha de tabela válida se começar e terminar com | ou tiver pelo menos 2 pipes
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && (trimmed.match(/\|/g) || []).length >= 2) {
      const cols = trimmed
        .slice(1, -1)
        .split('|')
        .map(c => c.trim());

      // É linha separadora Markdown (|---|---|...)?
      const isSeparator = cols.every(c => /^[:\s\-]+$/.test(c));

      if (isSeparator) {
        inTable = true;
        continue;
      }

      if (!inTable && tableHeaders.length === 0) {
        tableHeaders = cols;
        continue;
      }

      tableDataRows.push(cols);
    } else {
      if (inTable || tableHeaders.length > 0 || tableDataRows.length > 0) {
        flushCurrentTable();
      }
      convertedLines.push(rawLine);
    }
  }

  if (inTable || tableHeaders.length > 0 || tableDataRows.length > 0) {
    flushCurrentTable();
  }

  const finalConverted = convertedLines.join('\n');

  return {
    hasTable: hasAnyTable,
    originalTableText: text,
    convertedBlocksText: finalConverted,
    rowsProcessed: totalRowsProcessed,
    dataPreserved: true
  };
}

/**
 * Converte tabelas Markdown para blocos de WhatsApp (helper simplificado).
 */
export function convertMarkdownTablesToWhatsAppBlocks(text: string): string {
  return convertMarkdownTableToNativeBlocks(text).convertedBlocksText;
}

/**
 * Converte qualquer markdown de padrão CommonMark/GitHub para a sintaxe nativa do WhatsApp,
 * preservando identificadores literais (#426, placas, moedas), garantindo zero asteriscos duplos,
 * conversão estruturada de tabelas em cards [E2-02] e política de zero emoji [E2-01].
 */
export function sanitizeWhatsAppMarkdown(raw: string): string {
  if (!raw) return '';

  let text = String(raw);

  // 0. Correção de caracteres e palavras corrompidas em queries/strings ("Retidos h? mais de 5 dias")
  text = text.replace(/Retidos\s+h\?\s+mais\s+de\s+(\d+)\s+dias/gi, 'Retidos há mais de $1 dias');
  text = text.replace(/\bRetidos\s+h\?\b/gi, 'Retidos há');
  text = text.replace(/\bh\?\s+mais/gi, 'há mais');
  text = text.replace(/\bh\?\b/g, 'há');
  text = text.replace(/\bt\?\s+h\?\b/gi, 'tá há');
  text = text.replace(/\bt\?\b/g, 'tá');
  text = text.replace(/Situa\?\?o/gi, 'Situação');
  text = text.replace(/Perman\?ncia/gi, 'Permanência');
  text = text.replace(/Cen\?rio/gi, 'Cenário');
  text = text.replace(/espec\?fic([ao]s?)/gi, 'específic$1');

  // 1. Converte cabeçalhos Markdown (# Título ou ### Título) em Blockquotes do WhatsApp (> *Título*)
  text = text.replace(/^#{1,6}\s+(.+)$/gm, (_match, p1) => {
    const trimmed = p1.trim();
    if (trimmed.startsWith('*') && trimmed.endsWith('*')) {
      return `> ${trimmed}`;
    }
    return `> *${trimmed}*`;
  });

  // 2. Preserva separadores visuais nativos do WhatsApp estilo Hermes (------------ ou ----------------------------------------)
  // Normaliza linhas com 6 ou mais traços para o separador oficial de cards
  text = text.replace(/^[\t ]*-{6,}[\t ]*$/gm, '----------------------------------------');
  // Remove apenas ruídos residuais de markdown como asteriscos, underscores ou traços muito curtos
  text = text.replace(/^(?!---BLOCK---|----------------------------------------)[\t ]*[*_]{3,}[\t ]*$/gm, '');
  text = text.replace(/^(?!---BLOCK---|----------------------------------------)[\t ]*-{3,5}[\t ]*$/gm, '');

  // 3. Converte tabelas markdown em cards nativos de WhatsApp [E2-02]
  if (text.includes('|')) {
    const tableRes = convertMarkdownTableToNativeBlocks(text);
    if (tableRes.hasTable) {
      text = tableRes.convertedBlocksText;
    }
  }

  // 3.1. Transforma linhas agrupadas com pipes em cards/blocos estilo Hermes [R13]
  if (text.includes('|')) {
    text = reformatPipedLinesToHermesCards(text);
  }

  // 4. Converte negrito duplo (**) e asteriscos triplos (***) para negrito simples (*)
  text = text.replace(/\*\*\*+([^*\n]+?)\*\*\*+/g, '*$1*');
  text = text.replace(/\*\*([^*\n]+?)\*\*/g, '*$1*');

  // 5. Converte itálico duplo (__) para itálico simples (_)
  text = text.replace(/__([^_\n]+?)__/g, '_$1_');

  // 6. Normaliza marcadores de lista variados (•, +, ou * solto com espaço) para traço nativo (- )
  text = text.replace(/^[\t ]*[•+]\s+/gm, '- ');
  text = text.replace(/^[\t ]*\*\s+(?!\*)/gm, '- ');

  // 7. Garante que campos chave-valor em listas tenham a chave em negrito (- *Chave:* Valor)
  text = text.replace(/^([\t ]*-\s+)([A-Za-zÀ-ÖØ-öø-ÿ0-9\s/—–-]{2,30}:)\s+(?!\*)/gm, (_m, prefix, key) => {
    return `${prefix}*${key.trim()}* `;
  });

  // 8. Alinhamento visual e normalização de listas
  text = alignWhatsAppList(text);

  // 9. Blindagem estrita: limpeza de asteriscos e underscores duplos residuais (garantia zero **)
  while (text.includes('**')) {
    text = text.replace(/\*\*/g, '*');
  }
  while (text.includes('__')) {
    text = text.replace(/__/g, '_');
  }

  // 10. Política de Zero Emoji [E2-01]
  text = purgeDecorativeEmojis(text);

  // 11. Remove tags HTML residuais
  text = text.replace(/<[^>]+>/g, '');

  // 12. Remove acúmulo excessivo de linhas em branco (> 2 quebras seguidas)
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

/**
 * Transforma linhas agregadas com pipes em cards ou blocos verticais estilo Hermes [R13]
 */
export function reformatPipedLinesToHermesCards(text: string): string {
  if (!text || !text.includes('|')) return text;

  const lines = text.split('\n');
  const output: string[] = [];
  let inStorePatioSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Rastreia seções de resumo ou pátio
    if (/Posi[çc][ãa]o\s+de\s+p[áa]tio/i.test(trimmed) || /Gargalos\s+de\s+reten[çc][ãa]o/i.test(trimmed)) {
      inStorePatioSection = true;
      output.push(line);
      continue;
    }
    if (trimmed.startsWith('*') && trimmed.endsWith('*') && !/Posi[çc][ãa]o\s+de\s+p[áa]tio/i.test(trimmed) && !/Gargalos/i.test(trimmed)) {
      inStorePatioSection = false;
    }

    // Pattern 1: Multi-line OS (como na Captura de tela 143508)
    // Linha 1: [•-] Modelo (PLACA) | OS #1234 | Cliente
    // Linha 2: Status: ... | Pátio: ... | Valor: ...
    const multiLineOsMatch = trimmed.match(/^[-•*]\s*([^(|]+?)\s*\(([^)]+)\)\s*\|\s*(?:OS\s*)?#?(\d+)\s*\|\s*([^|]+)$/i);
    if (multiLineOsMatch && i + 1 < lines.length) {
      const nextLine = lines[i + 1].trim();
      const statusMatch = nextLine.match(/Status:\s*([^|]+)\s*\|\s*(?:Pátio|Aging|Permanência):\s*([^|]+)\s*\|\s*Valor:\s*([^|\n]+)/i);
      if (statusMatch) {
        const model = multiLineOsMatch[1].replace(/[*_]/g, '').trim().toUpperCase();
        const plate = multiLineOsMatch[2].replace(/[*_]/g, '').trim().toUpperCase();
        const osId = multiLineOsMatch[3].trim();
        const client = multiLineOsMatch[4].replace(/[*_]/g, '').trim();
        const status = statusMatch[1].trim();
        const patio = statusMatch[2].trim();
        const valor = statusMatch[3].trim();

        output.push('----------------------------------------');
        output.push(`> *OS #${osId} — ${model} (${plate})*`);
        output.push(`- *Status:* ${status} • *Pátio:* ${patio}`);
        output.push(`- *Cliente:* ${client}`);
        output.push(`- *Valor:* ${valor}`);
        i++; // pula nextLine
        continue;
      }
    }

    // Pattern 2: OS completa em linha única com pipes (como no log 2459)
    // - *Focus* (LLX5E81) | OS #8803 | Vanderlei Lucchetti | 6 dias | Em Execução | Total: R$ 12.206,60 (Resta: R$ 6.394,60)
    const singleLineOsMatch = trimmed.match(/^[-•*]\s*(?:[*_])?([^(|]+?)(?:[*_])?\s*\(([^)]+)\)\s*\|\s*(?:OS\s*)?#?(\d+)\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*(.+)$/i);
    if (singleLineOsMatch) {
      const model = singleLineOsMatch[1].replace(/[*_]/g, '').trim().toUpperCase();
      const plate = singleLineOsMatch[2].replace(/[*_]/g, '').trim().toUpperCase();
      const osId = singleLineOsMatch[3].trim();
      const client = singleLineOsMatch[4].replace(/[*_]/g, '').trim();
      const patio = singleLineOsMatch[5].trim();
      const status = singleLineOsMatch[6].trim();
      const valor = singleLineOsMatch[7].trim();

      output.push('----------------------------------------');
      output.push(`> *OS #${osId} — ${model} (${plate})*`);
      output.push(`- *Status:* ${status} • *Pátio:* ${patio}`);
      output.push(`- *Cliente:* ${client}`);
      output.push(`- *Valor:* ${valor}`);
      continue;
    }

    // Pattern 3: Resumo de pátio por loja com pipes (log 2461)
    // - Rudge Ramos: 6 veículos em atendimento | Valor em serviço: R$ 23.773,35 | Saldo a receber: R$ 11.879,54
    const storeOverviewMatch = trimmed.match(/^[-•*]\s*(?:\*)?([A-Za-zÀ-ÖØ-öø-ÿ0-9\s/—–-]+?)(?:\*)?:\s*(\d+\s+veículos[^\n|]*)\s*\|\s*Valor(?:\s+em\s+serviço)?:\s*([^|]+)\s*\|\s*Saldo(?:\s+a\s+receber)?:\s*([^|\n]+)$/i);
    if (storeOverviewMatch) {
      const storeName = storeOverviewMatch[1].replace(/[*_]/g, '').trim();
      const vehCount = storeOverviewMatch[2].trim();
      const valServico = storeOverviewMatch[3].replace(/[*_]/g, '').trim();
      const saldo = storeOverviewMatch[4].replace(/[*_]/g, '').trim();

      output.push('----------------------------------------');
      output.push(`> *${storeName} (${vehCount})*`);
      output.push(`- *Valor em serviço:* ${valServico}`);
      output.push(`- *Saldo a receber:* ${saldo}`);
      continue;
    }

    // Pattern 4: Linha de retenção/aging com múltiplas OSs unidas por pipe
    // - Rei do Óleo Mauá: OS #22601 (Fox - EBX8211) · 6 dias no pátio | OS #22626 (Sonic - FQK6B71) · 6 dias no pátio
    const agingMultiMatch = trimmed.match(/^[-•*]\s*(?:\*)?([A-Za-zÀ-ÖØ-öø-ÿ0-9\s/—–-]+?)(?:\*)?:\s*(OS\s*#\d+[^\n|]+)\s*\|\s*(OS\s*#\d+.+)$/i);
    if (agingMultiMatch) {
      const storeName = agingMultiMatch[1].replace(/[*_]/g, '').trim();
      const osParts = trimmed.substring(trimmed.indexOf(':') + 1).split('|').map(p => p.trim()).filter(Boolean);

      output.push('----------------------------------------');
      output.push(`> *${storeName}*`);
      for (const part of osParts) {
        output.push(`- ${part}`);
      }
      continue;
    }

    // Pattern 5: Linha única de aging sob seção de pátio/retenção
    // - Dom Pedro I: OS #578 (Peugeot 408 Allure - FRI8G91) · 29 dias no pátio
    const agingSingleMatch = trimmed.match(/^[-•*]\s*(?:\*)?([A-Za-zÀ-ÖØ-öø-ÿ0-9\s/—–-]+?)(?:\*)?:\s*(OS\s*#\d+\s*\([^)]+\)\s*·\s*\d+\s+dias[^\n]*)$/i);
    if (agingSingleMatch && inStorePatioSection) {
      const storeName = agingSingleMatch[1].replace(/[*_]/g, '').trim();
      const osDesc = agingSingleMatch[2].trim();
      output.push('----------------------------------------');
      output.push(`> *${storeName}*`);
      output.push(`- ${osDesc}`);
      continue;
    }

    // Pattern 6: Linhas residuais contendo pipes "|"
    if (trimmed.includes('|') && !trimmed.startsWith('|')) {
      const parts = trimmed.split('|').map(p => p.trim()).filter(Boolean);
      if (parts.length > 1) {
        if (parts[0].startsWith('-') || parts[0].startsWith('•')) {
          output.push(parts[0]);
          for (let pIdx = 1; pIdx < parts.length; pIdx++) {
            const sub = parts[pIdx];
            if (sub.includes(':')) {
              output.push(`  - ${sub}`);
            } else {
              output.push(`  • ${sub}`);
            }
          }
          continue;
        }
      }
    }

    output.push(line);
  }

  let result = output.join('\n');
  result = result.replace(/(?:----------------------------------------\s*\n\s*){2,}/g, '----------------------------------------\n');
  return result;
}

/**
 * Asserção clássica para validação de ausência de ** e __
 */
export function assertNoDoubleAsterisks(text: string): boolean {
  if (!text) return true;
  return !/\*\*/.test(text) && !/__/.test(text);
}

/**
 * Asserção estrita para conformidade com a sintaxe nativa do WhatsApp:
 * - Zero asteriscos duplos (**)
 * - Zero underscores duplos (__)
 * - Zero títulos CommonMark no início de linha (^#+)
 * - Zero separadores horizontais residuais
 * - Zero tabelas Markdown brutas (|---|)
 */
export function assertWhatsAppNativeFormat(text: string): boolean {
  if (!text) return true;
  if (/\*\*|__/.test(text)) return false;
  if (/^#{1,6}\s+/m.test(text)) return false;
  if (/^(?!---BLOCK---|----------------------------------------)[\t ]*[-*_]{3,}[\t ]*$/m.test(text)) return false;
  if (/^\|[\s\-:|]+\|$/m.test(text)) return false;
  return true;
}

/**
 * [E2-05]: Barreira Anti-Balão Vazio:
 * Proíbe o despacho de balões contendo apenas palavras isoladas (ex.: "Entendi." sozinho).
 * Se houver introdução curta, deve permanecer junto no mesmo balão.
 */
export function enforceAntiEmptyBalloons(balloons: string[]): string[] {
  const filtered = balloons
    .map(b => b.trim())
    .filter(b => b.length > 0);

  if (filtered.length <= 1) {
    return filtered;
  }

  const result: string[] = [];

  for (let i = 0; i < filtered.length; i++) {
    const b = filtered[i];

    // Detecta balão com apenas palavra isolada ou saudação / confirmação curta (<= 40 chars sem card)
    const isIsolatedWord =
      b.length <= 40 &&
      !b.includes('- *') &&
      !b.includes(':\n') &&
      !b.includes('> *') &&
      /^(?:entendi|perfeito|certo|compreendi|ok|ol[áa]|bom dia|boa tarde|boa noite|anotado|registrado|sim|n[ãa]o)[\s.!,]*$/i.test(b);

    if (isIsolatedWord) {
      // Se há um próximo balão, junta com ele no mesmo balão [E2-05]
      if (i + 1 < filtered.length) {
        filtered[i + 1] = `${b}\n\n${filtered[i + 1]}`;
        continue;
      } else if (result.length > 0) {
        // Se for o último balão e tiver um anterior, junta com o anterior
        result[result.length - 1] = `${result[result.length - 1]}\n\n${b}`;
        continue;
      }
    }

    result.push(b);
  }

  return result.filter(b => b.trim().length > 0);
}

/**
 * Detecta se um bloco ou parágrafo de texto é um cabeçalho/título de seção estruturada.
 * Reconhece:
 * - Blockquotes com numeração ou destaque: > 1. Gargalo..., > *Título:*, > Diagnóstico...
 * - Títulos destacados em negrito: *1. Título*, 1. *Título*, *Título:*
 */
export function isSectionHeader(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  const lines = trimmed.split('\n');
  const firstLine = lines[0].trim();

  // 1. Títulos numerados WhatsApp (> 1. Título, > *1. Título*, > 2. Título, etc.)
  if (/^>\s*(?:\*\d+\.|\d+\.|\*[0-9]+\*|[0-9]+\.\s+)/i.test(firstLine)) {
    return true;
  }

  // 2. Blockquote conciso com destaque (> *Título*, > Diagnóstico..., etc.)
  if (/^>\s*(?:\*[^*]+\*|[A-ZÀ-Ú][a-zA-ZÀ-ú0-9\s—–:-]{3,70})/i.test(firstLine)) {
    return lines.length <= 3 && trimmed.length <= 180;
  }

  // 3. Título numerado ou em negrito no início da linha (*1. Título*, 1. *Título*, *Título:*)
  if (/^(?:\*\d+\.\s+[^*]+\*|\d+\.\s+\*[^*]+\*|\*[A-ZÀ-Ú][^*]{3,60}:\*|\*[A-ZÀ-Ú][^*]{3,60}\*)/.test(firstLine)) {
    return lines.length <= 3 && trimmed.length <= 180;
  }

  return false;
}

/**
 * Divide o texto gerado em balões individuais de WhatsApp com consciência de cards e títulos (Title-Aware):
 * 1. Respeita '---BLOCK---' explícito gerado pela IA.
 * 2. Em respostas curtas (<600 chars), permanece SEMPRE em 1 balão [E2-04].
 * 3. Title-Aware Chunking:
 *    - Anti-Orphan-Title: Um cabeçalho nunca encerra um balão desacompanhado do seu conteúdo.
 *    - Quebra Natural por Seção: Tópicos numerados ou seções temáticas iniciam novos balões se o anterior já acumulou conteúdo suficiente (>= 280 chars).
 * 4. Aplica barreira anti-balão vazio [E2-05].
 */
export function splitIntoWhatsAppBlocks(rawText: string, maxBlockLength: number = 900): string[] {
  if (!rawText) return [];

  let rawBlocks: string[] = [];

  // 1. Delimitador explícito da IA (Platform Hint)
  if (rawText.includes('---BLOCK---')) {
    rawBlocks = rawText
      .split('---BLOCK---')
      .map(b => sanitizeWhatsAppMarkdown(b).trim())
      .filter(b => b.length > 0);
    return enforceAntiEmptyBalloons(rawBlocks);
  }

  // Normalização prévia: se um título de seção estiver colado sem linha em branco antes, insere \n\n
  const preNormalized = rawText.replace(
    /([^\n])\n(>\s*(?:\*\d+\.|\d+\.|\*[^*]+\*|[0-9]+\.\s+|[A-ZÀ-Ú][a-zA-ZÀ-ú0-9\s—–:-]{3,50}))/g,
    '$1\n\n$2'
  );

  const cleanText = sanitizeWhatsAppMarkdown(preNormalized);

  const minThreshold = Math.min(600, maxBlockLength);
  if (cleanText.length <= minThreshold) {
    // 2. Resposta curta (<= minThreshold chars) permanece SEMPRE em 1 balão [E2-04]
    rawBlocks = [cleanText];
  } else {
    // 3. Title-Aware Chunking: divide em parágrafos e agrupa com respeito a títulos
    const paragraphs = cleanText
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(p => p.length > 0);

    if (paragraphs.length <= 1) {
      rawBlocks = paragraphs;
    } else {
      const groupedBlocks: string[] = [];
      let currentChunk = '';

      for (let i = 0; i < paragraphs.length; i++) {
        const p = paragraphs[i];
        const nextP = i + 1 < paragraphs.length ? paragraphs[i + 1] : null;

        if (!currentChunk) {
          currentChunk = p;
          continue;
        }

        const isPHeader = isSectionHeader(p);

        // REGRA A: Quebra Natural por Seção Temática
        // Se 'p' for um novo título de seção e o balão atual já possui tamanho substantivo (>= 280 chars),
        // abre um novo balão diretamente para que a nova seção inicie no topo.
        if (isPHeader && currentChunk.length >= 280) {
          groupedBlocks.push(currentChunk);
          currentChunk = p;
          continue;
        }

        // REGRA B: Anti-Título Órfão (Anti-Orphan-Title)
        // Se 'p' for um cabeçalho, verifica se ele e seu próximo conteúdo caberão no balão atual.
        // Se não couberem, nunca coloca o título sozinho no fim do balão; quebra antes do título.
        if (isPHeader && nextP) {
          const neededWithNext = currentChunk.length + p.length + Math.min(nextP.length, 250) + 4;
          if (neededWithNext > maxBlockLength) {
            groupedBlocks.push(currentChunk);
            currentChunk = p;
            continue;
          }
        }

        // Agrupamento regular respeitando o limite
        if ((currentChunk.length + p.length + 2) <= maxBlockLength) {
          currentChunk += '\n\n' + p;
        } else {
          groupedBlocks.push(currentChunk);
          currentChunk = p;
        }
      }

      if (currentChunk) {
        groupedBlocks.push(currentChunk);
      }

      rawBlocks = groupedBlocks;
    }
  }

  // 4. Barreira Anti-Balão Vazio e sanitização final [E2-05]
  const enforced = enforceAntiEmptyBalloons(rawBlocks);
  return enforced
    .map(b => sanitizeWhatsAppMarkdown(b))
    .filter(b => b.length > 0);
}
