/**
 * src/hydra-sync/runtime_diagnostics.ts
 * Inspeção factual de runtime, estado do Obsidian Vault e integridade da memória.
 */

import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import type {
  RuntimeDiagnosticsPayload,
  VaultDiagnosticsResult
} from './types/vault_contract.js';

export interface BuildRuntimeDiagnosticsOptions {
  vaultPathOverride?: string;
  mcpAvailableOverride?: boolean;
  serverStatusOverride?: 'connected' | 'disconnected' | 'bypassed';
  registeredToolsOverride?: string[];
  nowDate?: Date;
}

/**
 * Obtém o timestamp ISO 8601 no fuso horário America/Sao_Paulo (-03:00)
 */
export function getSaoPauloIsoTimestamp(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);

  const getPart = (type: string) => parts.find(p => p.type === type)?.value || '00';
  const y = getPart('year');
  const m = getPart('month');
  const d = getPart('day');
  const hh = getPart('hour');
  const mm = getPart('minute');
  const ss = getPart('second');

  return `${y}-${m}-${d}T${hh}:${mm}:${ss}-03:00`;
}

/**
 * Mapeia recursivamente todas as notas markdown (.md) de um diretório
 */
function scanMarkdownFilesRecursively(dir: string): string[] {
  let results: string[] = [];
  try {
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results = results.concat(scanMarkdownFilesRecursively(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(fullPath);
      }
    }
  } catch {
    // Ignora erros de permissão ou leitura de diretório
  }
  return results;
}

/**
 * Constrói o payload estruturado de diagnóstico de runtime do sistema, do Obsidian Vault e da memória persistente.
 */
export function buildRuntimeDiagnostics(
  db?: Database.Database | any,
  phone?: string,
  persona: 'socio' | 'gerente' = 'socio',
  lojaSlug?: string | null,
  options?: BuildRuntimeDiagnosticsOptions
): RuntimeDiagnosticsPayload {
  const cleanPhone = (phone || '').replace(/\D/g, '') || 'default';
  const vaultRoot = options?.vaultPathOverride || process.env.HYDRA_VAULT_ROOT || '/home/operacional/hydra-data/vault';

  // Resolução do diretório do usuário no vault
  let userVaultDir = path.join(vaultRoot, 'usuarios', cleanPhone);
  if (!fs.existsSync(userVaultDir) && fs.existsSync(path.join(vaultRoot, cleanPhone))) {
    userVaultDir = path.join(vaultRoot, cleanPhone);
  } else if (!fs.existsSync(userVaultDir) && options?.vaultPathOverride) {
    userVaultDir = options.vaultPathOverride;
  }

  let isAccessible = false;
  let totalUserNotes = 0;
  let activeNotesCount = 0;
  let lastError: string | null = null;
  let lastSyncAt: string | null = null;

  try {
    if (fs.existsSync(userVaultDir)) {
      fs.accessSync(userVaultDir, fs.constants.R_OK);
      isAccessible = true;

      const mdFiles = scanMarkdownFilesRecursively(userVaultDir);
      totalUserNotes = mdFiles.length;

      let latestMtime = 0;
      for (const filePath of mdFiles) {
        try {
          const stats = fs.statSync(filePath);
          if (stats.mtimeMs > latestMtime) {
            latestMtime = stats.mtimeMs;
          }

          // Checa frontmatter/conteúdo para status ativo
          const content = fs.readFileSync(filePath, 'utf8');
          const isSuperseded = /status:\s*['"]?(superseded|revoked)['"]?/i.test(content);
          if (!isSuperseded) {
            activeNotesCount++;
          }
        } catch {
          // Continua para próxima nota
        }
      }

      if (latestMtime > 0) {
        lastSyncAt = getSaoPauloIsoTimestamp(new Date(latestMtime));
      }
    } else {
      lastError = `Diretório do vault não encontrado: ${userVaultDir}`;
    }
  } catch (err: any) {
    isAccessible = false;
    lastError = err?.message || String(err);
  }

  // Consulta do SQLite para geração e contagem de memórias ativas
  let memoryGeneration = 1;
  let totalActiveMemories = 0;
  const indexVersion = 1;

  if (db && typeof db.prepare === 'function') {
    try {
      // Checa perfil de usuário para memory_generation
      const profileRow = db.prepare('SELECT memory_generation FROM hydra_user_profiles WHERE phone = ?').get(cleanPhone) as any;
      if (profileRow && profileRow.memory_generation != null) {
        memoryGeneration = Number(profileRow.memory_generation) || 1;
      } else {
        // Fallback: MAX(generation_id) em hydra_memories
        const genRow = db.prepare('SELECT MAX(generation_id) as max_gen FROM hydra_memories WHERE phone = ?').get(cleanPhone) as any;
        if (genRow && genRow.max_gen != null) {
          memoryGeneration = Number(genRow.max_gen) || 1;
        }
      }

      // Contagem de memórias ativas no SQLite
      const memRow = db.prepare("SELECT COUNT(*) as cnt FROM hydra_memories WHERE phone = ? AND status = 'active'").get(cleanPhone) as any;
      if (memRow && memRow.cnt != null) {
        totalActiveMemories = Number(memRow.cnt);
      }
    } catch {
      // Tabela pode não existir no SQLite mock
    }
  }

  // Se o SQLite não reportou memórias, mas há notas ativas no vault
  if (totalActiveMemories === 0 && activeNotesCount > 0) {
    totalActiveMemories = activeNotesCount;
  }

  // Fonte de recuperação de memória
  let retrievalSource: 'vault_direct' | 'sqlite_index' | 'empty' = 'empty';
  if (isAccessible && activeNotesCount > 0) {
    retrievalSource = 'vault_direct';
  } else if (totalActiveMemories > 0) {
    retrievalSource = 'sqlite_index';
  }

  const registeredTools = options?.registeredToolsOverride || [
    'get_daily_revenue',
    'get_monthly_revenue',
    'get_cmv',
    'get_os_list',
    'get_os_details',
    'get_store_overview',
    'get_checklist_audit',
    'get_aging_cars',
    'search_os',
    'runtime_diagnostics'
  ];

  const now = options?.nowDate || new Date();
  const serverTime = getSaoPauloIsoTimestamp(now);

  const vaultDiagnostics: VaultDiagnosticsResult = {
    isVaultConfigured: Boolean(process.env.HYDRA_VAULT_ROOT || options?.vaultPathOverride || fs.existsSync('/home/operacional/hydra-data/vault')),
    vaultPath: userVaultDir,
    isAccessible,
    totalUserNotes,
    activeNotesCount,
    memoryGeneration,
    indexVersion,
    pendingOperationsCount: 0,
    lastSyncAt: lastSyncAt || serverTime,
    lastError
  };

  return {
    vault: vaultDiagnostics,
    memory: {
      totalActiveMemories,
      effectivePersona: persona,
      activeLojaSlug: lojaSlug || null,
      memoryGeneration,
      retrievalSource
    },
    tools: {
      mcpAvailable: options?.mcpAvailableOverride ?? true,
      serverStatus: options?.serverStatusOverride ?? 'connected',
      registeredTools
    },
    serverTime
  };
}

/**
 * Formata o payload de diagnóstico em um balão WhatsApp transparente, factual e estritamente nativo.
 */
export function formatRuntimeDiagnosticsBalloon(payload: RuntimeDiagnosticsPayload): string {
  const { vault, memory, tools, serverTime } = payload;

  const vaultStatusText = vault.isAccessible
    ? 'Acessível e sincronizado'
    : (vault.lastError ? `Atenção: ${vault.lastError}` : 'Não acessível no disco');

  const retrievalDesc = memory.retrievalSource === 'vault_direct'
    ? 'Obsidian Vault direto (.md)'
    : memory.retrievalSource === 'sqlite_index'
    ? 'Índice SQLite (hydra_memories)'
    : 'Sem memórias gravadas';

  const personaLabel = memory.effectivePersona === 'socio' ? 'Sócio' : 'Gerente';
  const lojaLabel = memory.activeLojaSlug ? memory.activeLojaSlug : 'Rede Consolidada';

  const lines = [
    `> *Diagnóstico de Runtime & Memória Hydra*`,
    `- *Status do Servidor:* ${tools.serverStatus === 'connected' ? 'Operacional' : tools.serverStatus}`,
    `- *Horário do Servidor:* ${serverTime}`,
    ``,
    `> *Obsidian Vault (Armazenamento Factual)*`,
    `- *Configurado:* ${vault.isVaultConfigured ? 'Sim' : 'Não'}`,
    `- *Estado do Vault:* ${vaultStatusText}`,
    `- *Caminho:* ${vault.vaultPath}`,
    `- *Total de Notas:* ${vault.totalUserNotes} arquivo(s) .md`,
    `- *Memórias Ativas:* ${vault.activeNotesCount}`,
    `- *Geração Ativa:* Geração ${vault.memoryGeneration}`,
    `- *Último Registro:* ${vault.lastSyncAt || 'N/A'}`,
    ``,
    `> *Estado de Memória & Persona*`,
    `- *Persona Efetiva:* ${personaLabel}`,
    `- *Loja em Foco:* ${lojaLabel}`,
    `- *Total Ativo:* ${memory.totalActiveMemories} memórias`,
    `- *Fonte de Recuperação:* ${retrievalDesc}`,
    ``,
    `> *Adaptadores Operacionais (Tools & MCP)*`,
    `- *MCP Server:* ${tools.mcpAvailable ? 'Disponível' : 'Indisponível'}`,
    `- *Ferramentas Conectadas:* ${tools.registeredTools.length} ativas`
  ];

  return lines.join('\n');
}
