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
import {
  getOntologyTerm,
  getOntologyMetric,
  getOntologyDimension
} from './ontology_catalog.js';

import type {
  BusinessMetric,
  BusinessDimension,
  BusinessTerm,
  SemanticPeriod
} from './types/semantic_contract.js';

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

export interface StoreInfo {
  readonly slug: string;
  readonly name: string;
  readonly aliases: readonly string[];
}

export const OFFICIAL_STORES: readonly StoreInfo[] = [
  { slug: 'jabaquara', name: 'Jabaquara', aliases: ['mpjabaquara', 'jabaquara', 'loja jabaquara'] },
  { slug: 'MPdompedro1', name: 'Dom Pedro', aliases: ['dompedro', 'dom pedro', 'mpdompedro1', 'mpdompedro'] },
  { slug: 'maua', name: 'Mauá', aliases: ['maua', 'mpmaua', 'loja maua'] },
  { slug: 'santana', name: 'Santana', aliases: ['santana', 'mpsantana', 'loja santana'] },
  { slug: 'santoandre', name: 'Santo André', aliases: ['santoandre', 'santo andre', 'mpsantoandre'] },
  { slug: 'saobernardo', name: 'São Bernardo', aliases: ['saobernardo', 'sao bernardo', 'sbc', 'mpsaobernardo'] },
  { slug: 'sorocaba', name: 'Sorocaba', aliases: ['sorocaba', 'mpsorocaba'] },
  { slug: 'campinas', name: 'Campinas', aliases: ['campinas', 'mpcampinas'] },
  { slug: 'osmar', name: 'Osmar', aliases: ['osmar', 'mposmar'] },
  { slug: 'diadema', name: 'Diadema', aliases: ['diadema', 'mpdiadema'] },
  { slug: 'MPMaster', name: 'Master Administrativa', aliases: ['master', 'mpmaster', 'adm'] }
];

export function isOperationalStoreEligible(lojaSlug: string): boolean {
  if (!lojaSlug) return false;
  const normalized = lojaSlug.trim().toLowerCase();

  const matchedStore = OFFICIAL_STORES.find(
    s => s.slug.toLowerCase() === normalized || s.aliases.some(a => a.toLowerCase() === normalized)
  );

  if (!matchedStore) return false;
  return matchedStore.slug !== 'MPMaster';
}

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

/**
 * Normalização léxica compatível com a camada ontológica
 */
export const normalizeLexical = normalizeSemanticTerm;

/**
 * Resolução da Loja a partir de termos coloquiais.
 * Detecta explicitamente ambiguidades como "rei" isolado ou "sbc".
 */
export function resolveStore(text: string): {
  storeSlug?: string;
  storeName?: string;
  isAmbiguous: boolean;
  ambiguousCandidates?: string[];
} {
  const norm = normalizeLexical(text);

  // Verificação de termos sabidamente ambíguos
  if (/\b(rei)\b/.test(norm) && !norm.includes('oleo') && !norm.includes('modulo') && !norm.includes('maua')) {
    return {
      isAmbiguous: true,
      ambiguousCandidates: ['ReiDoModulo', 'ReiDoOleoMaua']
    };
  }

  if (/\b(sao bernardo|sbc)\b/.test(norm) && !norm.includes('rudge') && !norm.includes('planalto') && !norm.includes('kennedy')) {
    return {
      isAmbiguous: true,
      ambiguousCandidates: ['MPrudge', 'MPplanalto', 'MPkennedy']
    };
  }

  for (const store of OFFICIAL_STORES) {
    if (norm === normalizeLexical(store.slug) || norm === normalizeLexical(store.name)) {
      return { storeSlug: store.slug, storeName: store.name, isAmbiguous: false };
    }
    for (const alias of store.aliases) {
      const aliasNorm = normalizeLexical(alias);
      const regex = new RegExp(`\\b${aliasNorm}\\b`, 'i');
      if (regex.test(norm)) {
        return { storeSlug: store.slug, storeName: store.name, isAmbiguous: false };
      }
    }
  }

  return { isAmbiguous: false };
}

/**
 * Resolução Lexical de Termos Canônicos do Catálogo (ex: 'sem sinal', 'parado', 'atrasado').
 */
export function resolveCanonicalTerms(text: string): BusinessTerm[] {
  const norm = normalizeLexical(text);
  const matchedTerms: BusinessTerm[] = [];

  if (/\b(sem sinal|sem entrada|zerad[ao] de entrada|sem valor de entrada)\b/.test(norm)) {
    const term = getOntologyTerm('sem_sinal');
    if (term) matchedTerms.push(term);
  }

  if (/\b(parado|parada|parados|paradas|ha mais de \d+ dias no patio|estacionado no patio)\b/.test(norm)) {
    const term = getOntologyTerm('parado');
    if (term) matchedTerms.push(term);
  }

  if (/\b(atrasado|atrasada|atrasados|atrasadas|em atraso)\b/.test(norm)) {
    const term = getOntologyTerm('atrasado');
    if (term) matchedTerms.push(term);
  }

  if (/\b(perdendo dinheiro|prejuizo|margem negativa|cmv estourado)\b/.test(norm)) {
    const term = getOntologyTerm('perdendo_dinheiro');
    if (term) matchedTerms.push(term);
  }

  if (/\b(encerrada|fechada|faturada|concluida|encerradas|fechadas|finalizadas)\b/.test(norm)) {
    const term = getOntologyTerm('encerrada');
    if (term) matchedTerms.push(term);
  }

  return matchedTerms;
}

/**
 * Identificação de Métricas Solicitadas na Pergunta.
 */
export function resolveMetrics(text: string): BusinessMetric[] {
  const norm = normalizeLexical(text);
  const metrics: BusinessMetric[] = [];

  if (/\b(ticket medio|ticket|ticket medio mais alto|maior ticket)\b/.test(norm)) {
    const m = getOntologyMetric('ticket_medio');
    if (m) metrics.push(m);
  }

  if (/\b(cmv|custo de mercadoria|percentual de custo)\b/.test(norm)) {
    const m = getOntologyMetric('cmv_percentual');
    if (m) metrics.push(m);
  }

  if (/\b(faturamento|receita|vendas|faturado|faturar|faturamento bruto|valor total|valor das os|total das os)\b/.test(norm)) {
    const m = getOntologyMetric('faturamento_bruto');
    if (m) metrics.push(m);
  }

  if (/\b(saldo restante|saldo|a receber|pendencia|restante|falta pagar)\b/.test(norm)) {
    const m = getOntologyMetric('saldo_restante');
    if (m) metrics.push(m);
  }

  if (/\b(valor pago|recebido|entrada|total recebido|adiantamento)\b/.test(norm)) {
    const m = getOntologyMetric('valor_pago');
    if (m) metrics.push(m);
  }

  if (/\b(quantidade|volume|volume de os|qtd|quantas os|total de os|numero de os)\b/.test(norm)) {
    const m = getOntologyMetric('volume_os');
    if (m) metrics.push(m);
  }

  if (/\b(atingimento da meta|percentual da meta|% da meta|meta batida|meta)\b/.test(norm)) {
    const m = getOntologyMetric('percentual_meta');
    if (m) metrics.push(m);
  }

  if (/\b(custo total|custo|gastos de pecas)\b/.test(norm) && !metrics.some(x => x.id === 'cmv_percentual')) {
    const m = getOntologyMetric('custo_total');
    if (m) metrics.push(m);
  }

  return metrics;
}

/**
 * Identificação de Dimensões de Agrupamento ou Filtro.
 */
export function resolveDimensions(text: string): BusinessDimension[] {
  const norm = normalizeLexical(text);
  const dims: BusinessDimension[] = [];

  if (/\b(responsavel|consultor|mecanico|atendente|quem fechou|por responsavel)\b/.test(norm)) {
    const d = getOntologyDimension('responsavel_fechamento');
    if (d) dims.push(d);
  }

  if (/\b(area|setor|departamento|por area)\b/.test(norm)) {
    const d = getOntologyDimension('area');
    if (d) dims.push(d);
  }

  if (/\b(loja|unidade|filial|por loja)\b/.test(norm)) {
    const d = getOntologyDimension('loja_slug');
    if (d) dims.push(d);
  }

  if (/\b(placa|veiculo|carro)\b/.test(norm)) {
    const d = getOntologyDimension('placa');
    if (d) dims.push(d);
  }

  if (/\b(status|situacao)\b/.test(norm)) {
    const d = getOntologyDimension('status_grid');
    if (d) dims.push(d);
  }

  return dims;
}

/**
 * Resolução do Período Temporal de Consulta.
 */
export function resolvePeriod(text: string): SemanticPeriod {
  const norm = normalizeLexical(text);

  // Comparação explícita com mês anterior homólogo
  if (
    norm.includes('mes passado') && (norm.includes('contra') || norm.includes('comparado') || norm.includes('versus') || norm.includes('vs') || norm.includes('caiu')) ||
    norm.includes('mesmo periodo do mes passado')
  ) {
    return {
      type: 'mes_atual',
      comparisonPeriod: {
        type: 'mes_anterior_homologo'
      }
    };
  }

  if (/\b(mes anterior|mes passado|ultimo mes)\b/.test(norm)) {
    return { type: 'mes_anterior' };
  }

  if (/\b(ultimos 30 dias|30 dias|ultimos 30d)\b/.test(norm)) {
    return { type: 'ultimos_30d' };
  }

  if (/\b(hoje|dia de hoje)\b/.test(norm)) {
    return { type: 'hoje' };
  }

  // Padrão de negócio: mês atual
  return { type: 'mes_atual' };
}

/**
 * Detecção de Perguntas Preditivas (Não Suportadas / Exige Declaração Factual).
 */
export function isPredictiveQuestion(text: string): boolean {
  const norm = normalizeLexical(text);
  return (
    /\b(quanto vamos faturar|vai faturar|quanto vai dar|previsao|prever|projecao|projetado|mes que vem|proximo mes|vai bater a meta|estimativa futura)\b/.test(norm)
  );
}

/**
 * Detecção de Perguntas Causais (Exige Decomposição Factual, Sem Inferência Causal Inventada).
 */
export function isCausalQuestion(text: string): boolean {
  const norm = normalizeLexical(text);
  return (
    /\b(por que|porque|por qual motivo|o que causou|qual a razao|por que caiu|por que subiu|por que o cmv)\b/.test(norm)
  );
}

/**
 * Detecção de Pedido de Busca Semântica / Vetorial (Amostras Candidatas).
 */
export function isSemanticSearchQuestion(text: string): boolean {
  const norm = normalizeLexical(text);
  return (
    /\b(casos parecidos|casos semelhantes|parecido com|semelhante a|parecido com esse|casos analogos|historico de casos parecidos)\b/.test(norm)
  );
}

/**
 * Detecção de Drill-down Conciliatório (Listagem de OSs que explicam um faturamento).
 */
export function isDrillDownQuestion(text: string): boolean {
  const norm = normalizeLexical(text);
  return (
    /\b(quais ordens explicam|quais os explicam|quais ordens somam|abrir ordens|detalhar ordens|conciliar faturamento)\b/.test(norm)
  );
}

/**
 * Detecção de Predicados Relacionais entre Serviços (ex: "câmbio sem troca de óleo").
 */
export function detectRelationalPredicates(text: string): {
  hasRelationalPredicate: boolean;
  relationId?: string;
  existsTerms?: string[];
  notExistsTerms?: string[];
} {
  const norm = normalizeLexical(text);

  if (norm.includes('cambio') && (norm.includes('sem troca de oleo') || norm.includes('sem oleo'))) {
    return {
      hasRelationalPredicate: true,
      relationId: 'os_servicos',
      existsTerms: ['cambio'],
      notExistsTerms: ['oleo']
    };
  }

  return { hasRelationalPredicate: false };
}

/**
 * Detecção de Referências Anafóricas ou Continuação Conversacional.
 */
export function detectAnaphoricReference(text: string): {
  isAnaphoric: boolean;
  excludes?: string[];
  maintains?: string[];
  refinedStore?: string;
  refinedPeriod?: SemanticPeriod;
} {
  const norm = normalizeLexical(text);

  const isAnaphoric = /\b(das anteriores|dessas|destas|delas|das que|mantenha so|exclua as|dessas mesmas|dentre elas)\b/.test(norm);

  const excludes: string[] = [];
  const maintains: string[] = [];

  if (isAnaphoric) {
    if (norm.includes('exclua as aguardando peca') || norm.includes('tirando aguardando peca') || norm.includes('sem aguardando peca')) {
      excludes.push('AGUARDANDO_PECA');
    }
    const marceloMatch = norm.match(/so as do ([a-z]+)|mantenha so as do ([a-z]+)/);
    if (marceloMatch) {
      const nome = marceloMatch[1] || marceloMatch[2];
      maintains.push(nome);
    }
  }

  return { isAnaphoric, excludes, maintains };
}