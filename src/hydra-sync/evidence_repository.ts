/**
 * src/hydra-sync/evidence_repository.ts
 * 
 * Repositório de Evidências, Cobertura de Dados e Matriz de Qualidade.
 * Rastreia se os dados de uma loja/tabela estão completos, parciais ou ausentes,
 * e implementa a REGRA ESTRITA: ausência de registros filhos ("sem pagamentos" ou "sem serviços")
 * só comprova ausência se a fonte tiver cobertura completa confirmada.
 * 
 * Propriedade: Executor 2 (Dados e Evidências)
 * Spec: hydra-semantic-layer
 */

import Database from 'better-sqlite3';

export type CoverageStatus = 'COMPLETA' | 'PARCIAL' | 'AUSENTE';

export interface TableEvidenceRecord {
  lojaSlug: string;
  tabela: string;
  coberturaStatus: CoverageStatus;
  dataColetaRecente: string;
  registrosContabilizados: number;
  incompletudeMotivo?: string;
  updatedAt?: string;
}

export interface QualityAnomaly {
  anomalyId: string;
  osId?: string;
  lojaSlug: string;
  tabela: string;
  campoAfetado: string;
  motivo: string;
  severidade: 'WARNING' | 'CRITICAL';
  dataIdentificacao: string;
}

export interface ChildAbsenceResult {
  osId: string;
  lojaSlug: string;
  childTable: string;
  childrenCountInDb: number;
  coberturaStatus: CoverageStatus;
  isZeroConfirmed: boolean;
  isUnknownOrPartial: boolean;
  verdictText: string;
  warning?: string;
}

export interface PopulationCoverageAssessment {
  overallStatus: 'full' | 'partial_warning' | 'insufficient';
  eligibleStoresCount: number;
  storesWithFullCoverage: string[];
  storesWithPartialCoverage: string[];
  storesWithMissingCoverage: string[];
  warnings: string[];
}

/**
 * Catálogo das 10 lojas operacionais elegíveis.
 * A loja 'master' é expressamente administrativa e expurgada de comparativos e rankings.
 */
export const CATALOGO_10_LOJAS_ELEGIVEIS = [
  'santo_andre',
  'sao_bernardo',
  'sao_caetano',
  'diadema',
  'maua',
  'ipiranga',
  'tatuape',
  'mooca',
  'santana',
  'osasco'
] as const;

export type AuthorizedLojaSlug = typeof CATALOGO_10_LOJAS_ELEGIVEIS[number];

/**
 * Verifica se a loja pertence ao universo das 10 lojas elegíveis (expurgando 'master').
 */
export function isAuthorizedOperationalStore(lojaSlug: string): boolean {
  if (lojaSlug.toLowerCase() === 'master') {
    return false;
  }
  return CATALOGO_10_LOJAS_ELEGIVEIS.includes(lojaSlug as AuthorizedLojaSlug);
}

/**
 * Cache em memória para execuções sem persistência em disco ou testes rápidos.
 */
const inMemoryEvidenceStore = new Map<string, TableEvidenceRecord>();
const inMemoryAnomalies: QualityAnomaly[] = [];

/**
 * Chave composta de indexação no repositório.
 */
function buildKey(lojaSlug: string, tabela: string): string {
  return `${lojaSlug.toLowerCase()}::${tabela.toLowerCase()}`;
}

/**
 * Inicializa a tabela 'hydra_semantic_evidence' no SQLite caso não exista.
 */
export function ensureEvidenceSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hydra_semantic_evidence (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loja_slug TEXT NOT NULL,
      tabela TEXT NOT NULL,
      cobertura_status TEXT NOT NULL CHECK(cobertura_status IN ('COMPLETA', 'PARCIAL', 'AUSENTE')),
      data_coleta_recente TEXT NOT NULL,
      registros_contabilizados INTEGER NOT NULL DEFAULT 0,
      incompletude_motivo TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(loja_slug, tabela)
    );

    CREATE INDEX IF NOT EXISTS idx_semantic_evidence_loja 
      ON hydra_semantic_evidence(loja_slug, tabela);
  `);
}

/**
 * Registra o status de cobertura de uma tabela para uma loja.
 */
export function recordStoreTableEvidence(
  evidence: TableEvidenceRecord,
  db?: Database.Database
): void {
  const normalizedSlug = evidence.lojaSlug.toLowerCase();
  const normalizedTable = evidence.tabela.toLowerCase();

  // Atualiza cache em memória
  inMemoryEvidenceStore.set(buildKey(normalizedSlug, normalizedTable), {
    ...evidence,
    lojaSlug: normalizedSlug,
    tabela: normalizedTable,
    updatedAt: evidence.updatedAt || new Date().toISOString()
  });

  // Persiste no SQLite se conexão for fornecida
  if (db) {
    ensureEvidenceSchema(db);
    const stmt = db.prepare(`
      INSERT INTO hydra_semantic_evidence (
        loja_slug, tabela, cobertura_status, data_coleta_recente, 
        registros_contabilizados, incompletude_motivo, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(loja_slug, tabela) DO UPDATE SET
        cobertura_status = excluded.cobertura_status,
        data_coleta_recente = excluded.data_coleta_recente,
        registros_contabilizados = excluded.registros_contabilizados,
        incompletude_motivo = excluded.incompletude_motivo,
        updated_at = CURRENT_TIMESTAMP
    `);

    stmt.run(
      normalizedSlug,
      normalizedTable,
      evidence.coberturaStatus,
      evidence.dataColetaRecente,
      evidence.registrosContabilizados,
      evidence.incompletudeMotivo || null
    );
  }
}

/**
 * Consulta a evidência de cobertura de uma tabela em uma loja.
 */
export function getStoreTableEvidence(
  lojaSlug: string,
  tabela: string,
  db?: Database.Database
): TableEvidenceRecord | undefined {
  const normalizedSlug = lojaSlug.toLowerCase();
  const normalizedTable = tabela.toLowerCase();

  if (db) {
    try {
      ensureEvidenceSchema(db);
      const row = db.prepare(`
        SELECT loja_slug, tabela, cobertura_status, data_coleta_recente, 
               registros_contabilizados, incompletude_motivo, updated_at
        FROM hydra_semantic_evidence
        WHERE loja_slug = ? AND tabela = ?
      `).get(normalizedSlug, normalizedTable) as {
        loja_slug: string;
        tabela: string;
        cobertura_status: CoverageStatus;
        data_coleta_recente: string;
        registros_contabilizados: number;
        incompletude_motivo: string | null;
        updated_at: string;
      } | undefined;

      if (row) {
        return {
          lojaSlug: row.loja_slug,
          tabela: row.tabela,
          coberturaStatus: row.cobertura_status,
          dataColetaRecente: row.data_coleta_recente,
          registrosContabilizados: row.registros_contabilizados,
          incompletudeMotivo: row.incompletude_motivo || undefined,
          updatedAt: row.updated_at
        };
      }
    } catch {
      // Fallback para cache em memória em caso de falha de leitura no DB
    }
  }

  return inMemoryEvidenceStore.get(buildKey(normalizedSlug, normalizedTable));
}

/**
 * REGRA ESTRITA MANDATÓRIA (T32 / Cláusula Pétrea):
 * Ausência de filhos ("sem pagamentos" ou "sem peças/serviços") só comprova
 * ausência de fato se a tabela filha tiver status 'COMPLETA' para aquela loja.
 * Caso contrário, a afirmação "sem pagamentos" é bloqueada e classificada
 * como dado parcial/desconhecido.
 */
export function assessChildAbsenceEvidence(params: {
  osId: string;
  lojaSlug: string;
  childTable: string;
  childrenCountInDb: number;
  db?: Database.Database;
}): ChildAbsenceResult {
  const { osId, lojaSlug, childTable, childrenCountInDb, db } = params;
  const evidence = getStoreTableEvidence(lojaSlug, childTable, db);
  const status = evidence?.coberturaStatus || 'AUSENTE';

  if (childrenCountInDb > 0) {
    return {
      osId,
      lojaSlug,
      childTable,
      childrenCountInDb,
      coberturaStatus: status,
      isZeroConfirmed: false,
      isUnknownOrPartial: false,
      verdictText: `Possui ${childrenCountInDb} registros em ${childTable}.`
    };
  }

  // Se childrenCountInDb === 0, checamos rigorosamente a evidência
  if (status === 'COMPLETA') {
    return {
      osId,
      lojaSlug,
      childTable,
      childrenCountInDb: 0,
      coberturaStatus: 'COMPLETA',
      isZeroConfirmed: true,
      isUnknownOrPartial: false,
      verdictText: `Comprovadamente sem registros em ${childTable} (cobertura completa comprovada na fonte).`
    };
  }

  // Se status é PARCIAL ou AUSENTE, é proibido afirmar "zero" ou "sem pagamentos"
  const missingReason = evidence?.incompletudeMotivo || 'Coleta da tabela filha não realizada ou incompleta para esta unidade.';
  return {
    osId,
    lojaSlug,
    childTable,
    childrenCountInDb: 0,
    coberturaStatus: status,
    isZeroConfirmed: false,
    isUnknownOrPartial: true,
    verdictText: `Dados de ${childTable} não disponíveis para esta unidade.`,
    warning: `ATENÇÃO: A ausência de registros em '${childTable}' para a OS ${osId} da loja '${lojaSlug}' ` +
      `não pode ser afirmada como ausência real pois a cobertura da fonte é ${status} (${missingReason}).`
  };
}

/**
 * Avaliação especializada para pagamentos de uma OS.
 */
export function assessPaymentEvidence(params: {
  osId: string;
  lojaSlug: string;
  paymentsCountInDb: number;
  db?: Database.Database;
}): ChildAbsenceResult {
  return assessChildAbsenceEvidence({
    osId: params.osId,
    lojaSlug: params.lojaSlug,
    childTable: 'pagamentos_os',
    childrenCountInDb: params.paymentsCountInDb,
    db: params.db
  });
}

/**
 * Registra uma anomalia de qualidade de dados (ex: OS fechada com valor zerado,
 * status conflitante ou divergência entre peças e total).
 */
export function recordQualityAnomaly(anomaly: QualityAnomaly): void {
  inMemoryAnomalies.push({
    ...anomaly,
    dataIdentificacao: anomaly.dataIdentificacao || new Date().toISOString()
  });
}

/**
 * Recupera anomalias de qualidade de uma OS específica.
 */
export function getQualityAnomaliesForOS(osId: string, lojaSlug: string): QualityAnomaly[] {
  return inMemoryAnomalies.filter(a => a.osId === osId && a.lojaSlug.toLowerCase() === lojaSlug.toLowerCase());
}

/**
 * Avalia a cobertura global de uma população de lojas para uma consulta composta.
 * Se qualquer loja tiver dados parciais ou ausentes, a consulta propaga um aviso
 * 'partial_warning' ou 'insufficient'.
 */
export function assessPopulationCoverage(
  lojaSlugs: string[],
  requiredTables: string[],
  db?: Database.Database
): PopulationCoverageAssessment {
  // Filtra apenas lojas elegíveis (expurga Master)
  const validStores = lojaSlugs.filter(isAuthorizedOperationalStore);
  const fullStores: string[] = [];
  const partialStores: string[] = [];
  const missingStores: string[] = [];
  const warnings: string[] = [];

  for (const store of validStores) {
    let storeStatus: CoverageStatus = 'COMPLETA';

    for (const table of requiredTables) {
      const evidence = getStoreTableEvidence(store, table, db);
      if (!evidence || evidence.coberturaStatus === 'AUSENTE') {
        storeStatus = 'AUSENTE';
        warnings.push(`Loja '${store}': tabela '${table}' está ausente.`);
        break;
      } else if (evidence.coberturaStatus === 'PARCIAL') {
        storeStatus = 'PARCIAL';
        warnings.push(`Loja '${store}': tabela '${table}' possui cobertura parcial (${evidence.incompletudeMotivo || 'incompletude'}).`);
      }
    }

    if (storeStatus === 'COMPLETA') {
      fullStores.push(store);
    } else if (storeStatus === 'PARCIAL') {
      partialStores.push(store);
    } else {
      missingStores.push(store);
    }
  }

  let overallStatus: 'full' | 'partial_warning' | 'insufficient' = 'full';
  if (missingStores.length > 0) {
    overallStatus = (fullStores.length + partialStores.length > 0) ? 'partial_warning' : 'insufficient';
  } else if (partialStores.length > 0) {
    overallStatus = 'partial_warning';
  }

  return {
    overallStatus,
    eligibleStoresCount: validStores.length,
    storesWithFullCoverage: fullStores,
    storesWithPartialCoverage: partialStores,
    storesWithMissingCoverage: missingStores,
    warnings
  };
}

/**
 * Limpa todos os dados em memória (útil para suítes de testes isoladas).
 */
export function clearInMemoryEvidenceStore(): void {
  inMemoryEvidenceStore.clear();
  inMemoryAnomalies.length = 0;
}
