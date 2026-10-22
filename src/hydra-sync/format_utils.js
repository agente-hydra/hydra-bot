function fmtMoeda(val) {
  return (val || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/[\u00A0\u202F]/g, " ");
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
  let inOsBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith("---BLOCK---") || /^[-*_]{3,}/.test(trimmed)) {
      inOsBlock = false;
      aligned.push(line);
      continue;
    }
    if (trimmed === "") {
      inOsBlock = false;
      aligned.push(line);
      continue;
    }
    const osHeaderMatch = trimmed.match(/^>*\s*\*?(OS\s*#?\d+[^*:\n]*)\*?\s*—\s*\*?([A-Za-zÀ-ÿ0-9\s/—–-]+(?:\s*\([^)\n]+\))?)\*?$/i);
    if (osHeaderMatch) {
      inOsBlock = true;
      const osNum = osHeaderMatch[1].replace(/[*_>]/g, "").trim();
      const osDesc = osHeaderMatch[2].replace(/[*_]/g, "").trim();
      aligned.push(`*${osNum} \u2014 ${osDesc}*`);
      continue;
    }
    const kneeMatch = line.match(/^(\s*)└\s*(.*)$/);
    if (kneeMatch) {
      inOsBlock = true;
      let kneeBody = kneeMatch[2].trim();
      kneeBody = kneeBody.replace(/\s*[•·]\s*$/, "").trim();
      const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : "";
      const nextKneeMatch = nextLine.match(/^└\s*(.*)$/);
      if (nextKneeMatch) {
        const nextKneeBody = nextKneeMatch[1].trim().replace(/\s*[•·]\s*$/, "").trim();
        const diasMatch = nextKneeBody.match(/^(\*?\d+\s*dias[^*]*\*?)(?:\s+no\s+p[áa]tio)?/i);
        const isStatusOnly = !/^(?:Status|Financeiro|Operação|Cliente|Resp|Total|Saldo):/i.test(kneeBody) && !/\d+\s*dias/i.test(kneeBody) && !/R\$/i.test(kneeBody);
        if (isStatusOnly && diasMatch) {
          const cleanStatus = kneeBody.replace(/^[*_]+|[*_]+$/g, "").trim();
          const cleanDias = diasMatch[1].replace(/^[*_]+|[*_]+$/g, "").trim();
          aligned.push(`  \u2514 Status: *${cleanStatus}* \xB7 *${cleanDias}* no p\xE1tio`);
          i++;
          continue;
        }
        const isTotalLine = /Total(?:\s*da\s*OS)?/i.test(kneeBody) && /R\$/i.test(kneeBody);
        const isSaldoEmpty = /^\*?Saldo(?::\*|\*:|:)?\s*(?:R\$\s*0(?:,00)?|-|—)?\s*$/i.test(nextKneeBody);
        if (isTotalLine && isSaldoEmpty) {
          const valMatch = kneeBody.match(/R\$\s*[\d.,]+/);
          const totalVal = valMatch ? valMatch[0] : "";
          aligned.push(`  \u2514 Financeiro: Total *${totalVal}* \xB7 Saldo: *Quitado*`);
          i++;
          continue;
        }
      }
      const statusLineMatch = kneeBody.match(/^(?:\*Status\*:\s*|\*Status:\*\s*|Status:\s*)(.+?)(?:\s*[•·]\s*(?:(?:Pátio|Aging|Permanência):\s*)?(\*?\d+\s*dias[^\n]*|\*?[A-Za-zÀ-ÿ0-9\s*]+dias[^\n]*))?$/i);
      if (statusLineMatch) {
        const statusText = statusLineMatch[1].replace(/[*_]/g, "").trim();
        let patioFormatted = "";
        if (statusLineMatch[2]) {
          const patioText = statusLineMatch[2].replace(/[*_]/g, "").trim();
          const diasMatch = patioText.match(/(\d+)\s*dias?/i);
          patioFormatted = diasMatch ? ` \xB7 *${diasMatch[1]} dias* no p\xE1tio` : ` \xB7 *${patioText}*`;
        }
        aligned.push(`  \u2514 Status: *${statusText}*${patioFormatted}`);
        continue;
      }
      const finLineMatch = kneeBody.match(/^(?:\*Financeiro\*:\s*|\*Financeiro:\*\s*|Financeiro:\s*)(.+)$/i);
      if (finLineMatch) {
        let finBody = finLineMatch[1].trim();
        finBody = finBody.replace(/Total(?:\s*:\s*|\s+)(?!\*)(R\$\s*[\d.,]+)/i, "Total *$1*");
        finBody = finBody.replace(/Saldo(?:\s*:\s*|\s+)(?!\*)(R\$\s*[\d.,]+|Quitado)/i, "Saldo: *$1*");
        aligned.push(`  \u2514 Financeiro: ${finBody}`);
        continue;
      }
      const respMatch = kneeBody.match(/^(?:\*Resp\*:\s*|\*Resp:\*\s*|Resp:\s*)(.+)$/i);
      if (respMatch) {
        aligned.push(`  \u2514 Opera\xE7\xE3o: Resp: ${respMatch[1].trim()}`);
        continue;
      }
      aligned.push(`  \u2514 ${kneeBody}`);
      continue;
    }
    const isBoldHeading = /^\s*\*([^*]+)\*(?:\s*)$/.test(line);
    const listMatch = !isBoldHeading ? line.match(/^(\s*)([-•+]|\*(?=\s))\s+(.*)$/) : null;
    if (listMatch) {
      const indent = listMatch[1];
      const rawContent = listMatch[3].trim();
      const isOsHeader = /^(?:>\s*)?(?:\*)?OS\s*#?\d+[^*:\n]*(?:\*)?$/i.test(rawContent);
      if (isOsHeader) {
        inOsBlock = true;
        const cleanOsTitle = rawContent.replace(/^>\s*/, "").replace(/^\*+|\*+$/g, "").trim();
        aligned.push(`*${cleanOsTitle}*`);
        continue;
      }
      const isSectionHeading = /^(?:>\s*)?(?:\*)?(?:Visão geral|Ordens de serviço(?: ativas| em aberto)?|Gargalos(?: de pátio| operacionais)?|Ponto crítico|Risco financeiro|Compliance(?: e vistorias)?|Checklists|Posição operacional|Faturamento|Resumo executivo|Atenção)(?:\*)?:?$/i.test(rawContent) || /^\*([^*:\n]+)\*:?$/.test(rawContent);
      if (isSectionHeading) {
        inOsBlock = false;
        const cleanHeading = rawContent.replace(/^>\s*/, "").replace(/^\*+|\*+$/g, "").replace(/:$/, "").trim();
        aligned.push(`*${cleanHeading}*`);
        continue;
      }
      const isOsProperty = /^(?:Status|Financeiro|Operação|Cliente|Pátio|Aging|Permanência|Valor|Total|Saldo|Resp|Responsável|Mecânico|Serviços|Peças|Checklist)/i.test(rawContent.replace(/^\*/, ""));
      if (inOsBlock && isOsProperty) {
        const finMatch = rawContent.match(/^(?:\*Financeiro\*:\s*|\*Financeiro:\*\s*|Financeiro:\s*)(.+)$/i);
        if (finMatch) {
          let finBody = finMatch[1].trim();
          finBody = finBody.replace(/Total(?:\s*:\s*|\s+)(?!\*)(R\$\s*[\d.,]+)/i, "Total *$1*");
          finBody = finBody.replace(/Saldo(?:\s*:\s*|\s+)(?!\*)(R\$\s*[\d.,]+|Quitado)/i, "Saldo: *$1*");
          aligned.push(`  \u2514 Financeiro: ${finBody}`);
          continue;
        }
        const opMatch = rawContent.match(/^(?:\*Operação\*:\s*|\*Operação:\*\s*|Operação:\s*)(.+)$/i);
        if (opMatch) {
          aligned.push(`  \u2514 Opera\xE7\xE3o: ${opMatch[1].trim()}`);
          continue;
        }
        const valMatch = rawContent.match(/^(?:\*(?:Valor|Total)\*:\s*|\*(?:Valor|Total):\*\s*|(?:Valor|Total):\s*)([^()]+?)\s*\((?:resta|saldo:?)\s*([^)]+)\)/i);
        if (valMatch) {
          const totalVal = valMatch[1].replace(/[*_]/g, "").trim();
          const saldoVal = valMatch[2].replace(/[*_]/g, "").trim();
          const saldoFormatted = /^(?:R\$\s*0(?:,00)?|0)$/i.test(saldoVal) ? "*Quitado*" : `*${saldoVal}*`;
          aligned.push(`  \u2514 Financeiro: Total *${totalVal}* \xB7 Saldo: ${saldoFormatted}`);
          continue;
        }
        const clientMatch = rawContent.match(/^(?:\*Cliente\*:\s*|\*Cliente:\*\s*|Cliente:\s*)(.+)$/i);
        if (clientMatch) {
          const clientName = clientMatch[1].replace(/[*_]/g, "").trim();
          aligned.push(`  \u2514 Opera\xE7\xE3o: Cliente: ${clientName}`);
          continue;
        }
        const statusMatch = rawContent.match(/^(?:\*Status\*:\s*|\*Status:\*\s*|Status:\s*)(.+?)(?:\s*[•·]\s*(?:(?:Pátio|Aging|Permanência):\s*)?(\d+\s*dias[^\n]*|[A-Za-zÀ-ÿ0-9\s]+dias[^\n]*))?$/i);
        if (statusMatch) {
          const statusText = statusMatch[1].replace(/[*_]/g, "").trim();
          let patioFormatted = "";
          if (statusMatch[2]) {
            const patioText = statusMatch[2].replace(/[*_]/g, "").trim();
            const diasMatch = patioText.match(/(\d+)\s*dias?/i);
            if (diasMatch) {
              patioFormatted = ` \xB7 *${diasMatch[1]} dias* no p\xE1tio`;
            } else {
              patioFormatted = ` \xB7 *${patioText}*`;
            }
          }
          aligned.push(`  \u2514 Status: *${statusText}*${patioFormatted}`);
          continue;
        }
        let propContent = rawContent;
        propContent = propContent.replace(/^\*([^*:\n]+)\*\s*:\s*/, "*$1:* ");
        if (!propContent.startsWith("*")) {
          propContent = propContent.replace(/^([A-Za-zÀ-ÖØ-öø-ÿ0-9\s/—–-]{2,30}):\s+(?!\*)/, (_m, key) => `*${key.trim()}:* `);
        }
        aligned.push(`  \u2514 ${propContent}`);
        continue;
      }
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
      const nonListOsMatch = trimmed.match(/^>*\s*\*?(OS\s*#?\d+[^*:\n]*)\*?$/i);
      if (nonListOsMatch) {
        inOsBlock = true;
        aligned.push(`*${nonListOsMatch[1].trim()}*`);
        continue;
      } else if (/^\*OS\s*#?\d+/i.test(trimmed)) {
        inOsBlock = true;
      } else if (trimmed.startsWith("*") && trimmed.endsWith("*") && !trimmed.includes("\u2014")) {
        inOsBlock = false;
      }
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
  result = result.split("\n").map((line) => {
    const match = line.match(/^(\s*)(.*)$/);
    if (!match) return line;
    const indent = match[1];
    const content = match[2].replace(/[ \t]{2,}/g, " ").trimEnd();
    return `${indent}${content}`;
  }).join("\n").trim();
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
  text = text.replace(/^[\t ]*-{6,}[\t ]*$/gm, "----------------------------------------");
  text = text.replace(/^(?!---BLOCK---|----------------------------------------)[\t ]*[*_]{3,}[\t ]*$/gm, "");
  text = text.replace(/^(?!---BLOCK---|----------------------------------------)[\t ]*-{3,5}[\t ]*$/gm, "");
  if (text.includes("|")) {
    const tableRes = convertMarkdownTableToNativeBlocks(text);
    if (tableRes.hasTable) {
      text = tableRes.convertedBlocksText;
    }
  }
  if (text.includes("|")) {
    text = reformatPipedLinesToHermesCards(text);
  }
  text = text.replace(/\*\*\*+([^*\n]+?)\*\*\*+/g, "*$1*");
  text = text.replace(/\*\*([^*\n]+?)\*\*/g, "*$1*");
  text = text.replace(/__([^_\n]+?)__/g, "_$1_");
  text = text.replace(/^[\t ]*[•+]\s+/gm, "- ");
  text = text.replace(/^[\t ]*\*[\t ]+\*(?=[A-Za-zÀ-ÿ0-9])/gm, "- *");
  text = text.replace(/^[\t ]*\*[\t ]+\*\s+/gm, "- ");
  text = text.replace(/^[\t ]*\*\s+(?!\*)/gm, "- ");
  text = text.replace(/^([\t ]*-\s+)([A-Za-zÀ-ÖØ-öø-ÿ0-9\s/—–-]{2,30}:)\s+(?!\*)/gm, (_m, prefix, key) => {
    return `${prefix}*${key.trim()}* `;
  });
  text = text.replace(/^([\t ]*-\s+\*[^*:\n]+:\*)\s*$/gm, (_m, g1) => `${g1} N\xE3o informado / Pendente`);
  text = text.replace(/^[\t ]*>\s*\*?(OS\s*#?\d+[^*:\n]*)\*?/gim, "*$1*");
  text = text.replace(/^[\t ]*\*?(OS\s*#?\d+[^*:\n]*)\*?\s*—\s*\*?([A-Za-zÀ-ÿ0-9\s/—–-]+(?:\s*\([^)\n]+\))?)\*?$/gm, "*$1 \u2014 $2*");
  text = alignWhatsAppList(text);
  text = text.replace(/^([\t ]*-\s+\*[^*:\n]+:\*)\s*$/gm, (_m, g1) => `${g1} N\xE3o informado / Pendente`);
  text = text.replace(/(?:^|\n)\*?(?:O que fazer agora|Ações recomendadas|Ações sugeridas|Próximos passos|Opções|Menu de opções)\*?[:\s]*[\s\S]*?(?=\n\n\*|$)/gi, "");
  text = text.replace(/^\s*\d+\.\s+([^\n]+)$/gm, "- $1");
  text = text.replace(/(?:----------------------------------------\s*\n+)+(\*OS\s*#?\d+)/gi, "$1");
  text = text.replace(/(?:----------------------------------------\s*)+$/gm, "");
  text = text.replace(/([^\n])\n(\*OS\s*#?\d+)/gi, "$1\n\n$2");
  const hydraHeaderMatch = text.match(/(?:^|\n)(\*HYDRA\s*\|[^\n]+(?:\n+[\d/·:\s]+)?)/i);
  if (hydraHeaderMatch && hydraHeaderMatch.index !== void 0 && hydraHeaderMatch.index > 0) {
    const headerBlock = hydraHeaderMatch[1].trim();
    const remainingText = (text.slice(0, hydraHeaderMatch.index) + "\n" + text.slice(hydraHeaderMatch.index + hydraHeaderMatch[0].length)).trim();
    text = `${headerBlock}

${remainingText}`;
  }
  while (text.includes("**")) {
    text = text.replace(/\*\*/g, "*");
  }
  while (text.includes("__")) {
    text = text.replace(/__/g, "_");
  }
  text = purgeDecorativeEmojis(text);
  text = text.replace(/<[^>]+>/g, "");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/[\u00A0\u202F]/g, " ");
  return text.trim();
}
function reformatPipedLinesToHermesCards(text) {
  if (!text || !text.includes("|")) return text;
  const lines = text.split("\n");
  const output = [];
  let inStorePatioSection = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (/HYDRA\s*\|/i.test(trimmed)) {
      output.push(line);
      continue;
    }
    if (/Posi[çc][ãa]o\s+de\s+p[áa]tio/i.test(trimmed) || /Gargalos\s+de\s+reten[çc][ãa]o/i.test(trimmed)) {
      inStorePatioSection = true;
      output.push(line);
      continue;
    }
    if (trimmed.startsWith("*") && trimmed.endsWith("*") && !/Posi[çc][ãa]o\s+de\s+p[áa]tio/i.test(trimmed) && !/Gargalos/i.test(trimmed)) {
      inStorePatioSection = false;
    }
    const multiLineOsMatch = trimmed.match(/^[-•*]\s*([^(|]+?)\s*\(([^)]+)\)\s*\|\s*(?:OS\s*)?#?(\d+)\s*\|\s*([^|]+)$/i);
    if (multiLineOsMatch && i + 1 < lines.length) {
      const nextLine = lines[i + 1].trim();
      const statusMatch = nextLine.match(/Status:\s*([^|]+)\s*\|\s*(?:Pátio|Aging|Permanência):\s*([^|]+)\s*\|\s*Valor:\s*([^|\n]+)/i);
      if (statusMatch) {
        const model = multiLineOsMatch[1].replace(/[*_]/g, "").trim().toUpperCase();
        const plate = multiLineOsMatch[2].replace(/[*_]/g, "").trim().toUpperCase();
        const osId = multiLineOsMatch[3].trim();
        const client = multiLineOsMatch[4].replace(/[*_]/g, "").trim();
        const status = statusMatch[1].trim();
        const patio = statusMatch[2].trim();
        const valor = statusMatch[3].trim();
        output.push(`*OS #${osId} \u2014 ${model} (${plate})*`);
        output.push(`  \u2514 Status: *${status}* \xB7 *${patio}*`);
        output.push(`  \u2514 Financeiro: *${valor}*`);
        if (client && client !== "N\xE3o informado") {
          output.push(`  \u2514 Opera\xE7\xE3o: Cliente: ${client}`);
        }
        output.push("");
        i++;
        continue;
      }
    }
    const singleLineOsMatch = trimmed.match(/^[-•*]\s*(?:[*_])?([^(|]+?)(?:[*_])?\s*\(([^)]+)\)\s*\|\s*(?:OS\s*)?#?(\d+)\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*(.+)$/i);
    if (singleLineOsMatch) {
      const model = singleLineOsMatch[1].replace(/[*_]/g, "").trim().toUpperCase();
      const plate = singleLineOsMatch[2].replace(/[*_]/g, "").trim().toUpperCase();
      const osId = singleLineOsMatch[3].trim();
      const client = singleLineOsMatch[4].replace(/[*_]/g, "").trim();
      const patio = singleLineOsMatch[5].trim();
      const status = singleLineOsMatch[6].trim();
      const valor = singleLineOsMatch[7].trim();
      output.push(`*OS #${osId} \u2014 ${model} (${plate})*`);
      output.push(`  \u2514 Status: *${status}* \xB7 *${patio}*`);
      output.push(`  \u2514 Financeiro: *${valor}*`);
      if (client && client !== "N\xE3o informado") {
        output.push(`  \u2514 Opera\xE7\xE3o: Cliente: ${client}`);
      }
      output.push("");
      continue;
    }
    const storeOverviewMatch = trimmed.match(/^[-•*]\s*(?:\*)?([A-Za-zÀ-ÖØ-öø-ÿ0-9\s/—–-]+?)(?:\*)?:\s*(\d+\s+veículos[^\n|]*)\s*\|\s*Valor(?:\s+em\s+serviço)?:\s*([^|]+)\s*\|\s*Saldo(?:\s+a\s+receber)?:\s*([^|\n]+)$/i);
    if (storeOverviewMatch) {
      const storeName = storeOverviewMatch[1].replace(/[*_]/g, "").trim();
      const vehCount = storeOverviewMatch[2].trim();
      const valServico = storeOverviewMatch[3].replace(/[*_]/g, "").trim();
      const saldo = storeOverviewMatch[4].replace(/[*_]/g, "").trim();
      output.push("----------------------------------------");
      output.push(`> *${storeName} (${vehCount})*`);
      output.push(`- *Valor em servi\xE7o:* ${valServico}`);
      output.push(`- *Saldo a receber:* ${saldo}`);
      continue;
    }
    const agingMultiMatch = trimmed.match(/^[-•*]\s*(?:\*)?([A-Za-zÀ-ÖØ-öø-ÿ0-9\s/—–-]+?)(?:\*)?:\s*(OS\s*#\d+[^\n|]+)\s*\|\s*(OS\s*#\d+.+)$/i);
    if (agingMultiMatch) {
      const storeName = agingMultiMatch[1].replace(/[*_]/g, "").trim();
      const osParts = trimmed.substring(trimmed.indexOf(":") + 1).split("|").map((p) => p.trim()).filter(Boolean);
      output.push("----------------------------------------");
      output.push(`> *${storeName}*`);
      for (const part of osParts) {
        output.push(`- ${part}`);
      }
      continue;
    }
    const agingSingleMatch = trimmed.match(/^[-•*]\s*(?:\*)?([A-Za-zÀ-ÖØ-öø-ÿ0-9\s/—–-]+?)(?:\*)?:\s*(OS\s*#\d+\s*\([^)]+\)\s*·\s*\d+\s+dias[^\n]*)$/i);
    if (agingSingleMatch && inStorePatioSection) {
      const storeName = agingSingleMatch[1].replace(/[*_]/g, "").trim();
      const osDesc = agingSingleMatch[2].trim();
      output.push("----------------------------------------");
      output.push(`> *${storeName}*`);
      output.push(`- ${osDesc}`);
      continue;
    }
    if (trimmed.includes("|") && !trimmed.startsWith("|")) {
      const parts = trimmed.split("|").map((p) => p.trim()).filter(Boolean);
      if (parts.length > 1) {
        if (parts[0].startsWith("-") || parts[0].startsWith("\u2022")) {
          output.push(parts[0]);
          for (let pIdx = 1; pIdx < parts.length; pIdx++) {
            const sub = parts[pIdx];
            if (sub.includes(":")) {
              output.push(`  - ${sub}`);
            } else {
              output.push(`  \u2022 ${sub}`);
            }
          }
          continue;
        }
      }
    }
    output.push(line);
  }
  let result = output.join("\n");
  result = result.replace(/(?:----------------------------------------\s*\n\s*){2,}/g, "----------------------------------------\n");
  return result;
}
function assertNoDoubleAsterisks(text) {
  if (!text) return true;
  return !/\*\*/.test(text) && !/__/.test(text);
}
function assertWhatsAppNativeFormat(text) {
  if (!text) return true;
  if (/\*\*|__/.test(text)) return false;
  if (/^#{1,6}\s+/m.test(text)) return false;
  if (/^(?!---BLOCK---|----------------------------------------)[\t ]*[-*_]{3,}[\t ]*$/m.test(text)) return false;
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
  if (/^\*OS\s*#?\d+[^*]*\*$/i.test(firstLine) || /^>\s*\*?OS\s*#?\d+/i.test(firstLine)) {
    return lines.length === 1;
  }
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
      for (let k = 0; k < groupedBlocks.length - 1; k++) {
        const bLines = groupedBlocks[k].trim().split("\n");
        const lastLine = bLines[bLines.length - 1].trim();
        const isTrailingTitle = /^\*OS\s*#?\d+[^*]*\*$/i.test(lastLine) || /^>\s*\*?OS\s*#?\d+/i.test(lastLine) || isSectionHeader(lastLine);
        if (isTrailingTitle && bLines.length > 1) {
          bLines.pop();
          if (bLines.length > 0 && /^[-*_]{3,}$/.test(bLines[bLines.length - 1].trim())) {
            bLines.pop();
          }
          groupedBlocks[k] = bLines.join("\n").trim();
          groupedBlocks[k + 1] = `${lastLine}

${groupedBlocks[k + 1]}`.trim();
        }
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
  reformatPipedLinesToHermesCards,
  sanitizeWhatsAppMarkdown,
  splitIntoWhatsAppBlocks
};
