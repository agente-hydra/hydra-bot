/**
 * src/hydra-sync/vault_manager.ts
 * Gerenciador e Driver do Obsidian Vault por Identidade do Usuário.
 * Implementação da Frente 2 (hydra-obsidian-memory-audit)
 *
 * Princípios:
 * 1. Isolamento estrito por usuário: vault/usuarios/<phone_canonical>/
 * 2. Prevenção absoluta de Path Traversal
 * 3. Gravação Two-Phase (tmp -> rename atômico)
 * 4. Validação estrita do contrato VaultFrontmatter
 * 5. Reconciliação bidirecional idempotente (syncVaultWithIndex)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type Database from 'better-sqlite3';
import type {
  VaultFrontmatter,
  VaultNote,
  VaultDiagnosticsResult,
  VaultMemoryType,
  VaultMemoryStatus,
  VaultScopeType
} from './types/vault_contract.js';

export function getVaultRoot(): string {
  if (process.env.HYDRA_VAULT_ROOT) {
    return path.resolve(process.env.HYDRA_VAULT_ROOT);
  }
  if (process.platform === 'win32') {
    return path.resolve('.tmp', 'vault');
  }
  return '/home/operacional/hydra-data/vault';
}

/**
 * Normaliza e valida o telefone canônico.
 * Rejeita estritamente tentativas de path traversal ou caracteres inválidos.
 */
export function sanitizeCanonicalPhone(phone: string): string {
  if (!phone || typeof phone !== 'string') {
    throw new Error('Telefone do usuário inválido ou indefinido');
  }
  if (phone.includes('..') || phone.includes('/') || phone.includes('\\') || phone.includes('\0')) {
    throw new Error(`SecurityException: Path traversal detectado no identificador: ${phone}`);
  }
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 20) {
    throw new Error(`Identificador telefônico inválido: '${phone}' (${digits.length} dígitos)`);
  }
  return digits;
}

/**
 * Retorna o diretório base do vault do usuário com validação anti-traversal estrita.
 */
export function getUserVaultDir(phone: string, vaultRoot = getVaultRoot()): string {
  const canonicalPhone = sanitizeCanonicalPhone(phone);
  const baseUsersDir = path.resolve(vaultRoot, 'usuarios');
  const targetUserDir = path.resolve(baseUsersDir, canonicalPhone);

  // Verificação estrita anti-traversal
  if (!targetUserDir.startsWith(baseUsersDir + path.sep)) {
    throw new Error(`SecurityException: Tentativa de Path Traversal para usuário '${phone}'`);
  }

  // Cria estrutura padrão de diretórios caso não existam
  if (!fs.existsSync(targetUserDir)) {
    fs.mkdirSync(targetUserDir, { recursive: true });
  }

  const subdirs = ['preferencias', 'correcoes', 'diario'];
  for (const sub of subdirs) {
    const subPath = path.join(targetUserDir, sub);
    if (!fs.existsSync(subPath)) {
      fs.mkdirSync(subPath, { recursive: true });
    }
  }

  return targetUserDir;
}

/**
 * Calcula o hash SHA-256 de um buffer ou string.
 */
export function computeSha256(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Validação estrita de todos os campos do contrato VaultFrontmatter.
 */
export function validateFrontmatter(fm: any): asserts fm is VaultFrontmatter {
  if (!fm || typeof fm !== 'object') {
    throw new Error('Frontmatter inválido: deve ser um objeto');
  }
  if (!fm.id || typeof fm.id !== 'string') {
    throw new Error('Frontmatter inválido: campo id é obrigatório');
  }
  if (!fm.owner || typeof fm.owner !== 'string') {
    throw new Error('Frontmatter inválido: campo owner é obrigatório');
  }
  if (typeof fm.generation_id !== 'number' || isNaN(fm.generation_id)) {
    throw new Error('Frontmatter inválido: generation_id deve ser número');
  }
  if (!['perfil_global', 'rede', 'loja'].includes(fm.scope_type)) {
    throw new Error(`Frontmatter inválido: scope_type inválido '${fm.scope_type}'`);
  }
  if (!fm.topic_key || typeof fm.topic_key !== 'string') {
    throw new Error('Frontmatter inválido: topic_key é obrigatório');
  }
  if (!['explicit_preference', 'correction', 'derived_interest'].includes(fm.memory_type)) {
    throw new Error(`Frontmatter inválido: memory_type inválido '${fm.memory_type}'`);
  }
  if (!['active', 'candidate', 'superseded', 'revoked'].includes(fm.status)) {
    throw new Error(`Frontmatter inválido: status inválido '${fm.status}'`);
  }
  if (typeof fm.version !== 'number') {
    throw new Error('Frontmatter inválido: version deve ser número');
  }
  if (typeof fm.confidence !== 'number' || fm.confidence < 0 || fm.confidence > 1) {
    throw new Error('Frontmatter inválido: confidence deve ser número entre 0 e 1');
  }
  if (typeof fm.evidence_text !== 'string') {
    throw new Error('Frontmatter inválido: evidence_text deve ser string');
  }
  if (!Array.isArray(fm.source_turn_ids)) {
    throw new Error('Frontmatter inválido: source_turn_ids deve ser array');
  }
  if (!fm.created_at || typeof fm.created_at !== 'string') {
    throw new Error('Frontmatter inválido: created_at é obrigatório');
  }
}

/**
 * Serializa VaultFrontmatter para bloco YAML Markdown.
 */
export function serializeFrontmatter(frontmatter: VaultFrontmatter): string {
  validateFrontmatter(frontmatter);
  const lines: string[] = ['---'];
  lines.push(`id: "${frontmatter.id}"`);
  lines.push(`owner: "${frontmatter.owner}"`);
  lines.push(`generation_id: ${frontmatter.generation_id}`);
  lines.push(`scope_type: "${frontmatter.scope_type}"`);
  lines.push(`loja_slug: ${frontmatter.loja_slug ? `"${frontmatter.loja_slug}"` : 'null'}`);
  lines.push(`topic_key: "${frontmatter.topic_key}"`);
  lines.push(`memory_type: "${frontmatter.memory_type}"`);
  lines.push(`status: "${frontmatter.status}"`);
  lines.push(`version: ${frontmatter.version}`);
  lines.push(`confidence: ${frontmatter.confidence}`);
  lines.push(`evidence_text: ${JSON.stringify(frontmatter.evidence_text)}`);
  lines.push(`source_turn_ids: ${JSON.stringify(frontmatter.source_turn_ids || [])}`);
  lines.push(`created_at: "${frontmatter.created_at}"`);
  lines.push(`confirmed_at: ${frontmatter.confirmed_at ? `"${frontmatter.confirmed_at}"` : 'null'}`);
  lines.push(`expires_at: ${frontmatter.expires_at ? `"${frontmatter.expires_at}"` : 'null'}`);
  lines.push(`superseded_by: ${frontmatter.superseded_by ? `"${frontmatter.superseded_by}"` : 'null'}`);
  lines.push('---');
  return lines.join('\n');
}

/**
 * Faz parse de uma nota Markdown com Frontmatter YAML.
 */
export function parseVaultNote(fileContent: string): { frontmatter: VaultFrontmatter; content: string } {
  const match = fileContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error('Nota Markdown não possui bloco de Frontmatter YAML delimitado por ---');
  }

  const rawYaml = match[1];
  const markdownBody = (match[2] || '').trim();

  // Parser YAML determinístico para os campos do contrato
  const lines = rawYaml.split(/\r?\n/);
  const data: Record<string, any> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    let val = trimmed.slice(colonIdx + 1).trim();

    if (val === 'null' || val === '~') {
      data[key] = null;
    } else if (val === 'true') {
      data[key] = true;
    } else if (val === 'false') {
      data[key] = false;
    } else if (/^\d+$/.test(val)) {
      data[key] = parseInt(val, 10);
    } else if (/^\d+\.\d+$/.test(val)) {
      data[key] = parseFloat(val);
    } else if (val.startsWith('[') && val.endsWith(']')) {
      try {
        data[key] = JSON.parse(val);
      } catch {
        data[key] = [];
      }
    } else {
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      data[key] = val;
    }
  }

  validateFrontmatter(data);

  return {
    frontmatter: data,
    content: markdownBody
  };
}

/**
 * Gravação transacional two-phase de nota Markdown no vault do usuário.
 * 1. Grava no arquivo temporário (.tmp_<id>_<uuid>.md)
 * 2. Executa rename atômico para o destino final
 */
export function writeVaultNote(
  phone: string,
  relativePath: string, // ex: 'preferencias/mem_tabela.md'
  frontmatter: VaultFrontmatter,
  bodyContent = '',
  vaultRoot = getVaultRoot()
): VaultNote {
  const userDir = getUserVaultDir(phone, vaultRoot);
  const cleanRelative = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, '');
  const targetPath = path.resolve(userDir, cleanRelative);

  // Anti-traversal check no relative path
  if (!targetPath.startsWith(userDir + path.sep)) {
    throw new Error(`SecurityException: Tentativa de Path Traversal no caminho relativo: '${relativePath}'`);
  }

  // Assegura diretório pai
  const parentDir = path.dirname(targetPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  const serializedYaml = serializeFrontmatter(frontmatter);
  const fullContent = `${serializedYaml}\n\n${bodyContent.trim()}\n`;

  // Two-phase write: grava em arquivo temporário com prefixo .tmp_
  const tempFileName = `.tmp_${frontmatter.id}_${crypto.randomUUID()}.md`;
  const tempPath = path.join(parentDir, tempFileName);

  try {
    fs.writeFileSync(tempPath, fullContent, 'utf-8');
    // Rename atômico substitui o destino final
    fs.renameSync(tempPath, targetPath);
  } catch (err: any) {
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch {}
    }
    throw new Error(`Falha ao gravar nota transacional no vault: ${err?.message || err}`);
  }

  const stat = fs.statSync(targetPath);
  const fileHash = computeSha256(fullContent);

  return {
    frontmatter,
    content: bodyContent.trim(),
    relativePath: cleanRelative.replace(/\\/g, '/'),
    absolutePath: targetPath,
    fileHash,
    updatedAt: stat.mtime.toISOString()
  };
}

/**
 * Lê nota Markdown do vault do usuário.
 */
export function readVaultNote(
  phone: string,
  relativePath: string,
  vaultRoot = getVaultRoot()
): VaultNote | null {
  const userDir = getUserVaultDir(phone, vaultRoot);
  const cleanRelative = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, '');
  const targetPath = path.resolve(userDir, cleanRelative);

  if (!targetPath.startsWith(userDir + path.sep)) {
    throw new Error(`SecurityException: Tentativa de Path Traversal: '${relativePath}'`);
  }

  if (!fs.existsSync(targetPath)) {
    return null;
  }

  const content = fs.readFileSync(targetPath, 'utf-8');
  const parsed = parseVaultNote(content);
  const fileHash = computeSha256(content);
  const stat = fs.statSync(targetPath);

  return {
    frontmatter: parsed.frontmatter,
    content: parsed.content,
    relativePath: cleanRelative.replace(/\\/g, '/'),
    absolutePath: targetPath,
    fileHash,
    updatedAt: stat.mtime.toISOString()
  };
}

/**
 * Inicializa a tabela hydra_vault_index no SQLite.
 */
export function initVaultIndexTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hydra_vault_index (
      note_id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      generation_id INTEGER NOT NULL,
      scope_type TEXT NOT NULL,
      loja_slug TEXT,
      topic_key TEXT NOT NULL,
      memory_type TEXT NOT NULL,
      status TEXT NOT NULL,
      version INTEGER NOT NULL,
      confidence REAL NOT NULL,
      evidence_text TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      confirmed_at TEXT,
      expires_at TEXT,
      superseded_by TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_vault_owner_status ON hydra_vault_index(owner, status, generation_id);
    CREATE INDEX IF NOT EXISTS idx_vault_topic ON hydra_vault_index(owner, topic_key, scope_type, loja_slug);
  `);
}

/**
 * Reconciliação bidirecional idempotente entre o disco do Vault e a tabela hydra_vault_index. (E2-E2.4)
 * - Reindexa notas existentes no disco que foram alteradas ou adicionadas.
 * - Expurga índices de notas que foram deletadas do disco.
 */
export function syncVaultWithIndex(
  db: Database.Database,
  phone: string,
  vaultRoot = getVaultRoot()
): {
  reindexedCount: number;
  purgedCount: number;
  unchangedCount: number;
  totalNotes: number;
} {
  initVaultIndexTable(db);
  const canonicalPhone = sanitizeCanonicalPhone(phone);
  const userDir = getUserVaultDir(canonicalPhone, vaultRoot);

  let reindexedCount = 0;
  let purgedCount = 0;
  let unchangedCount = 0;

  // 1. Escanear arquivos Markdown no diretório do usuário
  const diskNotes: Array<{
    relativePath: string;
    absolutePath: string;
    content: string;
    fileHash: string;
    frontmatter: VaultFrontmatter;
  }> = [];

  function scanDir(dir: string, base: string) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue; // Ignora temporários e ocultos
      const fullPath = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'diario') continue; // Di?rio epis?dico n?o ? indexado na tabela de mem?rias estruturadas
        scanDir(fullPath, base);
      } else if (ent.isFile() && ent.name.endsWith('.md')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const parsed = parseVaultNote(content);
          const fileHash = computeSha256(content);
          const relativePath = path.relative(base, fullPath).replace(/\\/g, '/');

          // Valida se o owner coincide com o usuário canônico
          if (parsed.frontmatter.owner === canonicalPhone) {
            diskNotes.push({
              relativePath,
              absolutePath: fullPath,
              content: parsed.content,
              fileHash,
              frontmatter: parsed.frontmatter
            });
          }
        } catch (err: any) {
          console.warn(`[VAULT_SYNC] Ignorando arquivo não conforme '${ent.name}':`, err?.message || err);
        }
      }
    }
  }

  scanDir(userDir, userDir);

  const diskNoteIds = new Set<string>();

  // 2. Reindexar / Inserir no SQLite
  const upsertStmt = db.prepare(`
    INSERT INTO hydra_vault_index (
      note_id, owner, generation_id, scope_type, loja_slug,
      topic_key, memory_type, status, version, confidence,
      evidence_text, relative_path, file_hash, created_at,
      confirmed_at, expires_at, superseded_by, updated_at
    ) VALUES (
      @note_id, @owner, @generation_id, @scope_type, @loja_slug,
      @topic_key, @memory_type, @status, @version, @confidence,
      @evidence_text, @relative_path, @file_hash, @created_at,
      @confirmed_at, @expires_at, @superseded_by, CURRENT_TIMESTAMP
    )
    ON CONFLICT(note_id) DO UPDATE SET
      generation_id = excluded.generation_id,
      scope_type = excluded.scope_type,
      loja_slug = excluded.loja_slug,
      topic_key = excluded.topic_key,
      memory_type = excluded.memory_type,
      status = excluded.status,
      version = excluded.version,
      confidence = excluded.confidence,
      evidence_text = excluded.evidence_text,
      relative_path = excluded.relative_path,
      file_hash = excluded.file_hash,
      created_at = excluded.created_at,
      confirmed_at = excluded.confirmed_at,
      expires_at = excluded.expires_at,
      superseded_by = excluded.superseded_by,
      updated_at = CURRENT_TIMESTAMP
  `);

  const selectExistingStmt = db.prepare(`
    SELECT note_id, file_hash FROM hydra_vault_index WHERE note_id = ?
  `);

  db.transaction(() => {
    for (const note of diskNotes) {
      diskNoteIds.add(note.frontmatter.id);
      const existing = selectExistingStmt.get(note.frontmatter.id) as { note_id: string; file_hash: string } | undefined;

      if (!existing || existing.file_hash !== note.fileHash) {
        upsertStmt.run({
          note_id: note.frontmatter.id,
          owner: canonicalPhone,
          generation_id: note.frontmatter.generation_id,
          scope_type: note.frontmatter.scope_type,
          loja_slug: note.frontmatter.loja_slug || null,
          topic_key: note.frontmatter.topic_key,
          memory_type: note.frontmatter.memory_type,
          status: note.frontmatter.status,
          version: note.frontmatter.version,
          confidence: note.frontmatter.confidence,
          evidence_text: note.frontmatter.evidence_text,
          relative_path: note.relativePath,
          file_hash: note.fileHash,
          created_at: note.frontmatter.created_at,
          confirmed_at: note.frontmatter.confirmed_at || null,
          expires_at: note.frontmatter.expires_at || null,
          superseded_by: note.frontmatter.superseded_by || null
        });
        reindexedCount++;
      } else {
        unchangedCount++;
      }
    }

    // 3. Expurga registros do banco cujas notas em disco foram deletadas
    const allDbNotes = db.prepare(`
      SELECT note_id FROM hydra_vault_index WHERE owner = ?
    `).all(canonicalPhone) as Array<{ note_id: string }>;

    for (const dbNote of allDbNotes) {
      if (!diskNoteIds.has(dbNote.note_id)) {
        db.prepare('DELETE FROM hydra_vault_index WHERE note_id = ?').run(dbNote.note_id);
        purgedCount++;
      }
    }
  })();

  return {
    reindexedCount,
    purgedCount,
    unchangedCount,
    totalNotes: diskNotes.length
  };
}

/**
 * Retorna telemetria de diagnóstico do vault para um determinado usuário.
 */
export function getVaultDiagnostics(
  db: Database.Database,
  phone: string,
  generationId = 1,
  vaultRoot = getVaultRoot()
): VaultDiagnosticsResult {
  const canonicalPhone = sanitizeCanonicalPhone(phone);
  const userDir = path.resolve(vaultRoot, 'usuarios', canonicalPhone);
  const isAccessible = fs.existsSync(userDir);

  initVaultIndexTable(db);

  const counts = db.prepare(`
    SELECT
      count(*) as total,
      sum(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active
    FROM hydra_vault_index
    WHERE owner = ? AND generation_id = ?
  `).get(canonicalPhone, generationId) as any;

  return {
    isVaultConfigured: true,
    vaultPath: userDir,
    isAccessible,
    totalUserNotes: counts?.total || 0,
    activeNotesCount: counts?.active || 0,
    memoryGeneration: generationId,
    indexVersion: 1,
    pendingOperationsCount: 0,
    lastSyncAt: new Date().toISOString(),
    lastError: null
  };
}

function safeParseJson<T>(val: any, fallback: T): T {
  if (!val) return fallback;
  if (typeof val !== 'string') return (val as T) || fallback;
  try {
    return JSON.parse(val) as T;
  } catch {
    return fallback;
  }
}

function getActiveGenerationLocal(db: Database.Database, phone: string): number {
  try {
    const row = db.prepare('SELECT memory_generation FROM hydra_user_profiles WHERE phone = ?').get(phone) as any;
    if (row && row.memory_generation != null) {
      return Number(row.memory_generation) || 1;
    }
  } catch {}
  return 1;
}

/**
 * Cria nota no Vault com validacao e rebaixamento de escopo por persona (M04).
 * Gerente tentando escopo 'rede' tem o escopo rebaixado para 'loja'.
 */
export function createVaultNoteForPersona(
  phone: string,
  input: {
    relativePath?: string;
    frontmatter: Omit<VaultFrontmatter, 'owner' | 'created_at'> & { created_at?: string };
    content?: string;
    effectivePersona: 'socio' | 'gerente';
    activeLojaSlug?: string | null;
  },
  vaultRoot = getVaultRoot()
): VaultNote {
  const canonicalPhone = sanitizeCanonicalPhone(phone);
  const fm: VaultFrontmatter = {
    ...input.frontmatter,
    owner: canonicalPhone,
    created_at: input.frontmatter.created_at || new Date().toISOString()
  };

  // M04: Rebaixamento de escopo para gerente
  if (input.effectivePersona === 'gerente') {
    if (fm.scope_type === 'rede') {
      fm.scope_type = 'loja';
      fm.loja_slug = input.activeLojaSlug || fm.loja_slug || null;
    }
  }

  const subDir = fm.memory_type === 'correction' ? 'correcoes' : 'preferencias';
  const relPath = input.relativePath || `${subDir}/${fm.id}.md`;
  return writeVaultNote(canonicalPhone, relPath, fm, input.content || '', vaultRoot);
}

/**
 * Consulta o indice de notas do Vault com isolamento estrito de persona (M13).
 * Gerente NUNCA tem acesso a notas com escopo 'rede'.
 */
export function queryVaultIndex(
  db: Database.Database,
  filter: {
    owner: string;
    generationId?: number;
    effectivePersona: 'socio' | 'gerente';
    activeLojaSlug?: string | null;
    topicKey?: string;
    status?: VaultMemoryStatus;
  }
): VaultFrontmatter[] {
  initVaultIndexTable(db);
  const canonicalPhone = sanitizeCanonicalPhone(filter.owner);
  const whereClauses: string[] = ['owner = ?'];
  const params: any[] = [canonicalPhone];

  if (filter.generationId != null) {
    whereClauses.push('generation_id = ?');
    params.push(filter.generationId);
  }

  if (filter.status) {
    whereClauses.push('status = ?');
    params.push(filter.status);
  } else {
    whereClauses.push("status = 'active'");
  }

  // M13: Isolamento de escopo
  if (filter.effectivePersona === 'gerente') {
    if (filter.activeLojaSlug && filter.activeLojaSlug.trim().length > 0) {
      whereClauses.push("((scope_type = 'loja' AND LOWER(loja_slug) = LOWER(?)) OR scope_type = 'perfil_global')");
      params.push(filter.activeLojaSlug.trim());
    } else {
      whereClauses.push("scope_type = 'perfil_global'");
    }
  } else {
    whereClauses.push("(scope_type = 'rede' OR scope_type = 'perfil_global')");
  }

  if (filter.topicKey) {
    whereClauses.push('LOWER(topic_key) = LOWER(?)');
    params.push(filter.topicKey.trim());
  }

  const rows = db.prepare(`
    SELECT * FROM hydra_vault_index
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY
      CASE memory_type
        WHEN 'correction' THEN 1
        WHEN 'explicit_preference' THEN 2
        WHEN 'derived_interest' THEN 3
        ELSE 4
      END ASC,
      version DESC
  `).all(...params) as any[];

  return rows.map(r => ({
    id: r.note_id,
    owner: r.owner,
    generation_id: r.generation_id,
    scope_type: r.scope_type,
    loja_slug: r.loja_slug,
    topic_key: r.topic_key,
    memory_type: r.memory_type,
    status: r.status,
    version: r.version,
    confidence: r.confidence,
    evidence_text: r.evidence_text,
    source_turn_ids: safeParseJson(r.source_turn_ids, []),
    created_at: r.created_at,
    confirmed_at: r.confirmed_at,
    expires_at: r.expires_at,
    superseded_by: r.superseded_by
  }));
}

/**
 * M10: Grava nota com verificacao de geracao ativa pos-reset.
 * Se o usuario resetou e a geracao ativa mudou, bloqueia/descarta gravacao defasada.
 */
export function saveVaultNoteWithGenerationCheck(
  db: Database.Database,
  phone: string,
  relativePath: string,
  frontmatter: VaultFrontmatter,
  bodyContent = '',
  vaultRoot = getVaultRoot()
): { saved: boolean; discardedDueToReset: boolean; note?: VaultNote } {
  const canonicalPhone = sanitizeCanonicalPhone(phone);
  const activeGen = getActiveGenerationLocal(db, canonicalPhone);
  if (activeGen > frontmatter.generation_id) {
    return { saved: false, discardedDueToReset: true };
  }
  const note = writeVaultNote(canonicalPhone, relativePath, frontmatter, bodyContent, vaultRoot);
  syncVaultWithIndex(db, canonicalPhone, vaultRoot);
  return { saved: true, discardedDueToReset: false, note };
}

/**
 * [E2-03]: Mascara automaticamente segredos, tokens JWT, senhas e credenciais.
 */
export function maskSensitiveData(text: string): string {
  if (!text || typeof text !== 'string') return '';
  return text
    // 1. JWT tokens: eyJ...
    .replace(/\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g, '[DADO_PROTEGIDO]')
    .replace(/\beyJ[A-Za-z0-9_\-\.]{25,}\b/g, '[DADO_PROTEGIDO]')
    // 2. Bearer tokens: Bearer ...
    .replace(/Bearer\s+[A-Za-z0-9_\-\.\=]{10,}/gi, 'Bearer [DADO_PROTEGIDO]')
    // 3. Key-Value pairs: token:, apikey:, password:, senha:, secret:
    .replace(/(?:apikey|api_key|token|secret|password|senha)\s*[:=]\s*['"]?[A-Za-z0-9_\-\.\=]{6,}['"]?/gi, (match) => {
      const sep = match.indexOf(':') !== -1 ? ':' : '=';
      const key = match.slice(0, match.indexOf(sep)).trim();
      return `${key}: [DADO_PROTEGIDO]`;
    });
}

export interface AppendDiaryOptions {
  turnId?: string;
  vaultRoot?: string;
  nowDate?: Date;
  generationId?: number;
  storesReferenced?: string[];
  scopeType?: 'loja' | 'rede' | 'perfil_global';
}

/**
 * [E2-01 / E2-02 / E2-03]: Grava continuamente cada turno de conversa no Obsidian Vault.
 * Caminho: vault/usuarios/<phone>/diario/YYYY-MM-DD.md
 */
export function appendConversationToDailyDiary(
  phone: string,
  userMessage: string,
  assistantReply: string,
  options: AppendDiaryOptions = {}
): void {
  try {
    const vaultRoot = options.vaultRoot || getVaultRoot();
    const baseUsersDir = path.resolve(vaultRoot, 'usuarios');
    if (!fs.existsSync(baseUsersDir)) {
      fs.mkdirSync(baseUsersDir, { recursive: true });
    }

    let canonicalPhone: string;
    try {
      canonicalPhone = sanitizeCanonicalPhone(phone);
    } catch {
      canonicalPhone = 'default';
    }

    const userVaultDir = getUserVaultDir(canonicalPhone, vaultRoot);
    const diarioDir = path.join(userVaultDir, 'diario');
    if (!fs.existsSync(diarioDir)) {
      fs.mkdirSync(diarioDir, { recursive: true });
    }

    const now = options.nowDate || new Date();
    // Fuso America/Sao_Paulo
    const dateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(now); // "YYYY-MM-DD"

    const [y, m, d] = dateStr.split('-');

    const timeStr = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(now); // "HH:mm:ss"

    const filePath = path.join(diarioDir, `${dateStr}.md`);

    const turnLabel = options.turnId ? `Turno #${options.turnId}` : `Turno #${now.getTime()}`;
    const cleanUser = maskSensitiveData(userMessage.trim().replace(/\n+/g, ' '));
    const cleanReply = assistantReply.trim().replace(/\n+/g, ' \n  ');

    const genId = options.generationId ?? 1;
    const storesList = options.storesReferenced || [];
    const scopeTag = options.scopeType ? ` [${options.scopeType.toUpperCase()}]` : '';

    if (!fs.existsSync(filePath)) {
      const headerLines = [
        '---',
        `date: "${dateStr}"`,
        `owner: "${canonicalPhone}"`,
        `generation_id: ${genId}`,
        'version: 1',
        `stores_referenced: ${JSON.stringify(storesList)}`,
        'type: "episodic_daily_diary"',
        `created_at: "${now.toISOString()}"`,
        '---',
        `# Di?rio de Bordo ? ${d}/${m}/${y} (Operador: ${canonicalPhone})`,
        '',
        `### [${timeStr}] ${turnLabel}${scopeTag}`,
        `- **Operador:** ${cleanUser}`,
        `- **Hydra:** ${cleanReply}`,
        ''
      ];
      fs.writeFileSync(filePath, headerLines.join('\n'), 'utf8');
    } else {
      const existingContent = fs.readFileSync(filePath, 'utf8');
      if (options.turnId && existingContent.includes(`Turno #${options.turnId}`)) {
        return;
      }

      let updatedContent = existingContent;
      if (storesList.length > 0) {
        const match = existingContent.match(/^stores_referenced:\s*(\[.*?\])/m);
        if (match) {
          try {
            const currentStores = JSON.parse(match[1]);
            const merged = Array.from(new Set([...currentStores, ...storesList]));
            updatedContent = existingContent.replace(match[0], `stores_referenced: ${JSON.stringify(merged)}`);
            if (updatedContent !== existingContent) {
              fs.writeFileSync(filePath, updatedContent, 'utf8');
            }
          } catch {}
        }
      }

      const entryLines = [
        '',
        `### [${timeStr}] ${turnLabel}${scopeTag}`,
        `- **Operador:** ${cleanUser}`,
        `- **Hydra:** ${cleanReply}`,
        ''
      ];
      fs.appendFileSync(filePath, entryLines.join('\n'), 'utf8');
    }
  } catch (err: any) {
    console.warn('[VaultManager] Falha ao registrar conversa no di?rio do Obsidian:', err?.message || err);
  }
}

/**
 * [E2-04]: L? o contexto do di?rio recente do usu?rio no Obsidian Vault.
 * Pagina??o contextual dos ?ltimos 2 dias, respeitando o teto de maxChars (default 2000)
 * e expurgando sess?es de rede quando o operador estiver como gerente de loja.
 */
export function getDailyDiaryContext(
  phone: string,
  vaultRoot = getVaultRoot(),
  maxChars = 2000,
  options?: {
    effectivePersona?: 'socio' | 'gerente';
    activeLojaSlug?: string | null;
    generationId?: number;
  }
): string {
  try {
    let canonicalPhone: string;
    try {
      canonicalPhone = sanitizeCanonicalPhone(phone);
    } catch {
      canonicalPhone = 'default';
    }

    const baseUsersDir = path.resolve(vaultRoot, 'usuarios');
    const userVaultDir = path.resolve(baseUsersDir, canonicalPhone);
    const diarioDir = path.join(userVaultDir, 'diario');
    if (!fs.existsSync(diarioDir)) return '';

    const files = fs.readdirSync(diarioDir).filter(f => f.endsWith('.md')).sort().reverse();
    if (files.length === 0) return '';

    // Pagina??o contextual dos ?ltimos 2 dias [E2-04]
    const recentFiles = files.slice(0, 2);
    let accumulated = '';

    for (const f of recentFiles) {
      const fullPath = path.join(diarioDir, f);
      const fileContent = fs.readFileSync(fullPath, 'utf8');

      // Se operador for gerente, expurga sess?es/turnos de rede [E2-04]
      let processedContent = fileContent;
      if (options?.effectivePersona === 'gerente') {
        const sections = fileContent.split(/(?=###\s+\[)/);
        const filteredSections = sections.filter(sec => {
          if (sec.startsWith('---') || sec.startsWith('# Di?rio') || sec.startsWith('# Diario')) return true;
          const secLower = sec.toLowerCase();
          if (sec.includes('[REDE]') || secLower.includes('escopo: rede') || (secLower.includes('vis?o de rede') || secLower.includes('visao de rede'))) {
            return false;
          }
          if (options.activeLojaSlug && secLower.includes('loja:')) {
            if (!secLower.includes(options.activeLojaSlug.toLowerCase())) {
              return false;
            }
          }
          return true;
        });
        processedContent = filteredSections.join('');
      }

      accumulated += `\n## Arquivo: ${f}\n${processedContent.trim()}\n`;
      if (accumulated.length >= maxChars) break;
    }

    if (!accumulated.trim()) return '';
    const header = '# MEM?RIA EPIS?DICA DO OBSIDIAN VAULT (DI?RIO DE CONVERSAS):';
    const total = `${header}\n${accumulated.trim()}`;
    return total.length > maxChars ? total.slice(0, maxChars).trim() : total;
  } catch {
    return '';
  }
}
