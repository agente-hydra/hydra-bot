import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

(async () => {
  const browser = await chromium.launch({ headless: true });
  // auth path
  const authPath = path.resolve('state/oficina-ondemand-storage-state.json');
  let contextArgs = {};
  if (fs.existsSync(authPath)) {
      contextArgs = { storageState: authPath };
      console.log('Usando state em', authPath);
  } else {
      console.log('Sem auth state, falhará. Caminho procurado:', authPath);
  }
  const context = await browser.newContext(contextArgs);
  const page = await context.newPage();

  console.log('Indo para wfOrdemDeServicoBusca.aspx...');
  await page.goto('https://sistemaoficinainteligente.com.br/wfOrdemDeServicoBusca.aspx', { waitUntil: 'networkidle' });

  console.log('Tirando screenshot da tela original...');
  await page.screenshot({ path: 'C:\\Users\\admin\\.gemini\\antigravity\\brain\\53a8ea8b-5076-411b-8621-c8a30af82418\\screenshot_antes.png', fullPage: true });

  console.log('Selecionando formato Excel...');
  await page.click('label[for="ctl00_cph_rblFormato_1"]');

  console.log('Tirando screenshot após marcar excel...');
  await page.screenshot({ path: 'C:\\Users\\admin\\.gemini\\antigravity\\brain\\53a8ea8b-5076-411b-8621-c8a30af82418\\screenshot_depois_radio.png', fullPage: true });

  console.log('Clicando em Buscar e aguardando load...');
  await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }).catch(e => 'No navigation'),
      page.click('#ctl00_cph_btnBuscar', { force: true })
  ]);

  console.log('Tirando screenshot após buscar...');
  await page.screenshot({ path: 'C:\\Users\\admin\\.gemini\\antigravity\\brain\\53a8ea8b-5076-411b-8621-c8a30af82418\\screenshot_apos_buscar.png', fullPage: true });

  await browser.close();
})();
