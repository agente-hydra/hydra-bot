// src/hydra-sync/format_utils.ts
function fmtMoeda(val) {
  if (val === void 0 || val === null || isNaN(val)) return "R$ 0,00";
  return Number(val).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function calculateGoalMetrics(faturamento, meta, extra) {
  const fat = Number(faturamento) || 0;
  const metaVal = Number(meta) || 0;
  if (metaVal <= 0 || isNaN(metaVal)) {
    return {
      lojaSlug: extra?.lojaSlug,
      lojaNome: extra?.lojaNome,
      periodoReferencia: extra?.periodoReferencia,
      posicaoHora: extra?.posicaoHora,
      faturamentoMes: fat,
      metaMes: 0,
      faturamento: fat,
      meta: 0,
      percentualAtingimento: 0,
      valorFaltante: 0,
      superavit: 0,
      volumeOS: extra?.volumeOS,
      ticketMedio: extra?.ticketMedio,
      isMetaAlcancada: false,
      statusTexto: "Meta do m\xEAs n\xE3o definida ou zerada",
      atingimentoFormatado: "Meta n\xE3o definida",
      valorFaltanteFormatado: "Meta n\xE3o definida"
    };
  }
  const percentualAtingimento = Math.max(0, fat / metaVal * 100);
  const valorFaltante = Math.max(0, metaVal - fat);
  const superavit = Math.max(0, fat - metaVal);
  const isMetaAlcancada = fat >= metaVal;
  const pctAtingFmt = `${percentualAtingimento.toFixed(2).replace(".", ",")}%`;
  const valorFaltanteFmt = fmtMoeda(valorFaltante);
  const statusTexto = isMetaAlcancada ? `Meta batida! (+${fmtMoeda(superavit)})` : `Faltam ${valorFaltanteFmt} (${(valorFaltante / metaVal * 100).toFixed(1).replace(".", ",")}% da meta)`;
  return {
    lojaSlug: extra?.lojaSlug,
    lojaNome: extra?.lojaNome,
    periodoReferencia: extra?.periodoReferencia,
    posicaoHora: extra?.posicaoHora,
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
    valorFaltanteFormatado: valorFaltanteFmt
  };
}
function alignWhatsAppList(text) {
  if (!text) return "";
  const lines = text.split("\n");
  const aligned = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const listMatch = line.match(/^(\s*)([-•+*])\s*(.*)$/);
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
  text = text.replace(/^\|(.+)\|$/gm, (match) => {
    if (/^\|[\s\-:|]+\|$/.test(match)) return "";
    const cols = match.split("|").map((c) => c.trim()).filter(Boolean);
    return cols.map((c) => `- ${c}`).join("\n");
  });
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
  text = text.replace(/([\p{Emoji_Presentation}\p{Extended_Pictographic}])\1{2,}/gu, "$1");
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
  return true;
}
function splitIntoWhatsAppBlocks(rawText, maxBlockLength = 1400) {
  if (!rawText) return [];
  let rawBlocks = [];
  if (rawText.includes("---BLOCK---")) {
    rawBlocks = rawText.split("---BLOCK---").map((b) => b.trim()).filter((b) => b.length > 0);
  } else if (rawText.trim().length < 180) {
    rawBlocks = [rawText.trim()];
  } else {
    const paragraphs = rawText.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
    if (paragraphs.length <= 1) {
      rawBlocks = paragraphs;
    } else {
      const groupedBlocks = [];
      let currentChunk = "";
      for (const p of paragraphs) {
        if (!currentChunk) {
          currentChunk = p;
        } else if (currentChunk.length + p.length + 2 <= maxBlockLength && groupedBlocks.length < 2) {
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
  return rawBlocks.map((b) => sanitizeWhatsAppMarkdown(b)).filter((b) => b.length > 0);
}
export {
  alignWhatsAppList,
  assertNoDoubleAsterisks,
  assertWhatsAppNativeFormat,
  calculateGoalMetrics,
  fmtMoeda,
  sanitizeWhatsAppMarkdown,
  splitIntoWhatsAppBlocks
};
