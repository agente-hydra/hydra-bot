import { type Page } from 'playwright';
import type Database from 'better-sqlite3';
import {
  carregarStoreLoja,
  salvarStoreLoja,
  type OSStore
} from './delta_storage.ts';

export interface ResumoPatioAtivoLoja {
  slugLoja: string;
  totalAbertasNativo: number;
  openOsIds: string[];
  inspecionadasFinanceiro: number;
  duracaoMs: number;
}

export type DatabaseInstance = Database.Database;

/**
 * Resolução de índices das colunas da grade nativa de OS
 * Layout observado no ERP (Oficina Integrada):
 * 0: Código (OS ID)
 * 1: Data (DD/MM/YYYY)
 * 2: Início (HH:mm)
 * 3: Fim (HH:mm)
 * 4: Veículo
 * 5: Placa
 * 6: Cliente
 * 7: Previsão
 * 8: Responsável
 * 9: Pesquisa
 * 10: Status
 */
export function resolverIndicesGrid(headerTexts: string[]): Record<string, number> {
  const norm = (s: string) => (s || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const findCol = (terms: string[]) => headerTexts.findIndex(h => terms.some(t => norm(h).includes(t)));

  const indices = {
    osId: findCol(['codigo', 'código', 'id', 'os']),
    data: findCol(['data']),
    inicio: findCol(['inicio', 'início']),
    fim: findCol(['fim']),
    veiculo: findCol(['veiculo', 'veículo']),
    placa: findCol(['placa']),
    cliente: findCol(['cliente']),
    previsao: findCol(['previsao', 'previsão']),
    responsavel: findCol(['responsavel', 'responsável']),
    status: findCol(['status'])
  };

  // Se a busca por termos falhar ou não encontrar os principais campos, aplica layout posicional padrão comprovado
  if (indices.osId < 0) indices.osId = 0;
  if (indices.data < 0) indices.data = 1;
  if (indices.inicio < 0) indices.inicio = 2;
  if (indices.fim < 0) indices.fim = 3;
  if (indices.veiculo < 0) indices.veiculo = 4;
  if (indices.placa < 0) indices.placa = 5;
  if (indices.cliente < 0) indices.cliente = 6;
  if (indices.previsao < 0) indices.previsao = 7;
  if (indices.responsavel < 0) indices.responsavel = 8;
  if (indices.status < 0) indices.status = 10;

  return indices;
}

/**
 * Coletor Leve de Pátio Ativo & Auditoria Financeira de OSs Abertas
 * Executa dentro da mesma sessão autenticada do Playwright com grid corrigido e leitura financeira via popup.
 */
export async function coletarPatioAtivoLoja(
  page: Page,
  slugLoja: string,
  db?: DatabaseInstance
): Promise<ResumoPatioAtivoLoja> {
  const inicio = Date.now();
  const BASE_URL = process.env.OI_URL || 'https://sistemaoficinainteligente.com.br';

  console.log(`[Patio Ativo Crawler] 🚗 [${slugLoja}] Inspecionando pátio ativo...`);

  // 1. Acessa a tela de busca de Ordens de Serviço
  await page.goto(`${BASE_URL}/wfOrdemDeServicoBusca.aspx`, { waitUntil: 'load', timeout: 30000 });
  await page.waitForTimeout(500);

  // 2. Lê contador nativo oficial (#ctl00_cph_lkbOSEmAberto)
  const lkbAberta = page.locator('#ctl00_cph_lkbOSEmAberto');
  let totalAbertasNativo = 0;

  if (await lkbAberta.count() > 0) {
    const txt = (await lkbAberta.first().textContent().catch(() => '0')) || '0';
    totalAbertasNativo = parseInt(txt.trim(), 10) || 0;
  }

  console.log(`[Patio Ativo Crawler] 📊 [${slugLoja}] Contador oficial pátio: ${totalAbertasNativo} veículos`);

  const store = carregarStoreLoja(slugLoja);
  const openOsIds: string[] = [];
  const statusCapturedAt = new Date().toISOString();
  let inspecionadasFinanceiro = 0;

  // Garante coluna financeiro_updated_at no SQLite se db estiver conectado
  if (db) {
    try {
      db.exec("ALTER TABLE ordens_servico ADD COLUMN financeiro_updated_at TEXT");
    } catch (_) {}
  }

  // Se não há veículos abertos no pátio, marca tudo como não aberto e encerra
  if (totalAbertasNativo === 0) {
    for (const id of Object.keys(store.os_map)) {
      store.os_map[id].is_aberta = 0;
      store.os_map[id].statusCapturedAt = statusCapturedAt;
    }
    salvarStoreLoja(store);

    if (db) {
      try {
        db.prepare(`
          UPDATE ordens_servico 
          SET estado_operacional = 'FECHADA', is_aberta = 0, updated_at = CURRENT_TIMESTAMP
          WHERE loja_slug = ? AND is_aberta = 1
        `).run(slugLoja);
      } catch (_) {}
    }

    return {
      slugLoja,
      totalAbertasNativo: 0,
      openOsIds: [],
      inspecionadasFinanceiro: 0,
      duracaoMs: Date.now() - inicio
    };
  }

  // 3. Clica no filtro de abertas para carregar a grade
  await lkbAberta.first().click();
  await page.waitForLoadState('load');
  await page.waitForTimeout(1500);

  // 4. Identifica cabeçalhos da tabela para mapeamento dinâmico
  const headerCells = await page.locator('table[id*="grd"] tr.cabecalho th, table[id*="grd"] tr:first-child th, table[id*="grd"] th').all();
  const headerTexts: string[] = [];
  for (const h of headerCells) {
    headerTexts.push((await h.textContent().catch(() => ''))?.trim() || '');
  }
  const colIndices = resolverIndicesGrid(headerTexts);

  // Loop de extração com suporte a paginação
  let currentPage = 1;
  const maxPages = 10;

  while (currentPage <= maxPages) {
    const rows = await page.locator('table[id*="grd"] tr:not(:first-child):not(.pgr)').all();

    for (const row of rows) {
      const idEl = row.locator('[id*="lkbOrdemDeServicoID"]').first();
      if (await idEl.count() === 0) continue;

      const osId = (await idEl.textContent().catch(() => ''))?.trim();
      if (!osId) continue;

      // Extrai colunas da linha da grade
      const cells = await row.locator('td').all();
      const cellTexts: string[] = [];
      for (const c of cells) {
        const t = (await c.textContent().catch(() => ''))?.trim() || '';
        cellTexts.push(t);
      }

      const dataAbertura = cellTexts[colIndices.data] || '';
      const horaInicio = cellTexts[colIndices.inicio] || '';
      const veiculo = cellTexts[colIndices.veiculo] || '';
      const placa = cellTexts[colIndices.placa] || '';
      const cliente = cellTexts[colIndices.cliente] || '';
      const responsavel = cellTexts[colIndices.responsavel] || '';
      let statusGrid = cellTexts[colIndices.status] || 'Em Aberto';

      const existing: any = store.os_map[osId] || {};
      const dataInicioFull = (dataAbertura && horaInicio)
        ? `${dataAbertura} ${horaInicio}`
        : (dataAbertura || existing.data_inicio || '');

      let totalOs = Number(existing.total_os || 0);
      let valorPago = Number(existing.valor_pago || 0);
      let valorRestante = existing.valor_restante !== undefined ? Number(existing.valor_restante) : totalOs;
      let isFechadaDetalhe = false;
      let financeiroAtualizado = false;

      // 4.1 Abre popup da OS para extração financeira completa
      try {
        const [detailPage] = await Promise.all([
          page.context().waitForEvent('page', { timeout: 12000 }).catch(() => null),
          idEl.click().catch(() => null)
        ]);

        if (detailPage) {
          try {
            await detailPage.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
            await detailPage.waitForTimeout(400);

            // Injeta shim __name para compatibilidade com bundling do esbuild/tsx
            await detailPage.evaluate('window.__name = function(t) { return t; };').catch(() => {});

            // Clica na aba Pagamentos se presente
            const tabPag = detailPage.locator('a:has-text("Pagamentos"), span:has-text("Pagamentos"), [id*="tapPagamento"]').first();
            if (await tabPag.count() > 0 && await tabPag.isVisible().catch(() => false)) {
              await tabPag.click().catch(() => {});
              await detailPage.waitForTimeout(350);
            }

            const detFin = await detailPage.evaluate(() => {
              var parseM = function(t: string) {
                if (!t) return 0;
                return parseFloat(t.replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
              };
              var getV = function(sel: string) {
                var el = document.querySelector(sel) as any;
                if (!el) return '';
                return ('value' in el ? el.value : el.textContent) || '';
              };

              const tot = parseM(getV('[id*="ucOrdemDeServicoItem_txtTotalValor"], [id*="txtTotalDaOS"], #ctl00_cph_txtTotalGeral, #txtTotalOS, [id*="TotalGeral"]'));
              const pagoInput = parseM(getV('[id*="ucOrdemDeServicoPagamento_txtTotalValor"], #ctl00_cph_txtValorPago, #txtValorPago, [id*="ValorPago"]'));
              const restInputRaw = getV('[id*="ucOrdemDeServicoPagamento_txtRestante"], #ctl00_cph_txtValorRestante, #txtValorRestante, [id*="ValorRestante"]');
              const restInput = restInputRaw.trim() !== '' ? parseM(restInputRaw) : null;

              // Soma das parcelas na grade de pagamentos
              const rowsPag = document.querySelectorAll('table[id*="ucOrdemDeServicoPagamento_grd"] tr');
              let somaParc = 0;
              for (let i = 1; i < rowsPag.length; i++) {
                const tds = rowsPag[i].querySelectorAll('td');
                if (tds.length >= 4) {
                  somaParc += parseM(tds[3].textContent || '0');
                }
              }

              const pagoFinal = pagoInput > 0 ? pagoInput : somaParc;
              const restFinal = restInput !== null ? restInput : Math.max(0, tot - pagoFinal);

              const statusChecked = document.querySelector('select[id*="ddlStatus"] option:checked')?.textContent?.trim() || '';
              const bodyTxt = document.body ? (document.body.innerText || '') : '';
              const fechada = /fechada\s+e\s+bloqueada/i.test(bodyTxt) || statusChecked.toUpperCase().includes('FECHAD') || statusChecked.toUpperCase().includes('FATUR');

              return {
                total_os: tot,
                valor_pago: pagoFinal,
                valor_restante: restFinal,
                status_grid: (statusChecked && !statusChecked.toLowerCase().includes('selecione')) ? statusChecked : null,
                is_fechada: fechada
              };
            });

            if (detFin.total_os > 0 || detFin.valor_pago > 0) {
              totalOs = detFin.total_os;
              valorPago = detFin.valor_pago;
              valorRestante = detFin.valor_restante;
              if (detFin.status_grid) statusGrid = detFin.status_grid;
              isFechadaDetalhe = detFin.is_fechada;
              financeiroAtualizado = true;
              inspecionadasFinanceiro++;
            }
          } finally {
            await detailPage.close().catch(() => {});
          }
        }
      } catch (detErr: any) {
        console.warn(`[Patio Ativo Crawler] Erro ao extrair financeiro da OS #${osId} (${slugLoja}): ${detErr?.message || detErr}`);
      }

      if (!isFechadaDetalhe) {
        if (!openOsIds.includes(osId)) {
          openOsIds.push(osId);
        }
      }

      const nowIso = new Date().toISOString();
      const financeiroUpdated = financeiroAtualizado ? nowIso : (existing.financeiro_updated_at || null);

      store.os_map[osId] = {
        ...existing,
        id: osId,
        os_id: osId,
        loja_slug: slugLoja,
        data_inicio: dataInicioFull,
        placa: placa || existing.placa || '',
        veiculo: veiculo || existing.veiculo || '',
        cliente_nome: cliente || existing.cliente_nome || '',
        status_grid: statusGrid,
        responsavel: responsavel || existing.responsavel || '',
        total_os: totalOs,
        valor_pago: valorPago,
        valor_restante: valorRestante,
        is_aberta: isFechadaDetalhe ? 0 : 1,
        statusCapturedAt,
        financeiro_updated_at: financeiroUpdated || undefined,
        checklists: existing.checklists || []
      };

      // Atualização granular no SQLite
      if (db) {
        try {
          const info = db.prepare(`
            UPDATE ordens_servico 
            SET is_aberta = ?,
                estado_operacional = ?,
                status_grid = ?,
                veiculo = CASE WHEN ? != '' THEN ? ELSE veiculo END,
                placa = CASE WHEN ? != '' THEN ? ELSE placa END,
                cliente_nome = CASE WHEN ? != '' THEN ? ELSE cliente_nome END,
                responsavel = CASE WHEN ? != '' THEN ? ELSE responsavel END,
                total_os = CASE WHEN ? > 0 THEN ? ELSE total_os END,
                valor_pago = CASE WHEN ? = 1 THEN ? ELSE valor_pago END,
                valor_restante = CASE WHEN ? = 1 THEN ? ELSE valor_restante END,
                financeiro_updated_at = CASE WHEN ? = 1 THEN ? ELSE financeiro_updated_at END,
                updated_at = CURRENT_TIMESTAMP
            WHERE loja_slug = ? AND os_id = ?
          `).run(
            isFechadaDetalhe ? 0 : 1,
            isFechadaDetalhe ? 'FECHADA' : 'ABERTA',
            statusGrid,
            veiculo, veiculo,
            placa, placa,
            cliente, cliente,
            responsavel, responsavel,
            totalOs, totalOs,
            financeiroAtualizado ? 1 : 0, valorPago,
            financeiroAtualizado ? 1 : 0, valorRestante,
            financeiroAtualizado ? 1 : 0, nowIso,
            slugLoja, osId
          );

          if (info.changes === 0) {
            db.prepare(`
              INSERT INTO ordens_servico (
                os_id, loja_slug, tipo, status_grid, is_aberta, estado_operacional,
                data_inicio, veiculo, placa, cliente_nome, responsavel,
                total_os, valor_pago, valor_restante, qualidade_dado, financeiro_updated_at, updated_at
              ) VALUES (?, ?, 'OS', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VALIDADO_ERP_HORARIO', ?, CURRENT_TIMESTAMP)
            `).run(
              osId, slugLoja, statusGrid, isFechadaDetalhe ? 0 : 1, isFechadaDetalhe ? 'FECHADA' : 'ABERTA',
              dataInicioFull, veiculo, placa, cliente, responsavel,
              totalOs, valorPago, valorRestante, financeiroUpdated
            );
          }
        } catch (_) {}
      }
    }

    // Se já coletou todas as OSs abertas indicadas pelo contador nativo, encerra paginação
    if (openOsIds.length >= totalAbertasNativo || totalAbertasNativo === 0) {
      break;
    }

    // Se ainda faltam OSs e houver pager nativo, tenta avançar
    const nextPageNum = currentPage + 1;
    const nextLink = page.locator(`table[id*="grd"] tr.pgr a:has-text("${nextPageNum}"), .pgr a:has-text("${nextPageNum}")`).first();
    if (await nextLink.count() > 0 && await nextLink.isVisible()) {
      await nextLink.click();
      await page.waitForLoadState('load');
      await page.waitForTimeout(1000);
      currentPage++;
    } else {
      break;
    }
  }

  // 5. Atualiza ordens que não estão mais na lista de abertas para is_aberta = 0
  const openSet = new Set(openOsIds);
  for (const id of Object.keys(store.os_map)) {
    if (!openSet.has(id)) {
      store.os_map[id].is_aberta = 0;
      store.os_map[id].statusCapturedAt = statusCapturedAt;
    }
  }

  // 6. Persiste store atualizado
  salvarStoreLoja(store);

  // 7. Sincroniza fechadas no SQLite
  if (db && openOsIds.length > 0) {
    try {
      const placeholders = openOsIds.map(() => '?').join(',');
      db.prepare(`
        UPDATE ordens_servico 
        SET is_aberta = 0, estado_operacional = 'FECHADA', updated_at = CURRENT_TIMESTAMP
        WHERE loja_slug = ? AND is_aberta = 1 AND os_id NOT IN (${placeholders})
      `).run(slugLoja, ...openOsIds);
    } catch (e: any) {
      console.warn(`[Patio Ativo Crawler] Aviso ao atualizar SQLite para ${slugLoja}: ${e.message}`);
    }
  }

  const duracao = Date.now() - inicio;
  console.log(`[Patio Ativo Crawler] ✅ [${slugLoja}] Pátio ativo sincronizado: ${openOsIds.length}/${totalAbertasNativo} veículos (${inspecionadasFinanceiro} financeiros) (${duracao}ms)`);

  return {
    slugLoja,
    totalAbertasNativo,
    openOsIds,
    inspecionadasFinanceiro,
    duracaoMs: duracao
  };
}
