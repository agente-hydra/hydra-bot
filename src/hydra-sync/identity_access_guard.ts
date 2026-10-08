/**
 * HYDRA IDENTITY & ACCESS GUARD (Frente 1)
 * 
 * Barreira de segurança e autorização segregada no Ingress, Fila e Egress do Hydra.
 * 
 * Regras:
 * 1. authenticateWebhookRequest:
 *    - Se EVOLUTION_WEBHOOK_SECRET estiver configurado, valida secret nos headers.
 *    - Se não configurado, aceita em modo compatível registrando [AccessGuard COMPAT_MODE].
 * 2. resolveCanonicalIdentity:
 *    - Mapeamento determinístico de LID/PN -> phone canônico via hydra_phone_identities.
 *    - Persistência imediata de novos mapeamentos confiáveis entregues pela Evolution.
 *    - Validação de hydra_authorized_users com is_active === 1.
 *    - Retorno de AuthorizedContext estruturado com perfil efetivo e permissões reais.
 *    - Retorna null para identidades não resolvidas ou não autorizadas (com auditoria).
 * 3. recordSecurityRejection:
 *    - Grava em hydra_security_rejections aplicando máscara estrita de privacidade.
 * 4. revalidateAuthorization:
 *    - Checagem em voo (in-flight) na fila assíncrona e no envio (egress).
 */

import type Database from 'better-sqlite3';
import type {
  AuthorizedContext,
  AuthorizedUser,
  SecurityRejectionLog,
  UserRole
} from './types/access_contract.js';
import { getUserProfile } from './command_interceptor.js';
import { STORE_DISPLAY_NAMES } from './db_repository.js';

/**
 * Mascara telefone para conformidade com LGPD/Privacidade (ex: 5511996242812 -> 5511*****2812)
 */
export function maskPhone(phone?: string | null): string {
  if (!phone) return '****';
  const clean = String(phone).replace(/\D/g, '');
  if (clean.length <= 4) return '****';
  return clean.slice(0, 4) + '*'.repeat(Math.max(0, clean.length - 8)) + clean.slice(-4);
}

/**
 * Mascara Remote JID preservando o domínio WhatsApp (ex: 271077481652389@lid -> 2710*******2389@lid)
 */
export function maskJid(jid?: string | null): string {
  if (!jid) return '****';
  const str = String(jid).trim();
  const parts = str.split('@');
  if (parts.length < 2) return maskPhone(str);
  const user = parts[0];
  const domain = parts[1];
  const maskedUser = user.length <= 4
    ? '****'
    : user.slice(0, 4) + '*'.repeat(Math.max(0, user.length - 8)) + user.slice(-4);
  return `${maskedUser}@${domain}`;
}

/**
 * Autentica o webhook recebido validando o token/secret da Evolution API.
 * - Se process.env.EVOLUTION_WEBHOOK_SECRET estiver configurado, valida contra os headers.
 * - Se NÃO estiver configurado, aceita a requisição em modo compatível e registra log sanitizado.
 */
export function authenticateWebhookRequest(
  headers: Record<string, string | string[] | undefined> | Headers | any
): boolean {
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;

  if (secret && secret.trim().length > 0) {
    if (!headers || typeof headers !== 'object') {
      return false;
    }

    const normalizedHeaders: Record<string, string> = {};
    if (typeof headers.entries === 'function' && !(headers instanceof Array)) {
      try {
        for (const [key, value] of headers.entries()) {
          normalizedHeaders[key.toLowerCase()] = String(value).trim();
        }
      } catch {}
    } else {
      for (const [key, value] of Object.entries(headers)) {
        if (typeof value === 'string') {
          normalizedHeaders[key.toLowerCase()] = value.trim();
        } else if (Array.isArray(value) && typeof value[0] === 'string') {
          normalizedHeaders[key.toLowerCase()] = value[0].trim();
        }
      }
    }

    const expected = secret.trim();
    const token =
      normalizedHeaders['x-webhook-secret'] ||
      normalizedHeaders['apikey'] ||
      normalizedHeaders['x-api-key'] ||
      (normalizedHeaders['authorization']?.startsWith('Bearer ')
        ? normalizedHeaders['authorization'].substring(7).trim()
        : normalizedHeaders['authorization']);

    if (token && token === expected) {
      return true;
    }

    return false;
  }

  // Modo compatível quando EVOLUTION_WEBHOOK_SECRET não está configurado
  console.log('[AccessGuard COMPAT_MODE] Webhook aceito em modo de compatibilidade (EVOLUTION_WEBHOOK_SECRET não configurado)');
  return true;
}

/**
 * Registra uma rejeição de segurança na tabela hydra_security_rejections com máscara de privacidade.
 */
export function recordSecurityRejection(
  db: Database.Database,
  rejectionLog: SecurityRejectionLog
): void {
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
      rejectionLog.timestamp || new Date().toISOString()
    );
  } catch (err: any) {
    console.warn('[AccessGuard] Erro ao registrar rejeição de segurança:', err?.message || err);
  }
}

/**
 * Resolve a identidade canônica e valida se o remetente é um usuário autorizado e ativo.
 * 
 * - Extrai remoteJid (inclusive LID), remoteJidAlt, participant, senderPhone.
 * - Consulta hydra_phone_identities para resolver LID -> phone_canonical.
 * - Se for novo mapeamento confiável de LID entregue pela Evolution (com remoteJidAlt válido), persiste em hydra_phone_identities.
 * - Consulta hydra_authorized_users garantindo is_active === 1.
 * - Retorna AuthorizedContext estruturado com perfil efetivo e permissões reais.
 * - Se não autorizado ou não resolvido, retorna null e registra rejeição auditada.
 */
export function resolveCanonicalIdentity(
  db: Database.Database,
  payload: any
): AuthorizedContext | null {
  if (!db || !payload) return null;

  const rawRemoteJid = String(
    payload?.data?.key?.remoteJid ||
    payload?.remoteJid ||
    payload?.data?.remoteJid ||
    ''
  ).trim();

  const remoteJidAlt = String(
    payload?.data?.key?.remoteJidAlt ||
    payload?.remoteJidAlt ||
    payload?.data?.remoteJidAlt ||
    ''
  ).trim();

  const participant = String(
    payload?.data?.key?.participant ||
    payload?.participant ||
    payload?.data?.participant ||
    ''
  ).trim();

  const senderPhone = String(
    payload?.sender?.phone_number ||
    payload?.sender ||
    payload?.phone ||
    payload?.data?.sender ||
    ''
  ).trim();

  const pushName =
    payload?.data?.pushName ||
    payload?.pushName ||
    undefined;

  const rawMessageId =
    payload?.data?.key?.id ||
    payload?.messageId ||
    payload?.id;

  const messageId = String(rawMessageId || `${Date.now()}`);

  let canonicalPhone: string | null = null;
  const isLid = rawRemoteJid.endsWith('@lid');

  // 1. Tenta resolver via hydra_phone_identities
  if (rawRemoteJid) {
    try {
      const mapping = db.prepare(`
        SELECT phone_canonical FROM hydra_phone_identities WHERE remote_jid = ?
      `).get(rawRemoteJid) as { phone_canonical: string } | undefined;

      if (mapping?.phone_canonical) {
        canonicalPhone = mapping.phone_canonical;
      }
    } catch (err: any) {
      console.warn('[AccessGuard] Erro ao buscar mapeamento em hydra_phone_identities:', err?.message || err);
    }
  }

  // 2. Se for LID e ainda não resolvido, verifica se há remoteJidAlt, participant ou senderPhone confiável
  if (!canonicalPhone && isLid) {
    const candidateClean = (remoteJidAlt || participant || senderPhone)
      .replace('@s.whatsapp.net', '')
      .replace(/\D/g, '');

    if (candidateClean && candidateClean.length >= 10) {
      // Verifica se o candidato é um usuário cadastrado
      try {
        const userExists = db.prepare(`
          SELECT phone FROM hydra_authorized_users WHERE phone = ?
        `).get(candidateClean) as { phone: string } | undefined;

        if (userExists?.phone) {
          canonicalPhone = candidateClean;

          // Persiste novo mapeamento confiável de LID entregue pela Evolution
          try {
            db.prepare(`
              INSERT INTO hydra_phone_identities (remote_jid, phone_canonical, identity_type, push_name, verified_at)
              VALUES (?, ?, 'LID', ?, CURRENT_TIMESTAMP)
              ON CONFLICT(remote_jid) DO UPDATE SET
                phone_canonical = excluded.phone_canonical,
                push_name = COALESCE(excluded.push_name, hydra_phone_identities.push_name),
                verified_at = CURRENT_TIMESTAMP
            `).run(rawRemoteJid, canonicalPhone, pushName || null);
          } catch (insertErr: any) {
            console.warn('[AccessGuard] Erro ao persistir mapeamento de LID:', insertErr?.message || insertErr);
          }
        }
      } catch (err: any) {
        console.warn('[AccessGuard] Erro ao validar candidato para LID:', err?.message || err);
      }
    }
  }

  // 3. Se não for LID e ainda não resolvido, extrai número de telefone canônico
  if (!canonicalPhone && !isLid) {
    const candidateClean = (rawRemoteJid || remoteJidAlt || participant || senderPhone)
      .replace('@s.whatsapp.net', '')
      .replace(/\D/g, '');

    if (candidateClean && candidateClean.length >= 10) {
      canonicalPhone = candidateClean;

      // Garante registro do PN em hydra_phone_identities se ainda não existir
      const pnJid = rawRemoteJid.includes('@') ? rawRemoteJid : `${candidateClean}@s.whatsapp.net`;
      try {
        db.prepare(`
          INSERT INTO hydra_phone_identities (remote_jid, phone_canonical, identity_type, push_name)
          VALUES (?, ?, 'PN', ?)
          ON CONFLICT(remote_jid) DO NOTHING
        `).run(pnJid, canonicalPhone, pushName || null);
      } catch {}
    }
  }

  // Se não foi possível resolver para um telefone canônico
  if (!canonicalPhone) {
    recordSecurityRejection(db, {
      remoteJidMasked: maskJid(rawRemoteJid),
      reason: 'unresolved_identity',
      endpoint: 'webhook_ingress',
      timestamp: new Date().toISOString()
    });
    return null;
  }

  // 4. Consulta hydra_authorized_users
  let userRow: any = null;
  try {
    userRow = db.prepare(`
      SELECT phone, name, role, allowed_stores, is_active, can_simulate_persona, created_at, updated_at
      FROM hydra_authorized_users
      WHERE phone = ?
    `).get(canonicalPhone);
  } catch (err: any) {
    console.error('[AccessGuard] Erro ao consultar hydra_authorized_users:', err?.message || err);
    return null;
  }

  if (!userRow) {
    recordSecurityRejection(db, {
      remoteJidMasked: maskJid(rawRemoteJid),
      phoneMasked: maskPhone(canonicalPhone),
      reason: 'unauthorized_user',
      endpoint: 'webhook_ingress',
      timestamp: new Date().toISOString()
    });
    return null;
  }

  if (userRow.is_active !== 1) {
    recordSecurityRejection(db, {
      remoteJidMasked: maskJid(rawRemoteJid),
      phoneMasked: maskPhone(canonicalPhone),
      reason: 'revoked_user',
      endpoint: 'webhook_ingress',
      timestamp: new Date().toISOString()
    });
    return null;
  }

  // 5. Monta AuthorizedUser estruturado
  let allowedStores: string[] = [];
  try {
    allowedStores = JSON.parse(userRow.allowed_stores);
    if (!Array.isArray(allowedStores)) allowedStores = [userRow.allowed_stores];
  } catch {
    allowedStores = [userRow.allowed_stores];
  }

  const user: AuthorizedUser = {
    phone: userRow.phone,
    name: userRow.name,
    role: userRow.role as UserRole,
    allowedStores,
    isActive: userRow.is_active === 1,
    canSimulatePersona: userRow.can_simulate_persona === 1,
    createdAt: userRow.created_at,
    updatedAt: userRow.updated_at
  };

  // 6. Determina o perfil efetivo e escopo de atuação
  const profile = getUserProfile(db, user.phone);
  let effectivePersona: 'socio' | 'gerente' = 'socio';
  let activeStoreSlug: string | null = null;
  let activeStoreName: string | null = null;

  if (user.canSimulatePersona) {
    if (profile.persona === 'gerente' && profile.lojaSlug) {
      effectivePersona = 'gerente';
      activeStoreSlug = profile.lojaSlug;
      activeStoreName = profile.lojaNome || STORE_DISPLAY_NAMES[profile.lojaSlug.toLowerCase()] || profile.lojaSlug;
    } else {
      effectivePersona = 'socio';
      activeStoreSlug = null;
      activeStoreName = null;
    }
  } else {
    // Gerentes e operadores reais: perfil travado
    if (user.role === 'gerente') {
      effectivePersona = 'gerente';
      activeStoreSlug = allowedStores[0] && allowedStores[0] !== '*' ? allowedStores[0] : null;
      activeStoreName = activeStoreSlug
        ? (STORE_DISPLAY_NAMES[activeStoreSlug.toLowerCase()] || activeStoreSlug)
        : null;
    } else {
      effectivePersona = 'socio';
      activeStoreSlug = null;
      activeStoreName = null;
    }
  }

  const targetRemoteJid = rawRemoteJid.includes('@')
    ? rawRemoteJid
    : `${canonicalPhone}@s.whatsapp.net`;

  return {
    phone: user.phone,
    remoteJid: targetRemoteJid,
    user,
    effectivePersona,
    activeStoreSlug,
    activeStoreName,
    memoryGeneration: profile.memoryGeneration || 1,
    scopeVersion: 'v1',
    messageId,
    batchId: undefined
  };
}

/**
 * Revalidação em voo (in-flight check) da autorização do usuário.
 * Usada antes de consumir jobs na fila assíncrona e antes de enviar balões no egress.
 */
export function revalidateAuthorization(
  db: Database.Database,
  phone: string,
  requiredStoreSlug?: string
): boolean {
  if (!db || !phone) return false;
  const clean = String(phone).replace(/\D/g, '');
  if (!clean) return false;

  try {
    const row = db.prepare(`
      SELECT phone, role, allowed_stores, is_active, can_simulate_persona
      FROM hydra_authorized_users
      WHERE phone = ?
    `).get(clean) as any;

    if (!row || row.is_active !== 1) {
      return false;
    }

    if (requiredStoreSlug) {
      let stores: string[] = [];
      try {
        stores = JSON.parse(row.allowed_stores);
        if (!Array.isArray(stores)) stores = [row.allowed_stores];
      } catch {
        stores = [row.allowed_stores];
      }

      if (stores.includes('*')) return true;
      if (stores.includes(requiredStoreSlug)) return true;
      if (row.can_simulate_persona === 1) return true;
      return false;
    }

    return true;
  } catch (err: any) {
    console.error('[AccessGuard] Erro ao revalidar autorização:', err?.message || err);
    return false;
  }
}
