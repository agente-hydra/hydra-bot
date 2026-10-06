import type Database from 'better-sqlite3';
import { CATALOGO_10_LOJAS } from './db_repository.js';

export const OFFICIAL_10_LOJAS: readonly string[] = CATALOGO_10_LOJAS || [
  'MPdompedro1',
  'MPJabaquara',
  'MPJorgeBeretta',
  'MPkennedy',
  'MPpiraporinha',
  'MPplanalto',
  'MPrudge',
  'MPSantoAndre',
  'ReiDoModulo',
  'ReiDoOleoMaua'
];

export interface DailyRevenueItem {
  lojaSlug: string;
  loja_slug: string;
  dataReferencia: string;
  data_referencia: string;
  posicaoHora: string;
  posicao_hora: string;
  faturamentoDia: number;
  faturamento_dia: number;
  volumeOsDia: number;
  volume_os_dia: number;
  capturedAt: string;
  captured_at: string;
  isStale: boolean;
  staleMinutes: number;
}

export interface DailyRevenueSnapshotResult extends Array<DailyRevenueItem> {
  lojaSlug?: string;
  dataReferencia: string;
  posicaoHora: string;
  faturamento_dia: number;
  faturamentoDia: number;
  volume_os_dia: number;
  volumeOsDia: number;
  capturedAt: string;
  isStale: boolean;
  staleMinutes: number;
  lojas: DailyRevenueItem[];
}

export interface MetasSnapshotItem {
  lojaSlug: string;
  loja_slug: string;
  dataReferencia: string;
  data_referencia: string;
  posicaoHora: string;
  posicao_hora: string;
  faturamentoMes: number;
  faturamento_mes: number;
  volumeOs: number;
  volume_os: number;
  ticketMedio: number;
  ticket_medio: number;
  metaMes: number | null;
  meta_mes: number | null;
  previsaoMes?: number | null;
  percentualMeta: number | null;
  percentual_meta: number | null;
  capturedAt: string;
  captured_at: string;
  isStale: boolean;
  staleMinutes: number;
}

export interface MetasSnapshotResult extends Array<MetasSnapshotItem> {
  lojaSlug?: string;
  dataReferencia: string;
  posicaoHora: string;
  faturamento_mes: number;
  faturamentoMes: number;
  volume_os: number;
  volumeOs: number;
  meta_mes: number;
  metaMes: number;
  percentual_meta: number;
  percentualMeta: number;
  capturedAt: string;
  isStale: boolean;
  staleMinutes: number;
  lojas: MetasSnapshotItem[];
}

export interface CMVSnapshotAreaItem {
  lojaSlug: string;
  area: string;
  faturamento: number;
  faturamento_percentual: number;
  desconto: number;
  custo: number;
  cmv_percentual: number;
  lucro_bruto: number;
  lucro_bruto_percentual: number;
}

export interface CMVSnapshotStoreItem {
  lojaSlug: string;
  loja_slug: string;
  dataInicio: string;
  data_inicio: string;
  dataFim: string;
  data_fim: string;
  faturamentoTotal: number;
  faturamento_total: number;
  descontoTotal: number;
  desconto_total: number;
  custoTotal: number;
  custo_total: number;
  cmvPercentual: number;
  cmv_percentual: number;
  lucroBruto: number;
  lucro_bruto: number;
  lucroBrutoPercentual: number;
  lucro_bruto_percentual: number;
  capturedAt: string;
  captured_at: string;
  areas: CMVSnapshotAreaItem[];
}

export interface CMVSnapshotResult {
  dataInicio: string;
  dataFim: string;
  faturamento_total: number;
  custo_total: number;
  desconto_total: number;
  cmv_percentual: number;
  lucro_bruto: number;
  lucro_bruto_percentual: number;
  captured_at: string;
  capturedAt: string;
  isCompleto: boolean;
  statusCompletude: string;
  lojasPresentes: string[];
  lojasFaltantes: string[];
  lojas: CMVSnapshotStoreItem[];
  areas: CMVSnapshotAreaItem[];
}

/**
 * Consulta o último snapshot de faturamento diário oficial (Vendas por Dia).
 * NUNCA retorna silenciosamente dados de outro mês quando a pergunta for sobre hoje.
 */
export function getLatestDailyRevenue(
  db: Database.Database,
  dataReferencia: string,
  lojaSlug?: string,
  maxAgeMinutes: number = 120
): DailyRevenueSnapshotResult {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='faturamento_diario_horario'").get();
  if (!exists) {
    const empty = [] as unknown as DailyRevenueSnapshotResult;
    empty.dataReferencia = dataReferencia;
    empty.posicaoHora = '';
    empty.faturamento_dia = 0;
    empty.faturamentoDia = 0;
    empty.volume_os_dia = 0;
    empty.volumeOsDia = 0;
    empty.capturedAt = '';
    empty.isStale = true;
    empty.staleMinutes = 9999;
    empty.lojas = [];
    if (lojaSlug) empty.lojaSlug = lojaSlug;
    return empty;
  }

  // NUNCA buscar silenciosamente dados de outro mês ou dia.
  // Filtra estritamente pela dataReferencia informada.
  const rows = db.prepare(`
    SELECT d.* FROM faturamento_diario_horario d
    WHERE d.data_referencia = ?
      AND (? IS NULL OR d.loja_slug = ?)
      AND d.posicao_hora = (
        SELECT MAX(x.posicao_hora) FROM faturamento_diario_horario x
        WHERE x.data_referencia = d.data_referencia AND x.loja_slug = d.loja_slug
      )
    ORDER BY d.loja_slug
  `).all(dataReferencia, lojaSlug || null, lojaSlug || null) as Array<{
    loja_slug: string;
    data_referencia: string;
    posicao_hora: string;
    faturamento_dia: number;
    volume_os_dia: number;
    captured_at: string;
  }>;

  const now = Date.now();
  const items: DailyRevenueItem[] = rows.map(r => {
    const capturedTime = new Date(r.captured_at).getTime();
    const ageMs = Math.max(0, now - (isNaN(capturedTime) ? now : capturedTime));
    const staleMinutes = Math.floor(ageMs / 60000);
    const isStale = ageMs > maxAgeMinutes * 60000;

    return {
      lojaSlug: r.loja_slug,
      loja_slug: r.loja_slug,
      dataReferencia: r.data_referencia,
      data_referencia: r.data_referencia,
      posicaoHora: r.posicao_hora,
      posicao_hora: r.posicao_hora,
      faturamentoDia: r.faturamento_dia,
      faturamento_dia: r.faturamento_dia,
      volumeOsDia: r.volume_os_dia,
      volume_os_dia: r.volume_os_dia,
      capturedAt: r.captured_at,
      captured_at: r.captured_at,
      isStale,
      staleMinutes
    };
  });

  const result = items as unknown as DailyRevenueSnapshotResult;
  result.lojas = items;
  result.dataReferencia = dataReferencia;
  if (lojaSlug) result.lojaSlug = lojaSlug;

  if (items.length > 0) {
    if (lojaSlug && items.length === 1) {
      result.faturamento_dia = items[0].faturamento_dia;
      result.faturamentoDia = items[0].faturamentoDia;
      result.volume_os_dia = items[0].volume_os_dia;
      result.volumeOsDia = items[0].volumeOsDia;
      result.posicaoHora = items[0].posicaoHora;
      result.capturedAt = items[0].capturedAt;
      result.isStale = items[0].isStale;
      result.staleMinutes = items[0].staleMinutes;
    } else {
      result.faturamento_dia = items.reduce((acc, i) => acc + i.faturamento_dia, 0);
      result.faturamentoDia = result.faturamento_dia;
      result.volume_os_dia = items.reduce((acc, i) => acc + i.volume_os_dia, 0);
      result.volumeOsDia = result.volume_os_dia;
      result.posicaoHora = items.map(i => i.posicaoHora).sort().reverse()[0] || '';
      result.capturedAt = items.map(i => i.capturedAt).sort().reverse()[0] || '';
      result.isStale = items.some(i => i.isStale);
      result.staleMinutes = Math.max(...items.map(i => i.staleMinutes), 0);
    }
  } else {
    result.faturamento_dia = 0;
    result.faturamentoDia = 0;
    result.volume_os_dia = 0;
    result.volumeOsDia = 0;
    result.posicaoHora = '';
    result.capturedAt = '';
    result.isStale = true;
    result.staleMinutes = 9999;
  }

  return result;
}

/**
 * Consulta o último snapshot de Metas (acumulado mensal e atingimento).
 * NUNCA retorna silenciosamente dados de outro mês quando a pergunta for sobre hoje.
 */
export function getLatestMetasSnapshot(
  db: Database.Database,
  dataReferencia: string,
  lojaSlug?: string,
  maxAgeMinutes: number = 120
): MetasSnapshotResult {
  const mesAlvo = dataReferencia.slice(0, 7); // ex: '2026-09'

  const hasMetasHorarias = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='metas_horarias'").get());
  const hasMetasDiarias = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='metas_diarias'").get());

  let rawRows: Array<{
    loja_slug: string;
    data_referencia: string;
    posicao_hora: string;
    faturamento_mes: number;
    volume_os: number;
    ticket_medio: number;
    meta_mes: number | null;
    previsao_mes?: number | null;
    percentual_meta: number | null;
    captured_at: string;
  }> = [];

  // Tenta metas_horarias primeiro para a data exata
  if (hasMetasHorarias) {
    rawRows = db.prepare(`
      SELECT m.loja_slug, m.data_referencia, m.posicao_hora, m.faturamento_mes, m.volume_os,
             m.ticket_medio, m.meta_mes, m.previsao_mes, m.percentual_meta, m.captured_at
      FROM metas_horarias m
      WHERE m.data_referencia = ?
        AND (? IS NULL OR m.loja_slug = ?)
        AND m.posicao_hora = (
          SELECT MAX(x.posicao_hora) FROM metas_horarias x
          WHERE x.data_referencia = m.data_referencia AND x.loja_slug = m.loja_slug
        )
      ORDER BY m.loja_slug
    `).all(dataReferencia, lojaSlug || null, lojaSlug || null) as typeof rawRows;
  }

  // Se vazio em metas_horarias, tenta metas_diarias para a data exata
  if (rawRows.length === 0 && hasMetasDiarias) {
    rawRows = db.prepare(`
      SELECT m.loja_slug, m.data_referencia, m.posicao_hora, m.faturamento_mes, m.volume_os,
             m.ticket_medio, m.meta_mes, m.previsao_mes, m.percentual_meta,
             COALESCE(m.created_at, datetime('now')) as captured_at
      FROM metas_diarias m
      WHERE m.data_referencia = ?
        AND (? IS NULL OR m.loja_slug = ?)
        AND m.id = (
          SELECT MAX(x.id) FROM metas_diarias x
          WHERE x.data_referencia = m.data_referencia AND x.loja_slug = m.loja_slug
        )
      ORDER BY m.loja_slug
    `).all(dataReferencia, lojaSlug || null, lojaSlug || null) as typeof rawRows;
  }

  // Se ainda vazio para a data exata, busca o registro mais recente ESTRITAMENTE DENTRO DO MESMO MÊS
  // (ex: dia anterior no mesmo mês), NUNCA de meses anteriores!
  if (rawRows.length === 0) {
    if (hasMetasHorarias) {
      rawRows = db.prepare(`
        SELECT m.loja_slug, m.data_referencia, m.posicao_hora, m.faturamento_mes, m.volume_os,
               m.ticket_medio, m.meta_mes, m.previsao_mes, m.percentual_meta, m.captured_at
        FROM metas_horarias m
        WHERE m.data_referencia LIKE ? AND m.data_referencia <= ?
          AND (? IS NULL OR m.loja_slug = ?)
          AND m.data_referencia = (
            SELECT MAX(x.data_referencia) FROM metas_horarias x
            WHERE x.data_referencia LIKE ? AND x.data_referencia <= ?
          )
          AND m.posicao_hora = (
            SELECT MAX(x.posicao_hora) FROM metas_horarias x
            WHERE x.data_referencia = m.data_referencia AND x.loja_slug = m.loja_slug
          )
        ORDER BY m.loja_slug
      `).all(`${mesAlvo}%`, dataReferencia, lojaSlug || null, lojaSlug || null, `${mesAlvo}%`, dataReferencia) as typeof rawRows;
    }

    if (rawRows.length === 0 && hasMetasDiarias) {
      rawRows = db.prepare(`
        SELECT m.loja_slug, m.data_referencia, m.posicao_hora, m.faturamento_mes, m.volume_os,
               m.ticket_medio, m.meta_mes, m.previsao_mes, m.percentual_meta,
               COALESCE(m.created_at, datetime('now')) as captured_at
        FROM metas_diarias m
        WHERE m.data_referencia LIKE ? AND m.data_referencia <= ?
          AND (? IS NULL OR m.loja_slug = ?)
          AND m.data_referencia = (
            SELECT MAX(x.data_referencia) FROM metas_diarias x
            WHERE x.data_referencia LIKE ? AND x.data_referencia <= ?
          )
        ORDER BY m.loja_slug
      `).all(`${mesAlvo}%`, dataReferencia, lojaSlug || null, lojaSlug || null, `${mesAlvo}%`, dataReferencia) as typeof rawRows;
    }
  }

  const now = Date.now();
  const items: MetasSnapshotItem[] = rawRows.map(r => {
    const capturedTime = new Date(r.captured_at).getTime();
    const ageMs = Math.max(0, now - (isNaN(capturedTime) ? now : capturedTime));
    const staleMinutes = Math.floor(ageMs / 60000);
    const isStale = ageMs > maxAgeMinutes * 60000;

    const rawFat = Number(r.faturamento_mes || 0);
    const rawMeta = Number(r.meta_mes || 0);
    const atingimentoCalculado = (rawMeta > 0)
      ? Number(((rawFat / rawMeta) * 100).toFixed(2))
      : (r.percentual_meta !== null && r.percentual_meta !== undefined ? Number(r.percentual_meta) : null);

    return {
      lojaSlug: r.loja_slug,
      loja_slug: r.loja_slug,
      dataReferencia: r.data_referencia,
      data_referencia: r.data_referencia,
      posicaoHora: r.posicao_hora,
      posicao_hora: r.posicao_hora,
      faturamentoMes: r.faturamento_mes,
      faturamento_mes: r.faturamento_mes,
      volumeOs: r.volume_os,
      volume_os: r.volume_os,
      ticketMedio: r.ticket_medio,
      ticket_medio: r.ticket_medio,
      metaMes: r.meta_mes,
      meta_mes: r.meta_mes,
      previsaoMes: r.previsao_mes,
      percentualMeta: atingimentoCalculado,
      percentual_meta: atingimentoCalculado,
      capturedAt: r.captured_at,
      captured_at: r.captured_at,
      isStale,
      staleMinutes
    };
  });

  const result = items as unknown as MetasSnapshotResult;
  result.lojas = items;
  result.dataReferencia = dataReferencia;
  if (lojaSlug) result.lojaSlug = lojaSlug;

  if (items.length > 0) {
    if (lojaSlug && items.length === 1) {
      result.faturamento_mes = items[0].faturamento_mes;
      result.faturamentoMes = items[0].faturamentoMes;
      result.volume_os = items[0].volume_os;
      result.volumeOs = items[0].volumeOs;
      result.meta_mes = items[0].meta_mes ?? 0;
      result.metaMes = result.meta_mes;
      result.percentual_meta = items[0].percentual_meta ?? 0;
      result.percentualMeta = result.percentual_meta;
      result.posicaoHora = items[0].posicaoHora;
      result.capturedAt = items[0].capturedAt;
      result.isStale = items[0].isStale;
      result.staleMinutes = items[0].staleMinutes;
    } else {
      result.faturamento_mes = items.reduce((acc, i) => acc + i.faturamento_mes, 0);
      result.faturamentoMes = result.faturamento_mes;
      result.volume_os = items.reduce((acc, i) => acc + i.volume_os, 0);
      result.volumeOs = result.volume_os;
      const totalMeta = items.reduce((acc, i) => acc + (i.meta_mes || 0), 0);
      result.meta_mes = totalMeta;
      result.metaMes = totalMeta;
      result.percentual_meta = totalMeta > 0 ? Number(((result.faturamento_mes / totalMeta) * 100).toFixed(2)) : 0;
      result.percentualMeta = result.percentual_meta;
      result.posicaoHora = items.map(i => i.posicaoHora).sort().reverse()[0] || '';
      result.capturedAt = items.map(i => i.capturedAt).sort().reverse()[0] || '';
      result.isStale = items.some(i => i.isStale);
      result.staleMinutes = Math.max(...items.map(i => i.staleMinutes), 0);
    }
  } else {
    result.faturamento_mes = 0;
    result.faturamentoMes = 0;
    result.volume_os = 0;
    result.volumeOs = 0;
    result.meta_mes = 0;
    result.metaMes = 0;
    result.percentual_meta = 0;
    result.percentualMeta = 0;
    result.posicaoHora = '';
    result.capturedAt = '';
    result.isStale = true;
    result.staleMinutes = 9999;
  }

  return result;
}

/**
 * Consulta dados consolidados de CMV (cmv_lojas e faturamento_areas) com status
 * de completude (10/10 lojas ou lista de faltantes).
 * NUNCA retorna silenciosamente dados de outro mês quando a pergunta for sobre um período específico.
 */
export function getLatestCMVSnapshot(
  db: Database.Database,
  dataInicio: string,
  dataFim: string,
  lojaSlug?: string
): CMVSnapshotResult {
  const hasCMV = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cmv_lojas'").get());
  const hasAreas = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='faturamento_areas'").get());

  const expectedStores = lojaSlug ? [lojaSlug] : [...OFFICIAL_10_LOJAS];

  if (!hasCMV) {
    return {
      dataInicio,
      dataFim,
      faturamento_total: 0,
      custo_total: 0,
      desconto_total: 0,
      cmv_percentual: 0,
      lucro_bruto: 0,
      lucro_bruto_percentual: 0,
      captured_at: '',
      capturedAt: '',
      isCompleto: false,
      statusCompletude: `0/${expectedStores.length} lojas (faltantes: ${expectedStores.join(', ')})`,
      lojasPresentes: [],
      lojasFaltantes: expectedStores,
      lojas: [],
      areas: []
    };
  }

  // Consulta strictly cmv_lojas para o período informado
  const cmvRows = db.prepare(`
    SELECT loja_slug, data_inicio, data_fim, faturamento_total, desconto_total, custo_total,
           cmv_percentual, lucro_bruto, lucro_bruto_percentual, created_at
    FROM cmv_lojas
    WHERE data_inicio = ? AND data_fim = ?
      AND (? IS NULL OR loja_slug = ?)
    ORDER BY loja_slug
  `).all(dataInicio, dataFim, lojaSlug || null, lojaSlug || null) as Array<{
    loja_slug: string;
    data_inicio: string;
    data_fim: string;
    faturamento_total: number;
    desconto_total: number;
    custo_total: number;
    cmv_percentual: number;
    lucro_bruto: number;
    lucro_bruto_percentual: number;
    created_at: string;
  }>;

  // Consulta faturamento_areas para o período
  let areaRows: Array<{
    loja_slug: string;
    area: string;
    faturamento: number;
    faturamento_percentual: number;
    desconto: number;
    custo: number;
    cmv_percentual: number;
    lucro_bruto: number;
    lucro_bruto_percentual: number;
  }> = [];

  if (hasAreas) {
    areaRows = db.prepare(`
      SELECT loja_slug, area, faturamento, faturamento_percentual, desconto, custo,
             cmv_percentual, lucro_bruto, lucro_bruto_percentual
      FROM faturamento_areas
      WHERE data_inicio = ? AND data_fim = ?
        AND (? IS NULL OR loja_slug = ?)
      ORDER BY loja_slug, faturamento DESC
    `).all(dataInicio, dataFim, lojaSlug || null, lojaSlug || null) as typeof areaRows;
  }

  const areasByStore = new Map<string, CMVSnapshotAreaItem[]>();
  const allAreas: CMVSnapshotAreaItem[] = [];

  for (const a of areaRows) {
    const item: CMVSnapshotAreaItem = {
      lojaSlug: a.loja_slug,
      area: a.area,
      faturamento: a.faturamento,
      faturamento_percentual: a.faturamento_percentual,
      desconto: a.desconto,
      custo: a.custo,
      cmv_percentual: a.cmv_percentual,
      lucro_bruto: a.lucro_bruto,
      lucro_bruto_percentual: a.lucro_bruto_percentual
    };
    allAreas.push(item);
    if (!areasByStore.has(a.loja_slug)) {
      areasByStore.set(a.loja_slug, []);
    }
    areasByStore.get(a.loja_slug)!.push(item);
  }

  const storeItems: CMVSnapshotStoreItem[] = cmvRows.map(r => ({
    lojaSlug: r.loja_slug,
    loja_slug: r.loja_slug,
    dataInicio: r.data_inicio,
    data_inicio: r.data_inicio,
    dataFim: r.data_fim,
    data_fim: r.data_fim,
    faturamentoTotal: r.faturamento_total,
    faturamento_total: r.faturamento_total,
    descontoTotal: r.desconto_total,
    desconto_total: r.desconto_total,
    custoTotal: r.custo_total,
    custo_total: r.custo_total,
    cmvPercentual: r.cmv_percentual,
    cmv_percentual: r.cmv_percentual,
    lucroBruto: r.lucro_bruto,
    lucro_bruto: r.lucro_bruto,
    lucroBrutoPercentual: r.lucro_bruto_percentual,
    lucro_bruto_percentual: r.lucro_bruto_percentual,
    capturedAt: r.created_at,
    captured_at: r.created_at,
    areas: areasByStore.get(r.loja_slug) || []
  }));

  const presentes = storeItems.map(s => s.lojaSlug);
  const faltantes = expectedStores.filter(s => !presentes.includes(s));
  const isCompleto = faltantes.length === 0 && storeItems.length > 0;

  const statusCompletude = isCompleto
    ? `${presentes.length}/${expectedStores.length} lojas`
    : `${presentes.length}/${expectedStores.length} lojas (faltantes: ${faltantes.join(', ')})`;

  const totalFat = storeItems.reduce((acc, s) => acc + s.faturamento_total, 0);
  const totalCusto = storeItems.reduce((acc, s) => acc + s.custo_total, 0);
  const totalDesconto = storeItems.reduce((acc, s) => acc + s.desconto_total, 0);
  const totalLucro = totalFat - totalCusto;
  const cmvPct = totalFat > 0 ? Number(((totalCusto / totalFat) * 100).toFixed(2)) : 0;
  const lucroPct = totalFat > 0 ? Number(((totalLucro / totalFat) * 100).toFixed(2)) : 0;
  const latestCapturedAt = storeItems.map(s => s.captured_at).sort().reverse()[0] || '';

  return {
    dataInicio,
    dataFim,
    faturamento_total: totalFat,
    custo_total: totalCusto,
    desconto_total: totalDesconto,
    cmv_percentual: cmvPct,
    lucro_bruto: totalLucro,
    lucro_bruto_percentual: lucroPct,
    captured_at: latestCapturedAt,
    capturedAt: latestCapturedAt,
    isCompleto,
    statusCompletude,
    lojasPresentes: presentes,
    lojasFaltantes: faltantes,
    lojas: storeItems,
    areas: allAreas
  };
}