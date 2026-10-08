import type Database from 'better-sqlite3';
import type { CanonicalIntent } from './intent_rewriter.js';
import { getOSDetails } from './db_repository.js';

export interface ConsultedData {
  fonte: string;
  periodo?: string;
  dados: any;
  descricao?: string;
}

export interface ManagerStoreResult {
  replyText: string;
  toolsCalled: string[];
  allowed: boolean;
  understood?: boolean;
  dadosConsultados?: ConsultedData[];
}

const DENIED = 'No perfil de gerente, você só pode consultar informações da sua unidade. Para acessar dados de outras lojas ou da rede completa, use o comando /socio.';
const UNSUPPORTED = 'Não consigo consultar esse assunto com segurança no perfil de gerente. Peça dados de faturamento, meta, CMV ou OS da sua loja.';

const STORE_NAMES: Record<string, string[]> = {
  MPdompedro1: ['dom pedro', 'dompedro'],
  MPJabaquara: ['jabaquara'],
  MPJorgeBeretta: ['jorge beretta', 'beretta'],
  MPkennedy: ['kennedy', 'kenedy'],
  ReiDoOleoMaua: ['maua', 'rei do oleo'],
  MPpiraporinha: ['piraporinha', 'pirapora'],
  MPplanalto: ['planalto'],
  ReiDoModulo: ['rei do modulo', 'modulo'],
  MPrudge: ['rudge ramos', 'rudge'],
  MPSantoAndre: ['santo andre', 'santoandre'],
  MPMaster: ['master']
};

export const pretty: Record<string, string> = {
  MPdompedro1: 'Dom Pedro I', MPJabaquara: 'Jabaquara', MPJorgeBeretta: 'Jorge Beretta',
  MPkennedy: 'Kennedy', ReiDoOleoMaua: 'Rei do Óleo Mauá', MPpiraporinha: 'Piraporinha',
  MPplanalto: 'Planalto', ReiDoModulo: 'Rei do Módulo', MPrudge: 'Rudge Ramos',
  MPSantoAndre: 'Santo André', MPMaster: 'Master'
};

const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
export const money = (value: unknown) => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const denied = (): ManagerStoreResult => ({ replyText: DENIED, toolsCalled: ['manager_scope_denied'], allowed: false, understood: false, dadosConsultados: [] });
const unsupported = (): ManagerStoreResult => ({ replyText: UNSUPPORTED, toolsCalled: ['manager_scope_unsupported'], allowed: false, understood: false, dadosConsultados: [] });

/** Verifica se a mensagem cita explicitamente outra loja da rede */
export function mentionsOtherStore(message: string, storeSlug: string): boolean {
  const text = ` ${normalize(message)} `;
  for (const [slug, aliases] of Object.entries(STORE_NAMES)) {
    if (slug === storeSlug) continue;
    if (aliases.some(alias => new RegExp(`(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9])`).test(text))) {
      return true;
    }
  }
  return false;
}

/** Gerente nunca herda escopo de rede, nem pode trocar de loja por texto livre. */
export function isOutsideManagerStore(message: string, storeSlug: string): boolean {
  const text = ` ${normalize(message)} `;

  // 1. Menção explícita a qualquer outra loja da rede
  if (mentionsOtherStore(message, storeSlug)) return true;

  // 2. Termos de escopo global de rede ou múltiplas lojas
  if (/\b(rede|todas as lojas|todas lojas|todas as unidades|todas unidades|todas as filiais|todas filiais|outras lojas|outra loja|demais lojas)\b/.test(text)) {
    return true;
  }

  // 3. Qualificadores locais ("minha loja", "minhas ordens", ou menção ao nome da própria loja)
  const ownAliases = STORE_NAMES[storeSlug] || [];
  const mentionsOwnStore = ownAliases.some(alias => text.includes(alias));
  const hasLocalQualifier = mentionsOwnStore || /\b(da minha loja|na minha loja|minha loja|minha unidade|minhas ordens|meus carros|minhas os|do meu patio|no meu patio|meu patio|daqui|dessa loja|desta loja|nesta loja)\b/.test(text);

  if (hasLocalQualifier) {
    // Se qualificado localmente, permite "todos", "todas" e "ranking" local
    // Ex: "todos os carros da minha loja", "ranking das minhas ordens"
    if (/\b(lojas|unidades|filiais)\b/.test(text) && !/\b(minha loja|minha unidade)\b/.test(text)) {
      return true;
    }
    return false;
  }

  // 4. Sem qualificador local, termos de agregação ampla ou rede são barrados
  if (/\b(rede|lojas|unidades|filiais|todas|todos|ranking)\b/.test(text)) {
    return true;
  }

  return false;
}

/**
 * Guarda de escopo efetivo (E1-E3): injeta activeLojaSlug estrito e barra qualquer
 * tentativa de consulta a dados de rede ou de outras lojas quando o operador for gerente.
 */
export function enforceManagerScope(options: {
  persona?: string;
  activeLojaSlug: string;
  requestedLojaSlug?: string;
  message?: string;
}): { allowed: boolean; reason?: string; effectiveLojaSlug: string; replyText?: string } {
  const { persona, activeLojaSlug, requestedLojaSlug, message } = options;

  if (persona === 'gerente') {
    // 1. Barrar se tentar solicitar outra loja explicitamente
    if (requestedLojaSlug && requestedLojaSlug.toLowerCase() !== activeLojaSlug.toLowerCase()) {
      return {
        allowed: false,
        reason: 'CROSS_STORE_FORBIDDEN',
        effectiveLojaSlug: activeLojaSlug,
        replyText: DENIED
      };
    }
    // 2. Barrar se a mensagem textual tentar pedir dados de rede ou de outra loja
    if (message && isOutsideManagerStore(message, activeLojaSlug)) {
      return {
        allowed: false,
        reason: 'NETWORK_SCOPE_FORBIDDEN',
        effectiveLojaSlug: activeLojaSlug,
        replyText: DENIED
      };
    }
  }

  return {
    allowed: true,
    effectiveLojaSlug: persona === 'gerente' ? activeLojaSlug : (requestedLojaSlug || activeLojaSlug)
  };
}

/** Executa apenas SQL com loja_slug obrigatório. */
export function executeManagerStoreQuery(
  db: Database.Database,
  message: string,
  intent: CanonicalIntent,
  storeSlug: string
): ManagerStoreResult {
  if (!STORE_NAMES[storeSlug] || isOutsideManagerStore(message, storeSlug)) return denied();
  if (intent.needsClarification || (intent.contract?.decision && intent.contract.decision !== 'execute')) return unsupported();
  const requested = intent.subQueries?.length ? intent.subQueries : [intent];
  const allowedIntents = new Set(['financial_alerts', 'store_overview', 'store_cmv', 'store_areas', 'list_os', 'os_detail', 'aging_cars']);
  if (requested.some(q => !allowedIntents.has(q.intent))) return unsupported();
  if (intent.lojaSlug && intent.lojaSlug.toLowerCase() !== storeSlug.toLowerCase()) return denied();
  if ((intent as any).targetLojaSlug && (intent as any).targetLojaSlug.toLowerCase() !== storeSlug.toLowerCase()) return denied();
  if ((intent as any).params?.lojaSlug && (intent as any).params.lojaSlug.toLowerCase() !== storeSlug.toLowerCase()) return denied();
  const name = pretty[storeSlug] || storeSlug;
  const parts: string[] = [];
  const tools: string[] = [];
  const dadosConsultados: ConsultedData[] = [];

  for (const query of requested) {
    // Exija também que o plano estruturado não aponte para outra loja.
    const targets = [query.lojaSlug, (query as any).targetLojaSlug, (query as any).params?.lojaSlug, query.contract?.plan?.targetLojaSlug, query.contract?.entities?.loja?.slug,
      ...(query.answerRequirements || []).map(r => r.targetLojaSlug)];
    if (targets.some(target => target && target.toLowerCase() !== storeSlug.toLowerCase())) return denied();
    if (query.focusWorst || query.subIntent === 'worst_store' || query.contract?.filters?.focusWorst) return denied();

    if (query.intent === 'financial_alerts' || query.intent === 'store_overview') {
      if (query.noDeposit) {
        const alerts = db.prepare(`
          SELECT os_id, placa, veiculo, valor_restante FROM ordens_servico
          WHERE loja_slug = ? AND is_aberta = 1 AND valor_restante >= 2500
          ORDER BY valor_restante DESC LIMIT 5
        `).all(storeSlug) as any[];
        parts.push(alerts.length ? `> *${name} — Saldos pendentes*\n${alerts.map(r => `- OS #${r.os_id}: ${r.veiculo || 'Veículo'} (${r.placa || 'sem placa'}) — ${money(r.valor_restante)}`).join('\n')}` : `> *${name} — Saldos pendentes*\nNenhum alerta encontrado nesta loja.`);
        tools.push('manager_store_alerts');
        dadosConsultados.push({ fonte: 'ordens_servico_alertas', dados: alerts });
        continue;
      }
      const row = db.prepare(`
        SELECT faturamento_mes, volume_os, ticket_medio, meta_mes, percentual_meta, data_referencia, posicao_hora
        FROM metas_diarias WHERE loja_slug = ? ORDER BY data_referencia DESC, id DESC LIMIT 1
      `).get(storeSlug) as any;
      if (!row) parts.push(`> *${name} — Faturamento*\nDados não disponíveis para esta loja.`);
      else {
        parts.push(`> *${name} — Faturamento*\n- Faturamento: ${money(row.faturamento_mes)}\n- Meta: ${money(row.meta_mes)}\n- Atingimento: ${Number(row.percentual_meta || 0).toFixed(1)}%\n- OSs no período: ${row.volume_os}\n- Ticket médio: ${money(row.ticket_medio)}\n- Posição: ${row.data_referencia} ${row.posicao_hora || ''}`);
        dadosConsultados.push({ fonte: 'metas_diarias', periodo: `${row.data_referencia} ${row.posicao_hora || ''}`, dados: row });
      }
      tools.push('manager_store_revenue');
    } else if (query.intent === 'store_cmv') {
      const area = query.targetArea || query.contract?.plan?.targetArea || query.contract?.filters?.area;
      const row = area
        ? db.prepare('SELECT cmv_percentual, faturamento, custo, data_inicio, data_fim FROM faturamento_areas WHERE loja_slug = ? AND UPPER(area) = UPPER(?) ORDER BY data_fim DESC, id DESC LIMIT 1').get(storeSlug, area) as any
        : db.prepare('SELECT cmv_percentual, faturamento_total, custo_total, data_inicio, data_fim FROM cmv_lojas WHERE loja_slug = ? ORDER BY data_fim DESC, id DESC LIMIT 1').get(storeSlug) as any;
      if (!row) parts.push(`> *${name} — CMV${area ? ` de ${area}` : ''}*\nDados não disponíveis para esta loja.`);
      else {
        parts.push(`> *${name} — CMV${area ? ` de ${area}` : ''}*\n- CMV: ${Number(row.cmv_percentual).toFixed(2)}%\n- Faturamento: ${money(row.faturamento ?? row.faturamento_total)}\n- Custo: ${money(row.custo ?? row.custo_total)}\n- Período: ${row.data_inicio} a ${row.data_fim}`);
        dadosConsultados.push({ fonte: 'cmv_lojas', periodo: `${row.data_inicio} a ${row.data_fim}`, dados: row });
      }
      tools.push('manager_store_cmv');
    } else if (query.intent === 'store_areas') {
      const rows = db.prepare(`
        SELECT area, faturamento, cmv_percentual, data_inicio, data_fim FROM faturamento_areas
        WHERE loja_slug = ? AND data_fim = (SELECT MAX(data_fim) FROM faturamento_areas WHERE loja_slug = ?)
        ORDER BY faturamento DESC
      `).all(storeSlug, storeSlug) as any[];
      parts.push(rows.length ? `> *${name} — Áreas*\n${rows.map(r => `- ${r.area}: ${money(r.faturamento)} | CMV ${Number(r.cmv_percentual).toFixed(2)}%`).join('\n')}\nPeríodo: ${rows[0].data_inicio} a ${rows[0].data_fim}` : `> *${name} — Áreas*\nDados não disponíveis para esta loja.`);
      tools.push('manager_store_areas');
      if (rows.length) {
        dadosConsultados.push({ fonte: 'faturamento_areas', periodo: `${rows[0].data_inicio} a ${rows[0].data_fim}`, dados: rows });
      }
    } else if (query.intent === 'os_detail' && query.osId) {
      const osId = String(query.osId).replace(/\D/g, '');
      const osDetail = getOSDetails(db, { os_id: osId, loja_slug: storeSlug });
      if (!osDetail) {
        parts.push(`> *${name} — OS #${osId}*\nNenhuma OS encontrada nesta loja.`);
        tools.push('manager_store_os');
        dadosConsultados.push({ fonte: 'ordens_servico', dados: null });
        continue;
      }
      const blocks: string[] = [
        `> *Ficha Completa: OS #${osDetail.osId} — ${name}*`,
        `- *Veículo:* ${osDetail.veiculo} (${osDetail.placa})`,
        `- *Cliente:* ${osDetail.clienteNome}`,
        `- *Responsável:* ${osDetail.responsavel || 'Não informado'}`,
        `- *Status:* ${osDetail.situacao}`,
        `- *Valor Total:* ${money(osDetail.valorTotal)} (Pago: ${money(osDetail.valorPago)}, Restante: ${money(osDetail.saldoDevedor)})`,
        `- *Tempo no pátio:* ${osDetail.diasNoPatio} dias`
      ];

      if (osDetail.servicos && osDetail.servicos.length > 0) {
        blocks.push(`> *Serviços Discriminados:*\n${osDetail.servicos.map(s => `- ${s.descricao}: ${money(s.valorTotal)}${s.executor ? ` (Executor: ${s.executor})` : ''}`).join('\n')}`);
      }

      if (osDetail.pagamentos && osDetail.pagamentos.length > 0) {
        blocks.push(`> *Formas de Pagamento e Parcelas:*\n${osDetail.pagamentos.map(p => `- Parcela ${p.parcela}: ${money(p.valor)} (${p.modalidade}${p.vencimento ? `, Venc: ${p.vencimento}` : ''})`).join('\n')}`);
      }

      if (osDetail.checklistAudit?.detalhes) {
        blocks.push(`> *Documentos e Checklists:*\n- Checklists: ${osDetail.checklistAudit.detalhes}\n- Nota Fiscal: ${osDetail.temNf ? 'Emitida' : 'Não emitida'}`);
      }

      parts.push(blocks.join('\n\n'));
      tools.push('get_os_details');
      dadosConsultados.push({ fonte: 'get_os_details', dados: osDetail });
      continue;
    } else {
      // OS, placa e veículos: toda busca usa a loja da sessão como primeiro predicado.
      const osId = query.osId;
      const placa = query.placa;
      const minDays = query.intent === 'aging_cars' ? 5 : 0;
      const rows = db.prepare(`
        SELECT os_id, placa, veiculo, status_grid, is_aberta, total_os, valor_restante, dias_no_patio
        FROM ordens_servico WHERE loja_slug = ?
          AND (? IS NULL OR os_id = ?)
          AND (? IS NULL OR UPPER(placa) = UPPER(?))
          AND (? = 0 OR dias_no_patio >= ?)
          AND (? = 1 OR is_aberta = 1)
        ORDER BY total_os DESC LIMIT 10
      `).all(storeSlug, osId || null, osId || null, placa || null, placa || null, minDays, minDays, osId || placa ? 1 : 0) as any[];
      parts.push(rows.length ? `> *${name} — OSs*\n${rows.map(r => `- OS #${r.os_id}: ${r.veiculo || 'Veículo'} (${r.placa || 'sem placa'}) — ${money(r.total_os)} | ${r.status_grid || (r.is_aberta ? 'Aberta' : 'Fechada')}`).join('\n')}` : `> *${name} — OSs*\nNenhuma OS encontrada nesta loja.`);
      tools.push('manager_store_os');
      dadosConsultados.push({ fonte: 'ordens_servico', dados: rows });
    }
  }
  return { replyText: parts.join('\n\n'), toolsCalled: tools, allowed: true, understood: true, dadosConsultados };
}

/**
 * Executa ferramenta em decisão CONSULTAR do AI Reviewer.
 * Garantia arquitetural: vincula estritamente à authorizedStoreSlug.
 */
export function executeManagerTool(
  db: Database.Database,
  toolName: string,
  params: Record<string, any> | undefined,
  authorizedStoreSlug: string
): { replyText: string; toolCalled: string; dados: any; fonte: string; periodo?: string; allowed?: boolean } {
  // Guarda de escopo efetivo estrito: se parâmetros tentarem especificar outra loja, bloqueia
  const requestedLoja = params?.lojaSlug || params?.loja_slug || params?.targetLojaSlug || params?.storeSlug;
  if (requestedLoja && String(requestedLoja).toLowerCase() !== authorizedStoreSlug.toLowerCase()) {
    return {
      replyText: DENIED,
      toolCalled: 'manager_scope_denied',
      fonte: 'manager_store_access',
      dados: { error: 'CROSS_STORE_ACCESS_DENIED', authorizedStoreSlug, requestedLoja },
      allowed: false
    };
  }

  const name = pretty[authorizedStoreSlug] || authorizedStoreSlug;
  const tool = (toolName || '').toLowerCase().trim();

  if (tool === 'get_os_details' || tool === 'os_detail') {
    const rawOs = params?.osId || params?.os_id || '';
    const osId = String(rawOs).replace(/\D/g, '');
    const osDetail = getOSDetails(db, { os_id: osId, loja_slug: authorizedStoreSlug });

    if (!osDetail) {
      return {
        replyText: `> *Ficha de OS — ${name}*\nNenhuma OS #${osId} localizada nesta unidade.`,
        toolCalled: 'get_os_details',
        fonte: 'get_os_details',
        dados: { osId, found: false }
      };
    }

    const saldoTxt = osDetail.saldoDevedor > 0
      ? ` (Saldo: *${money(osDetail.saldoDevedor)}*)`
      : ' (Quitado)';

    const blocks: string[] = [
      `> *OS #${osDetail.osId} — ${(osDetail.veiculo || 'VEÍCULO').toUpperCase()} (${osDetail.placa || 'Sem placa'})*\n` +
      `- *Loja:* ${name}\n` +
      `- *Status:* *${osDetail.situacao || (osDetail.isAberta ? 'Aberta' : 'Fechada')}*\n` +
      `- *Permanência:* ${osDetail.diasNoPatio || 0} dia(s) no pátio\n` +
      `- *Cliente:* ${osDetail.clienteNome || 'Não informado'}\n` +
      `- *Responsável:* ${osDetail.responsavel || 'Não informado'}\n` +
      `- *Valor Total:* *${money(osDetail.valorTotal)}*${saldoTxt}`
    ];

    if (osDetail.servicos && osDetail.servicos.length > 0) {
      const servicosLines = osDetail.servicos.map(s => 
        `- ${s.descricao}: *${money(s.valorTotal)}*${s.executor ? ` (${s.executor})` : ''}`
      ).join('\n');
      blocks.push(`----------------------------------------\n> *Serviços Discriminados*\n${servicosLines}`);
    }

    if (osDetail.pagamentos && osDetail.pagamentos.length > 0) {
      const pagLines = osDetail.pagamentos.map(p => 
        `- Parcela ${p.parcela}: *${money(p.valor)}* (${p.modalidade}${p.vencimento ? `, Venc: ${p.vencimento}` : ''})`
      ).join('\n');
      blocks.push(`----------------------------------------\n> *Formas de Pagamento*\n${pagLines}`);
    }

    const docLines: string[] = [];
    if (osDetail.extracaoCompleta === false || (osDetail as any).extracao_completa === false) {
      docLines.push(`- *Checklists:* Sincronização detalhada do ERP em andamento.`);
    } else {
      const temEntrada = osDetail.checklistAudit?.temChecklistEntrada;
      const temMec = osDetail.checklistAudit?.temChecklistMecanico;
      docLines.push(`- *Checklist de Entrada:* ${temEntrada ? '✅ Realizado' : '⚠️ Pendente'}`);
      docLines.push(`- *Checklist do Mecânico:* ${temMec ? '✅ Realizado' : '⚠️ Pendente'}`);
      if (osDetail.checklists && osDetail.checklists.length > 0) {
        for (const cl of osDetail.checklists) {
          docLines.push(`  └ *${cl.tipo}:* ${cl.status} (${cl.realizado_por || 'Técnico'}, ${cl.data})`);
        }
      }
    }
    docLines.push(`- *Nota Fiscal:* ${osDetail.temNf ? 'Emitida/vinculada' : 'Não emitida'}`);
    blocks.push(`----------------------------------------\n> *Vistorias e Documentos*\n${docLines.join('\n')}`);

    const replyText = blocks.join('\n\n');

    return {
      replyText,
      toolCalled: 'get_os_details',
      fonte: 'get_os_details',
      dados: osDetail
    };
  }

  if (tool === 'get_os_list' || tool === 'manager_store_os' || tool === 'list_os') {
    const limit = Number(params?.limit) || 10;
    const onlyOpen = params?.onlyOpen !== false ? 1 : 0;
    const rows = db.prepare(`
      SELECT os_id, placa, veiculo, status_grid, is_aberta, total_os, valor_restante, dias_no_patio
      FROM ordens_servico
      WHERE loja_slug = ? AND (? = 0 OR is_aberta = 1)
      ORDER BY total_os DESC LIMIT ?
    `).all(authorizedStoreSlug, onlyOpen, limit) as any[];

    const replyText = rows.length
      ? `> *${name} — Ordens de Serviço*\n${rows.map(r => `- OS #${r.os_id}: ${r.veiculo || 'Veículo'} (${r.placa || 'sem placa'}) — ${money(r.total_os)} | ${r.status_grid || (r.is_aberta ? 'Aberta' : 'Fechada')}`).join('\n')}`
      : `> *${name} — Ordens de Serviço*\nNenhuma OS em aberto encontrada nesta unidade.`;

    return {
      replyText,
      toolCalled: 'get_os_list',
      fonte: 'ordens_servico',
      dados: rows
    };
  }

  if (tool === 'get_cmv' || tool === 'manager_store_cmv' || tool === 'store_cmv') {
    const area = params?.area || params?.targetArea;
    const row = area
      ? db.prepare('SELECT cmv_percentual, faturamento, custo, data_inicio, data_fim FROM faturamento_areas WHERE loja_slug = ? AND UPPER(area) = UPPER(?) ORDER BY data_fim DESC, id DESC LIMIT 1').get(authorizedStoreSlug, area) as any
      : db.prepare('SELECT cmv_percentual, faturamento_total, custo_total, data_inicio, data_fim FROM cmv_lojas WHERE loja_slug = ? ORDER BY data_fim DESC, id DESC LIMIT 1').get(authorizedStoreSlug) as any;

    if (!row) {
      return {
        replyText: `> *${name} — CMV${area ? ` de ${area}` : ''}*\nDados de CMV não disponíveis para esta loja.`,
        toolCalled: 'get_cmv',
        fonte: 'cmv_lojas',
        dados: null
      };
    }

    const replyText = [
      `> *${name} — CMV${area ? ` de ${area}` : ''}*`,
      `- CMV: ${Number(row.cmv_percentual).toFixed(2)}%`,
      `- Faturamento: ${money(row.faturamento ?? row.faturamento_total)}`,
      `- Custo: ${money(row.custo ?? row.custo_total)}`,
      `- Período: ${row.data_inicio} a ${row.data_fim}`
    ].join('\n');

    return {
      replyText,
      toolCalled: 'get_cmv',
      fonte: 'cmv_lojas',
      periodo: `${row.data_inicio} a ${row.data_fim}`,
      dados: row
    };
  }

  if (tool === 'get_store_revenue' || tool === 'manager_store_revenue' || tool === 'financial_alerts') {
    const row = db.prepare(`
      SELECT faturamento_mes, volume_os, ticket_medio, meta_mes, percentual_meta, data_referencia, posicao_hora
      FROM metas_diarias WHERE loja_slug = ? ORDER BY data_referencia DESC, id DESC LIMIT 1
    `).get(authorizedStoreSlug) as any;

    if (!row) {
      return {
        replyText: `> *${name} — Faturamento*\nDados de faturamento não disponíveis para esta loja.`,
        toolCalled: 'get_store_revenue',
        fonte: 'metas_diarias',
        dados: null
      };
    }

    const fat = Number(row.faturamento_mes || 0);
    const meta = Number(row.meta_mes || 0);
    const ating = meta > 0 ? Number(((fat / meta) * 100).toFixed(2)) : 0;
    const falta = Math.max(0, meta - fat);
    row.percentual_meta = ating;
    row.atingimento_pct = ating;
    row.valor_faltante = falta;

    const replyText = [
      `> *${name} — Faturamento*`,
      `- Faturamento: ${money(fat)}`,
      `- Meta: ${money(meta)}`,
      `- Atingimento: ${ating.toFixed(1)}%`,
      `- Falta para Meta: ${money(falta)}`,
      `- OSs no período: ${row.volume_os}`,
      `- Ticket médio: ${money(row.ticket_medio)}`,
      `- Posição: ${row.data_referencia} ${row.posicao_hora || ''}`
    ].join('\n');

    return {
      replyText,
      toolCalled: 'get_store_revenue',
      fonte: 'metas_diarias',
      periodo: `${row.data_referencia} ${row.posicao_hora || ''}`,
      dados: row
    };
  }

  // Fallback para overview
  const row = db.prepare(`
    SELECT faturamento_mes, volume_os, ticket_medio, meta_mes, percentual_meta, data_referencia, posicao_hora
    FROM metas_diarias WHERE loja_slug = ? ORDER BY data_referencia DESC, id DESC LIMIT 1
  `).get(authorizedStoreSlug) as any;

  if (row) {
    const fat = Number(row.faturamento_mes || 0);
    const meta = Number(row.meta_mes || 0);
    const ating = meta > 0 ? Number(((fat / meta) * 100).toFixed(2)) : 0;
    const falta = Math.max(0, meta - fat);
    row.percentual_meta = ating;
    row.atingimento_pct = ating;
    row.valor_faltante = falta;
  }

  return {
    replyText: row
      ? `> *${name} — Situação Geral*\n- Faturamento: ${money(row.faturamento_mes)}\n- Meta: ${money(row.meta_mes)}\n- Atingimento: ${Number(row.percentual_meta || 0).toFixed(1)}%\n- Falta para Meta: ${money(row.valor_faltante || 0)}`
      : `> *${name} — Situação Geral*\nDados operacionais não encontrados.`,
    toolCalled: 'get_store_overview',
    fonte: 'metas_diarias',
    dados: row
  };
}

/**
 * Compõe diretamente por template factual com os dados da ferramenta
 * para nunca ultrapassar o teto global de 50.000 ms quando o saldo for inferior a 15s.
 */
export function composeFactualTemplate(
  lojaNome: string,
  dadosConsultados: ConsultedData[]
): string {
  if (!dadosConsultados || dadosConsultados.length === 0) {
    return `> *${lojaNome} — Informações Operacionais*\nNenhum dado localizado para esta consulta na sua unidade.`;
  }

  const sections: string[] = [];

  for (const item of dadosConsultados) {
    if (item.fonte === 'cmv_lojas' && item.dados) {
      const d = item.dados;
      sections.push([
        `> *${lojaNome} — CMV*`,
        `- CMV: ${Number(d.cmv_percentual).toFixed(2)}%`,
        `- Faturamento: ${money(d.faturamento_total ?? d.faturamento)}`,
        `- Custo: ${money(d.custo_total ?? d.custo)}`,
        d.data_inicio && d.data_fim ? `- Período: ${d.data_inicio} a ${d.data_fim}` : ''
      ].filter(Boolean).join('\n'));
    } else if (item.fonte === 'ordens_servico' || item.fonte === 'get_os_list') {
      const rows = Array.isArray(item.dados) ? item.dados : [];
      if (rows.length) {
        sections.push(`> *${lojaNome} — Ordens de Serviço*\n${rows.map((r: any) => `- OS #${r.os_id}: ${r.veiculo || 'Veículo'} (${r.placa || 'sem placa'}) — ${money(r.total_os)} | ${r.status_grid || (r.is_aberta ? 'Aberta' : 'Fechada')}`).join('\n')}`);
      }
    } else if ((item.fonte === 'get_os_details' || item.fonte === 'os_detail') && item.dados) {
      const r = item.dados;
      if (r.found === false) {
        sections.push(`> *Ficha de OS — ${lojaNome}*\nNenhuma OS #${r.osId || ''} localizada nesta unidade.`);
      } else {
        sections.push([
          `> *Ficha Completa: OS #${r.os_id} — ${lojaNome}*`,
          `- *Veículo:* ${r.veiculo || 'Não informado'} (${r.placa || 'Sem placa'})`,
          `- *Cliente:* ${r.cliente_nome || 'Não informado'}`,
          `- *Responsável:* ${r.responsavel || 'Não informado'}`,
          `- *Status:* ${r.status_grid || (r.is_aberta ? 'Aberta' : 'Fechada')}`,
          `- *Valor Total:* ${money(r.total_os)}`,
          `- *Valor Pago:* ${money(r.valor_pago)} | *Restante:* ${money(r.valor_restante)}`,
          `- *Tempo no pátio:* ${r.dias_no_patio || 0} dias`
        ].join('\n'));
      }
    } else if ((item.fonte === 'metas_diarias' || item.fonte === 'metas_horarias' || item.fonte === 'get_store_revenue') && item.dados) {
      const r = item.dados;
      const fat = Number(r.faturamento_mes || r.faturamentoMes || 0);
      const meta = Number(r.meta_mes || r.metaMes || 0);
      const ating = meta > 0 ? Number(((fat / meta) * 100).toFixed(2)) : (r.percentual_meta || 0);
      const falta = Math.max(0, meta - fat);
      sections.push([
        `> *${lojaNome} — Faturamento*`,
        `- Faturamento: ${money(fat)}`,
        `- Meta: ${money(meta)}`,
        `- Atingimento: ${ating.toFixed(1)}%`,
        `- Falta para Meta: ${money(falta)}`,
        `- OSs no período: ${r.volume_os || r.volumeOs || 0}`,
        `- Ticket médio: ${money(r.ticket_medio || r.ticketMedio || 0)}`,
        r.data_referencia ? `- Posição: ${r.data_referencia} ${r.posicao_hora || ''}` : ''
      ].filter(Boolean).join('\n'));
    } else if (item.fonte === 'faturamento_areas' && Array.isArray(item.dados)) {
      const rows = item.dados;
      if (rows.length) {
        sections.push(`> *${lojaNome} — Áreas*\n${rows.map((r: any) => `- ${r.area}: ${money(r.faturamento)} | CMV ${Number(r.cmv_percentual).toFixed(2)}%`).join('\n')}`);
      }
    }
  }

  return sections.length > 0
    ? sections.join('\n\n')
    : `> *${lojaNome} — Informações Operacionais*\nDados operacionais consultados com sucesso.`;
}