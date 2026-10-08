/**
 * HYDRA COMMAND INTERCEPTOR (Frente C & Frente 1)
 * Interceptação determinística de comandos de controle no Ingress, antes do batcher e da IA.
 * 
 * Regras:
 * 1. Restrito estritamente aos números autorizados (hydra_authorized_users com is_active === 1).
 * 2. Comandos atendidos sem chamada à IA:
 *    - /menu: lista estática com uma linha de descrição por comando.
 *    - /perfil: exibe a persona (sócio ou gerente) e a loja assumida.
 *    - /reset: limpa contexto de conversa, persona simulada e memória diária, iniciando nova geração
 *              sem apagar auditoria histórica. Aborta respostas em voo e encerra 'digitando'.
 *    - /socio: assume persona de sócio com escopo padrão "rede" (exclusivo para quem tem can_simulate_persona === 1).
 *    - /{loja}: assume gerente da loja correspondente e define essa loja como escopo padrão
 *               (exclusivo para quem tem can_simulate_persona === 1).
 *               Baseado estritamente em CATALOGO_10_LOJAS em db_repository.ts.
 * 3. Segregação de Permissão de Simulação:
 *    - Usuários reais sem permissão de simulação (can_simulate_persona === 0) que enviarem /socio, /reset
 *      ou /{loja} recebem recusa educada informando que não possuem permissão de simulação.
 * 4. Regra de Ouro do Reset Abortivo:
 *    Quando /reset é chamado enquanto a IA está gerando resposta (job em voo), invalida a resposta antiga,
 *    encerra imediatamente a presença ('digitando') e confirma a troca uma vez, sem vazamento entre perfis.
 */

import type Database from 'better-sqlite3';
import { CATALOGO_10_LOJAS, STORE_DISPLAY_NAMES } from './db_repository.js';
import { clearTurnState, saveTurnState, getLatestTurnState, clearAgyConversationId } from './turn_context_repository.js';
import { sanitizeWhatsAppMarkdown, assertNoDoubleAsterisks } from './format_utils.js';
import { composeSemanticBalloons } from './balloon_composer.js';
import { invalidateGenerationMemories } from './memory_repository.js';

// Números autorizados legados para fallback caso o schema ainda não esteja populado
export const AUTHORIZED_NUMBERS = new Set<string>([
  '5511996242812',
  '5511970671717'
]);

export interface StoreCommandMapping {
  command: string;
  lojaSlug: string;
  nome: string;
  description: string;
}

/**
 * Mapeamento determinístico dos comandos de lojas baseado estritamente em CATALOGO_10_LOJAS
 */
export const STORE_COMMANDS: Record<string, StoreCommandMapping> = {
  '/dompedro': {
    command: '/dompedro',
    lojaSlug: 'MPdompedro1',
    nome: STORE_DISPLAY_NAMES['mpdompedro1'] || 'Dom Pedro I',
    description: 'Assume perfil de Gerente da loja Dom Pedro I.'
  },
  '/jabaquara': {
    command: '/jabaquara',
    lojaSlug: 'MPJabaquara',
    nome: STORE_DISPLAY_NAMES['mpjabaquara'] || 'Jabaquara',
    description: 'Assume perfil de Gerente da loja Jabaquara.'
  },
  '/jorgeberetta': {
    command: '/jorgeberetta',
    lojaSlug: 'MPJorgeBeretta',
    nome: STORE_DISPLAY_NAMES['mpjorgeberetta'] || 'Jorge Beretta',
    description: 'Assume perfil de Gerente da loja Jorge Beretta.'
  },
  '/kennedy': {
    command: '/kennedy',
    lojaSlug: 'MPkennedy',
    nome: STORE_DISPLAY_NAMES['mpkennedy'] || 'Kennedy',
    description: 'Assume perfil de Gerente da loja Kennedy.'
  },
  '/maua': {
    command: '/maua',
    lojaSlug: 'ReiDoOleoMaua',
    nome: STORE_DISPLAY_NAMES['reidooleomaua'] || 'Rei do Óleo Mauá',
    description: 'Assume perfil de Gerente da loja Rei do Óleo Mauá.'
  },
  '/piraporinha': {
    command: '/piraporinha',
    lojaSlug: 'MPpiraporinha',
    nome: STORE_DISPLAY_NAMES['mppiraporinha'] || 'Piraporinha',
    description: 'Assume perfil de Gerente da loja Piraporinha.'
  },
  '/planalto': {
    command: '/planalto',
    lojaSlug: 'MPplanalto',
    nome: STORE_DISPLAY_NAMES['mpplanalto'] || 'Planalto',
    description: 'Assume perfil de Gerente da loja Planalto.'
  },
  '/reidomodulo': {
    command: '/reidomodulo',
    lojaSlug: 'ReiDoModulo',
    nome: STORE_DISPLAY_NAMES['reidomodulo'] || 'Rei do Módulo',
    description: 'Assume perfil de Gerente da loja Rei do Módulo.'
  },
  '/rudge': {
    command: '/rudge',
    lojaSlug: 'MPrudge',
    nome: STORE_DISPLAY_NAMES['mprudge'] || 'Rudge Ramos',
    description: 'Assume perfil de Gerente da loja Rudge Ramos.'
  },
  '/santoandre': {
    command: '/santoandre',
    lojaSlug: 'MPSantoAndre',
    nome: STORE_DISPLAY_NAMES['mpsantoandre'] || 'Santo André',
    description: 'Assume perfil de Gerente da loja Santo André.'
  }
};

export interface UserProfile {
  phone: string;
  persona: 'socio' | 'gerente';
  lojaSlug?: string;
  lojaNome?: string;
  defaultScope: 'rede' | 'loja';
  memoryGeneration: number;
  dailyMemoryResetAt?: string;
  updatedAt: string;
}

export interface InFlightJobInfo {
  phone: string;
  jobId: string;
  batchId?: string;
  startedAt: number;
  abortController: AbortController;
  isAborted: boolean;
}

/**
 * Registro de jobs em voo para cancelamento imediato pelo comando /reset
 */
export class InFlightAbortRegistry {
  private static instance: InFlightAbortRegistry;
  private activeJobs = new Map<string, InFlightJobInfo>();

  public static getInstance(): InFlightAbortRegistry {
    if (!InFlightAbortRegistry.instance) {
      InFlightAbortRegistry.instance = new InFlightAbortRegistry();
    }
    return InFlightAbortRegistry.instance;
  }

  public register(phone: string, jobId: string, batchId?: string): AbortController {
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    const controller = new AbortController();
    this.activeJobs.set(cleanPhone, {
      phone: cleanPhone,
      jobId,
      batchId,
      startedAt: Date.now(),
      abortController: controller,
      isAborted: false
    });
    return controller;
  }

  public abort(phone: string): { aborted: boolean; jobId?: string; batchId?: string } {
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    const job = this.activeJobs.get(cleanPhone);
    if (!job) return { aborted: false };

    job.isAborted = true;
    try {
      job.abortController.abort('RESET_COMMAND');
    } catch {}
    this.activeJobs.delete(cleanPhone);
    return { aborted: true, jobId: job.jobId, batchId: job.batchId };
  }

  public isAborted(phone: string, jobId?: string): boolean {
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    const job = this.activeJobs.get(cleanPhone);
    if (!job) return true;
    if (jobId && job.jobId !== jobId) return true;
    return job.isAborted;
  }

  public clear(phone: string, jobId?: string): void {
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    const job = this.activeJobs.get(cleanPhone);
    if (job && (!jobId || job.jobId === jobId)) {
      this.activeJobs.delete(cleanPhone);
    }
  }

  public hasInFlight(phone: string): boolean {
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    return this.activeJobs.has(cleanPhone);
  }
}

/**
 * Garante a criação idempotente das tabelas de perfil e memória diária no SQLite
 */
export function ensureUserProfileSchema(db: Database.Database): void {
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
  } catch (err: any) {
    console.error('[HYDRA_COMMANDS] Erro ao inicializar schema de perfis:', err?.message || err);
  }
}

/**
 * Normaliza número de telefone (apenas dígitos)
 */
export function normalizePhone(raw: string): string {
  return String(raw || '').replace(/\D/g, '');
}

/**
 * Verifica se o número de telefone está autorizado para executar comandos determinísticos
 */
export function isAuthorizedPhone(phone: string, db?: Database.Database): boolean {
  const clean = normalizePhone(phone);
  if (db) {
    try {
      const user = db.prepare('SELECT is_active FROM hydra_authorized_users WHERE phone = ?').get(clean) as { is_active: number } | undefined;
      if (user) {
        return user.is_active === 1;
      }
    } catch {}
  }
  return AUTHORIZED_NUMBERS.has(clean);
}

/**
 * Verifica se o usuário possui permissão para simular personas (/socio, /{loja}) e resetar o ambiente (/reset).
 */
export function canUserSimulatePersona(db: Database.Database, phone: string): boolean {
  const clean = normalizePhone(phone);
  if (db) {
    try {
      const user = db.prepare('SELECT can_simulate_persona FROM hydra_authorized_users WHERE phone = ?').get(clean) as { can_simulate_persona: number } | undefined;
      if (user) {
        return user.can_simulate_persona === 1;
      }
    } catch {}
  }
  return AUTHORIZED_NUMBERS.has(clean);
}

/**
 * Constrói a mensagem de recusa educada quando um usuário sem permissão de simulação tenta /socio, /reset ou /{loja}
 */
export function buildSimulationRefusalMessage(): string {
  return [
    '> *Acesso Restrito — Permissão Insuficiente*',
    '- Seu perfil não possui permissão para simulação de personas ou alternância de lojas.',
    '- Os comandos de simulação e redefinição de ambiente são exclusivos para a diretoria.',
    '- Seu acesso permanece restrito à sua unidade autorizada.'
  ].join('\n');
}

/**
 * Verifica se uma mensagem de texto é um comando determinístico suportado
 */
export function isDeterministicCommand(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  // Comandos desconhecidos também ficam fora da IA e recebem orientação segura.
  return trimmed.startsWith('/');
}

/**
 * Recupera o perfil do usuário ou o padrão (Sócio / Rede).
 * Garante que usuários sem permissão de simulação fiquem estritamente no perfil Gerente de sua loja.
 */
export function getUserProfile(db: Database.Database, phone: string): UserProfile {
  ensureUserProfileSchema(db);
  const p = normalizePhone(phone);

  let isLockedManager = false;
  let lockedStoreSlug: string | undefined = undefined;
  let lockedStoreName: string | undefined = undefined;

  try {
    const authUser = db.prepare(`
      SELECT role, allowed_stores, can_simulate_persona FROM hydra_authorized_users WHERE phone = ?
    `).get(p) as any;

    if (authUser && authUser.can_simulate_persona === 0 && authUser.role === 'gerente') {
      isLockedManager = true;
      let allowedStores: string[] = [];
      try {
        allowedStores = JSON.parse(authUser.allowed_stores);
        if (!Array.isArray(allowedStores)) allowedStores = [authUser.allowed_stores];
      } catch {
        allowedStores = [authUser.allowed_stores];
      }
      lockedStoreSlug = allowedStores[0] && allowedStores[0] !== '*' ? allowedStores[0] : undefined;
      if (lockedStoreSlug) {
        lockedStoreName = STORE_DISPLAY_NAMES[lockedStoreSlug.toLowerCase()] || lockedStoreSlug;
      }
    }
  } catch {}

  try {
    const row = db.prepare(`
      SELECT phone, persona, loja_slug, loja_nome, default_scope, memory_generation, daily_memory_reset_at, updated_at
      FROM hydra_user_profiles
      WHERE phone = ?
    `).get(p) as any;

    if (row) {
      if (isLockedManager) {
        return {
          phone: row.phone,
          persona: 'gerente',
          lojaSlug: lockedStoreSlug,
          lojaNome: lockedStoreName,
          defaultScope: 'loja',
          memoryGeneration: Number(row.memory_generation) || 1,
          dailyMemoryResetAt: row.daily_memory_reset_at || undefined,
          updatedAt: row.updated_at
        };
      }

      return {
        phone: row.phone,
        persona: row.persona as 'socio' | 'gerente',
        lojaSlug: row.loja_slug || undefined,
        lojaNome: row.loja_nome || undefined,
        defaultScope: row.default_scope as 'rede' | 'loja',
        memoryGeneration: Number(row.memory_generation) || 1,
        dailyMemoryResetAt: row.daily_memory_reset_at || undefined,
        updatedAt: row.updated_at
      };
    }
  } catch (err: any) {
    console.warn(`[HYDRA_COMMANDS] Falha ao recuperar perfil de ${p}:`, err?.message || err);
  }

  if (isLockedManager) {
    return {
      phone: p,
      persona: 'gerente',
      lojaSlug: lockedStoreSlug,
      lojaNome: lockedStoreName,
      defaultScope: 'loja',
      memoryGeneration: 1,
      updatedAt: new Date().toISOString()
    };
  }

  // Padrão: Sócio com escopo 'rede'
  return {
    phone: p,
    persona: 'socio',
    lojaSlug: undefined,
    lojaNome: undefined,
    defaultScope: 'rede',
    memoryGeneration: 1,
    updatedAt: new Date().toISOString()
  };
}

/**
 * Salva ou atualiza o perfil do usuário
 */
export function saveUserProfile(db: Database.Database, profile: UserProfile): void {
  ensureUserProfileSchema(db);
  const p = normalizePhone(profile.phone);
  const now = profile.updatedAt || new Date().toISOString();

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
      profile.defaultScope || (profile.persona === 'gerente' ? 'loja' : 'rede'),
      profile.memoryGeneration || 1,
      profile.dailyMemoryResetAt || null,
      now
    );
  } catch (err: any) {
    console.error(`[HYDRA_COMMANDS] Erro ao salvar perfil de ${p}:`, err?.message || err);
  }
}

/**
 * Constrói a mensagem estática do menu com exatamente uma linha por comando
 */
export function buildMenuMessage(): string {
  const lines: string[] = [
    '> *Comandos Rápidos do Hydra*',
    '- */menu:* Exibe a lista de comandos disponíveis.',
    '- */perfil:* Consulta a persona e loja atualmente ativas no seu WhatsApp.',
    '- */reset:* Reinicia o contexto, persona e memória diária, abortando respostas em voo.',
    '- */socio:* Assume o perfil de Sócio com visão consolidada de toda a rede.'
  ];

  // Adiciona cada uma das 10 lojas na ordem do catálogo
  for (const storeSlug of CATALOGO_10_LOJAS) {
    const entry = Object.values(STORE_COMMANDS).find(s => s.lojaSlug.toLowerCase() === storeSlug.toLowerCase());
    if (entry) {
      lines.push(`- *${entry.command}:* ${entry.description}`);
    }
  }

  return lines.join('\n');
}

/**
 * Constrói a mensagem descritiva do perfil ativo
 */
export function buildProfileMessage(profile: UserProfile): string {
  if (profile.persona === 'gerente') {
    return [
      '> *Perfil Operacional Ativo*',
      '- *Persona:* Gerente de Loja',
      `- *Loja:* ${profile.lojaNome || 'N/A'}`,
      `- *Escopo Padrão:* ${profile.lojaSlug || 'N/A'}`,
      '- *Modo:* Foco exclusivo na unidade. Consultas sem loja explícita são direcionadas para sua loja.'
    ].join('\n');
  }

  return [
    '> *Perfil Operacional Ativo*',
    '- *Persona:* Sócio',
    '- *Escopo Padrão:* Rede consolidada (10 lojas)',
    `- *Geração de Memória:* #${profile.memoryGeneration}`,
    '- *Modo:* Visão executiva de rede. Consultas sem loja explícita trazem panorama geral.'
  ].join('\n');
}

/**
 * Constrói a confirmação de ativação do perfil de Sócio
 */
export function buildSocioConfirmationMessage(): string {
  return [
    '> *Perfil Atualizado — Sócio*',
    '- *Persona:* Sócio',
    '- *Escopo Padrão:* Rede consolidada (10 lojas)',
    '- Modo de visão executiva ativado. Consultas gerais analisarão toda a rede.'
  ].join('\n');
}

/**
 * Constrói a confirmação de ativação do perfil de Gerente
 */
export function buildStoreConfirmationMessage(mapping: StoreCommandMapping): string {
  return [
    `> *Perfil Atualizado — Gerente de ${mapping.nome}*`,
    '- *Persona:* Gerente de Loja',
    `- *Loja:* ${mapping.nome}`,
    `- *Escopo Padrão:* ${mapping.lojaSlug}`,
    `- Modo gerente ativado. Perguntas como "como estamos de meta?" focarão automaticamente em ${mapping.nome}.`
  ].join('\n');
}

/**
 * Executa o comando /reset garantindo a Regra de Ouro do Reset Abortivo
 */
export async function executeResetCommand(
  phone: string,
  db: Database.Database,
  options?: {
    batcher?: any;
    abortRegistry?: InFlightAbortRegistry;
    presenceFn?: (phone: string, presence: 'composing' | 'paused') => Promise<void>;
  }
): Promise<{ replyText: string; abortedInFlight: boolean; newGeneration: number }> {
  const p = normalizePhone(phone);
  const registry = options?.abortRegistry || InFlightAbortRegistry.getInstance();
  let abortedInFlight = false;

  // 1. REGRA DE OURO: Aborta resposta em voo imediatamente
  const abortRes = registry.abort(p);
  if (abortRes.aborted) {
    abortedInFlight = true;
  }

  if (options?.batcher) {
    if (typeof options.batcher.isInFlight === 'function' && options.batcher.isInFlight(p)) {
      abortedInFlight = true;
      const inFlight = options.batcher.getInFlight?.(p);
      if (inFlight?.batchId && typeof options.batcher.markBatchObsolete === 'function') {
        options.batcher.markBatchObsolete(inFlight.batchId);
      }
      if (typeof options.batcher.clearInFlight === 'function') {
        options.batcher.clearInFlight(p);
      }
    }
  }

  // 2. Encerra imediatamente a presença 'digitando' (composing -> paused)
  if (options?.presenceFn) {
    try {
      await options.presenceFn(p, 'paused');
    } catch {}
  }

  // 3. Limpa o contexto conversacional na hydra_turn_contexts e a conversa no AGY CLI
  clearTurnState(db, p);
  clearAgyConversationId(db, p);

  // 4. Reseta a persona para Sócio (visão de rede) e incrementa a geração de memória
  const currentProfile = getUserProfile(db, p);
  const newGeneration = currentProfile.memoryGeneration + 1;
  const nowIso = new Date().toISOString();

  saveUserProfile(db, {
    phone: p,
    persona: 'socio',
    lojaSlug: undefined,
    lojaNome: undefined,
    defaultScope: 'rede',
    memoryGeneration: newGeneration,
    dailyMemoryResetAt: nowIso,
    updatedAt: nowIso
  });

  // 5. Limpa a memória diária do usuário sem apagar a auditoria histórica
  try {
    db.prepare('DELETE FROM hydra_daily_memories WHERE phone = ?').run(p);
  } catch {}

  // [E2-06]: Invalida mem?rias da gera??o anterior no SQLite sem corromper os arquivos f?sicos hist?ricos no Vault
  try {
    invalidateGenerationMemories(db, p, currentProfile.memoryGeneration);
  } catch {}

  // 6. Confirmação única sem vazamento entre perfis
  const abortDetail = abortedInFlight
    ? '- *Geração em voo:* Interrompida com sucesso (sem vazamento da resposta anterior).'
    : '- *Geração em voo:* Nenhuma requisição pendente no momento.';

  const replyText = [
    '> *Contexto e Memória Reiniciados*',
    '- Conversa, persona e memória diária resetadas com sucesso.',
    '- *Perfil restaurado:* Sócio (Visão de Rede).',
    `- *Geração de Memória:* #${newGeneration}`,
    abortDetail,
    '- Pronto para novas consultas!'
  ].join('\n');

  return {
    replyText,
    abortedInFlight,
    newGeneration
  };
}

export interface CommandInterceptorOptions {
  phone: string;
  text: string;
  db: Database.Database;
  batcher?: any;
  abortRegistry?: InFlightAbortRegistry;
  presenceFn?: (phone: string, presence: 'composing' | 'paused') => Promise<void>;
}

export interface CommandInterceptorResult {
  handled: boolean;
  command?: string;
  replyText?: string;
  messages: string[];
  abortedInFlight?: boolean;
  profile?: UserProfile;
}

/**
 * Ponto de entrada do interceptor determinístico de comandos no Ingress.
 * Intercepta antes do batcher e da IA para números autorizados.
 */
export async function interceptCommand(
  options: CommandInterceptorOptions
): Promise<CommandInterceptorResult> {
  const { phone, text, db, batcher, abortRegistry, presenceFn } = options;

  if (!isAuthorizedPhone(phone, db) || !isDeterministicCommand(text)) {
    return { handled: false, messages: [] };
  }

  ensureUserProfileSchema(db);
  const p = normalizePhone(phone);
  const cmd = text.trim().split(/\s+/)[0].toLowerCase();

  // /menu: lista estática com uma linha de descrição por comando, sem IA
  if (cmd === '/menu') {
    const replyText = buildMenuMessage();
    const messages = composeSemanticBalloons(replyText);
    return {
      handled: true,
      command: '/menu',
      replyText,
      messages,
      profile: getUserProfile(db, p)
    };
  }

  // /perfil: exibe a persona e a loja atualmente assumidas, sem IA
  if (cmd === '/perfil') {
    const profile = getUserProfile(db, p);
    const replyText = buildProfileMessage(profile);
    const messages = composeSemanticBalloons(replyText);
    return {
      handled: true,
      command: '/perfil',
      replyText,
      messages,
      profile
    };
  }

  // Comandos de simulação: /socio, /reset e /{loja} só são atendidos se can_simulate_persona === 1
  const isSimulationCommand = cmd === '/socio' || cmd === '/reset' || (cmd in STORE_COMMANDS);
  if (isSimulationCommand && !canUserSimulatePersona(db, p)) {
    const replyText = buildSimulationRefusalMessage();
    const messages = composeSemanticBalloons(replyText);
    return {
      handled: true,
      command: cmd,
      replyText,
      messages,
      profile: getUserProfile(db, p)
    };
  }

  // /reset: limpa contexto, persona e memória diária com cancelamento em voo
  if (cmd === '/reset') {
    const resetResult = await executeResetCommand(p, db, { batcher, abortRegistry, presenceFn });
    const messages = composeSemanticBalloons(resetResult.replyText);
    return {
      handled: true,
      command: '/reset',
      replyText: resetResult.replyText,
      messages,
      abortedInFlight: resetResult.abortedInFlight,
      profile: getUserProfile(db, p)
    };
  }

  // /socio: assume persona de sócio com escopo padrão "rede"
  if (cmd === '/socio') {
    const nowIso = new Date().toISOString();
    const current = getUserProfile(db, p);
    const updatedProfile: UserProfile = {
      ...current,
      persona: 'socio',
      lojaSlug: undefined,
      lojaNome: undefined,
      defaultScope: 'rede',
      updatedAt: nowIso
    };

    saveUserProfile(db, updatedProfile);

    // Atualiza também o contexto ativo de turno (limpa loja pré-fixada)
    const turnState = getLatestTurnState(db, p, 120);
    if (turnState) {
      saveTurnState(db, {
        ...turnState,
        lojaSlug: undefined,
        updatedAt: nowIso
      });
    }

    const replyText = buildSocioConfirmationMessage();
    const messages = composeSemanticBalloons(replyText);

    return {
      handled: true,
      command: '/socio',
      replyText,
      messages,
      profile: updatedProfile
    };
  }

  // /{loja}: /dompedro, /jabaquara, etc.
  if (cmd in STORE_COMMANDS) {
    const mapping = STORE_COMMANDS[cmd];
    const nowIso = new Date().toISOString();
    const current = getUserProfile(db, p);
    const updatedProfile: UserProfile = {
      ...current,
      persona: 'gerente',
      lojaSlug: mapping.lojaSlug,
      lojaNome: mapping.nome,
      defaultScope: 'loja',
      updatedAt: nowIso
    };

    saveUserProfile(db, updatedProfile);

    // Atualiza também o contexto ativo de turno com a loja assumida
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
        lastIntent: 'store_overview',
        lojaSlug: mapping.lojaSlug,
        filters: { lojaSlug: mapping.lojaSlug },
        updatedAt: nowIso
      });
    }

    const replyText = buildStoreConfirmationMessage(mapping);
    const messages = composeSemanticBalloons(replyText);

    return {
      handled: true,
      command: cmd,
      replyText,
      messages,
      profile: updatedProfile
    };
  }

  const replyText = 'Comando não reconhecido. Use /menu para ver os comandos disponíveis.';
  return {
    handled: true,
    command: cmd,
    replyText,
    messages: composeSemanticBalloons(replyText),
    profile: getUserProfile(db, p)
  };
}
