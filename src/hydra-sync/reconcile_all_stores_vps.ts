import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { config as dotenvConfig } from 'dotenv';
import { ensureCompany } from '../workers/oficina-agent/playwright/actions/core.js';
import { getDatabaseConnection, calcularDiasNoPatio, getPatioOverview, getAgingCars } from './db_repository.js';

dotenvConfig({ path: '/opt/bots/.env' });
dotenvConfig();

const BASE_URL = process.env.OI_URL || 'https://sistemaoficinainteligente.com.br';

const LOJAS = [
  'MPSantoAndre',
  'MPrudge',
  'MPpiraporinha',
  'ReiDoModulo',
  'MPJabaquara',
  'MPdompedro1',
  'ReiDoOleoMaua',
  'MPplanalto',
  'MPJorgeBeretta',
  'MPkennedy',
  'MPMaster'
];

async function login(page: any) {
  console.log('[Reconcile] Efetuando login...');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'load' });
  await page.waitForTimeout(3000);

  const captchaFrame = page.frameLocator('iframe[src*="cloudflare"], iframe[src*="turnstile"]').first();
  const captchaCheckbox = captchaFrame.locator('input[type="checkbox"], .ctp-checkbox-label');
  if (await captchaCheckbox.isVisible({ timeout: 4000 }).catch(() => false)) {
    await captchaCheckbox.click({ force: true });
    await page.waitForTimeout(5000);
  }

  const email = page.locator('input[type="email"], input[type="text"], input[name="login"]').first();
  const pass  = page.locator('input[type="password"]').first();
  await email.waitFor({ state: 'visible', timeout: 20000 });
  await email.fill(process.env.OI_USER || '');
  await pass.fill(process.env.OI_PASS || '');

  const btn = page.locator('button:has-text("Entrar"), button:has-text("Login"), input[type="submit"]').first();
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await btn.click();
  } else {
    await pass.press('Enter');
  }
  await page.waitForTimeout(5000);
  console.log('[Reconcile] Login OK. URL:', page.url());
}

async function run() {
  const db = getDatabaseConnection();

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await login(page);

  const resumoGeral: Record<string, { contadorNativo: number; osIds: string[] }> = {};

  for (const slug of LOJAS) {
    console.log(`\n=============================================`);
    console.log(`[Reconcile] 🏢 Processando loja: ${slug}`);
    console.log(`=============================================`);

    try {
      await page.goto(`${BASE_URL}/wfOrdemDeServicoBusca.aspx`, { waitUntil: 'load' });
      await ensureCompany(page, slug);
      await page.goto(`${BASE_URL}/wfOrdemDeServicoBusca.aspx`, { waitUntil: 'load' });
      await page.waitForTimeout(1000);

      const lkbAberta = page.locator('#ctl00_cph_lkbOSEmAberto');
      let totalNativo = 0;
      const openIds: string[] = [];

      if (await lkbAberta.count() > 0) {
        const txt = (await lkbAberta.first().textContent().catch(() => '0')) || '0';
        totalNativo = parseInt(txt.trim(), 10) || 0;
        console.log(`[Reconcile] 📊 Contador nativo (#ctl00_cph_lkbOSEmAberto): ${totalNativo} OSs`);

        if (totalNativo > 0) {
          await lkbAberta.first().click();
          await page.waitForLoadState('load');
          await page.waitForTimeout(2000);

          const rows = await page.locator('table[id*="grd"] tr:not(:first-child):not(.pgr)').all();
          for (const r of rows) {
            const idEl = r.locator('[id*="lkbOrdemDeServicoID"]').first();
            if (await idEl.count() > 0) {
              const osId = (await idEl.textContent().catch(() => ''))?.trim();
              if (osId) {
                openIds.push(osId);

                // Capturar dados básicos da grade para garantir que a OS existe no banco
                const cells = await r.locator('td').all();
                if (cells.length >= 8) {
                  const allText = await Promise.all(cells.map(c => c.textContent().catch(() => '')));
                  const dataCompleta = (allText[1] || '').trim();
                  const veiculo = (await r.locator('[id*="lkbNomeDoVeiculo"]').textContent().catch(() => (allText[4] || '').trim())) || '';
                  const placa = (await r.locator('[id*="lkbPlacaDoVeiculo"]').textContent().catch(() => (allText[5] || '').trim())) || '';
                  const cliente = (await r.locator('[id*="lkbClienteNome"]').textContent().catch(() => (allText[6] || '').trim())) || '';
                  const responsavel = (allText[8] || '').trim();
                  const status = (allText[10] || '').trim();
                  const dias = calcularDiasNoPatio(dataCompleta);

                  db.prepare(`
                    INSERT INTO ordens_servico (
                      os_id, loja_slug, tipo, status_grid, is_aberta,
                      data_inicio, dias_no_patio, veiculo, placa,
                      cliente_nome, responsavel, updated_at
                    ) VALUES (
                      @os_id, @loja_slug, @tipo, @status_grid, 1,
                      @data_inicio, @dias_no_patio, @veiculo, @placa,
                      @cliente_nome, @responsavel, CURRENT_TIMESTAMP
                    )
                    ON CONFLICT(os_id, loja_slug) DO UPDATE SET
                      is_aberta = 1,
                      dias_no_patio = @dias_no_patio,
                      status_grid = COALESCE(excluded.status_grid, ordens_servico.status_grid),
                      veiculo = COALESCE(excluded.veiculo, ordens_servico.veiculo),
                      placa = COALESCE(excluded.placa, ordens_servico.placa),
                      cliente_nome = COALESCE(excluded.cliente_nome, ordens_servico.cliente_nome),
                      responsavel = COALESCE(excluded.responsavel, ordens_servico.responsavel),
                      updated_at = CURRENT_TIMESTAMP
                  `).run({
                    os_id: osId,
                    loja_slug: slug,
                    tipo: osId.startsWith('OR') ? 'OR' : 'OS',
                    status_grid: status || 'ABERTO',
                    data_inicio: dataCompleta,
                    dias_no_patio: dias,
                    veiculo: veiculo.trim(),
                    placa: placa.trim(),
                    cliente_nome: cliente.trim(),
                    responsavel: responsavel.trim()
                  });
                }
              }
            }
          }
        }
      }

      // Reconciliação no SQLite: marcar como is_aberta = 0 todas que NÃO estão em openIds
      if (openIds.length > 0) {
        const placeholders = openIds.map(() => '?').join(',');
        db.prepare(`
          UPDATE ordens_servico
          SET is_aberta = 0, dias_no_patio = 0, updated_at = CURRENT_TIMESTAMP
          WHERE loja_slug = ? AND os_id NOT IN (${placeholders}) AND is_aberta = 1
        `).run(slug, ...openIds);
      } else {
        db.prepare(`
          UPDATE ordens_servico
          SET is_aberta = 0, dias_no_patio = 0, updated_at = CURRENT_TIMESTAMP
          WHERE loja_slug = ? AND is_aberta = 1
        `).run(slug);
      }

      resumoGeral[slug] = { contadorNativo: totalNativo, osIds: openIds };
      console.log(`[Reconcile] ✅ Loja ${slug}: ${openIds.length} OSs em pátio salvas no SQLite.`);
    } catch (err: any) {
      console.error(`[Reconcile] ❌ Erro ao reconciliar ${slug}: ${err.message}`);
    }
  }

  await browser.close();

  // Relatório Final do SQLite
  console.log(`\n======================================================`);
  console.log(`🏁 RECONCILIAÇÃO CONCLUÍDA - RESUMO GERAL DO PÁTIO`);
  console.log(`======================================================`);
  
  const patioOverview = getPatioOverview(db);
  console.log(JSON.stringify(patioOverview, null, 2));

  const totalCarros = patioOverview.reduce((acc, curr) => acc + curr.total_abertas, 0);
  console.log(`\n🚗 TOTAL DE CARROS EM PÁTIO NA REDE TODA: ${totalCarros} veículos`);

  const agingCars = getAgingCars(db, 5);
  console.log(`⏳ TOTAL DE CARROS COM MAIS DE 5 DIAS NO PÁTIO: ${agingCars.length} veículos`);
}

run().catch(err => {
  console.error('[Reconcile] ERRO FATAL:', err);
  process.exit(1);
});
