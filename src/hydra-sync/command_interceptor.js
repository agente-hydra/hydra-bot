// src/hydra-sync/db_repository.ts
import Database from "better-sqlite3";
import { createRequire } from "module";
var requireESM = createRequire(import.meta.url);
var CATALOGO_10_LOJAS = [
  "MPdompedro1",
  "MPJabaquara",
  "MPJorgeBeretta",
  "MPkennedy",
  "MPpiraporinha",
  "MPplanalto",
  "MPrudge",
  "MPSantoAndre",
  "ReiDoModulo",
  "ReiDoOleoMaua"
];
var STORE_DISPLAY_NAMES = {
  "mpdompedro1": "Dom Pedro I",
  "mpjabaquara": "Jabaquara",
  "mpjorgeberetta": "Jorge Beretta",
  "mpkennedy": "Kennedy",
  "mppiraporinha": "Piraporinha",
  "mpplanalto": "Planalto",
  "mprudge": "Rudge Ramos",
  "mpsantoandre": "Santo Andr\xE9",
  "reidomodulo": "Rei do M\xF3dulo",
  "reidooleomaua": "Rei do \xD3leo Mau\xE1",
  "mpmaster": "Master"
};

// src/hydra-sync/turn_context_repository.ts
var NON_OS_TOPIC_INTENTS = [
  "financial_alerts",
  "store_overview",
  "store_cmv",
  "store_areas",
  "media_survey"
];
function ensureTurnContextTable(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS hydra_turn_contexts (
        phone TEXT PRIMARY KEY,
        last_turn_id TEXT NOT NULL,
        last_intent TEXT NOT NULL,
        loja_slug TEXT,
        placa TEXT,
        os_id TEXT,
        filters_json TEXT,
        last_message_id INTEGER,
        last_response_text TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_turn_contexts_updated ON hydra_turn_contexts(updated_at);
    `);
  } catch (err) {
    console.error("[TURN_CONTEXT] Erro ao criar tabela hydra_turn_contexts:", err?.message || err);
  }
}
function cleanPhone(raw) {
  return (raw || "").replace(/\D/g, "");
}
function getLatestTurnState(db, phone, maxAgeMinutes = 120) {
  ensureTurnContextTable(db);
  const p = cleanPhone(phone);
  if (!p) return null;
  try {
    const row = db.prepare(`
      SELECT phone, last_turn_id, last_intent, loja_slug, placa, os_id, filters_json, last_message_id, last_response_text, updated_at
      FROM hydra_turn_contexts
      WHERE phone = ?
    `).get(p);
    if (!row) return null;
    const updatedAtMillis = new Date(row.updated_at).getTime();
    if (Number.isFinite(updatedAtMillis)) {
      const ageMs = Date.now() - updatedAtMillis;
      if (ageMs > maxAgeMinutes * 60 * 1e3) {
        return null;
      }
    }
    let filters = {};
    let lastContract = void 0;
    if (row.filters_json) {
      try {
        const parsed = JSON.parse(row.filters_json);
        if (parsed && typeof parsed === "object") {
          if (parsed._contract) {
            lastContract = parsed._contract;
            const { _contract, ...restFilters } = parsed;
            filters = restFilters;
          } else {
            filters = parsed;
          }
        }
      } catch {
        filters = {};
      }
    }
    return {
      phone: row.phone,
      lastTurnId: row.last_turn_id,
      lastIntent: row.last_intent,
      lojaSlug: row.loja_slug || void 0,
      placa: row.placa || void 0,
      osId: row.os_id || void 0,
      filters,
      lastContract,
      lastMessageId: row.last_message_id != null ? Number(row.last_message_id) : void 0,
      lastResponseText: row.last_response_text || void 0,
      updatedAt: row.updated_at
    };
  } catch (err) {
    console.error("[TURN_CONTEXT] Erro ao recuperar estado do turno:", err?.message || err);
    return null;
  }
}
function saveTurnState(db, state) {
  ensureTurnContextTable(db);
  const p = cleanPhone(state.phone);
  if (!p) return;
  try {
    const existing = db.prepare(`
      SELECT loja_slug, os_id, placa FROM hydra_turn_contexts WHERE phone = ?
    `).get(p);
    const hadActiveOS = Boolean(existing?.os_id);
    let targetLojaSlug = state.lojaSlug || null;
    let targetOsId = state.osId || null;
    let targetPlaca = state.placa || null;
    const isTopicShiftFromOSToFinance = hadActiveOS && NON_OS_TOPIC_INTENTS.includes(state.lastIntent) && !state.filters?.isOSSpecific && !state.filters?.explicitOS;
    if (isTopicShiftFromOSToFinance) {
      targetOsId = null;
      targetPlaca = null;
      if (!targetLojaSlug && existing?.loja_slug) {
        targetLojaSlug = existing.loja_slug;
      }
    }
    if (state.lastIntent === "os_detail" || state.filters?.isOSSpecific) {
      if (state.osId) targetOsId = state.osId;
      if (state.placa) targetPlaca = state.placa;
      if (!targetLojaSlug && existing?.loja_slug) {
        targetLojaSlug = existing.loja_slug;
      }
    }
    const payloadFilters = {
      ...state.filters || {},
      ...state.lastContract ? { _contract: state.lastContract } : {}
    };
    const filtersJson = JSON.stringify(payloadFilters);
    const nowIso = state.updatedAt || (/* @__PURE__ */ new Date()).toISOString();
    db.prepare(`
      INSERT INTO hydra_turn_contexts (
        phone, last_turn_id, last_intent, loja_slug, placa, os_id,
        filters_json, last_message_id, last_response_text, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(phone) DO UPDATE SET
        last_turn_id = excluded.last_turn_id,
        last_intent = excluded.last_intent,
        loja_slug = excluded.loja_slug,
        placa = excluded.placa,
        os_id = excluded.os_id,
        filters_json = excluded.filters_json,
        last_message_id = excluded.last_message_id,
        last_response_text = excluded.last_response_text,
        updated_at = excluded.updated_at
    `).run(
      p,
      state.lastTurnId,
      state.lastIntent,
      targetLojaSlug,
      targetPlaca,
      targetOsId,
      filtersJson,
      state.lastMessageId != null ? state.lastMessageId : null,
      state.lastResponseText || null,
      nowIso
    );
  } catch (err) {
    console.error("[TURN_CONTEXT] Erro ao salvar estado do turno:", err?.message || err);
  }
}
function clearTurnState(db, phone) {
  ensureTurnContextTable(db);
  const p = cleanPhone(phone);
  if (!p) return;
  try {
    db.prepare("DELETE FROM hydra_turn_contexts WHERE phone = ?").run(p);
  } catch {
  }
}

// src/hydra-sync/balloon_composer.js
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

// src/hydra-sync/command_interceptor.ts
var AUTHORIZED_NUMBERS = /* @__PURE__ */ new Set([
  "5511996242812",
  "5511970671717"
]);
var STORE_COMMANDS = {
  "/dompedro": {
    command: "/dompedro",
    lojaSlug: "MPdompedro1",
    nome: STORE_DISPLAY_NAMES["mpdompedro1"] || "Dom Pedro I",
    description: "Assume perfil de Gerente da loja Dom Pedro I."
  },
  "/jabaquara": {
    command: "/jabaquara",
    lojaSlug: "MPJabaquara",
    nome: STORE_DISPLAY_NAMES["mpjabaquara"] || "Jabaquara",
    description: "Assume perfil de Gerente da loja Jabaquara."
  },
  "/jorgeberetta": {
    command: "/jorgeberetta",
    lojaSlug: "MPJorgeBeretta",
    nome: STORE_DISPLAY_NAMES["mpjorgeberetta"] || "Jorge Beretta",
    description: "Assume perfil de Gerente da loja Jorge Beretta."
  },
  "/kennedy": {
    command: "/kennedy",
    lojaSlug: "MPkennedy",
    nome: STORE_DISPLAY_NAMES["mpkennedy"] || "Kennedy",
    description: "Assume perfil de Gerente da loja Kennedy."
  },
  "/maua": {
    command: "/maua",
    lojaSlug: "ReiDoOleoMaua",
    nome: STORE_DISPLAY_NAMES["reidooleomaua"] || "Rei do \xD3leo Mau\xE1",
    description: "Assume perfil de Gerente da loja Rei do \xD3leo Mau\xE1."
  },
  "/piraporinha": {
    command: "/piraporinha",
    lojaSlug: "MPpiraporinha",
    nome: STORE_DISPLAY_NAMES["mppiraporinha"] || "Piraporinha",
    description: "Assume perfil de Gerente da loja Piraporinha."
  },
  "/planalto": {
    command: "/planalto",
    lojaSlug: "MPplanalto",
    nome: STORE_DISPLAY_NAMES["mpplanalto"] || "Planalto",
    description: "Assume perfil de Gerente da loja Planalto."
  },
  "/reidomodulo": {
    command: "/reidomodulo",
    lojaSlug: "ReiDoModulo",
    nome: STORE_DISPLAY_NAMES["reidomodulo"] || "Rei do M\xF3dulo",
    description: "Assume perfil de Gerente da loja Rei do M\xF3dulo."
  },
  "/rudge": {
    command: "/rudge",
    lojaSlug: "MPrudge",
    nome: STORE_DISPLAY_NAMES["mprudge"] || "Rudge Ramos",
    description: "Assume perfil de Gerente da loja Rudge Ramos."
  },
  "/santoandre": {
    command: "/santoandre",
    lojaSlug: "MPSantoAndre",
    nome: STORE_DISPLAY_NAMES["mpsantoandre"] || "Santo Andr\xE9",
    description: "Assume perfil de Gerente da loja Santo Andr\xE9."
  }
};
var InFlightAbortRegistry = class _InFlightAbortRegistry {
  static instance;
  activeJobs = /* @__PURE__ */ new Map();
  static getInstance() {
    if (!_InFlightAbortRegistry.instance) {
      _InFlightAbortRegistry.instance = new _InFlightAbortRegistry();
    }
    return _InFlightAbortRegistry.instance;
  }
  register(phone, jobId, batchId) {
    const cleanPhone2 = String(phone || "").replace(/\D/g, "");
    const controller = new AbortController();
    this.activeJobs.set(cleanPhone2, {
      phone: cleanPhone2,
      jobId,
      batchId,
      startedAt: Date.now(),
      abortController: controller,
      isAborted: false
    });
    return controller;
  }
  abort(phone) {
    const cleanPhone2 = String(phone || "").replace(/\D/g, "");
    const job = this.activeJobs.get(cleanPhone2);
    if (!job) return { aborted: false };
    job.isAborted = true;
    try {
      job.abortController.abort("RESET_COMMAND");
    } catch {
    }
    this.activeJobs.delete(cleanPhone2);
    return { aborted: true, jobId: job.jobId, batchId: job.batchId };
  }
  isAborted(phone, jobId) {
    const cleanPhone2 = String(phone || "").replace(/\D/g, "");
    const job = this.activeJobs.get(cleanPhone2);
    if (!job) return true;
    if (jobId && job.jobId !== jobId) return true;
    return job.isAborted;
  }
  clear(phone, jobId) {
    const cleanPhone2 = String(phone || "").replace(/\D/g, "");
    const job = this.activeJobs.get(cleanPhone2);
    if (job && (!jobId || job.jobId === jobId)) {
      this.activeJobs.delete(cleanPhone2);
    }
  }
  hasInFlight(phone) {
    const cleanPhone2 = String(phone || "").replace(/\D/g, "");
    return this.activeJobs.has(cleanPhone2);
  }
};
function ensureUserProfileSchema(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS hydra_user_profiles (
        phone TEXT PRIMARY KEY,
        persona TEXT NOT NULL DEFAULT 'socio',
        loja_slug TEXT,
        loja_nome TEXT,
        default_scope TEXT NOT NULL DEFAULT 'rede',
        memory_generation INTEGER NOT NULL DEFAULT 1,
        daily_memory_reset_at TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hydra_daily_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phone TEXT NOT NULL,
        generation_id INTEGER NOT NULL,
        data_referencia TEXT NOT NULL,
        resumo_diario TEXT,
        updated_at TEXT NOT NULL
      );
    `);
  } catch (err) {
    console.error("[HYDRA_COMMANDS] Erro ao inicializar schema de perfis:", err?.message || err);
  }
}
function normalizePhone(raw) {
  return String(raw || "").replace(/\D/g, "");
}
function isAuthorizedPhone(phone, db) {
  const clean = normalizePhone(phone);
  if (db) {
    try {
      const user = db.prepare("SELECT is_active FROM hydra_authorized_users WHERE phone = ?").get(clean);
      if (user) {
        return user.is_active === 1;
      }
    } catch {
    }
  }
  return AUTHORIZED_NUMBERS.has(clean);
}
function canUserSimulatePersona(db, phone) {
  const clean = normalizePhone(phone);
  if (db) {
    try {
      const user = db.prepare("SELECT can_simulate_persona FROM hydra_authorized_users WHERE phone = ?").get(clean);
      if (user) {
        return user.can_simulate_persona === 1;
      }
    } catch {
    }
  }
  return AUTHORIZED_NUMBERS.has(clean);
}
function buildSimulationRefusalMessage() {
  return [
    "> *Acesso Restrito \u2014 Permiss\xE3o Insuficiente*",
    "- Seu perfil n\xE3o possui permiss\xE3o para simula\xE7\xE3o de personas ou altern\xE2ncia de lojas.",
    "- Os comandos de simula\xE7\xE3o e redefini\xE7\xE3o de ambiente s\xE3o exclusivos para a diretoria.",
    "- Seu acesso permanece restrito \xE0 sua unidade autorizada."
  ].join("\n");
}
function isDeterministicCommand(text) {
  if (!text) return false;
  const trimmed = text.trim();
  return trimmed.startsWith("/");
}
function getUserProfile(db, phone) {
  ensureUserProfileSchema(db);
  const p = normalizePhone(phone);
  let isLockedManager = false;
  let lockedStoreSlug = void 0;
  let lockedStoreName = void 0;
  try {
    const authUser = db.prepare(`
      SELECT role, allowed_stores, can_simulate_persona FROM hydra_authorized_users WHERE phone = ?
    `).get(p);
    if (authUser && authUser.can_simulate_persona === 0 && authUser.role === "gerente") {
      isLockedManager = true;
      let allowedStores = [];
      try {
        allowedStores = JSON.parse(authUser.allowed_stores);
        if (!Array.isArray(allowedStores)) allowedStores = [authUser.allowed_stores];
      } catch {
        allowedStores = [authUser.allowed_stores];
      }
      lockedStoreSlug = allowedStores[0] && allowedStores[0] !== "*" ? allowedStores[0] : void 0;
      if (lockedStoreSlug) {
        lockedStoreName = STORE_DISPLAY_NAMES[lockedStoreSlug.toLowerCase()] || lockedStoreSlug;
      }
    }
  } catch {
  }
  try {
    const row = db.prepare(`
      SELECT phone, persona, loja_slug, loja_nome, default_scope, memory_generation, daily_memory_reset_at, updated_at
      FROM hydra_user_profiles
      WHERE phone = ?
    `).get(p);
    if (row) {
      if (isLockedManager) {
        return {
          phone: row.phone,
          persona: "gerente",
          lojaSlug: lockedStoreSlug,
          lojaNome: lockedStoreName,
          defaultScope: "loja",
          memoryGeneration: Number(row.memory_generation) || 1,
          dailyMemoryResetAt: row.daily_memory_reset_at || void 0,
          updatedAt: row.updated_at
        };
      }
      return {
        phone: row.phone,
        persona: row.persona,
        lojaSlug: row.loja_slug || void 0,
        lojaNome: row.loja_nome || void 0,
        defaultScope: row.default_scope,
        memoryGeneration: Number(row.memory_generation) || 1,
        dailyMemoryResetAt: row.daily_memory_reset_at || void 0,
        updatedAt: row.updated_at
      };
    }
  } catch (err) {
    console.warn(`[HYDRA_COMMANDS] Falha ao recuperar perfil de ${p}:`, err?.message || err);
  }
  if (isLockedManager) {
    return {
      phone: p,
      persona: "gerente",
      lojaSlug: lockedStoreSlug,
      lojaNome: lockedStoreName,
      defaultScope: "loja",
      memoryGeneration: 1,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  return {
    phone: p,
    persona: "socio",
    lojaSlug: void 0,
    lojaNome: void 0,
    defaultScope: "rede",
    memoryGeneration: 1,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function saveUserProfile(db, profile) {
  ensureUserProfileSchema(db);
  const p = normalizePhone(profile.phone);
  const now = profile.updatedAt || (/* @__PURE__ */ new Date()).toISOString();
  try {
    db.prepare(`
      INSERT INTO hydra_user_profiles (
        phone, persona, loja_slug, loja_nome, default_scope, memory_generation, daily_memory_reset_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(phone) DO UPDATE SET
        persona = excluded.persona,
        loja_slug = excluded.loja_slug,
        loja_nome = excluded.loja_nome,
        default_scope = excluded.default_scope,
        memory_generation = excluded.memory_generation,
        daily_memory_reset_at = excluded.daily_memory_reset_at,
        updated_at = excluded.updated_at
    `).run(
      p,
      profile.persona,
      profile.lojaSlug || null,
      profile.lojaNome || null,
      profile.defaultScope,
      profile.memoryGeneration || 1,
      profile.dailyMemoryResetAt || null,
      now
    );
  } catch (err) {
    console.error(`[HYDRA_COMMANDS] Erro ao salvar perfil de ${p}:`, err?.message || err);
  }
}
function buildMenuMessage() {
  const lines = [
    "> *Comandos R\xE1pidos do Hydra*",
    "- */menu:* Exibe a lista de comandos dispon\xEDveis.",
    "- */perfil:* Consulta a persona e loja atualmente ativas no seu WhatsApp.",
    "- */reset:* Reinicia o contexto, persona e mem\xF3ria di\xE1ria, abortando respostas em voo.",
    "- */socio:* Assume o perfil de S\xF3cio com vis\xE3o consolidada de toda a rede."
  ];
  for (const storeSlug of CATALOGO_10_LOJAS) {
    const entry = Object.values(STORE_COMMANDS).find((s) => s.lojaSlug.toLowerCase() === storeSlug.toLowerCase());
    if (entry) {
      lines.push(`- *${entry.command}:* ${entry.description}`);
    }
  }
  return lines.join("\n");
}
function buildProfileMessage(profile) {
  if (profile.persona === "gerente") {
    return [
      "> *Perfil Operacional Ativo*",
      "- *Persona:* Gerente de Loja",
      `- *Loja:* ${profile.lojaNome || "N/A"}`,
      `- *Escopo Padr\xE3o:* ${profile.lojaSlug || "N/A"}`,
      "- *Modo:* Foco exclusivo na unidade. Consultas sem loja expl\xEDcita s\xE3o direcionadas para sua loja."
    ].join("\n");
  }
  return [
    "> *Perfil Operacional Ativo*",
    "- *Persona:* S\xF3cio",
    "- *Escopo Padr\xE3o:* Rede consolidada (10 lojas)",
    `- *Gera\xE7\xE3o de Mem\xF3ria:* #${profile.memoryGeneration}`,
    "- *Modo:* Vis\xE3o executiva de rede. Consultas sem loja expl\xEDcita trazem panorama geral."
  ].join("\n");
}
function buildSocioConfirmationMessage() {
  return [
    "> *Perfil Atualizado \u2014 S\xF3cio*",
    "- *Persona:* S\xF3cio",
    "- *Escopo Padr\xE3o:* Rede consolidada (10 lojas)",
    "- Modo de vis\xE3o executiva ativado. Consultas gerais analisar\xE3o toda a rede."
  ].join("\n");
}
function buildStoreConfirmationMessage(mapping) {
  return [
    `> *Perfil Atualizado \u2014 Gerente de ${mapping.nome}*`,
    "- *Persona:* Gerente de Loja",
    `- *Loja:* ${mapping.nome}`,
    `- *Escopo Padr\xE3o:* ${mapping.lojaSlug}`,
    `- Modo gerente ativado. Perguntas como "como estamos de meta?" focar\xE3o automaticamente em ${mapping.nome}.`
  ].join("\n");
}
async function executeResetCommand(phone, db, options) {
  const p = normalizePhone(phone);
  const registry = options?.abortRegistry || InFlightAbortRegistry.getInstance();
  let abortedInFlight = false;
  const abortRes = registry.abort(p);
  if (abortRes.aborted) {
    abortedInFlight = true;
  }
  if (options?.batcher) {
    if (typeof options.batcher.isInFlight === "function" && options.batcher.isInFlight(p)) {
      abortedInFlight = true;
      const inFlight = options.batcher.getInFlight?.(p);
      if (inFlight?.batchId && typeof options.batcher.markBatchObsolete === "function") {
        options.batcher.markBatchObsolete(inFlight.batchId);
      }
      if (typeof options.batcher.clearInFlight === "function") {
        options.batcher.clearInFlight(p);
      }
    }
  }
  if (options?.presenceFn) {
    try {
      await options.presenceFn(p, "paused");
    } catch {
    }
  }
  clearTurnState(db, p);
  const currentProfile = getUserProfile(db, p);
  const newGeneration = currentProfile.memoryGeneration + 1;
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  saveUserProfile(db, {
    phone: p,
    persona: "socio",
    lojaSlug: void 0,
    lojaNome: void 0,
    defaultScope: "rede",
    memoryGeneration: newGeneration,
    dailyMemoryResetAt: nowIso,
    updatedAt: nowIso
  });
  try {
    db.prepare("DELETE FROM hydra_daily_memories WHERE phone = ?").run(p);
  } catch {
  }
  const abortDetail = abortedInFlight ? "- *Gera\xE7\xE3o em voo:* Interrompida com sucesso (sem vazamento da resposta anterior)." : "- *Gera\xE7\xE3o em voo:* Nenhuma requisi\xE7\xE3o pendente no momento.";
  const replyText = [
    "> *Contexto e Mem\xF3ria Reiniciados*",
    "- Conversa, persona e mem\xF3ria di\xE1ria resetadas com sucesso.",
    "- *Perfil restaurado:* S\xF3cio (Vis\xE3o de Rede).",
    `- *Gera\xE7\xE3o de Mem\xF3ria:* #${newGeneration}`,
    abortDetail,
    "- Pronto para novas consultas!"
  ].join("\n");
  return {
    replyText,
    abortedInFlight,
    newGeneration
  };
}
async function interceptCommand(options) {
  const { phone, text, db, batcher, abortRegistry, presenceFn } = options;
  if (!isAuthorizedPhone(phone, db) || !isDeterministicCommand(text)) {
    return { handled: false, messages: [] };
  }
  ensureUserProfileSchema(db);
  const p = normalizePhone(phone);
  const cmd = text.trim().split(/\s+/)[0].toLowerCase();
  if (cmd === "/menu") {
    const replyText2 = buildMenuMessage();
    const messages = composeSemanticBalloons(replyText2);
    return {
      handled: true,
      command: "/menu",
      replyText: replyText2,
      messages,
      profile: getUserProfile(db, p)
    };
  }
  if (cmd === "/perfil") {
    const profile = getUserProfile(db, p);
    const replyText2 = buildProfileMessage(profile);
    const messages = composeSemanticBalloons(replyText2);
    return {
      handled: true,
      command: "/perfil",
      replyText: replyText2,
      messages,
      profile
    };
  }
  const isSimulationCommand = cmd === "/socio" || cmd === "/reset" || cmd in STORE_COMMANDS;
  if (isSimulationCommand && !canUserSimulatePersona(db, p)) {
    const replyText2 = buildSimulationRefusalMessage();
    const messages = composeSemanticBalloons(replyText2);
    return {
      handled: true,
      command: cmd,
      replyText: replyText2,
      messages,
      profile: getUserProfile(db, p)
    };
  }
  if (cmd === "/reset") {
    const resetResult = await executeResetCommand(p, db, { batcher, abortRegistry, presenceFn });
    const messages = composeSemanticBalloons(resetResult.replyText);
    return {
      handled: true,
      command: "/reset",
      replyText: resetResult.replyText,
      messages,
      abortedInFlight: resetResult.abortedInFlight,
      profile: getUserProfile(db, p)
    };
  }
  if (cmd === "/socio") {
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const current = getUserProfile(db, p);
    const updatedProfile = {
      ...current,
      persona: "socio",
      lojaSlug: void 0,
      lojaNome: void 0,
      defaultScope: "rede",
      updatedAt: nowIso
    };
    saveUserProfile(db, updatedProfile);
    const turnState = getLatestTurnState(db, p, 120);
    if (turnState) {
      saveTurnState(db, {
        ...turnState,
        lojaSlug: void 0,
        updatedAt: nowIso
      });
    }
    const replyText2 = buildSocioConfirmationMessage();
    const messages = composeSemanticBalloons(replyText2);
    return {
      handled: true,
      command: "/socio",
      replyText: replyText2,
      messages,
      profile: updatedProfile
    };
  }
  if (cmd in STORE_COMMANDS) {
    const mapping = STORE_COMMANDS[cmd];
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const current = getUserProfile(db, p);
    const updatedProfile = {
      ...current,
      persona: "gerente",
      lojaSlug: mapping.lojaSlug,
      lojaNome: mapping.nome,
      defaultScope: "loja",
      updatedAt: nowIso
    };
    saveUserProfile(db, updatedProfile);
    const turnState = getLatestTurnState(db, p, 120);
    if (turnState) {
      saveTurnState(db, {
        ...turnState,
        lojaSlug: mapping.lojaSlug,
        updatedAt: nowIso
      });
    } else {
      saveTurnState(db, {
        phone: p,
        lastTurnId: `cmd_${Date.now()}`,
        lastIntent: "store_overview",
        lojaSlug: mapping.lojaSlug,
        filters: { lojaSlug: mapping.lojaSlug },
        updatedAt: nowIso
      });
    }
    const replyText2 = buildStoreConfirmationMessage(mapping);
    const messages = composeSemanticBalloons(replyText2);
    return {
      handled: true,
      command: cmd,
      replyText: replyText2,
      messages,
      profile: updatedProfile
    };
  }
  const replyText = "Comando n\xE3o reconhecido. Use /menu para ver os comandos dispon\xEDveis.";
  return {
    handled: true,
    command: cmd,
    replyText,
    messages: composeSemanticBalloons(replyText),
    profile: getUserProfile(db, p)
  };
}
export {
  AUTHORIZED_NUMBERS,
  InFlightAbortRegistry,
  STORE_COMMANDS,
  buildMenuMessage,
  buildProfileMessage,
  buildSimulationRefusalMessage,
  buildSocioConfirmationMessage,
  buildStoreConfirmationMessage,
  canUserSimulatePersona,
  ensureUserProfileSchema,
  executeResetCommand,
  getUserProfile,
  interceptCommand,
  isAuthorizedPhone,
  isDeterministicCommand,
  normalizePhone,
  saveUserProfile
};
