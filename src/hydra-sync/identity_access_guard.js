// src/hydra-sync/command_interceptor.js
import Database from "better-sqlite3";
import { createRequire } from "module";
var requireESM = createRequire(import.meta.url);
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

// src/hydra-sync/db_repository.ts
import Database2 from "better-sqlite3";
import { createRequire as createRequire2 } from "module";
var requireESM2 = createRequire2(import.meta.url);
var STORE_DISPLAY_NAMES2 = {
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

// src/hydra-sync/identity_access_guard.ts
function maskPhone(phone) {
  if (!phone) return "****";
  const clean = String(phone).replace(/\D/g, "");
  if (clean.length <= 4) return "****";
  return clean.slice(0, 4) + "*".repeat(Math.max(0, clean.length - 8)) + clean.slice(-4);
}
function maskJid(jid) {
  if (!jid) return "****";
  const str = String(jid).trim();
  const parts = str.split("@");
  if (parts.length < 2) return maskPhone(str);
  const user = parts[0];
  const domain = parts[1];
  const maskedUser = user.length <= 4 ? "****" : user.slice(0, 4) + "*".repeat(Math.max(0, user.length - 8)) + user.slice(-4);
  return `${maskedUser}@${domain}`;
}
function authenticateWebhookRequest(headers) {
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (secret && secret.trim().length > 0) {
    if (!headers || typeof headers !== "object") {
      return false;
    }
    const normalizedHeaders = {};
    if (typeof headers.entries === "function" && !(headers instanceof Array)) {
      try {
        for (const [key, value] of headers.entries()) {
          normalizedHeaders[key.toLowerCase()] = String(value).trim();
        }
      } catch {
      }
    } else {
      for (const [key, value] of Object.entries(headers)) {
        if (typeof value === "string") {
          normalizedHeaders[key.toLowerCase()] = value.trim();
        } else if (Array.isArray(value) && typeof value[0] === "string") {
          normalizedHeaders[key.toLowerCase()] = value[0].trim();
        }
      }
    }
    const expected = secret.trim();
    const token = normalizedHeaders["x-webhook-secret"] || normalizedHeaders["apikey"] || normalizedHeaders["x-api-key"] || (normalizedHeaders["authorization"]?.startsWith("Bearer ") ? normalizedHeaders["authorization"].substring(7).trim() : normalizedHeaders["authorization"]);
    if (token && token === expected) {
      return true;
    }
    return false;
  }
  console.log("[AccessGuard COMPAT_MODE] Webhook aceito em modo de compatibilidade (EVOLUTION_WEBHOOK_SECRET n\xE3o configurado)");
  return true;
}
function recordSecurityRejection(db, rejectionLog) {
  if (!db) return;
  try {
    db.prepare(`
      INSERT INTO hydra_security_rejections (
        remote_jid_masked, phone_masked, rejection_reason, endpoint, created_at
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      rejectionLog.remoteJidMasked,
      rejectionLog.phoneMasked || null,
      rejectionLog.reason,
      rejectionLog.endpoint,
      rejectionLog.timestamp || (/* @__PURE__ */ new Date()).toISOString()
    );
  } catch (err) {
    console.warn("[AccessGuard] Erro ao registrar rejei\xE7\xE3o de seguran\xE7a:", err?.message || err);
  }
}
function resolveCanonicalIdentity(db, payload) {
  if (!db || !payload) return null;
  const rawRemoteJid = String(
    payload?.data?.key?.remoteJid || payload?.remoteJid || payload?.data?.remoteJid || ""
  ).trim();
  const remoteJidAlt = String(
    payload?.data?.key?.remoteJidAlt || payload?.remoteJidAlt || payload?.data?.remoteJidAlt || ""
  ).trim();
  const participant = String(
    payload?.data?.key?.participant || payload?.participant || payload?.data?.participant || ""
  ).trim();
  const senderPhone = String(
    payload?.sender?.phone_number || payload?.sender || payload?.phone || payload?.data?.sender || ""
  ).trim();
  const pushName = payload?.data?.pushName || payload?.pushName || void 0;
  const rawMessageId = payload?.data?.key?.id || payload?.messageId || payload?.id;
  const messageId = String(rawMessageId || `${Date.now()}`);
  let canonicalPhone = null;
  const isLid = rawRemoteJid.endsWith("@lid");
  if (rawRemoteJid) {
    try {
      const mapping = db.prepare(`
        SELECT phone_canonical FROM hydra_phone_identities WHERE remote_jid = ?
      `).get(rawRemoteJid);
      if (mapping?.phone_canonical) {
        canonicalPhone = mapping.phone_canonical;
      }
    } catch (err) {
      console.warn("[AccessGuard] Erro ao buscar mapeamento em hydra_phone_identities:", err?.message || err);
    }
  }
  if (!canonicalPhone && isLid) {
    const candidateClean = (remoteJidAlt || participant || senderPhone).replace("@s.whatsapp.net", "").replace(/\D/g, "");
    if (candidateClean && candidateClean.length >= 10) {
      try {
        const userExists = db.prepare(`
          SELECT phone FROM hydra_authorized_users WHERE phone = ?
        `).get(candidateClean);
        if (userExists?.phone) {
          canonicalPhone = candidateClean;
          try {
            db.prepare(`
              INSERT INTO hydra_phone_identities (remote_jid, phone_canonical, identity_type, push_name, verified_at)
              VALUES (?, ?, 'LID', ?, CURRENT_TIMESTAMP)
              ON CONFLICT(remote_jid) DO UPDATE SET
                phone_canonical = excluded.phone_canonical,
                push_name = COALESCE(excluded.push_name, hydra_phone_identities.push_name),
                verified_at = CURRENT_TIMESTAMP
            `).run(rawRemoteJid, canonicalPhone, pushName || null);
          } catch (insertErr) {
            console.warn("[AccessGuard] Erro ao persistir mapeamento de LID:", insertErr?.message || insertErr);
          }
        }
      } catch (err) {
        console.warn("[AccessGuard] Erro ao validar candidato para LID:", err?.message || err);
      }
    }
  }
  if (!canonicalPhone && !isLid) {
    const candidateClean = (rawRemoteJid || remoteJidAlt || participant || senderPhone).replace("@s.whatsapp.net", "").replace(/\D/g, "");
    if (candidateClean && candidateClean.length >= 10) {
      canonicalPhone = candidateClean;
      const pnJid = rawRemoteJid.includes("@") ? rawRemoteJid : `${candidateClean}@s.whatsapp.net`;
      try {
        db.prepare(`
          INSERT INTO hydra_phone_identities (remote_jid, phone_canonical, identity_type, push_name)
          VALUES (?, ?, 'PN', ?)
          ON CONFLICT(remote_jid) DO NOTHING
        `).run(pnJid, canonicalPhone, pushName || null);
      } catch {
      }
    }
  }
  if (!canonicalPhone) {
    recordSecurityRejection(db, {
      remoteJidMasked: maskJid(rawRemoteJid),
      reason: "unresolved_identity",
      endpoint: "webhook_ingress",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    return null;
  }
  let userRow = null;
  try {
    userRow = db.prepare(`
      SELECT phone, name, role, allowed_stores, is_active, can_simulate_persona, created_at, updated_at
      FROM hydra_authorized_users
      WHERE phone = ?
    `).get(canonicalPhone);
  } catch (err) {
    console.error("[AccessGuard] Erro ao consultar hydra_authorized_users:", err?.message || err);
    return null;
  }
  if (!userRow) {
    recordSecurityRejection(db, {
      remoteJidMasked: maskJid(rawRemoteJid),
      phoneMasked: maskPhone(canonicalPhone),
      reason: "unauthorized_user",
      endpoint: "webhook_ingress",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    return null;
  }
  if (userRow.is_active !== 1) {
    recordSecurityRejection(db, {
      remoteJidMasked: maskJid(rawRemoteJid),
      phoneMasked: maskPhone(canonicalPhone),
      reason: "revoked_user",
      endpoint: "webhook_ingress",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    return null;
  }
  let allowedStores = [];
  try {
    allowedStores = JSON.parse(userRow.allowed_stores);
    if (!Array.isArray(allowedStores)) allowedStores = [userRow.allowed_stores];
  } catch {
    allowedStores = [userRow.allowed_stores];
  }
  const user = {
    phone: userRow.phone,
    name: userRow.name,
    role: userRow.role,
    allowedStores,
    isActive: userRow.is_active === 1,
    canSimulatePersona: userRow.can_simulate_persona === 1,
    createdAt: userRow.created_at,
    updatedAt: userRow.updated_at
  };
  const profile = getUserProfile(db, user.phone);
  let effectivePersona = "socio";
  let activeStoreSlug = null;
  let activeStoreName = null;
  if (user.canSimulatePersona) {
    if (profile.persona === "gerente" && profile.lojaSlug) {
      effectivePersona = "gerente";
      activeStoreSlug = profile.lojaSlug;
      activeStoreName = profile.lojaNome || STORE_DISPLAY_NAMES2[profile.lojaSlug.toLowerCase()] || profile.lojaSlug;
    } else {
      effectivePersona = "socio";
      activeStoreSlug = null;
      activeStoreName = null;
    }
  } else {
    if (user.role === "gerente") {
      effectivePersona = "gerente";
      activeStoreSlug = allowedStores[0] && allowedStores[0] !== "*" ? allowedStores[0] : null;
      activeStoreName = activeStoreSlug ? STORE_DISPLAY_NAMES2[activeStoreSlug.toLowerCase()] || activeStoreSlug : null;
    } else {
      effectivePersona = "socio";
      activeStoreSlug = null;
      activeStoreName = null;
    }
  }
  const targetRemoteJid = rawRemoteJid.includes("@") ? rawRemoteJid : `${canonicalPhone}@s.whatsapp.net`;
  return {
    phone: user.phone,
    remoteJid: targetRemoteJid,
    user,
    effectivePersona,
    activeStoreSlug,
    activeStoreName,
    memoryGeneration: profile.memoryGeneration || 1,
    scopeVersion: "v1",
    messageId,
    batchId: void 0
  };
}
function revalidateAuthorization(db, phone, requiredStoreSlug) {
  if (!db || !phone) return false;
  const clean = String(phone).replace(/\D/g, "");
  if (!clean) return false;
  try {
    const row = db.prepare(`
      SELECT phone, role, allowed_stores, is_active, can_simulate_persona
      FROM hydra_authorized_users
      WHERE phone = ?
    `).get(clean);
    if (!row || row.is_active !== 1) {
      return false;
    }
    if (requiredStoreSlug) {
      let stores = [];
      try {
        stores = JSON.parse(row.allowed_stores);
        if (!Array.isArray(stores)) stores = [row.allowed_stores];
      } catch {
        stores = [row.allowed_stores];
      }
      if (stores.includes("*")) return true;
      if (stores.includes(requiredStoreSlug)) return true;
      if (row.can_simulate_persona === 1) return true;
      return false;
    }
    return true;
  } catch (err) {
    console.error("[AccessGuard] Erro ao revalidar autoriza\xE7\xE3o:", err?.message || err);
    return false;
  }
}
export {
  authenticateWebhookRequest,
  maskJid,
  maskPhone,
  recordSecurityRejection,
  resolveCanonicalIdentity,
  revalidateAuthorization
};
