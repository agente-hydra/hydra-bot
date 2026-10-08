import { chromium } from 'playwright';
import { config as dotenvConfig } from 'dotenv';
import { ensureCompany } from '../src/workers/oficina-agent/playwright/actions/core.js';
import { extrairDetalheDaPagina } from '../src/workers/oficina-agent/playwright/actions/os_deep_inspector.js';
import { getDatabaseConnection } from '../src/hydra-sync/db_repository.js';

dotenvConfig({ path: '/opt/bots/.env' });
dotenvConfig();

const BASE_URL = process.env.OI_URL || 'https://sistemaoficinainteligente.com.br';

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  console.log('[Extract 1132] Efetuando login...');
  await page.goto(BASE_URL + '/login', { waitUntil: 'load' });
  await page.waitForTimeout(3000);

  const captchaFrame = page.frameLocator('iframe[src*="cloudflare"], iframe[src*="turnstile"]').first();
  const captchaCheckbox = captchaFrame.locator('input[type="checkbox"], .ctp-checkbox-label');
  if (await captchaCheckbox.isVisible({ timeout: 4000 }).catch(() => false)) {
    await captchaCheckbox.click({ force: true });
    await page.waitForTimeout(4000);
  }

  const email = page.locator('input[type="email"], input[type="text"], input[name="login"]').first();
  const pass = page.locator('input[type="password"]').first();
  await email.fill(process.env.OI_USER || '');
  await pass.fill(process.env.OI_PASS || '');
  const btn = page.locator('button:has-text("Entrar"), button:has-text("Login"), input[type="submit"]').first();
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await btn.click();
  } else {
    await pass.press('Enter');
  }
  await page.waitForTimeout(4000);
  console.log('[Extract 1132] Login OK, URL:', page.url());

  console.log('[Extract 1132] Garantindo empresa MPJorgeBeretta...');
  await page.goto(BASE_URL + '/wfOrdemDeServicoBusca.aspx', { waitUntil: 'load' });
  await ensureCompany(page, 'MPJorgeBeretta');
  await page.waitForTimeout(2000);

  console.log('[Extract 1132] Buscando OS #1132 na grade...');
  await page.goto(BASE_URL + '/wfOrdemDeServicoBusca.aspx', { waitUntil: 'load' });
  await page.waitForTimeout(1000);

  const txtId = page.locator('#ctl00_cph_txtOrdemDeServicoID');
  await txtId.waitFor({ state: 'visible', timeout: 15000 });
  await txtId.fill('1132');
  await page.locator('#ctl00_cph_chkExibirFechada').check().catch(() => {});
  await page.locator('#ctl00_cph_chkExibirAberta').check().catch(() => {});

  const btnBuscar = page.locator('#ctl00_cph_btnBuscar');
  await btnBuscar.waitFor({ state: 'visible', timeout: 15000 });
  await btnBuscar.click();
  await page.waitForLoadState('load');
  await page.waitForTimeout(2000);

  const link = page.locator('a[id*="lkbOrdemDeServicoID"]:has-text("1132")').first();
  const linkCount = await link.count();
  console.log('[Extract 1132] Link count:', linkCount);
  if (linkCount === 0) {
    console.error('[Extract 1132] Link da OS 1132 não encontrado na grade!');
    await browser.close();
    return;
  }

  console.log('[Extract 1132] Abrindo popup da OS #1132...');
  const [detailPage] = await Promise.all([
    context.waitForEvent('page', { timeout: 15000 }).catch(() => null),
    link.click().catch(() => null)
  ]);

  if (!detailPage) {
    console.error('[Extract 1132] Popup não abriu!');
    await browser.close();
    return;
  }

  await detailPage.waitForLoadState('load', { timeout: 15000 });
  await detailPage.waitForTimeout(2000);

  console.log('[Extract 1132] Extraindo detalhes completos...');
  const detalhe = await extrairDetalheDaPagina(detailPage);
  await detailPage.close().catch(() => {});
  await browser.close();

  console.log('[Extract 1132] Detalhes extraídos com sucesso!');
  console.log('Checklists encontrados:', detalhe.checklists ? detalhe.checklists.length : 0);
  console.log('Itens encontrados:', detalhe.itens ? detalhe.itens.length : 0);
  console.log('Pagamentos:', detalhe.pagamentos ? detalhe.pagamentos.length : 0);
  console.log('Total OS:', detalhe.total_os);

  // Agora vamos mesclar e persistir no SQLite operacional
  const db = getDatabaseConnection();
  const rowAtual = db.prepare('SELECT raw_payload, veiculo, placa, cliente_nome, status_grid, data_inicio FROM ordens_servico WHERE os_id = ? AND loja_slug = ?').get('1132', 'MPJorgeBeretta') as any;

  let docBase: any = {};
  if (rowAtual && rowAtual.raw_payload) {
    try { docBase = JSON.parse(rowAtual.raw_payload); } catch {}
  }

  const docFinal = {
    ...docBase,
    ...detalhe,
    id: '1132',
    tipo: 'OS',
    loja_slug: 'MPJorgeBeretta',
    veiculo: docBase.veiculo || rowAtual?.veiculo || 'KICKS',
    placa: docBase.placa || rowAtual?.placa || 'TAR4I55',
    cliente_nome: docBase.cliente_nome || rowAtual?.cliente_nome || '',
    status_grid: docBase.status_grid || rowAtual?.status_grid || 'NECESSITA SUPORTE ESPECIALIZADO',
    data_inicio: docBase.data_inicio || rowAtual?.data_inicio || '06/10/26 09:56',
    extracao_completa: true,
    erro: null
  };

  const jsonStr = JSON.stringify(docFinal);
  db.prepare(`
    UPDATE ordens_servico
    SET raw_payload = ?,
        total_os = ?,
        valor_pago = ?,
        valor_restante = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE os_id = '1132' AND loja_slug = 'MPJorgeBeretta'
  `).run(
    jsonStr,
    detalhe.total_os || 0,
    detalhe.valor_pago || 0,
    detalhe.valor_restante || 0
  );

  console.log('[Extract 1132] ✅ SQLite atualizado com sucesso! raw_payload tamanho:', jsonStr.length);
  console.log('Checklists salvos:', JSON.stringify(docFinal.checklists, null, 2));
}

run().catch(e => {
  console.error('[Extract 1132] ❌ Erro fatal:', e);
  process.exit(1);
});
