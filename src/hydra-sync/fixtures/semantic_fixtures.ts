/**
 * src/hydra-sync/fixtures/semantic_fixtures.ts
 * 
 * Fixtures Controladas de Teste para a Camada Semântica do Hydra.
 * Implementa os cenários controlados:
 * - T29: Detecção de explosão cartesiana 1:N e proibição terminante de SUM(DISTINCT).
 * - T30: Proibição de soma ingênua de snapshots horários acumulados de metas.
 * 
 * Propriedade: Executor 2 (Dados e Evidências)
 * Spec: hydra-semantic-layer
 */

import Database from 'better-sqlite3';
import { ensureEvidenceSchema, recordStoreTableEvidence } from '../evidence_repository.js';

export interface T29OSData {
  os_id: string;
  loja_slug: string;
  total_os: number;
  dias_no_patio: number;
  is_aberta: number;
  pecas: { id: string; descricao: string; quantidade: number; valor_unitario: number; valor_total: number }[];
  pagamentos: { id: string; valor_parcela: number; forma_pagamento: string }[];
}

export interface T30SnapshotData {
  id?: number;
  data_referencia: string;
  posicao_hora: string;
  loja_slug: string;
  faturamento_mes: number;
  volume_os: number;
  ticket_medio: number;
  meta_mes: number;
  percentual_meta: number;
}

/**
 * Dados de referência congelados do cenário T29:
 * - OS 101: R$ 1.000, 2 peças, 2 pagamentos (R$ 300 e R$ 200).
 * - OS 102: R$ 1.000, 1 peça, 1 pagamento (R$ 500).
 * Totais verdadeiros:
 * - Faturamento Total de OS: exatamente R$ 2.000,00
 * - Total Recebido: exatamente R$ 1.000,00
 */
export const T29_FIXTURE_DATA: T29OSData[] = [
  {
    os_id: '101',
    loja_slug: 'santo_andre',
    total_os: 1000.00,
    dias_no_patio: 6,
    is_aberta: 1,
    pecas: [
      { id: 'p101_1', descricao: 'Pastilha Freio', quantidade: 1, valor_unitario: 600.00, valor_total: 600.00 },
      { id: 'p101_2', descricao: 'Disco Freio', quantidade: 1, valor_unitario: 400.00, valor_total: 400.00 }
    ],
    pagamentos: [
      { id: 'pg101_1', valor_parcela: 300.00, forma_pagamento: 'PIX' },
      { id: 'pg101_2', valor_parcela: 200.00, forma_pagamento: 'CARTAO_CREDITO' }
    ]
  },
  {
    os_id: '102',
    loja_slug: 'santo_andre',
    total_os: 1000.00,
    dias_no_patio: 3,
    is_aberta: 1,
    pecas: [
      { id: 'p102_1', descricao: 'Amortecedor Dianteiro', quantidade: 1, valor_unitario: 1000.00, valor_total: 1000.00 }
    ],
    pagamentos: [
      { id: 'pg102_1', valor_parcela: 500.00, forma_pagamento: 'DINHEIRO' }
    ]
  }
];

/**
 * Dados de referência congelados do cenário T30:
 * Múltiplos snapshots ao longo do mesmo dia (2026-10-02) para a loja santo_andre.
 * Cada snapshot registra a foto do faturamento acumulado no mês até aquela hora.
 * Faturamento real atingido no dia: R$ 150.000,00 (posição das 18h).
 */
export const T30_FIXTURE_DATA: T30SnapshotData[] = [
  {
    data_referencia: '2026-10-02',
    posicao_hora: '10:00:00',
    loja_slug: 'santo_andre',
    faturamento_mes: 120000.00,
    volume_os: 80,
    ticket_medio: 1500.00,
    meta_mes: 200000.00,
    percentual_meta: 60.0
  },
  {
    data_referencia: '2026-10-02',
    posicao_hora: '14:00:00',
    loja_slug: 'santo_andre',
    faturamento_mes: 135000.00,
    volume_os: 90,
    ticket_medio: 1500.00,
    meta_mes: 200000.00,
    percentual_meta: 67.5
  },
  {
    data_referencia: '2026-10-02',
    posicao_hora: '18:00:00',
    loja_slug: 'santo_andre',
    faturamento_mes: 150000.00,
    volume_os: 100,
    ticket_medio: 1500.00,
    meta_mes: 200000.00,
    percentual_meta: 75.0
  }
];

/**
 * Cria um banco de dados SQLite em memória com schemas e tabelas para testes semânticos.
 */
export function setupSemanticTestDb(): Database.Database {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE IF NOT EXISTS lojas (
      slug TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      ativa INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS ordens_servico (
      os_id TEXT NOT NULL,
      loja_slug TEXT NOT NULL,
      tipo TEXT DEFAULT 'OS',
      status_grid TEXT DEFAULT 'Aberta',
      is_aberta INTEGER NOT NULL DEFAULT 1,
      data_inicio TEXT,
      data_fim TEXT,
      dias_no_patio INTEGER DEFAULT 0,
      veiculo TEXT,
      placa TEXT,
      cliente_nome TEXT,
      responsavel TEXT,
      total_os REAL DEFAULT 0,
      valor_pago REAL DEFAULT 0,
      valor_restante REAL DEFAULT 0,
      tem_nf INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (os_id, loja_slug)
    );

    CREATE TABLE IF NOT EXISTS itens_pecas (
      id TEXT PRIMARY KEY,
      os_id TEXT NOT NULL,
      loja_slug TEXT NOT NULL,
      descricao TEXT NOT NULL,
      quantidade REAL NOT NULL,
      valor_unitario REAL NOT NULL,
      valor_total REAL NOT NULL,
      custo_peca REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS pagamentos_os (
      id TEXT PRIMARY KEY,
      os_id TEXT NOT NULL,
      loja_slug TEXT NOT NULL,
      valor_parcela REAL NOT NULL,
      forma_pagamento TEXT,
      data_pagamento TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS metas_diarias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data_referencia TEXT NOT NULL,
      posicao_hora TEXT NOT NULL,
      loja_slug TEXT NOT NULL,
      faturamento_mes REAL NOT NULL,
      volume_os INTEGER NOT NULL,
      ticket_medio REAL NOT NULL,
      meta_mes REAL,
      previsao_mes REAL,
      percentual_meta REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS faturamento_areas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loja_slug TEXT NOT NULL,
      data_inicio TEXT NOT NULL,
      data_fim TEXT NOT NULL,
      area TEXT NOT NULL,
      faturamento REAL NOT NULL,
      faturamento_percentual REAL DEFAULT 0,
      desconto REAL DEFAULT 0,
      custo REAL NOT NULL,
      cmv_percentual REAL NOT NULL,
      lucro_bruto REAL NOT NULL,
      lucro_bruto_percentual REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  ensureEvidenceSchema(db);

  // Inserção da loja santo_andre
  db.prepare(`
    INSERT INTO lojas (slug, nome, ativa) VALUES ('santo_andre', 'Mecânica Santo André', 1)
  `).run();

  // Inserção dos dados T29
  const insertOS = db.prepare(`
    INSERT INTO ordens_servico (
      os_id, loja_slug, total_os, dias_no_patio, is_aberta, data_inicio
    ) VALUES (?, ?, ?, ?, ?, '2026-10-01 08:00:00')
  `);

  const insertPeca = db.prepare(`
    INSERT INTO itens_pecas (
      id, os_id, loja_slug, descricao, quantidade, valor_unitario, valor_total
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPagamento = db.prepare(`
    INSERT INTO pagamentos_os (
      id, os_id, loja_slug, valor_parcela, forma_pagamento, data_pagamento
    ) VALUES (?, ?, ?, ?, ?, '2026-10-01 10:00:00')
  `);

  for (const os of T29_FIXTURE_DATA) {
    insertOS.run(os.os_id, os.loja_slug, os.total_os, os.dias_no_patio, os.is_aberta);

    for (const p of os.pecas) {
      insertPeca.run(p.id, os.os_id, os.loja_slug, p.descricao, p.quantidade, p.valor_unitario, p.valor_total);
    }

    for (const pg of os.pagamentos) {
      insertPagamento.run(pg.id, os.os_id, os.loja_slug, pg.valor_parcela, pg.forma_pagamento);
    }
  }

  // Inserção dos dados T30
  const insertMeta = db.prepare(`
    INSERT INTO metas_diarias (
      data_referencia, posicao_hora, loja_slug, faturamento_mes, volume_os, 
      ticket_medio, meta_mes, percentual_meta
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const m of T30_FIXTURE_DATA) {
    insertMeta.run(
      m.data_referencia,
      m.posicao_hora,
      m.loja_slug,
      m.faturamento_mes,
      m.volume_os,
      m.ticket_medio,
      m.meta_mes,
      m.percentual_meta
    );
  }

  // Registra evidências de teste
  recordStoreTableEvidence({
    lojaSlug: 'santo_andre',
    tabela: 'ordens_servico',
    coberturaStatus: 'COMPLETA',
    dataColetaRecente: '2026-10-02 18:05:00',
    registrosContabilizados: 2
  }, db);

  recordStoreTableEvidence({
    lojaSlug: 'santo_andre',
    tabela: 'itens_pecas',
    coberturaStatus: 'COMPLETA',
    dataColetaRecente: '2026-10-02 18:05:00',
    registrosContabilizados: 3
  }, db);

  recordStoreTableEvidence({
    lojaSlug: 'santo_andre',
    tabela: 'pagamentos_os',
    coberturaStatus: 'COMPLETA',
    dataColetaRecente: '2026-10-02 18:05:00',
    registrosContabilizados: 3
  }, db);

  recordStoreTableEvidence({
    lojaSlug: 'santo_andre',
    tabela: 'metas_diarias',
    coberturaStatus: 'COMPLETA',
    dataColetaRecente: '2026-10-02 18:05:00',
    registrosContabilizados: 3
  }, db);

  return db;
}

/**
 * Executa o cálculo ingênuo (Naive Join) na OS 101:
 * Junta 1 OS com 2 peças e 2 pagamentos -> 4 linhas multiplicadas.
 * A soma do total_os resulta em R$ 4.000,00 (ERRO CARTESIANO 1:N).
 */
export function runT29NaiveJoinOS101(db: Database.Database): { rowCount: number; naiveTotalOS: number } {
  const result = db.prepare(`
    SELECT 
      COUNT(*) as rowCount,
      SUM(os.total_os) as naiveTotalOS
    FROM ordens_servico os
    LEFT JOIN itens_pecas p ON os.os_id = p.os_id
    LEFT JOIN pagamentos_os pg ON os.os_id = pg.os_id
    WHERE os.os_id = '101'
  `).get() as { rowCount: number; naiveTotalOS: number };

  return {
    rowCount: result.rowCount,
    naiveTotalOS: result.naiveTotalOS
  };
}

/**
 * Executa o cálculo ingênuo (Naive Join) na população total T29 (OS 101 e OS 102):
 * OS 101 gera 4 linhas (4 x 1000 = 4000)
 * OS 102 gera 1 linha  (1 x 1000 = 1000)
 * Total ingênuo gerado: R$ 5.000,00 (ERRO GRAVE, o faturamento real é R$ 2.000,00).
 */
export function runT29NaiveJoinGlobal(db: Database.Database): { rowCount: number; naiveTotalOS: number } {
  const result = db.prepare(`
    SELECT 
      COUNT(*) as rowCount,
      SUM(os.total_os) as naiveTotalOS
    FROM ordens_servico os
    LEFT JOIN itens_pecas p ON os.os_id = p.os_id
    LEFT JOIN pagamentos_os pg ON os.os_id = pg.os_id
  `).get() as { rowCount: number; naiveTotalOS: number };

  return {
    rowCount: result.rowCount,
    naiveTotalOS: result.naiveTotalOS
  };
}

/**
 * Executa a tentativa ingênua com SUM(DISTINCT total_os):
 * Como ambas as OSs têm total_os = 1000.00, SUM(DISTINCT) deduplica por valor
 * e resulta em exatamente R$ 1.000,00 (ERRO GRAVÍSSIMO, apagou metade do faturamento real).
 */
export function runT29SumDistinct(db: Database.Database): { sumDistinctTotalOS: number } {
  const result = db.prepare(`
    SELECT 
      SUM(DISTINCT total_os) as sumDistinctTotalOS
    FROM ordens_servico
  `).get() as { sumDistinctTotalOS: number };

  return {
    sumDistinctTotalOS: result.sumDistinctTotalOS
  };
}

/**
 * Executa o padrão compilado seguro da Camada Semântica:
 * Utiliza CTE pré-agregada ou subconsulta correlacionada escalar.
 * Resultado esperado: exatamente R$ 2.000,00 de faturamento e R$ 1.000,00 de recebido.
 */
export function runT29SafeCompilerPattern(db: Database.Database): { 
  totalFaturamento: number; 
  totalRecebido: number;
  osCount: number;
} {
  const result = db.prepare(`
    WITH pagamentos_agregados AS (
      SELECT os_id, SUM(valor_parcela) AS total_recebido_os
      FROM pagamentos_os
      GROUP BY os_id
    )
    SELECT 
      COUNT(os.os_id) AS osCount,
      SUM(os.total_os) AS totalFaturamento,
      SUM(COALESCE(p.total_recebido_os, 0)) AS totalRecebido
    FROM ordens_servico os
    LEFT JOIN pagamentos_agregados p ON p.os_id = os.os_id
  `).get() as { osCount: number; totalFaturamento: number; totalRecebido: number };

  return {
    osCount: result.osCount,
    totalFaturamento: result.totalFaturamento,
    totalRecebido: result.totalRecebido
  };
}

/**
 * Executa o cálculo ingênuo de metas somando todos os snapshots horários (T30):
 * Soma 120.000 + 135.000 + 150.000 = R$ 405.000,00 (ERRO: triplica o faturamento).
 */
export function runT30NaiveSumSnapshots(db: Database.Database): { naiveSumFaturamento: number } {
  const result = db.prepare(`
    SELECT SUM(faturamento_mes) AS naiveSumFaturamento
    FROM metas_diarias
    WHERE loja_slug = 'santo_andre' AND data_referencia = '2026-10-02'
  `).get() as { naiveSumFaturamento: number };

  return {
    naiveSumFaturamento: result.naiveSumFaturamento
  };
}

/**
 * Executa a seleção do snapshot mais recente (LATEST_SNAPSHOT) para T30:
 * Retorna exatamente a foto mais recente do dia = R$ 150.000,00.
 */
export function runT30LatestSnapshot(db: Database.Database): { 
  faturamentoMes: number; 
  posicaoHora: string;
  percentualMeta: number;
} {
  const result = db.prepare(`
    SELECT faturamento_mes, posicao_hora, percentual_meta
    FROM metas_diarias
    WHERE loja_slug = 'santo_andre' AND data_referencia = '2026-10-02'
    ORDER BY posicao_hora DESC
    LIMIT 1
  `).get() as { faturamento_mes: number; posicao_hora: string; percentual_meta: number };

  return {
    faturamentoMes: result.faturamento_mes,
    posicaoHora: result.posicao_hora,
    percentualMeta: result.percentual_meta
  };
}
