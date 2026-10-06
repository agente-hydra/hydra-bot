/**
 * Glossário Semântico Operacional do Hydra (v1.1.0)
 * 
 * Centraliza e resolve o mapeamento semântico entre a linguagem natural do operador
 * e o modelo de dados formal da Mecânica Popular.
 * 
 * Categorias:
 * - 'area': Áreas oficiais de faturamento_areas ('OLEO', 'FILTRO', 'MECANICA', etc.)
 * - 'metrica': Indicadores de negócio ('cmv', 'faturamento', 'lucro_bruto', etc.)
 * - 'loja': Slugs canônicos e apelidos das 10 lojas elegíveis
 * - 'sinonimo': Termos operacionais equivalentes ('os', 'sinal zero', etc.)
 * - 'regra': Regras de negócio determinísticas (ponderação de CMV, exclusão de Master)
 */

import type Database from 'better-sqlite3';

export type GlossaryCategory = 'metrica' | 'area' | 'loja' | 'sinonimo' | 'regra';

export const OFFICIAL_AREAS = [
  'OLEO',
  'FILTRO',
  'MECANICA',
  'TERCEIRIZADO',
  'ACESSORIO / DIVERSOS',
  'SERVIÇO PRESTADO'
] as const;

export type OfficialArea = typeof OFFICIAL_AREAS[number];

export interface GlossaryEntry {
  id?: number;
  categoria: GlossaryCategory;
  termo: string;
  termo_canonico: string;
  descricao?: string;
  metadata?: string;
}

export interface SemanticSearchResult {
  categoria: GlossaryCategory;
  termo: string;
  termoCanonico: string;
  descricao?: string;
  score: number;
}

/**
 * Normaliza string removendo acentos e convertendo para minúsculas
 */
export function normalizeSemanticTerm(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Mapeamento estático e rápido em memória (Fallback determinístico)
 */
export const IN_MEMORY_AREA_MAP: Record<string, OfficialArea> = {
  // OLEO
  'oleo': 'OLEO',
  'oleos': 'OLEO',
  'troca de oleo': 'OLEO',
  'lubrificante': 'OLEO',
  'lubrificantes': 'OLEO',
  'oleo motor': 'OLEO',
  'oleo de motor': 'OLEO',
  'oleo cambio': 'OLEO',
  'oleo de cambio': 'OLEO',
  'oleo de transmissao': 'OLEO',
  'fluido de freio': 'OLEO',
  'fluido': 'OLEO',
  'fluidos': 'OLEO',

  // FILTRO
  'filtro': 'FILTRO',
  'filtros': 'FILTRO',
  'filtro de oleo': 'FILTRO',
  'filtro de ar': 'FILTRO',
  'filtro de cabine': 'FILTRO',
  'filtro de combustivel': 'FILTRO',
  'troca de filtro': 'FILTRO',
  'troca de filtros': 'FILTRO',

  // MECANICA
  'mecanica': 'MECANICA',
  'mecanica geral': 'MECANICA',
  'pecas': 'MECANICA',
  'suspensao': 'MECANICA',
  'freio': 'MECANICA',
  'freios': 'MECANICA',
  'motor': 'MECANICA',
  'amortecedor': 'MECANICA',
  'embreagem': 'MECANICA',

  // TERCEIRIZADO
  'terceirizado': 'TERCEIRIZADO',
  'terceirizados': 'TERCEIRIZADO',
  'servico terceirizado': 'TERCEIRIZADO',
  'servicos terceirizados': 'TERCEIRIZADO',
  'retifica': 'TERCEIRIZADO',
  'guincho': 'TERCEIRIZADO',
  'torno': 'TERCEIRIZADO',

  // ACESSORIO / DIVERSOS
  'acessorio': 'ACESSORIO / DIVERSOS',
  'acessorios': 'ACESSORIO / DIVERSOS',
  'diversos': 'ACESSORIO / DIVERSOS',
  'acessorio / diversos': 'ACESSORIO / DIVERSOS',
  'acessorios / diversos': 'ACESSORIO / DIVERSOS',
  'acessorios e diversos': 'ACESSORIO / DIVERSOS',
  'palheta': 'ACESSORIO / DIVERSOS',
  'lampada': 'ACESSORIO / DIVERSOS',
  'aditivo': 'ACESSORIO / DIVERSOS',

  // SERVIÇO PRESTADO
  'servico prestado': 'SERVIÇO PRESTADO',
  'servicos prestados': 'SERVIÇO PRESTADO',
  'mao de obra': 'SERVIÇO PRESTADO',
  'mao-de-obra': 'SERVIÇO PRESTADO',
  'servico': 'SERVIÇO PRESTADO',
  'servicos': 'SERVIÇO PRESTADO',
  'mo': 'SERVIÇO PRESTADO',
  'alinhamento': 'SERVIÇO PRESTADO',
  'balanceamento': 'SERVIÇO PRESTADO'
};

/**
 * Vocabulário inicial para seed no SQLite
 */
export const SEED_GLOSSARY: Array<Omit<GlossaryEntry, 'id'>> = [
  // Áreas Oficiais
  { categoria: 'area', termo: 'oleo', termo_canonico: 'OLEO', descricao: 'Óleo e lubrificantes' },
  { categoria: 'area', termo: 'óleo', termo_canonico: 'OLEO', descricao: 'Óleo e lubrificantes' },
  { categoria: 'area', termo: 'oleos', termo_canonico: 'OLEO', descricao: 'Óleo e lubrificantes' },
  { categoria: 'area', termo: 'óleos', termo_canonico: 'OLEO', descricao: 'Óleo e lubrificantes' },
  { categoria: 'area', termo: 'troca de oleo', termo_canonico: 'OLEO', descricao: 'Serviço e produto de troca de óleo' },
  { categoria: 'area', termo: 'troca de óleo', termo_canonico: 'OLEO', descricao: 'Serviço e produto de troca de óleo' },
  { categoria: 'area', termo: 'lubrificante', termo_canonico: 'OLEO', descricao: 'Lubrificantes automotivos' },
  { categoria: 'area', termo: 'lubrificantes', termo_canonico: 'OLEO', descricao: 'Lubrificantes automotivos' },
  { categoria: 'area', termo: 'oleo motor', termo_canonico: 'OLEO', descricao: 'Óleo de motor' },
  { categoria: 'area', termo: 'oleo de motor', termo_canonico: 'OLEO', descricao: 'Óleo de motor' },
  { categoria: 'area', termo: 'fluido', termo_canonico: 'OLEO', descricao: 'Fluidos e óleos' },

  { categoria: 'area', termo: 'filtro', termo_canonico: 'FILTRO', descricao: 'Filtros em geral' },
  { categoria: 'area', termo: 'filtros', termo_canonico: 'FILTRO', descricao: 'Filtros em geral' },
  { categoria: 'area', termo: 'filtro de oleo', termo_canonico: 'FILTRO', descricao: 'Filtro de óleo' },
  { categoria: 'area', termo: 'filtro de ar', termo_canonico: 'FILTRO', descricao: 'Filtro de ar' },

  { categoria: 'area', termo: 'mecanica', termo_canonico: 'MECANICA', descricao: 'Mecânica geral' },
  { categoria: 'area', termo: 'mecânica', termo_canonico: 'MECANICA', descricao: 'Mecânica geral' },
  { categoria: 'area', termo: 'mecanica geral', termo_canonico: 'MECANICA', descricao: 'Mecânica geral' },
  { categoria: 'area', termo: 'pecas', termo_canonico: 'MECANICA', descricao: 'Peças mecânicas' },
  { categoria: 'area', termo: 'peças', termo_canonico: 'MECANICA', descricao: 'Peças mecânicas' },

  { categoria: 'area', termo: 'terceirizado', termo_canonico: 'TERCEIRIZADO', descricao: 'Serviços terceirizados' },
  { categoria: 'area', termo: 'retifica', termo_canonico: 'TERCEIRIZADO', descricao: 'Retífica terceirizada' },

  { categoria: 'area', termo: 'acessorio', termo_canonico: 'ACESSORIO / DIVERSOS', descricao: 'Acessórios e diversos' },
  { categoria: 'area', termo: 'acessorios', termo_canonico: 'ACESSORIO / DIVERSOS', descricao: 'Acessórios e diversos' },
  { categoria: 'area', termo: 'diversos', termo_canonico: 'ACESSORIO / DIVERSOS', descricao: 'Acessórios e diversos' },
  { categoria: 'area', termo: 'acessorio / diversos', termo_canonico: 'ACESSORIO / DIVERSOS', descricao: 'Acessórios e diversos' },

  { categoria: 'area', termo: 'servico prestado', termo_canonico: 'SERVIÇO PRESTADO', descricao: 'Serviços e mão de obra' },
  { categoria: 'area', termo: 'serviço prestado', termo_canonico: 'SERVIÇO PRESTADO', descricao: 'Serviços e mão de obra' },
  { categoria: 'area', termo: 'mao de obra', termo_canonico: 'SERVIÇO PRESTADO', descricao: 'Mão de obra da oficina' },
  { categoria: 'area', termo: 'mão de obra', termo_canonico: 'SERVIÇO PRESTADO', descricao: 'Mão de obra da oficina' },

  // Métricas
  { categoria: 'metrica', termo: 'cmv', termo_canonico: 'cmv', descricao: 'Custo de Mercadoria Vendida percentual' },
  { categoria: 'metrica', termo: 'custo de mercadoria', termo_canonico: 'cmv', descricao: 'Custo de Mercadoria Vendida' },
  { categoria: 'metrica', termo: 'custo de mercadorias', termo_canonico: 'cmv', descricao: 'Custo de Mercadoria Vendida' },
  { categoria: 'metrica', termo: 'margem', termo_canonico: 'lucro_bruto_percentual', descricao: 'Margem bruta percentual' },
  { categoria: 'metrica', termo: 'faturamento', termo_canonico: 'faturamento', descricao: 'Faturamento bruto da operação' },
  { categoria: 'metrica', termo: 'lucro bruto', termo_canonico: 'lucro_bruto', descricao: 'Lucro bruto em reais' },
  { categoria: 'metrica', termo: 'atingimento', termo_canonico: 'percentual_atingimento', descricao: 'Percentual de atingimento da meta' },
  { categoria: 'metrica', termo: 'quanto falta', termo_canonico: 'falta_para_meta', descricao: 'Valor em reais faltante para bater a meta' },

  // Lojas canônicas
  { categoria: 'loja', termo: 'jorge beretta', termo_canonico: 'MPJorgeBeretta', descricao: 'Unidade Jorge Beretta' },
  { categoria: 'loja', termo: 'santo andre', termo_canonico: 'MPSantoAndre', descricao: 'Unidade Santo André' },
  { categoria: 'loja', termo: 'dom pedro', termo_canonico: 'MPdompedro1', descricao: 'Unidade Dom Pedro I' },
  { categoria: 'loja', termo: 'jabaquara', termo_canonico: 'MPJabaquara', descricao: 'Unidade Jabaquara' },
  { categoria: 'loja', termo: 'kennedy', termo_canonico: 'MPkennedy', descricao: 'Unidade Kennedy' },
  { categoria: 'loja', termo: 'piraporinha', termo_canonico: 'MPpiraporinha', descricao: 'Unidade Piraporinha' },
  { categoria: 'loja', termo: 'planalto', termo_canonico: 'MPplanalto', descricao: 'Unidade Planalto' },
  { categoria: 'loja', termo: 'rudge ramos', termo_canonico: 'MPrudge', descricao: 'Unidade Rudge Ramos' },
  { categoria: 'loja', termo: 'rei do modulo', termo_canonico: 'ReiDoModulo', descricao: 'Unidade Rei do Módulo' },
  { categoria: 'loja', termo: 'rei do oleo maua', termo_canonico: 'ReiDoOleoMaua', descricao: 'Unidade Rei do Óleo Mauá' },

  // Sinônimos Operacionais
  { categoria: 'sinonimo', termo: 'os', termo_canonico: 'list_os', descricao: 'Ordens de serviço' },
  { categoria: 'sinonimo', termo: 'ordem de servico', termo_canonico: 'list_os', descricao: 'Ordem de serviço' },
  { categoria: 'sinonimo', termo: 'sem sinal', termo_canonico: 'no_deposit', descricao: 'Entrada zero / pagamento pendente' },
  { categoria: 'sinonimo', termo: 'retido', termo_canonico: 'aging_cars', descricao: 'Veículos parados no pátio' },
  { categoria: 'sinonimo', termo: 'checklist', termo_canonico: 'checklist_audit', descricao: 'Auditoria de checklists' },

  // Regras
  { categoria: 'regra', termo: 'excluir_master', termo_canonico: 'MASTER_EXCLUDED', descricao: 'A unidade MPMaster é administrativa e deve ser expurgada de comparativos e médias.' },
  { categoria: 'regra', termo: 'cmv_area_isolado', termo_canonico: 'ISOLATED_AREA_CMV', descricao: 'O CMV de área específica (ex: OLEO) deve ser calculado exclusivamente sobre faturamento_areas, sem fallback para o CMV geral da loja.' },
  { categoria: 'regra', termo: 'orcamento_turno_50s', termo_canonico: 'GLOBAL_TURN_BUDGET_50S', descricao: 'O orçamento total de espera do turno é de 50s distribuído entre primário e secundário.' }
];

/**
 * Cria a tabela do glossário semântico e a tabela virtual FTS5 caso não existam
 */
export function initSemanticGlossary(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hydra_semantic_glossary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      categoria TEXT NOT NULL,
      termo TEXT NOT NULL,
      termo_canonico TEXT NOT NULL,
      descricao TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(categoria, termo)
    );

    CREATE INDEX IF NOT EXISTS idx_glossary_cat_termo ON hydra_semantic_glossary(categoria, termo);
    CREATE INDEX IF NOT EXISTS idx_glossary_canonico ON hydra_semantic_glossary(termo_canonico);

    CREATE VIRTUAL TABLE IF NOT EXISTS hydra_semantic_glossary_fts USING fts5(
      termo,
      termo_canonico,
      categoria,
      descricao,
      content='hydra_semantic_glossary',
      content_rowid='id'
    );
  `);

  // Popula os termos caso tabela esteja vazia
  const countRow: any = db.prepare('SELECT COUNT(*) as count FROM hydra_semantic_glossary').get();
  if (!countRow || countRow.count === 0) {
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO hydra_semantic_glossary (categoria, termo, termo_canonico, descricao)
      VALUES (?, ?, ?, ?)
    `);
    const insertFtsStmt = db.prepare(`
      INSERT OR IGNORE INTO hydra_semantic_glossary_fts (rowid, termo, termo_canonico, categoria, descricao)
      VALUES (?, ?, ?, ?, ?)
    `);

    const insertTx = db.transaction(() => {
      for (const entry of SEED_GLOSSARY) {
        const info = insertStmt.run(entry.categoria, entry.termo, entry.termo_canonico, entry.descricao || null);
        if (info.lastInsertRowid) {
          try {
            insertFtsStmt.run(info.lastInsertRowid, entry.termo, entry.termo_canonico, entry.categoria, entry.descricao || null);
          } catch {}
        }
      }
    });

    insertTx();
  }
}

/**
 * Mapeia termos livres do usuário para a área oficial de faturamento_areas
 * Retorna uma das 6 áreas canônicas ou undefined se não encontrar correspondência.
 */
export function resolveSemanticArea(rawTerm: string, db?: Database.Database): OfficialArea | undefined {
  if (!rawTerm) return undefined;
  const norm = normalizeSemanticTerm(rawTerm);

  // 1. Verificação direta no mapa estático (rápido e determinístico)
  if (IN_MEMORY_AREA_MAP[norm]) {
    return IN_MEMORY_AREA_MAP[norm];
  }

  // 2. Busca por substrings no termo normalizado
  for (const [key, area] of Object.entries(IN_MEMORY_AREA_MAP)) {
    if (norm.includes(key)) {
      return area;
    }
  }

  // 3. Consulta no banco SQLite / FTS5 se db fornecido
  if (db) {
    try {
      // 3.1 Busca exata na tabela
      const row: any = db.prepare(`
        SELECT termo_canonico FROM hydra_semantic_glossary
        WHERE categoria = 'area' AND (LOWER(termo) = ? OR LOWER(termo) = ?)
        LIMIT 1
      `).get(rawTerm.toLowerCase(), norm);

      if (row && OFFICIAL_AREAS.includes(row.termo_canonico)) {
        return row.termo_canonico as OfficialArea;
      }

      // 3.2 Busca FTS5
      const ftsTerm = norm.replace(/[^\w\s]/g, '').trim();
      if (ftsTerm) {
        const ftsRow: any = db.prepare(`
          SELECT termo_canonico FROM hydra_semantic_glossary_fts
          WHERE hydra_semantic_glossary_fts MATCH ? AND categoria = 'area'
          LIMIT 1
        `).get(`${ftsTerm}*`);

        if (ftsRow && OFFICIAL_AREAS.includes(ftsRow.termo_canonico)) {
          return ftsRow.termo_canonico as OfficialArea;
        }
      }
    } catch {
      // Fallback gracioso se tabela SQLite não estiver pronta
    }
  }

  return undefined;
}

/**
 * Busca genérica no glossário semântico por termo ou similaridade
 */
export function searchSemanticGlossary(
  query: string,
  options?: { category?: GlossaryCategory; limit?: number },
  db?: Database.Database
): SemanticSearchResult[] {
  const norm = normalizeSemanticTerm(query);
  const limit = options?.limit || 5;

  if (db) {
    try {
      const catFilter = options?.category ? 'AND categoria = ?' : '';
      const params = options?.category ? [`${norm}*`, options.category] : [`${norm}*`];

      const rows: any[] = db.prepare(`
        SELECT categoria, termo, termo_canonico, descricao, rank
        FROM hydra_semantic_glossary_fts
        WHERE hydra_semantic_glossary_fts MATCH ? ${catFilter}
        ORDER BY rank
        LIMIT ?
      `).all(...params, limit);

      return rows.map(r => ({
        categoria: r.categoria,
        termo: r.termo,
        termoCanonico: r.termo_canonico,
        descricao: r.descricao,
        score: Math.abs(r.rank || 1.0)
      }));
    } catch {
      // Fallback em memória abaixo
    }
  }

  // Fallback em memória
  const results: SemanticSearchResult[] = [];
  for (const entry of SEED_GLOSSARY) {
    if (options?.category && entry.categoria !== options.category) continue;
    const entryNorm = normalizeSemanticTerm(entry.termo);
    if (entryNorm === norm || entryNorm.includes(norm) || norm.includes(entryNorm)) {
      results.push({
        categoria: entry.categoria,
        termo: entry.termo,
        termoCanonico: entry.termo_canonico,
        descricao: entry.descricao,
        score: entryNorm === norm ? 1.0 : 0.8
      });
      if (results.length >= limit) break;
    }
  }

  return results;
}