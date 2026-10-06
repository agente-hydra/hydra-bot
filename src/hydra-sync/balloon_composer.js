// src/hydra-sync/format_utils.js
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

// src/hydra-sync/balloon_composer.ts
function convertMarkdownTablesToWhatsAppLists(text) {
  if (!text || !text.includes("|")) return text;
  const lines = text.split("\n");
  const resultLines = [];
  let inTable = false;
  let tableHeaderCols = [];
  let tableDataRows = [];
  const flushTable = () => {
    if (tableHeaderCols.length > 0 && tableDataRows.length > 0) {
      for (const row of tableDataRows) {
        if (row.length === 0) continue;
        const firstCol = row[0];
        const remainingCols = [];
        for (let c = 1; c < row.length; c++) {
          const header = tableHeaderCols[c] || "";
          const val = row[c];
          if (!val) continue;
          if (header && !header.toLowerCase().includes("coluna")) {
            remainingCols.push(`${header}: ${val}`);
          } else {
            remainingCols.push(val);
          }
        }
        const cleanEntity = firstCol.replace(/^\*+|\*+$/g, "").trim();
        const firstColFormatted = `*${cleanEntity}:*`;
        if (remainingCols.length > 0) {
          resultLines.push(`- ${firstColFormatted} ${remainingCols.join(" \u2022 ")}`);
        } else {
          resultLines.push(`- *${cleanEntity}*`);
        }
      }
    } else if (tableDataRows.length > 0) {
      for (const row of tableDataRows) {
        if (row.length > 0) {
          const clean = row[0].replace(/^\*+|\*+$/g, "").trim();
          resultLines.push(`- *${clean}:* ${row.slice(1).join(" \u2022 ")}`);
        }
      }
    }
    inTable = false;
    tableHeaderCols = [];
    tableDataRows = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("|") && line.endsWith("|")) {
      const cols = line.split("|").slice(1, -1).map((c) => c.trim());
      const isSeparator = cols.every((c) => /^[:\s\-]+$/.test(c));
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
  return resultLines.join("\n");
}
function parseSemanticSections(raw) {
  if (typeof raw === "object" && raw !== null) {
    const detailsStr = Array.isArray(raw.details) ? raw.details.map((d) => sanitizeWhatsAppMarkdown(d)).join("\n") : raw.details ? sanitizeWhatsAppMarkdown(raw.details) : void 0;
    const reading = raw.resultReading || raw.indicatorsReading;
    const footer = raw.sourcePeriod || raw.footer;
    return {
      directAnswer: raw.directAnswer ? sanitizeWhatsAppMarkdown(raw.directAnswer) : void 0,
      resultReading: reading ? sanitizeWhatsAppMarkdown(reading) : void 0,
      details: detailsStr,
      sourcePeriod: footer ? sanitizeWhatsAppMarkdown(footer) : void 0
    };
  }
  const text = convertMarkdownTablesToWhatsAppLists(String(raw || ""));
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
  let directAnswer;
  let resultReading;
  const detailBlocks = [];
  let sourcePeriod;
  for (const para of paragraphs) {
    const lower = para.toLowerCase();
    if (lower.includes("fonte:") || lower.includes("per\xEDodo:") || lower.includes("periodo:") || lower.includes("base de dados:") || lower.includes("atualizado em:") || lower.includes("data de refer\xEAncia:") || lower.includes("data de referencia:") || lower.startsWith("_atualizado") || lower.startsWith("atualizado") || lower.startsWith("_fonte")) {
      sourcePeriod = para;
      continue;
    }
    if (lower.includes("leitura dos indicadores") || lower.includes("leitura de indicadores") || lower.includes("leitura do resultado") || lower.includes("leitura operacional") || lower.includes("indicadores principais") || lower.includes("indicadores:") || lower.includes("diagn\xF3stico") || lower.includes("diagnostico") || lower.includes("o que os n\xFAmeros indicam") || lower.includes("o que os numeros indicam") || lower.includes("an\xE1lise executiva") || lower.includes("analise executiva")) {
      if (!resultReading) {
        resultReading = para;
        continue;
      }
    }
    if (!directAnswer && (para.startsWith(">") || lower.includes("conclus\xE3o") || lower.includes("resumo"))) {
      directAnswer = para;
      continue;
    }
    detailBlocks.push(para);
  }
  if (!directAnswer && detailBlocks.length > 0) {
    directAnswer = detailBlocks.shift();
  }
  return {
    directAnswer: directAnswer ? sanitizeWhatsAppMarkdown(directAnswer) : void 0,
    resultReading: resultReading ? sanitizeWhatsAppMarkdown(resultReading) : void 0,
    details: detailBlocks.length > 0 ? sanitizeWhatsAppMarkdown(detailBlocks.join("\n\n")) : void 0,
    sourcePeriod: sourcePeriod ? sanitizeWhatsAppMarkdown(sourcePeriod) : void 0
  };
}
function splitIntoAtomicItems(detailsText) {
  if (!detailsText) return [];
  const items = [];
  const lines = detailsText.split("\n");
  let currentItemLines = [];
  for (const line of lines) {
    const isListItem = /^\s*-\s+/.test(line);
    const isCardHeader = /^\s*>\s+/.test(line);
    if ((isListItem || isCardHeader) && currentItemLines.length > 0) {
      items.push(currentItemLines.join("\n").trim());
      currentItemLines = [line];
    } else {
      if (line.trim().length > 0) {
        currentItemLines.push(line);
      }
    }
  }
  if (currentItemLines.length > 0) {
    items.push(currentItemLines.join("\n").trim());
  }
  return items;
}
function composeSemanticBalloons(input, options) {
  const minBudget = options?.minBalloonChars ?? 700;
  const maxBudget = options?.maxBalloonChars ?? 900;
  const maxBalloons = options?.maxBalloons ?? 3;
  const sections = parseSemanticSections(input);
  const directAnswer = sections.directAnswer ? sanitizeWhatsAppMarkdown(sections.directAnswer) : "";
  const resultReading = sections.resultReading ? sanitizeWhatsAppMarkdown(sections.resultReading) : "";
  const details = sections.details ? sanitizeWhatsAppMarkdown(sections.details) : "";
  const sourcePeriod = sections.sourcePeriod ? sanitizeWhatsAppMarkdown(sections.sourcePeriod) : "";
  const fullText = [directAnswer, resultReading, details, sourcePeriod].filter(Boolean).join("\n\n").trim();
  if (fullText.length <= maxBudget) {
    return [sanitizeWhatsAppMarkdown(fullText)];
  }
  const balloons = [];
  let currentBalloon = "";
  const pushCurrentBalloon = () => {
    const trimmed = currentBalloon.trim();
    if (trimmed.length > 0) {
      balloons.push(sanitizeWhatsAppMarkdown(trimmed));
      currentBalloon = "";
    }
  };
  const tryAppendToCurrent = (content) => {
    if (!content || !content.trim()) return true;
    const separator = currentBalloon ? "\n\n" : "";
    const projectedLength = currentBalloon.length + separator.length + content.length;
    if (projectedLength <= maxBudget) {
      currentBalloon += separator + content;
      return true;
    }
    return false;
  };
  if (directAnswer) {
    currentBalloon = directAnswer;
  }
  if (resultReading) {
    if (!tryAppendToCurrent(resultReading)) {
      pushCurrentBalloon();
      currentBalloon = resultReading;
    }
  }
  if (details) {
    const atomicItems = splitIntoAtomicItems(details);
    for (const item of atomicItems) {
      if (!currentBalloon) {
        currentBalloon = item;
        continue;
      }
      const separator = "\n";
      const projectedLength = currentBalloon.length + separator.length + item.length;
      if (projectedLength <= maxBudget) {
        currentBalloon += separator + item;
      } else {
        if (currentBalloon.length >= minBudget) {
          pushCurrentBalloon();
          currentBalloon = item;
        } else if (projectedLength <= maxBudget + 50 && balloons.length < maxBalloons - 1) {
          currentBalloon += separator + item;
        } else {
          pushCurrentBalloon();
          currentBalloon = item;
        }
      }
    }
  }
  if (sourcePeriod) {
    if (!tryAppendToCurrent(sourcePeriod)) {
      if (balloons.length < maxBalloons - 1) {
        pushCurrentBalloon();
        currentBalloon = sourcePeriod;
      } else {
        currentBalloon += "\n\n" + sourcePeriod;
      }
    }
  }
  pushCurrentBalloon();
  return balloons.map((b) => sanitizeWhatsAppMarkdown(b)).filter((b) => b.length > 0);
}
export {
  composeSemanticBalloons,
  convertMarkdownTablesToWhatsAppLists,
  parseSemanticSections
};
