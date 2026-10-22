import {
  sanitizeWhatsAppMarkdown,
  purgeDecorativeEmojis,
  enforceAntiEmptyBalloons
} from "./format_utils.js";
function formatCurrencyBRL(val) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val).replace(/\u00a0/g, " ");
}
function formatPercentBR(val) {
  return new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(val / 100).replace(/\u00a0/g, " ");
}
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
    const detailsStr = Array.isArray(raw.details) ? raw.details.map((d) => sanitizeWhatsAppMarkdown(d)).join("\n\n") : raw.details ? sanitizeWhatsAppMarkdown(raw.details) : void 0;
    const reading = raw.resultReading || raw.indicatorsReading;
    const footer = raw.sourcePeriod || raw.footer;
    return {
      directAnswer: raw.directAnswer ? sanitizeWhatsAppMarkdown(raw.directAnswer) : void 0,
      resultReading: reading ? sanitizeWhatsAppMarkdown(reading) : void 0,
      details: detailsStr,
      incompletenessDeclaration: raw.incompletenessDeclaration ? sanitizeWhatsAppMarkdown(raw.incompletenessDeclaration) : void 0,
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
    if (lower.includes("fonte:") || lower.includes("per\xEDodo:") || lower.includes("periodo:") || lower.includes("base de dados:") || lower.includes("atualizado em:") || lower.includes("data de refer\xEAncia:") || lower.includes("data de referencia:") || lower.startsWith("_atualizado") || lower.startsWith("atualizado") || lower.startsWith("_fonte") || lower.startsWith("_dados atualizados")) {
      sourcePeriod = para;
      continue;
    }
    if (lower.includes("leitura dos indicadores") || lower.includes("leitura de indicadores") || lower.includes("leitura do resultado") || lower.includes("leitura operacional") || lower.includes("indicadores principais") || lower.includes("indicadores:") || lower.includes("diagn\xF3stico") || lower.includes("diagnostico") || lower.includes("o que os n\xFAmeros indicam") || lower.includes("o que os numeros indicam") || lower.includes("an\xE1lise executiva") || lower.includes("analise executiva")) {
      if (!resultReading) {
        resultReading = para;
        continue;
      }
    }
    const isOsCard = /^>?\s*\*?OS\s*#?\d+/i.test(para);
    if (!isOsCard && !directAnswer && (para.startsWith(">") || lower.includes("conclus\xE3o") || lower.includes("resumo"))) {
      directAnswer = para;
      continue;
    }
    detailBlocks.push(para);
  }
  if (!directAnswer && detailBlocks.length > 0) {
    if (!/^>?\s*\*?OS\s*#?\d+/i.test(detailBlocks[0])) {
      directAnswer = detailBlocks.shift();
    }
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
  const blocks = detailsText.split(/\n\s*\n/).map((b) => b.trim()).filter((b) => b.length > 0);
  const items = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trimEnd()).filter((l) => l.length > 0);
    if (lines.length === 0) continue;
    const firstLine = lines[0].trim();
    const isCardHeader = firstLine.startsWith(">") || /^\*[^*]+\*$/.test(firstLine) || /^\*[^*]+:\*$/.test(firstLine) || /^\*OS\s*#?\d+/i.test(firstLine);
    const hasFieldBullets = lines.slice(1).some((l) => /^\s*(?:[-•]|└)\s+/.test(l));
    if (isCardHeader && hasFieldBullets) {
      items.push(block.trim());
    } else if (lines.length > 1 && lines.every((l) => /^\s*(?:[-•]|└)\s+/.test(l))) {
      for (const line of lines) {
        if (line.trim()) items.push(line.trim());
      }
    } else {
      items.push(block.trim());
    }
  }
  return items;
}
function composeSemanticBalloons(input, options) {
  const minBudget = options?.minBalloonChars ?? 600;
  const maxBudget = options?.maxBalloonChars ?? 900;
  const maxBalloons = options?.maxBalloons ?? 3;
  const sections = parseSemanticSections(input);
  const directAnswer = sections.directAnswer ? sanitizeWhatsAppMarkdown(sections.directAnswer) : "";
  const resultReading = sections.resultReading ? sanitizeWhatsAppMarkdown(sections.resultReading) : "";
  const details = sections.details ? sanitizeWhatsAppMarkdown(sections.details) : "";
  const incompleteness = sections.incompletenessDeclaration ? sanitizeWhatsAppMarkdown(sections.incompletenessDeclaration) : "";
  const sourcePeriod = sections.sourcePeriod ? sanitizeWhatsAppMarkdown(sections.sourcePeriod) : "";
  const fullText = [directAnswer, resultReading, details, incompleteness, sourcePeriod].filter(Boolean).join("\n\n").trim();
  if (fullText.length < 600 || fullText.length <= maxBudget) {
    const singleBalloon = purgeDecorativeEmojis(sanitizeWhatsAppMarkdown(fullText), options);
    return [singleBalloon];
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
      const separator = item.includes("\n") || currentBalloon.includes("\n") ? "\n\n" : "\n";
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
  if (incompleteness) {
    if (!tryAppendToCurrent(incompleteness)) {
      pushCurrentBalloon();
      currentBalloon = incompleteness;
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
  const sanitizedBalloons = balloons.map((b) => purgeDecorativeEmojis(sanitizeWhatsAppMarkdown(b), options)).filter((b) => b.trim().length > 0);
  return enforceAntiEmptyBalloons(sanitizedBalloons);
}
function composeSemanticBalloonsStructured(input, options) {
  const balloons = composeSemanticBalloons(input, options);
  const totalChars = balloons.reduce((sum, b) => sum + b.length, 0);
  const EMOJI_REGEX = /(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})/gu;
  const emojisCount = balloons.reduce((count, b) => {
    const m = b.match(EMOJI_REGEX);
    return count + (m ? m.length : 0);
  }, 0);
  const isStructuredCard = balloons.some(
    (b) => b.includes("> *") || /^\*[^*]+\*\n\s*-\s+\*/m.test(b) || b.includes("\n- *")
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
function composePartialSuccessBalloon(options) {
  const { components, minBalloonChars, maxBalloonChars, maxBalloons } = options;
  const composerOpts = {
    minBalloonChars,
    maxBalloonChars,
    maxBalloons
  };
  const successful = components.filter((c) => c.status === "SUCCESS" || c.status === "PARTIAL" && (c.renderedContent || c.replyText));
  const failed = components.filter((c) => c.status === "TIMEOUT" || c.status === "UNSUPPORTED" || c.status === "DENIED" || c.status === "PARTIAL" && !c.renderedContent && !c.replyText);
  const sections = [];
  for (const comp of successful) {
    const text = comp.renderedContent || comp.replyText;
    if (text && text.trim()) {
      sections.push(text.trim());
    }
  }
  for (const comp of failed) {
    let notice = comp.unavailableNotice;
    if (!notice) {
      const isOs = (comp.componentId || "").toLowerCase().includes("os") || (comp.capabilityId || "").toLowerCase().includes("os");
      if (comp.status === "TIMEOUT") {
        notice = isOs ? "> *Aviso Operacional:* A listagem de ordens de servi\xE7o atingiu o tempo limite e n\xE3o p\xF4de ser carregada. O faturamento acima reflete a posi\xE7\xE3o oficial mais recente." : `> *Aviso Operacional:* A consulta ${comp.name || comp.componentId} atingiu o tempo limite e n\xE3o p\xF4de ser conclu\xEDda. Os demais dados refletem a posi\xE7\xE3o oficial dispon\xEDvel.`;
      } else if (comp.status === "DENIED") {
        notice = `> *Aviso Operacional:* A consulta ${comp.name || comp.componentId} foi bloqueada pelas pol\xEDticas de acesso da unidade.`;
      } else {
        notice = `> *Aviso Operacional:* A consulta ${comp.name || comp.componentId} n\xE3o est\xE1 dispon\xEDvel no momento (${comp.errorMessage || "capacidade n\xE3o suportada"}).`;
      }
    }
    sections.push(notice);
  }
  const combinedText = sections.join("\n\n");
  return composeSemanticBalloons(combinedText, composerOpts);
}
function formatDeterministicFinancialBalloon(extraction) {
  const lojaNome = extraction.lojaNome || extraction.lojaSlug;
  if (extraction.status === "SUCCESS") {
    if (extraction.value === 0 && extraction.hasExplicitTotalZero) {
      const replyText2 = `> *${lojaNome} \u2014 Vendas*
Sem vendas registradas hoje na unidade ${lojaNome} at\xE9 o momento.`;
      return {
        replyText: sanitizeWhatsAppMarkdown(replyText2),
        freshness: "FRESH",
        execution: "SUCCESS",
        isZeroConfirmed: true,
        balloons: composeSemanticBalloons(replyText2)
      };
    }
    const valFormatted = Number(extraction.value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    const replyText = `> *${lojaNome} \u2014 Vendas*
- *Faturamento:* ${valFormatted}
- *Posi\xE7\xE3o:* ${extraction.periodo || "hoje"}`;
    return {
      replyText: sanitizeWhatsAppMarkdown(replyText),
      freshness: "FRESH",
      execution: "SUCCESS",
      isZeroConfirmed: false,
      balloons: composeSemanticBalloons(replyText)
    };
  }
  const lastValFormatted = extraction.lastKnownValidValue !== void 0 ? Number(extraction.lastKnownValidValue).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : null;
  let notice = `> *Aviso Operacional:*
A extra\xE7\xE3o de vendas de hoje para a unidade ${lojaNome} est\xE1 temporariamente indispon\xEDvel.`;
  if (lastValFormatted && extraction.lastKnownValidDate) {
    const horaStr = extraction.lastKnownValidHour ? ` \xE0s ${extraction.lastKnownValidHour}` : "";
    notice += ` A \xFAltima posi\xE7\xE3o v\xE1lida registrada foi de ${lastValFormatted} em ${extraction.lastKnownValidDate}${horaStr}.`;
  } else {
    notice += ` A posi\xE7\xE3o anterior foi preservada com frescor STALE.`;
  }
  return {
    replyText: sanitizeWhatsAppMarkdown(notice),
    freshness: "STALE",
    execution: "PARTIAL",
    isZeroConfirmed: false,
    balloons: composeSemanticBalloons(notice)
  };
}
export {
  composePartialSuccessBalloon,
  composeSemanticBalloons,
  composeSemanticBalloonsStructured,
  convertMarkdownTablesToWhatsAppLists,
  formatCurrencyBRL,
  formatDeterministicFinancialBalloon,
  formatPercentBR,
  parseSemanticSections,
  splitIntoAtomicItems
};
