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
function formatHoursAndMin(hours) {
  const totalMin = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const hStr = hours.toFixed(2).replace(".", ",");
  if (h > 0 && m > 0) {
    return `${hStr}h (${h}h ${m} min)`;
  }
  return `${hStr}h (${totalMin} min)`;
}
function composeTemparioHermesBalloon(response) {
  const sections = [];
  sections.push("*HYDRA | Temp\xE1rio T\xE9cnico Automotivo*");
  if (response.veiculo) {
    const v = response.veiculo;
    const anoStr = v.anoInicio === v.anoFim ? `${v.anoInicio}` : `${v.anoInicio}-${v.anoFim}`;
    const engineStr = response.motor ? ` \xB7 Motor ${response.motor.descricaoComercial}` : "";
    const servicosTitulos = response.operacoesResolvidas.length > 0 ? response.operacoesResolvidas.map((o) => o.titulo).join(" + ") : response.cadeiaExecucao.steps.map((s) => s.titulo).join(" + ") || "Servi\xE7o sob consulta";
    const dificuldades = response.operacoesResolvidas.map((o) => o.grauDificuldade);
    const dificuldadeStr = dificuldades.includes("ESPECIALISTA") ? "Especialista" : dificuldades.includes("ALTO") ? "Alto" : dificuldades.includes("MEDIO") ? "M\xE9dio" : "Baixo";
    sections.push(
      `> *${v.marca} ${v.modelo} (${anoStr})${engineStr}*
- *Servi\xE7os consultados:* ${servicosTitulos}
- *Grau de dificuldade:* ${dificuldadeStr}`
    );
  } else {
    sections.push(
      `> *Ve\xEDculo sob Estimativa Provis\xF3ria*
- *Aviso:* ${response.avisoQuarentena || "Ve\xEDculo ou servi\xE7o n\xE3o localizado no cat\xE1logo homologado OEM."}
- *Status de evid\xEAncia:* Estimativa externa pendente de valida\xE7\xE3o`
    );
  }
  if (response.cadeiaExecucao.steps.length > 0) {
    const stepLines = ["*Sequ\xEAncia de execu\xE7\xE3o otimizada (Grafo de Acesso)*"];
    for (const step of response.cadeiaExecucao.steps) {
      const faseLabel = step.faseExecucao === "DESMONTAGEM" ? "Desmontagem" : step.faseExecucao === "EXECUCAO" ? "Execu\xE7\xE3o" : step.faseExecucao === "REMONTAGEM" ? "Remontagem" : "Teste e Ajuste";
      let line = `- *${step.ordemExecucaoFinal}. ${step.titulo} (${faseLabel}):* *${step.tempoHoras.toFixed(2).replace(".", ",")}h* (${step.tempoMinutos} min)`;
      if (step.ferramentas && step.ferramentas.length > 0) {
        line += `
  Ferramentas: ${step.ferramentas.join(", ")}`;
      }
      if (step.torqueEspecificado) {
        line += ` (Torque: ${step.torqueEspecificado})`;
      }
      if (step.isAcessoCompartilhado) {
        line += `
  Acesso compartilhado entre os servi\xE7os (contabilizado 1 \xFAnica vez)`;
      }
      stepLines.push(line);
    }
    sections.push(stepLines.join("\n"));
  }
  const cadeia = response.cadeiaExecucao;
  const taxaPadrao = cadeia.taxaHorariaPadrao || 270;
  const valorBruto = cadeia.valorMaoDeObraBrutoSemAssociativa ?? Math.round(cadeia.tempoBrutoTotalHoras * taxaPadrao * 100) / 100;
  const valorLiquido = cadeia.valorMaoDeObraSugerido ?? Math.round(cadeia.tempoLiquidoTotalHoras * taxaPadrao * 100) / 100;
  const economiaReais = cadeia.economiaMaoDeObraReais ?? Math.round(cadeia.tempoEconomizadoDeduplicacaoHoras * taxaPadrao * 100) / 100;
  const precoLines = [
    `*Valores de M\xE3o de Obra (Taxa da Rede: R$ ${taxaPadrao.toFixed(2).replace(".", ",")}/h)*`,
    `- *Tempo bruto somado (sem pacote):* ${formatHoursAndMin(cadeia.tempoBrutoTotalHoras)} (R$ ${valorBruto.toFixed(2).replace(".", ",")})`
  ];
  if (cadeia.possuiDeduplicacaoAtiva && cadeia.tempoEconomizadoDeduplicacaoHoras > 0) {
    precoLines.push(
      `- *Desconto por acesso compartilhado:* *-${cadeia.tempoEconomizadoDeduplicacaoHoras.toFixed(2).replace(".", ",")}h* (-R$ ${economiaReais.toFixed(2).replace(".", ",")})`
    );
  }
  precoLines.push(`- *Tempo l\xEDquido cobrado:* *${formatHoursAndMin(cadeia.tempoLiquidoTotalHoras)}*`);
  precoLines.push(`- *Total M\xE3o de Obra a Cobrar:* *R$ ${valorLiquido.toFixed(2).replace(".", ",")}*`);
  sections.push(precoLines.join("\n"));
  if (cadeia.pecasNecessarias && cadeia.pecasNecessarias.length > 0) {
    const pecasLines = ["*Associativa de Pe\xE7as Necess\xE1rias*"];
    for (const p of cadeia.pecasNecessarias) {
      const statusPeca = p.obrigatoria ? "Obrigat\xF3ria" : "Preventiva recomendada";
      const spec = p.especificacaoTecnica ? ` [${p.especificacaoTecnica}]` : "";
      pecasLines.push(`- [x] ${p.nomePeca} (${p.quantidade} ${p.unidade})${spec} \u2014 ${statusPeca}`);
    }
    sections.push(pecasLines.join("\n"));
  }
  if (cadeia.ferramentasNecessarias && cadeia.ferramentasNecessarias.length > 0) {
    const ferrLines = ["*Ferramentas Especiais Exigidas na Bancada*"];
    for (const ferr of cadeia.ferramentasNecessarias) {
      ferrLines.push(`- ${ferr}`);
    }
    if (cadeia.torquesEspecificados && cadeia.torquesEspecificados.length > 0) {
      ferrLines.push(`- *Torques Cr\xEDticos:* ${cadeia.torquesEspecificados.join("; ")}`);
    }
    sections.push(ferrLines.join("\n"));
  }
  const comp = response.comparativoPatio;
  const compLines = [
    "*Comparativo: Tempo Tabelado vs. Realidade de P\xE1tio*",
    `- *Tempo bruto somado (sem grafo):* ${formatHoursAndMin(cadeia.tempoBrutoTotalHoras)}`
  ];
  if (cadeia.possuiDeduplicacaoAtiva && cadeia.tempoEconomizadoDeduplicacaoHoras > 0) {
    compLines.push(
      `- *Economia por acesso compartilhado:* *-${cadeia.tempoEconomizadoDeduplicacaoHoras.toFixed(2).replace(".", ",")}h* (-${cadeia.tempoEconomizadoDeduplicacaoMinutos} min)`
    );
  }
  compLines.push(`- *Tempo tabelado l\xEDquido (Manual OEM):* *${formatHoursAndMin(cadeia.tempoLiquidoTotalHoras)}*`);
  if (comp.temHistoricoRede && comp.tempoMedioExecucaoHoras !== null) {
    const escopoDesc = comp.escopoAplicado === "LOJA_ISOLADA" && comp.lojaFiltroSlug ? `na unidade ${comp.lojaFiltroSlug}` : "na rede";
    compLines.push(`- *Tempo m\xE9dio de execu\xE7\xE3o ${escopoDesc} (${comp.totalOsAnalisadas} OSs):* *${formatHoursAndMin(comp.tempoMedioExecucaoHoras)}*`);
    if (comp.leadTimeMedioPatioDias !== null) {
      compLines.push(`- *Perman\xEAncia m\xE9dia em p\xE1tio (Lead Time):* *${comp.leadTimeMedioPatioDias.toFixed(1).replace(".", ",")} dias*`);
    }
    if (comp.gargalosFatuaisComprovados.length > 0) {
      compLines.push(`- *Gargalos documentados nas OSs:* ${comp.gargalosFatuaisComprovados.join("; ")}`);
    }
  } else {
    compLines.push(`- *Hist\xF3rico de p\xE1tio:* ${comp.declaracaoLimitacaoFactual}`);
  }
  sections.push(compLines.join("\n"));
  const auditLines = ["> *Proveni\xEAncia e Auditoria*"];
  const statusDesc = response.statusEvidenciaGlobal === "HOMOLOGADO_OEM" ? "Manual Oficial OEM (Homologado)" : response.statusEvidenciaGlobal === "HISTORICO_OS_REDE" ? "Hist\xF3rico Factual de Ordens de Servi\xE7o" : "Estimativa Externa Pendente de Valida\xE7\xE3o";
  auditLines.push(`- *Classifica\xE7\xE3o:* ${statusDesc}`);
  if (response.evidenciasFontes && response.evidenciasFontes.length > 0) {
    const fontes = response.evidenciasFontes.map((f) => {
      let desc = f.nomeDocumento;
      if (f.capituloSecao) desc += ` (${f.capituloSecao}`;
      if (f.paginaTabela) desc += `, ${f.paginaTabela}`;
      if (f.capituloSecao) desc += `)`;
      return desc;
    }).join("; ");
    auditLines.push(`- *Fonte:* ${fontes}`);
  } else if (response.avisoQuarentena) {
    auditLines.push(`- *Quarentena:* ${response.avisoQuarentena}`);
  }
  auditLines.push(`- *Confian\xE7a da recupera\xE7\xE3o:* ${Math.round(response.confidenceScore * 100)}%`);
  sections.push(auditLines.join("\n"));
  const rawFullText = sections.join("\n\n");
  const sanitized = sanitizeWhatsAppMarkdown(rawFullText);
  const cleanNBSP = sanitized.replace(/[\u00A0\u202F]/g, " ");
  return composeSemanticBalloons(cleanNBSP);
}
function composeTemparioExecutiveBalloon(response, options) {
  const sections = [];
  const v = response.veiculo;
  const m = response.motor;
  const marcaPura = v?.marca && v.marca !== "Nacional" ? `${v.marca} ` : "";
  const modeloPuro = v?.modelo ? v.modelo.charAt(0).toUpperCase() + v.modelo.slice(1) : "Ve\xEDculo";
  let vehicleDesc = v ? `${marcaPura}${modeloPuro}` : "Ve\xEDculo";
  if (v && v.anoInicio && v.anoFim) {
    vehicleDesc += ` (${v.anoInicio}-${v.anoFim})`;
  }
  if (m && m.descricaoComercial) {
    vehicleDesc += ` \xB7 Motor ${m.descricaoComercial}`;
  }
  const servicosTexto = response.operacoesResolvidas.length > 0 ? response.operacoesResolvidas.map((o) => o.titulo).join(" + ") : response.cadeiaExecucao.steps.length > 0 ? response.cadeiaExecucao.steps.map((s) => s.titulo.replace(/\s*\(Pesquisa Técnica Web\)/gi, "")).join(" + ") : "Servi\xE7os Mec\xE2nicos Solicitados";
  const headerLines = [
    "*HYDRA | Temp\xE1rio T\xE9cnico & M\xE3o de Obra*",
    "",
    `> *${vehicleDesc}*`,
    `- *Servi\xE7os:* ${servicosTexto}`
  ];
  sections.push(headerLines.join("\n"));
  const cadeia = response.cadeiaExecucao;
  const taxaPadrao = cadeia.taxaHorariaPadrao || 270;
  const valorLiquido = cadeia.valorMaoDeObraSugerido ?? Math.round(cadeia.tempoLiquidoTotalHoras * taxaPadrao * 100) / 100;
  const economiaReais = cadeia.economiaMaoDeObraReais ?? Math.round(cadeia.tempoEconomizadoDeduplicacaoHoras * taxaPadrao * 100) / 100;
  const precoLines = [
    `*Resumo de M\xE3o de Obra (Taxa da Rede: R$ ${taxaPadrao.toFixed(2).replace(".", ",")}/h)*`,
    `- *Tempo l\xEDquido cobrado:* *${formatHoursAndMin(cadeia.tempoLiquidoTotalHoras)}*`,
    `- *Total M\xE3o de Obra a Cobrar:* *R$ ${valorLiquido.toFixed(2).replace(".", ",")}*`
  ];
  if (cadeia.possuiDeduplicacaoAtiva && cadeia.tempoEconomizadoDeduplicacaoHoras > 0) {
    precoLines.push(
      `- *Economia por acesso compartilhado:* *-${cadeia.tempoEconomizadoDeduplicacaoHoras.toFixed(2).replace(".", ",")}h* (-R$ ${economiaReais.toFixed(2).replace(".", ",")})`
    );
  }
  const qtdEtapas = cadeia.steps?.length || 1;
  precoLines.push(`- *Complexidade t\xE9cnica:* M\xE9dia (${qtdEtapas} etapas no grafo de acesso)`);
  sections.push(precoLines.join("\n"));
  if (options?.includePecasDirectly && cadeia.pecasNecessarias && cadeia.pecasNecessarias.length > 0) {
    const pecasLines = ["*Associativa de Pe\xE7as Necess\xE1rias*"];
    for (const p of cadeia.pecasNecessarias) {
      const statusPeca = p.obrigatoria ? "Obrigat\xF3ria" : "Preventiva recomendada";
      const spec = p.especificacaoTecnica ? ` [${p.especificacaoTecnica}]` : "";
      pecasLines.push(`- [x] ${p.nomePeca} (${p.quantidade} ${p.unidade})${spec} \u2014 ${statusPeca}`);
    }
    sections.push(pecasLines.join("\n"));
  }
  if (options?.includeFerramentasDirectly && cadeia.ferramentasNecessarias && cadeia.ferramentasNecessarias.length > 0) {
    const ferrLines = ["*Ferramentas Especiais Exigidas na Bancada*"];
    for (const ferr of cadeia.ferramentasNecessarias) {
      ferrLines.push(`- ${ferr}`);
    }
    if (cadeia.torquesEspecificados && cadeia.torquesEspecificados.length > 0) {
      ferrLines.push(`- *Torques Cr\xEDticos:* ${cadeia.torquesEspecificados.join("; ")}`);
    }
    sections.push(ferrLines.join("\n"));
  }
  if (!options?.includePecasDirectly && !options?.includeFerramentasDirectly) {
    const qtdPecas = cadeia.pecasNecessarias?.length || 0;
    const qtdFerr = cadeia.ferramentasNecessarias?.length || 0;
    const menuLines = [
      "----------------------------------------",
      "*Deseja ver o detalhamento t\xE9cnico?*",
      `1\uFE0F\u20E3 *Pe\xE7as necess\xE1rias* (${qtdPecas > 0 ? `${qtdPecas} itens` : "consultar lista"})`,
      `2\uFE0F\u20E3 *Ferramentas de bancada e torques* (${qtdFerr > 0 ? `${qtdFerr} itens` : "consultar"})`,
      "3\uFE0F\u20E3 *Passo a passo da montagem* (sequ\xEAncia otimizada)",
      "4\uFE0F\u20E3 *Tudo completo* (relat\xF3rio t\xE9cnico integral)",
      "",
      '_Responda com o n\xFAmero (1, 2, 3 ou 4) ou escreva o que precisa (ex: "pe\xE7as" ou "ferramentas")._'
    ];
    sections.push(menuLines.join("\n"));
  }
  const rawFullText = sections.join("\n\n");
  const sanitized = sanitizeWhatsAppMarkdown(rawFullText).replace(/[\u00A0\u202F]/g, " ");
  return [sanitized];
}
function composeTemparioDetailBalloon(choice, response) {
  if (choice === "COMPLETO") {
    return composeTemparioHermesBalloon(response);
  }
  const sections = [];
  const v = response.veiculo;
  const m = response.motor;
  let vehicleDesc = v ? `${v.marca} ${v.modelo}` : "Ve\xEDculo";
  if (v && v.anoInicio && v.anoFim) {
    vehicleDesc += ` (${v.anoInicio}-${v.anoFim})`;
  }
  if (m && m.descricaoComercial) {
    vehicleDesc += ` \xB7 Motor ${m.descricaoComercial}`;
  }
  const servicosTexto = response.operacoesResolvidas.length > 0 ? response.operacoesResolvidas.map((o) => o.titulo).join(" + ") : "Servi\xE7os Mec\xE2nicos Solicitados";
  const cadeia = response.cadeiaExecucao;
  if (choice === "PECAS") {
    sections.push(
      `*HYDRA | Pe\xE7as Necess\xE1rias*

> *${vehicleDesc}*
- *Servi\xE7o:* ${servicosTexto}`
    );
    if (cadeia.pecasNecessarias && cadeia.pecasNecessarias.length > 0) {
      const pecasObrigatorias = cadeia.pecasNecessarias.filter((p) => p.obrigatoria);
      const pecasPreventivas = cadeia.pecasNecessarias.filter((p) => !p.obrigatoria);
      if (pecasObrigatorias.length > 0) {
        const lines = ["*Pe\xE7as Obrigat\xF3rias para Montagem*"];
        for (const p of pecasObrigatorias) {
          const spec = p.especificacaoTecnica ? ` [${p.especificacaoTecnica}]` : "";
          lines.push(`- [x] ${p.nomePeca} (${p.quantidade} ${p.unidade})${spec}`);
        }
        sections.push(lines.join("\n"));
      }
      if (pecasPreventivas.length > 0) {
        const lines = ["*Itens Preventivos Recomendados*"];
        for (const p of pecasPreventivas) {
          const spec = p.especificacaoTecnica ? ` [${p.especificacaoTecnica}]` : "";
          lines.push(`- [ ] ${p.nomePeca} (${p.quantidade} ${p.unidade})${spec} \u2014 Opcional/Recomendado`);
        }
        sections.push(lines.join("\n"));
      }
    } else {
      sections.push("Nenhuma pe\xE7a obrigat\xF3ria adicional registrada para este procedimento.");
    }
  } else if (choice === "FERRAMENTAS") {
    sections.push(
      `*HYDRA | Ferramental & Torques de Bancada*

> *${vehicleDesc}*
- *Servi\xE7o:* ${servicosTexto}`
    );
    if (cadeia.ferramentasNecessarias && cadeia.ferramentasNecessarias.length > 0) {
      const ferrLines = ["*Ferramental Especial Exigido na Bancada*"];
      for (const f of cadeia.ferramentasNecessarias) {
        ferrLines.push(`- ${f}`);
      }
      sections.push(ferrLines.join("\n"));
    }
    if (cadeia.torquesEspecificados && cadeia.torquesEspecificados.length > 0) {
      const torqueLines = ["*Torques Cr\xEDticos Tabelados pela Montadora*"];
      for (const t of cadeia.torquesEspecificados) {
        torqueLines.push(`- ${t}`);
      }
      sections.push(torqueLines.join("\n"));
    }
    if ((!cadeia.ferramentasNecessarias || cadeia.ferramentasNecessarias.length === 0) && (!cadeia.torquesEspecificados || cadeia.torquesEspecificados.length === 0)) {
      sections.push("Ferramentas manuais convencionais de oficina mec\xE2nica.");
    }
  } else if (choice === "PASSOS") {
    sections.push(
      `*HYDRA | Sequ\xEAncia T\xE9cnica de Execu\xE7\xE3o*

> *${vehicleDesc}*
- *Servi\xE7o:* ${servicosTexto}`
    );
    if (cadeia.steps && cadeia.steps.length > 0) {
      const stepLines = ["*Passo a Passo Otimizado (Grafo de Acesso)*"];
      for (const step of cadeia.steps) {
        const faseLabel = step.faseExecucao === "DESMONTAGEM" ? "Desmontagem" : step.faseExecucao === "EXECUCAO" ? "Execu\xE7\xE3o" : step.faseExecucao === "REMONTAGEM" ? "Remontagem" : "Teste e Ajuste";
        let line = `- *${step.ordemExecucaoFinal}. ${step.titulo} (${faseLabel}):* *${step.tempoHoras.toFixed(2).replace(".", ",")}h* (${step.tempoMinutos} min)`;
        if (step.ferramentas && step.ferramentas.length > 0) {
          line += `
  Ferramentas: ${step.ferramentas.join(", ")}`;
        }
        if (step.torqueEspecificado) {
          line += ` (Torque: ${step.torqueEspecificado})`;
        }
        if (step.isAcessoCompartilhado) {
          line += `
  Acesso compartilhado entre os servi\xE7os (contabilizado 1 \xFAnica vez)`;
        }
        stepLines.push(line);
      }
      sections.push(stepLines.join("\n"));
    }
  }
  const rawFullText = sections.join("\n\n");
  const sanitized = sanitizeWhatsAppMarkdown(rawFullText).replace(/[\u00A0\u202F]/g, " ");
  return [sanitized];
}
function composePlateVehicleBalloon(record) {
  const anoStr = record.anoModelo ? record.anoFabricacao && record.anoFabricacao !== record.anoModelo ? ` (${record.anoFabricacao}/${record.anoModelo})` : ` (${record.anoModelo})` : "";
  const header = `*HYDRA | Consulta Veicular por Placa*

> *${record.modeloCompleto}${anoStr}*`;
  const details = [];
  details.push(`- *Placa:* ${record.placaFormatada}`);
  const corComb = [];
  if (record.cor) corComb.push(`*Cor:* ${record.cor}`);
  if (record.combustivel) corComb.push(`*Combust\xEDvel:* ${record.combustivel}`);
  if (corComb.length > 0) {
    details.push(`- ${corComb.join(" \xB7 ")}`);
  }
  const loc = [];
  if (record.municipio) loc.push(record.municipio);
  if (record.uf) loc.push(record.uf);
  if (loc.length > 0) {
    details.push(`- *Munic\xEDpio:* ${loc.join(" / ")}`);
  }
  const mec = [];
  if (record.motor) mec.push(`*Motor:* ${record.motor}`);
  if (record.potencia) mec.push(`*Pot\xEAncia:* ${record.potencia} cv`);
  if (record.cilindrada) mec.push(`*Cilindradas:* ${record.cilindrada} cc`);
  if (mec.length > 0) {
    details.push(`- ${mec.join(" \xB7 ")}`);
  }
  if (record.chassiMascarado) {
    details.push(`- *Chassi:* \`${record.chassiMascarado}\``);
  }
  const situacao = record.situacao ? record.situacao === "CIRCULACAO" ? "Em circula\xE7\xE3o (Regular)" : record.situacao : "Em circula\xE7\xE3o (Regular)";
  details.push(`- *Situa\xE7\xE3o cadastral:* ${situacao}`);
  const fonte = record.origemDados === "ORDENS_SERVICO_REDE" ? "_Dados recuperados do hist\xF3rico operacional da rede de oficinas._" : "_Dados obtidos via Base Nacional de Registro Veicular (APIBrasil)._";
  const balloonText = `${header}
${details.join("\n")}

${fonte}`;
  const sanitized = sanitizeWhatsAppMarkdown(balloonText).replace(/[\u00A0\u202F]/g, " ");
  return [sanitized];
}
export {
  composePartialSuccessBalloon,
  composePlateVehicleBalloon,
  composeSemanticBalloons,
  composeSemanticBalloonsStructured,
  composeTemparioDetailBalloon,
  composeTemparioExecutiveBalloon,
  composeTemparioHermesBalloon,
  convertMarkdownTablesToWhatsAppLists,
  formatCurrencyBRL,
  formatDeterministicFinancialBalloon,
  formatPercentBR,
  parseSemanticSections,
  splitIntoAtomicItems
};
