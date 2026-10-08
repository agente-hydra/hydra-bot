import type Database from 'better-sqlite3';
import type { CanonicalIntent } from './intent_rewriter.js';

export interface ManagerStoreResult {
  replyText: string;
  toolsCalled: string[];
  allowed: boolean;
}

const DENIED = 'No perfil de gerente, só posso consultar dados da sua loja. Use /perfil para conferir a unidade ativa.';

export const STORE_NAMES: Record<string, string[]> = {
  MPdompedro1: ['dom pedro', 'dompedro', 'dom pedro 1', 'dompedro1', 'd pedro'],
  MPJabaquara: ['jabaquara', 'jaba', 'jbq'],
  MPJorgeBeretta: ['jorge beretta', 'beretta'],
  MPkennedy: ['kennedy', 'kenedy', 'pres kennedy', 'presidente kennedy'],
  ReiDoOleoMaua: ['maua', 'rei do oleo', 'rei do oleo maua', 'ro maua'],
  MPpiraporinha: ['piraporinha', 'pirapora', 'pira'],
  MPplanalto: ['planalto', 'sao bernardo planalto'],
  ReiDoModulo: ['rei do modulo', 'modulo'],
  MPrudge: ['rudge ramos', 'rudge', 'ramos'],
  MPSantoAndre: ['santo andre', 'santoandre', 'sto andre'],
  MPMaster: ['master', 'loja master']
};

export const pretty: Record<string, string> = {
  MPdompedro1: 'Dom Pedro I',
  MPJabaquara: 'Jabaquara',
  MPJorgeBeretta: 'Jorge Beretta',
  MPkennedy: 'Kennedy',
  ReiDoOleoMaua: 'Rei do Óleo Mauá',
  MPpiraporinha: 'Piraporinha',
  MPplanalto: 'Planalto',
  ReiDoModulo: 'Rei do Módulo',
  MPrudge: 'Rudge Ramos',
  MPSantoAndre: 'Santo André',
  MPMaster: 'Master',
  mpdompedro1: 'Dom Pedro I',
  mpjabaquara: 'Jabaquara',
  mpjorgeberetta: 'Jorge Beretta',
  mpkennedy: 'Kennedy',
  reidooleomaua: 'Rei do Óleo Mauá',
  mppiraporinha: 'Piraporinha',
  mpplanalto: 'Planalto',
  reidomodulo: 'Rei do Módulo',
  mprudge: 'Rudge Ramos',
  mpsantoandre: 'Santo André',
  mpmaster: 'Master'
};

const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const money = (value: unknown) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const percent = (value: unknown, decimals = 2) =>
  Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + '%';

const denied = (tool = 'manager_scope_denied'): ManagerStoreResult => ({
  replyText: DENIED,
  toolsCalled: [tool],
  allowed: false
});

/** Gerente nunca herda escopo de rede, nem pode trocar de loja por texto livre. */
export function isOutsideManagerStore(message: string, storeSlug: string): boolean {
  if (!message || !storeSlug) return true;
  const text = ` ${normalize(message)} `;

  // 1. Termos de rede e escopo geral/consolidado
  if (/\b(rede|lojas|unidades|filiais|todas|todos|ranking|geral|gerais|consolidado|consolidada|consolidados|consolidadas)\b/i.test(text)) {
    return true;
  }

  // 2. Termos de comparação de lojas ou pior/melhor loja
  if (/\b(pior\s+loja|piores\s+lojas|melhor\s+loja|melhores\s+lojas|comparativo)\b/i.test(text)) {
    return true;
  }

  // 3. Detecção de apelidos de outras lojas do catálogo
  const currentSlugNorm = storeSlug.toLowerCase().trim();
  for (const [slug, aliases] of Object.entries(STORE_NAMES)) {
    if (slug.toLowerCase() === currentSlugNorm) continue;
    for (const alias of aliases) {
      const normAlias = normalize(alias);
      const escaped = normAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i');
      if (regex.test(text)) {
        return true;
      }
    }
  }

  return false;
}

/** Executa apenas SQL com loja_slug obrigatório. Nenhum worker/MCP é chamado para gerente. */
export function executeManagerStoreQuery(
  db: Database.Database,
  message: string,
  intent: CanonicalIntent,
  storeSlug: string
): ManagerStoreResult {
  // Encontra a chave canônica da loja no catálogo
  const canonicalSlug = Object.keys(STORE_NAMES).find(
    s => s.toLowerCase() === (storeSlug || '').toLowerCase().trim()
  );

  // 1. Barreira Léxica e Validação de Loja Ativa
  if (!canonicalSlug || isOutsideManagerStore(message, canonicalSlug)) {
    return denied('manager_scope_denied');
  }

  // 2. Validação de Decisão e Clarificação
  if (intent.needsClarification || (intent.contract?.decision && intent.contract.decision !== 'execute')) {
    return denied('manager_scope_denied');
  }

  // 3. Intenções Permitidas em Modo Gerente
  const allowedIntents = new Set([
    'financial_alerts',
    'store_overview',
    'store_cmv',
    'store_areas',
    'list_os',
    'os_detail',
    'aging_cars'
  ]);

  const requested = intent.subQueries?.length ? intent.subQueries : [intent];

  // Se qualquer intenção não pertencer ao conjunto estritamente permitido, recusa deterministamente
  if (requested.some(q => !allowedIntents.has(q.intent))) {
    return denied('manager_scope_denied');
  }

  // 4. Bloqueio de Escopo de Rede ou Loja Externa na Intent Principal
  if (intent.lojaSlug && intent.lojaSlug.toLowerCase() !== canonicalSlug.toLowerCase()) {
    return denied('manager_scope_denied');
  }
  if (intent.scope === 'network' || intent.scope === 'all_stores' || intent.contract?.scope === 'network') {
    return denied('manager_scope_denied');
  }
  if (
    intent.focusWorst ||
    intent.subIntent === 'worst_store' ||
    intent.subIntent === 'store_list' ||
    intent.subIntent === 'general' ||
    intent.contract?.filters?.focusWorst
  ) {
    return denied('manager_scope_denied');
  }

  const name = pretty[canonicalSlug] || pretty[canonicalSlug.toLowerCase()] || canonicalSlug;
  const parts: string[] = [];
  const tools: string[] = [];

  for (const query of requested) {
    // 5. Blindagem de Sub-queries e Planos Estruturados
    const targets = [
      query.lojaSlug,
      query.contract?.plan?.targetLojaSlug,
      query.contract?.entities?.loja?.slug,
      ...(query.answerRequirements || []).map(r => r.targetLojaSlug)
    ];
    if (targets.some(target => target && target.toLowerCase() !== canonicalSlug.toLowerCase())) {
      return denied('manager_scope_denied');
    }

    if (
      query.focusWorst ||
      query.subIntent === 'worst_store' ||
      query.subIntent === 'store_list' ||
      query.subIntent === 'general' ||
      query.contract?.filters?.focusWorst ||
      query.scope === 'network' ||
      query.scope === 'all_stores' ||
      query.contract?.scope === 'network'
    ) {
      return denied('manager_scope_denied');
    }

    // 6. Execução Determinística das Consultas SQL por Intenção (100% WHERE loja_slug = ?)
    if (query.intent === 'financial_alerts' || query.intent === 'store_overview') {
      if (query.noDeposit) {
        const alerts = db.prepare(`
          SELECT os_id, placa, veiculo, valor_restante FROM ordens_servico
          WHERE loja_slug = ? AND is_aberta = 1 AND valor_restante >= 2500
          ORDER BY valor_restante DESC LIMIT 5
        `).all(canonicalSlug) as any[];
        parts.push(
          alerts.length
            ? `> *${name} — Saldos pendentes*\n${alerts.map(r => `- OS #${r.os_id}: ${r.veiculo || 'Veículo'} (${r.placa || 'sem placa'}) — ${money(r.valor_restante)}`).join('\n')}`
            : `> *${name} — Saldos pendentes*\nNenhum alerta encontrado nesta loja.`
        );
        tools.push('manager_store_alerts');
        continue;
      }

      const row = db.prepare(`
        SELECT faturamento_mes, volume_os, ticket_medio, meta_mes, percentual_meta, data_referencia, posicao_hora
        FROM metas_diarias WHERE loja_slug = ? ORDER BY data_referencia DESC, id DESC LIMIT 1
      `).get(canonicalSlug) as any;

      if (!row) {
        parts.push(`> *${name} — Faturamento*\nDados não disponíveis para esta loja.`);
      } else {
        parts.push(
          `> *${name} — Faturamento*\n- Faturamento: ${money(row.faturamento_mes)}\n- Meta: ${money(row.meta_mes)}\n- Atingimento: ${percent(row.percentual_meta, 1)}\n- OSs no período: ${row.volume_os}\n- Ticket médio: ${money(row.ticket_medio)}\n- Posição: ${row.data_referencia} ${row.posicao_hora || ''}`
        );
      }
      tools.push('manager_store_revenue');
    } else if (query.intent === 'store_cmv') {
      const area = query.targetArea || query.contract?.plan?.targetArea || query.contract?.filters?.area;
      const row = area
        ? db.prepare(`
            SELECT cmv_percentual, faturamento, custo, data_inicio, data_fim
            FROM faturamento_areas
            WHERE loja_slug = ? AND UPPER(area) = UPPER(?)
            ORDER BY data_fim DESC, id DESC LIMIT 1
          `).get(canonicalSlug, area) as any
        : db.prepare(`
            SELECT cmv_percentual, faturamento_total, custo_total, data_inicio, data_fim
            FROM cmv_lojas
            WHERE loja_slug = ?
            ORDER BY data_fim DESC, id DESC LIMIT 1
          `).get(canonicalSlug) as any;

      if (!row) {
        parts.push(`> *${name} — CMV${area ? ` de ${area}` : ''}*\nDados não disponíveis para esta loja.`);
      } else {
        parts.push(
          `> *${name} — CMV${area ? ` de ${area}` : ''}*\n- CMV: ${percent(row.cmv_percentual, 2)}\n- Faturamento: ${money(row.faturamento ?? row.faturamento_total)}\n- Custo: ${money(row.custo ?? row.custo_total)}\n- Período: ${row.data_inicio} a ${row.data_fim}`
        );
      }
      tools.push('manager_store_cmv');
    } else if (query.intent === 'store_areas') {
      const rows = db.prepare(`
        SELECT area, faturamento, cmv_percentual, data_inicio, data_fim FROM faturamento_areas
        WHERE loja_slug = ? AND data_fim = (SELECT MAX(data_fim) FROM faturamento_areas WHERE loja_slug = ?)
        ORDER BY faturamento DESC
      `).all(canonicalSlug, canonicalSlug) as any[];

      parts.push(
        rows.length
          ? `> *${name} — Áreas*\n${rows.map(r => `- ${r.area}: ${money(r.faturamento)} | CMV ${percent(r.cmv_percentual, 2)}`).join('\n')}\nPeríodo: ${rows[0].data_inicio} a ${rows[0].data_fim}`
          : `> *${name} — Áreas*\nDados não disponíveis para esta loja.`
      );
      tools.push('manager_store_areas');
    } else {
      // Intenções de OS: list_os, os_detail, aging_cars
      const osId = query.osId;
      const placa = query.placa;
      const isAging = query.intent === 'aging_cars';
      const minDays = isAging ? 5 : 0;

      const rows = db.prepare(`
        SELECT os_id, placa, veiculo, status_grid, is_aberta, total_os, valor_restante, dias_no_patio
        FROM ordens_servico WHERE loja_slug = ?
          AND (? IS NULL OR os_id = ?)
          AND (? IS NULL OR UPPER(placa) = UPPER(?))
          AND (? = 0 OR dias_no_patio >= ?)
          AND (? = 1 OR is_aberta = 1)
        ORDER BY total_os DESC LIMIT 10
      `).all(
        canonicalSlug,
        osId || null,
        osId || null,
        placa || null,
        placa || null,
        minDays,
        minDays,
        osId || placa ? 1 : 0
      ) as any[];

      const headerTitle = isAging ? 'Veículos Retidos no Pátio (> 5 dias)' : 'OSs';
      parts.push(
        rows.length
          ? `> *${name} — ${headerTitle}*\n${rows.map(r => `- OS #${r.os_id}: ${r.veiculo || 'Veículo'} (${r.placa || 'sem placa'}) — ${money(r.total_os)} | ${r.status_grid || (r.is_aberta ? 'Aberta' : 'Fechada')}`).join('\n')}`
          : `> *${name} — ${headerTitle}*\nNenhuma OS encontrada nesta loja.`
      );
      tools.push('manager_store_os');
    }
  }

  return { replyText: parts.join('\n\n'), toolsCalled: tools, allowed: true };
}
