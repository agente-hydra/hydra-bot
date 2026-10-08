import type Database from 'better-sqlite3';

export interface StoreManagerRecord {
  loja_slug: string;
  loja_nome: string;
  gerente_nome: string;
  phone_canonical: string;
  instance_evolution: string;
  is_active: number;
}

export const OFFICIAL_STORE_MANAGERS_SEED: StoreManagerRecord[] = [
  {
    loja_slug: 'MPJorgeBeretta',
    loja_nome: 'Jorge Beretta',
    gerente_nome: 'Gerente Jorge Beretta',
    phone_canonical: '5511998874158',
    instance_evolution: 'Jorge Beretta',
    is_active: 1
  },
  {
    loja_slug: 'MPkennedy',
    loja_nome: 'Kennedy',
    gerente_nome: 'Gerente Kennedy',
    phone_canonical: '5511984926600',
    instance_evolution: 'Kennedy',
    is_active: 1
  },
  {
    loja_slug: 'MPdompedro1',
    loja_nome: 'Dom Pedro I',
    gerente_nome: 'Gerente Dom Pedro',
    phone_canonical: '5511963717410',
    instance_evolution: 'Dom Pedro',
    is_active: 1
  },
  {
    loja_slug: 'MPrudge',
    loja_nome: 'Rudge Ramos',
    gerente_nome: 'Gerente Rudge',
    phone_canonical: '5511947439443',
    instance_evolution: 'Rudge',
    is_active: 1
  },
  {
    loja_slug: 'MPJabaquara',
    loja_nome: 'Jabaquara',
    gerente_nome: 'Gerente Jabaquara',
    phone_canonical: '5511933733131',
    instance_evolution: 'Jabaquara',
    is_active: 1
  },
  {
    loja_slug: 'MPpiraporinha',
    loja_nome: 'Piraporinha',
    gerente_nome: 'Gerente Piraporinha',
    phone_canonical: '5511983012850',
    instance_evolution: 'Piraporinha',
    is_active: 1
  },
  {
    loja_slug: 'MPplanalto',
    loja_nome: 'Planalto',
    gerente_nome: 'Gerente Planalto',
    phone_canonical: '5511984325302',
    instance_evolution: 'Planalto',
    is_active: 1
  },
  {
    loja_slug: 'ReiDoOleoMaua',
    loja_nome: 'Rei do Óleo Mauá',
    gerente_nome: 'Gerente Mauá',
    phone_canonical: '5511984324928',
    instance_evolution: 'Maua',
    is_active: 1
  },
  {
    loja_slug: 'MPSantoAndre',
    loja_nome: 'Santo André',
    gerente_nome: 'Gerente Santo André',
    phone_canonical: '5511917698769',
    instance_evolution: 'Carijós',
    is_active: 1
  },
  {
    loja_slug: 'ReiDoModulo',
    loja_nome: 'Rei do Módulo',
    gerente_nome: 'Gerente Rei do Módulo',
    phone_canonical: '5511917698769',
    instance_evolution: 'REI DO MODULO',
    is_active: 1
  }
];

export const TEST_OVERRIDE_PHONE = '5511996242812';

/**
 * Inicializa schema das tabelas de gerentes e notificacoes MCP
 */
export function initManagerRegistrySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hydra_store_managers (
      loja_slug TEXT PRIMARY KEY,
      loja_nome TEXT NOT NULL,
      gerente_nome TEXT NOT NULL,
      phone_canonical TEXT NOT NULL,
      instance_evolution TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS hydra_manager_notifications (
      id TEXT PRIMARY KEY,
      id_externo TEXT,
      tipo TEXT NOT NULL,
      loja_slug TEXT NOT NULL,
      gerente_phone TEXT NOT NULL,
      cliente_nome TEXT NOT NULL,
      cliente_phone TEXT NOT NULL,
      data_agendamento TEXT NOT NULL,
      horario_agendamento TEXT NOT NULL,
      instancia_emissora TEXT NOT NULL DEFAULT 'atendimento',
      payload_json TEXT NOT NULL,
      mensagem_texto TEXT NOT NULL,
      status TEXT NOT NULL,
      evolution_message_id TEXT,
      status_http INTEGER,
      duracao_ms INTEGER,
      erro_detalhe TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_mgr_notif_externo ON hydra_manager_notifications(id_externo, tipo);
    CREATE INDEX IF NOT EXISTS idx_mgr_notif_loja ON hydra_manager_notifications(loja_slug, created_at);
  `);

  // Seed idempotente preservando alteracoes existentes
  const insertStmt = db.prepare(`
    INSERT INTO hydra_store_managers (loja_slug, loja_nome, gerente_nome, phone_canonical, instance_evolution, is_active)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(loja_slug) DO UPDATE SET
      loja_nome = excluded.loja_nome,
      instance_evolution = excluded.instance_evolution
  `);

  for (const m of OFFICIAL_STORE_MANAGERS_SEED) {
    insertStmt.run(m.loja_slug, m.loja_nome, m.gerente_nome, m.phone_canonical, m.instance_evolution, m.is_active);
  }
}

/**
 * Retorna todos os gerentes cadastrados
 */
export function getAllStoreManagers(db: Database.Database): StoreManagerRecord[] {
  return db.prepare(`SELECT * FROM hydra_store_managers ORDER BY loja_nome ASC`).all() as StoreManagerRecord[];
}

/**
 * Resolucao inteligente/fuzzy de loja e gerente
 */
export function resolveStoreAndManager(db: Database.Database, rawInput: string): {
  success: boolean;
  manager?: StoreManagerRecord;
  error?: string;
  availableStores?: string[];
} {
  if (!rawInput || typeof rawInput !== 'string') {
    return {
      success: false,
      error: 'Identificador de loja não informado.',
      availableStores: OFFICIAL_STORE_MANAGERS_SEED.map(s => s.loja_nome)
    };
  }

  const clean = rawInput.trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const managers = getAllStoreManagers(db);

  // 1. Busca exata por loja_slug
  let match = managers.find(m => m.loja_slug.toLowerCase() === clean);

  // 2. Busca exata por loja_nome
  if (!match) {
    match = managers.find(m => m.loja_nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') === clean);
  }

  // 3. Mapeamento por apelidos/aliases conhecidos
  if (!match) {
    const aliasMap: Record<string, string> = {
      'jorge': 'MPJorgeBeretta',
      'beretta': 'MPJorgeBeretta',
      'jorge beretta': 'MPJorgeBeretta',
      'kennedy': 'MPkennedy',
      'robert kennedy': 'MPkennedy',
      'dom pedro': 'MPdompedro1',
      'dompedro': 'MPdompedro1',
      'd. pedro': 'MPdompedro1',
      'rudge': 'MPrudge',
      'rudge ramos': 'MPrudge',
      'jabaquara': 'MPJabaquara',
      'piraporinha': 'MPpiraporinha',
      'planalto': 'MPplanalto',
      'maua': 'ReiDoOleoMaua',
      'rei do oleo': 'ReiDoOleoMaua',
      'santo andre': 'MPSantoAndre',
      'carijos': 'MPSantoAndre',
      'modulo': 'ReiDoModulo',
      'rei do modulo': 'ReiDoModulo'
    };

    const slugFound = aliasMap[clean];
    if (slugFound) {
      match = managers.find(m => m.loja_slug === slugFound);
    }
  }

  // 4. Substring inclusiva se tiver tamanho suficiente
  if (!match && clean.length >= 4) {
    match = managers.find(m => {
      const nameNorm = m.loja_nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const slugNorm = m.loja_slug.toLowerCase();
      return nameNorm.includes(clean) || clean.includes(nameNorm) || slugNorm.includes(clean);
    });
  }

  if (match) {
    return { success: true, manager: match };
  }

  return {
    success: false,
    error: `Loja '${rawInput}' não reconhecida.`,
    availableStores: managers.map(m => m.loja_nome)
  };
}

/**
 * Trava de seguranca: retorna o telefone efetivo para envio
 * Se MCP_FORCE_RECIPIENT estiver setado ou teste ativo, desvia para 5511996242812
 */
export function getEffectiveRecipientPhone(managerPhone: string): {
  phone: string;
  isTestOverride: boolean;
} {
  if (!process.env.MCP_FORCE_RECIPIENT && typeof (process as any).loadEnvFile === 'function') {
    try { (process as any).loadEnvFile('/home/operacional/hydra/.env'); } catch {}
  }
  const force = process.env.MCP_FORCE_RECIPIENT || process.env.MCP_TEST_PHONE;
  if (force && force.trim().length > 0) {
    return { phone: force.trim().replace(/\D/g, ''), isTestOverride: true };
  }

  // Se estiver em modo de teste explicito
  if (process.env.NODE_ENV === 'test' || process.env.MCP_TEST_MODE === 'true') {
    return { phone: TEST_OVERRIDE_PHONE, isTestOverride: true };
  }

  return { phone: managerPhone.replace(/\D/g, ''), isTestOverride: false };
}

/**
 * Checagem de idempotencia para evitar notificacoes duplicadas em 24h
 */
export function checkNotificationIdempotency(
  db: Database.Database,
  idExterno?: string,
  tipo?: string
): { isDuplicate: boolean; existingId?: string } {
  if (!idExterno || !idExterno.trim()) {
    return { isDuplicate: false };
  }

  const row = db.prepare(`
    SELECT id, status, created_at FROM hydra_manager_notifications
    WHERE id_externo = ? AND tipo = ? AND status IN ('SENT', 'DUPLICATE')
      AND datetime(created_at) >= datetime('now', '-24 hours')
    LIMIT 1
  `).get(idExterno.trim(), tipo || '') as { id: string; status: string } | undefined;

  if (row) {
    return { isDuplicate: true, existingId: row.id };
  }

  return { isDuplicate: false };
}

/**
 * Registra o disparo da notificacao no SQLite
 */
export function recordManagerNotification(
  db: Database.Database,
  record: {
    id: string;
    id_externo?: string;
    tipo: 'LEAD_SCHEDULED' | 'LEAD_CANCELLED';
    loja_slug: string;
    gerente_phone: string;
    cliente_nome: string;
    cliente_phone: string;
    data_agendamento: string;
    horario_agendamento: string;
    instancia_emissora?: string;
    payload_json: string;
    mensagem_texto: string;
    status: 'PENDING' | 'SENT' | 'FAILED' | 'DUPLICATE';
    evolution_message_id?: string;
    status_http?: number;
    duracao_ms?: number;
    erro_detalhe?: string;
  }
): void {
  db.prepare(`
    INSERT INTO hydra_manager_notifications (
      id, id_externo, tipo, loja_slug, gerente_phone, cliente_nome, cliente_phone,
      data_agendamento, horario_agendamento, instancia_emissora, payload_json,
      mensagem_texto, status, evolution_message_id, status_http, duracao_ms, erro_detalhe
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
  `).run(
    record.id,
    record.id_externo || null,
    record.tipo,
    record.loja_slug,
    record.gerente_phone,
    record.cliente_nome,
    record.cliente_phone,
    record.data_agendamento,
    record.horario_agendamento,
    record.instancia_emissora || 'atendimento',
    record.payload_json,
    record.mensagem_texto,
    record.status,
    record.evolution_message_id || null,
    record.status_http || null,
    record.duracao_ms || null,
    record.erro_detalhe || null
  );
}