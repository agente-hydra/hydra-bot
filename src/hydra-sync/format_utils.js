// src/hydra-sync/format_utils.ts
function fmtMoeda(val) {
  return (val || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function calculateGoalMetrics(faturamento, meta, extra) {
  const fat = Math.max(0, Number(faturamento) || 0);
  const metaVal = Math.max(0, Number(meta) || 0);
  let percentualAtingimento = 0;
  let valorFaltante = 0;
  let superavit = 0;
  let isMetaAlcancada = false;
  if (metaVal > 0) {
    percentualAtingimento = fat / metaVal * 100;
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
  const pctAtingFmt = `${percentualAtingimento.toFixed(1).replace(".", ",")}%`;
  const valorFaltanteFmt = fmtMoeda(valorFaltante);
  const statusTexto = isMetaAlcancada ? `Meta alcan\xE7ada (${pctAtingFmt})` : `Falta ${valorFaltanteFmt} (${pctAtingFmt} atingido)`;
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
function alignWhatsAppList(text) {
  if (!text) return "";
  const lines = text.split("\n");
  const aligned = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("---BLOCK---") || /^[-*_]{3,}/.test(line.trim())) {
      aligned.push(line);
      continue;
    }
    const isBoldHeading = /^\s*\*([^*]+)\*(?:\s*)$/.test(line);
    const listMatch = !isBoldHeading ? line.match(/^(\s*)([-•+]|\*(?=\s))\s+(.*)$/) : null;
    if (listMatch) {
      const indent = listMatch[1];
      const rawContent = listMatch[3].trim();
      const prefix = indent.length >= 2 ? "  - " : "- ";
      let formattedContent = rawContent;
      formattedContent = formattedContent.replace(/^\*([^*:\n]+)\*\s*:\s*/, "*$1:* ");
      if (!formattedContent.startsWith("*")) {
        formattedContent = formattedContent.replace(/^([A-Za-zÀ-ÖØ-öø-ÿ0-9\s/—–-]{2,30}):\s+(?!\*)/, (_m, key) => {
          return `*${key.trim()}:* `;
        });
      }
      aligned.push(`${prefix}${formattedContent}`);
    } else {
      aligned.push(line);
    }
  }
  return aligned.join("\n");
}
function purgeDecorativeEmojis(text, options) {
  if (!text || typeof text !== "string") return "";
  const hasProvenCriticalAlert = options?.allowCriticalAlertEmoji === true || /\b(?:retid[ao]s?\s+h[áa]\s+mais\s+de\s+(?:3[0-9]|[4-9][0-9]|\d{3,})\s+dias|mais\s+de\s+(?:3[0-9]|[4-9][0-9]|\d{3,})\s+dias\s+no\s+p[áa]tio|dias_no_patio\s*>\s*30)\b/i.test(text);
  const maxAlertEmojis = hasProvenCriticalAlert ? options?.maxCriticalAlertEmojis ?? 1 : 0;
  const ALERT_EMOJIS = /* @__PURE__ */ new Set(["\u{1F6A8}", "\u26A0\uFE0F", "\u2757", "\u{1F6D1}", "\u26A1"]);
  const EMOJI_REGEX = /(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:[\uFE0E\uFE0F]|\uD83C[\uDFFB-\uDFFF])?(?:\u200D(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})(?:[\uFE0E\uFE0F]|\uD83C[\uDFFB-\uDFFF])?)*/gu;
  let alertEmojisUsed = 0;
  let result = text.replace(EMOJI_REGEX, (match, offset, fullString) => {
    if (ALERT_EMOJIS.has(match) && alertEmojisUsed < maxAlertEmojis) {
      alertEmojisUsed++;
      return match;
    }
    if (ALERT_EMOJIS.has(match)) {
      const remaining = fullString.slice(offset + match.length).trim();
      if (!remaining.toLowerCase().startsWith("aten\xE7\xE3o:") && !remaining.toLowerCase().startsWith("*aten\xE7\xE3o:*")) {
        const before = fullString.slice(0, offset).trim();
        if (before.endsWith(">") || before.endsWith("\n") || before === "") {
          return "*Aten\xE7\xE3o:* ";
        }
      }
    }
    return "";
  });
  result = result.replace(/[ \t]{2,}/g, " ").replace(/^[ \t]+/gm, (m) => m).replace(/ \n/g, "\n").trim();
  return result;
}
function convertMarkdownTableToNativeBlocks(text) {
  if (!text || !text.includes("|")) {
    return {
      hasTable: false,
      originalTableText: text,
      convertedBlocksText: text,
      rowsProcessed: 0,
      dataPreserved: true
    };
  }
  const lines = text.split("\n");
  const convertedLines = [];
  let inTable = false;
  let tableHeaders = [];
  let tableDataRows = [];
  let totalRowsProcessed = 0;
  let hasAnyTable = false;
  const flushCurrentTable = () => {
    if (tableHeaders.length > 0 && tableDataRows.length > 0) {
      hasAnyTable = true;
      const cards = [];
      for (let r = 0; r < tableDataRows.length; r++) {
        const row = tableDataRows[r];
        if (row.length === 0) continue;
        const firstColVal = row[0].replace(/^\*+|\*+$/g, "").trim();
        const firstHeader = tableHeaders[0] ? tableHeaders[0].trim() : "Item";
        let cardTitle = "";
        if (firstColVal.toLowerCase().startsWith(firstHeader.toLowerCase())) {
          cardTitle = `*${firstColVal}*`;
        } else if (firstHeader.toLowerCase().includes("item") || firstHeader.toLowerCase().includes("loja") || firstHeader.toLowerCase().includes("unidade")) {
          cardTitle = `*${firstColVal}*`;
        } else if (firstHeader.toLowerCase() === "os") {
          cardTitle = firstColVal.startsWith("#") ? `*OS ${firstColVal}*` : `*OS #${firstColVal}*`;
        } else {
          cardTitle = `*${firstHeader}: ${firstColVal}*`;
        }
        const fieldLines = [];
        for (let c = 1; c < Math.max(tableHeaders.length, row.length); c++) {
          const header = (tableHeaders[c] || `Coluna ${c + 1}`).trim();
          const val = (row[c] !== void 0 ? row[c] : "-").trim();
          fieldLines.push(`- *${header}:* ${val || "-"}`);
        }
        const card = fieldLines.length > 0 ? `${cardTitle}
${fieldLines.join("\n")}` : cardTitle;
        cards.push(card);
        totalRowsProcessed++;
      }
      convertedLines.push(cards.join("\n\n"));
    } else if (tableDataRows.length > 0) {
      hasAnyTable = true;
      const cards = [];
      for (const row of tableDataRows) {
        if (row.length === 0) continue;
        const first = row[0].replace(/^\*+|\*+$/g, "").trim();
        const otherFields = row.slice(1).map((val, idx) => `- *Campo ${idx + 1}:* ${val}`);
        cards.push(otherFields.length > 0 ? `*${first}*
${otherFields.join("\n")}` : `*${first}*`);
        totalRowsProcessed++;
      }
      convertedLines.push(cards.join("\n\n"));
    }
    inTable = false;
    tableHeaders = [];
    tableDataRows = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("|") && trimmed.endsWith("|") && (trimmed.match(/\|/g) || []).length >= 2) {
      const cols = trimmed.slice(1, -1).split("|").map((c) => c.trim());
      const isSeparator = cols.every((c) => /^[:\s\-]+$/.test(c));
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
  const finalConverted = convertedLines.join("\n");
  return {
    hasTable: hasAnyTable,
    originalTableText: text,
    convertedBlocksText: finalConverted,
    rowsProcessed: totalRowsProcessed,
    dataPreserved: true
  };
}
function convertMarkdownTablesToWhatsAppBlocks(text) {
  return convertMarkdownTableToNativeBlocks(text).convertedBlocksText;
}
function sanitizeWhatsAppMarkdown(raw) {
  if (!raw) return "";
  let text = String(raw);
  text = text.replace(/Retidos\s+h\?\s+mais\s+de\s+(\d+)\s+dias/gi, "Retidos h\xE1 mais de $1 dias");
  text = text.replace(/\bRetidos\s+h\?\b/gi, "Retidos h\xE1");
  text = text.replace(/\bh\?\s+mais/gi, "h\xE1 mais");
  text = text.replace(/\bh\?\b/g, "h\xE1");
  text = text.replace(/\bt\?\s+h\?\b/gi, "t\xE1 h\xE1");
  text = text.replace(/\bt\?\b/g, "t\xE1");
  text = text.replace(/Situa\?\?o/gi, "Situa\xE7\xE3o");
  text = text.replace(/Perman\?ncia/gi, "Perman\xEAncia");
  text = text.replace(/Cen\?rio/gi, "Cen\xE1rio");
  text = text.replace(/espec\?fic([ao]s?)/gi, "espec\xEDfic$1");
  text = text.replace(/^#{1,6}\s+(.+)$/gm, (_match, p1) => {
    const trimmed = p1.trim();
    if (trimmed.startsWith("*") && trimmed.endsWith("*")) {
      return `> ${trimmed}`;
    }
    return `> *${trimmed}*`;
  });
  text = text.replace(/^(?!---BLOCK---)[\t ]*[-*_]{3,}[\t ]*$/gm, "");
  if (text.includes("|")) {
    const tableRes = convertMarkdownTableToNativeBlocks(text);
    if (tableRes.hasTable) {
      text = tableRes.convertedBlocksText;
    }
  }
  text = text.replace(/\*\*\*+([^*\n]+?)\*\*\*+/g, "*$1*");
  text = text.replace(/\*\*([^*\n]+?)\*\*/g, "*$1*");
  text = text.replace(/__([^_\n]+?)__/g, "_$1_");
  text = text.replace(/^[\t ]*[•+]\s+/gm, "- ");
  text = text.replace(/^[\t ]*\*\s+(?!\*)/gm, "- ");
  text = text.replace(/^([\t ]*-\s+)([A-Za-zÀ-ÖØ-öø-ÿ0-9\s/—–-]{2,30}:)\s+(?!\*)/gm, (_m, prefix, key) => {
    return `${prefix}*${key.trim()}* `;
  });
  text = alignWhatsAppList(text);
  while (text.includes("**")) {
    text = text.replace(/\*\*/g, "*");
  }
  while (text.includes("__")) {
    text = text.replace(/__/g, "_");
  }
  text = purgeDecorativeEmojis(text);
  text = text.replace(/<[^>]+>/g, "");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}
function assertNoDoubleAsterisks(text) {
  if (!text) return true;
  return !/\*\*/.test(text) && !/__/.test(text);
}
function assertWhatsAppNativeFormat(text) {
  if (!text) return true;
  if (/\*\*|__/.test(text)) return false;
  if (/^#{1,6}\s+/m.test(text)) return false;
  if (/^(?!---BLOCK---)[\t ]*[-*_]{3,}[\t ]*$/m.test(text)) return false;
  if (/^\|[\s\-:|]+\|$/m.test(text)) return false;
  return true;
}
function enforceAntiEmptyBalloons(balloons) {
  const filtered = balloons.map((b) => b.trim()).filter((b) => b.length > 0);
  if (filtered.length <= 1) {
    return filtered;
  }
  const result = [];
  for (let i = 0; i < filtered.length; i++) {
    const b = filtered[i];
    const isIsolatedWord = b.length <= 40 && !b.includes("- *") && !b.includes(":\n") && !b.includes("> *") && /^(?:entendi|perfeito|certo|compreendi|ok|ol[áa]|bom dia|boa tarde|boa noite|anotado|registrado|sim|n[ãa]o)[\s.!,]*$/i.test(b);
    if (isIsolatedWord) {
      if (i + 1 < filtered.length) {
        filtered[i + 1] = `${b}

${filtered[i + 1]}`;
        continue;
      } else if (result.length > 0) {
        result[result.length - 1] = `${result[result.length - 1]}

${b}`;
        continue;
      }
    }
    result.push(b);
  }
  return result.filter((b) => b.trim().length > 0);
}
function isSectionHeader(text) {
  if (!text) return false;
  const trimmed = text.trim();
  const lines = trimmed.split("\n");
  const firstLine = lines[0].trim();
  if (/^>\s*(?:\*\d+\.|\d+\.|\*[0-9]+\*|[0-9]+\.\s+)/i.test(firstLine)) {
    return true;
  }
  if (/^>\s*(?:\*[^*]+\*|[A-ZÀ-Ú][a-zA-ZÀ-ú0-9\s—–:-]{3,70})/i.test(firstLine)) {
    return lines.length <= 3 && trimmed.length <= 180;
  }
  if (/^(?:\*\d+\.\s+[^*]+\*|\d+\.\s+\*[^*]+\*|\*[A-ZÀ-Ú][^*]{3,60}:\*|\*[A-ZÀ-Ú][^*]{3,60}\*)/.test(firstLine)) {
    return lines.length <= 3 && trimmed.length <= 180;
  }
  return false;
}
function splitIntoWhatsAppBlocks(rawText, maxBlockLength = 900) {
  if (!rawText) return [];
  let rawBlocks = [];
  if (rawText.includes("---BLOCK---")) {
    rawBlocks = rawText.split("---BLOCK---").map((b) => sanitizeWhatsAppMarkdown(b).trim()).filter((b) => b.length > 0);
    return enforceAntiEmptyBalloons(rawBlocks);
  }
  const preNormalized = rawText.replace(
    /([^\n])\n(>\s*(?:\*\d+\.|\d+\.|\*[^*]+\*|[0-9]+\.\s+|[A-ZÀ-Ú][a-zA-ZÀ-ú0-9\s—–:-]{3,50}))/g,
    "$1\n\n$2"
  );
  const cleanText = sanitizeWhatsAppMarkdown(preNormalized);
  const minThreshold = Math.min(600, maxBlockLength);
  if (cleanText.length <= minThreshold) {
    rawBlocks = [cleanText];
  } else {
    const paragraphs = cleanText.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
    if (paragraphs.length <= 1) {
      rawBlocks = paragraphs;
    } else {
      const groupedBlocks = [];
      let currentChunk = "";
      for (let i = 0; i < paragraphs.length; i++) {
        const p = paragraphs[i];
        const nextP = i + 1 < paragraphs.length ? paragraphs[i + 1] : null;
        if (!currentChunk) {
          currentChunk = p;
          continue;
        }
        const isPHeader = isSectionHeader(p);
        if (isPHeader && currentChunk.length >= 280) {
          groupedBlocks.push(currentChunk);
          currentChunk = p;
          continue;
        }
        if (isPHeader && nextP) {
          const neededWithNext = currentChunk.length + p.length + Math.min(nextP.length, 250) + 4;
          if (neededWithNext > maxBlockLength) {
            groupedBlocks.push(currentChunk);
            currentChunk = p;
            continue;
          }
        }
        if (currentChunk.length + p.length + 2 <= maxBlockLength) {
          currentChunk += "\n\n" + p;
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
  const enforced = enforceAntiEmptyBalloons(rawBlocks);
  return enforced.map((b) => sanitizeWhatsAppMarkdown(b)).filter((b) => b.length > 0);
}
export {
  alignWhatsAppList,
  assertNoDoubleAsterisks,
  assertWhatsAppNativeFormat,
  calculateGoalMetrics,
  convertMarkdownTableToNativeBlocks,
  convertMarkdownTablesToWhatsAppBlocks,
  enforceAntiEmptyBalloons,
  fmtMoeda,
  isSectionHeader,
  purgeDecorativeEmojis,
  sanitizeWhatsAppMarkdown,
  splitIntoWhatsAppBlocks
};
