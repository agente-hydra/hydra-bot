import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { JobEntry } from '../../types/index.js';

import { executeGetRevenue } from './actions/faturamento.js';

const OI_URL = process.env.OFICINA_BASE_URL || 'https://sistemaoficinainteligente.com.br';
const OI_USER = process.env.OFICINA_USER!;
const OI_PASS = process.env.OFICINA_PASSWORD!;
const STATE_PATH = path.resolve('state/oficina-ondemand-storage-state.json');

export async function detectAccessDenied(page: Page): Promise<boolean> {
   const title = await page.title().catch(() => '');
   const bodyText = await page.locator('body').innerText().catch(() => '');
   
   if (
       title.includes('403 Forbidden') ||
       title.includes('Access Denied') ||
       title.includes('Just a moment...') || 
       bodyText.includes('Ray ID:') || 
       bodyText.includes('Acesso Negado')
   ) {
       return true;
   }
   
   return false;
}

export async function isSessionValid(page: Page): Promise<boolean> {
   const url = page.url();
   if (url.includes('login')) return false;
   if (await detectAccessDenied(page)) return false;
   
   const loginForm = page.locator('input[type="password"]');
   if (await loginForm.isVisible().catch(() => false)) return false;
   
   return true;
}

export async function saveAuthState(page: Page): Promise<void> {
    const dir = path.dirname(STATE_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    await page.context().storageState({ path: STATE_PATH });
    console.log(`[Playwright Worker] Estado da sessão salvo em ${STATE_PATH}`);
}

export async function ensureLoggedIn(page: Page): Promise<void> {
    console.log('[Playwright Worker] Acessando página de login para verificar sessão...');
    await page.goto(`${OI_URL}/login`, { waitUntil: 'networkidle' });

    // Se ele for redirecionado ou não estiver na tela de login, checamos se está válido
    if (await isSessionValid(page)) {
        console.log('[Playwright Worker] Sessão válida, página autenticada detectada.');
        return;
    }

    console.log('[Playwright Worker] Realizando Login...');

    const captchaFrame = page.frameLocator('iframe[src*="cloudflare"], iframe[src*="turnstile"]').first();
    const captchaCheckbox = captchaFrame.locator('input[type="checkbox"], .ctp-checkbox-label, #challenge-stage');
    
    await page.waitForTimeout(2000); 
    
    if (await captchaCheckbox.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('[Playwright Worker] Captcha detectado. Clicando no checkbox...');
      await captchaCheckbox.click({ force: true });
      await page.waitForTimeout(5000); 
    }

    console.log('[Playwright Worker] Aguardando o formulário de login carregar...');

    const emailInput = page.locator('input[type="email"], input[type="text"], input[placeholder*="e-mail" i], input[placeholder*="email" i], input[name="login"]').first();
    const passInput = page.locator('input[type="password"]').first();
    
    try {
      await emailInput.waitFor({ state: 'visible', timeout: 45000 });
    } catch (e) {
      if (await detectAccessDenied(page)) {
          console.log('[Playwright Worker] Cloudflare / Acesso Negado detectado no timeout.');
          throw new Error('access_denied');
      }
      console.log('[Playwright Worker] Timeout aguardando campo de e-mail.');
      throw new Error('login_failed');
    }

    await emailInput.fill(OI_USER);
    await passInput.fill(OI_PASS);

    const btnSubmit = page.locator('button:has-text("Entrar"), button:has-text("Login"), button:has-text("Acessar"), button').filter({ hasText: /entrar|login|acessar/i }).first();
    if (await btnSubmit.isVisible().catch(() => false)) {
        await btnSubmit.click();
    } else {
        await passInput.press('Enter');
    }
    
    await page.waitForTimeout(3000);
    await page.waitForLoadState('networkidle');

    if (await detectAccessDenied(page)) throw new Error('access_denied');
    if (page.url().includes('login')) throw new Error('login_failed');

    // Vai para a dashboard confirmar que logou com sucesso
    await page.goto(`${OI_URL}/wfRelatorioRede.aspx`, { waitUntil: 'networkidle' });
    
    if (await detectAccessDenied(page)) throw new Error('access_denied');
    if (!await isSessionValid(page)) throw new Error('login_failed');

    console.log(`[Playwright Worker] Sessão válida, página autenticada detectada em ${page.url()}`);
    await saveAuthState(page);
}

export async function loadContextWithState(browser: Browser): Promise<BrowserContext> {
    const contextOptions = {
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        acceptDownloads: true
    };
    
    if (fs.existsSync(STATE_PATH)) {
        console.log(`[Playwright Worker] Carregando contexto com storageState...`);
        return await browser.newContext({ ...contextOptions, storageState: STATE_PATH });
    } else {
        console.log(`[Playwright Worker] Criando contexto limpo (sem storageState)...`);
        return await browser.newContext(contextOptions);
    }
}

export async function executeJob(job: JobEntry): Promise<void> {
  console.log(`[Playwright Worker] Iniciando job ${job.id} (${job.request.action})`);
  job.meta = { started_at: new Date().toISOString() };
  job.evidence = {};

  if (job.request.action === 'generate_workflows') {
      try {
          const { runWorkflowGenerator } = await import('../mapper/workflow-generator.js');
          const actionResult = await runWorkflowGenerator({ domain: job.request.params.domains?.[0] || 'estoque' });
          job.status = 'completed';
          job.result = actionResult;
      } catch (e: any) {
          job.status = 'failed';
          job.error = { message: e.message, code: null, step: 'generate_workflows' };
      }
      return;
  }

  const browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  
  const context = await loadContextWithState(browser);
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  const screenshotsDir = path.resolve(`docs/evidence/${job.id}`);
  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

  console.log(`[Playwright Worker] Iniciando job ${job.id} (${job.request.action})`);
  job.meta = { started_at: new Date().toISOString() };
  job.evidence = {};

  try {
    await ensureLoggedIn(page);
    job.meta.session = 'valid';

    let actionResult: any = {};
    
    if (job.request.action === 'execute_workflow') {
        const { executeBusinessWorkflow } = await import('../operators/index.js');
        actionResult = await executeBusinessWorkflow(page, job.request.params);
    } else if (job.request.action === 'get_revenue') {
       actionResult = await executeGetRevenue(page, job.request.params);
    } else if (job.request.action === 'map_domain') {
       const { runDomainMapping } = await import('../mapper/crawler.js');
       actionResult = await runDomainMapping(page, job, job.request.params);
    } else if (job.request.action === 'map_header') {
       const { runHeaderMapping } = await import('../mapper/header-crawler.js');
       actionResult = await runHeaderMapping(page, job, job.request.params);
    } else if (job.request.action === 'map_screens') {
       const { runScreenMapping } = await import('../mapper/screen-mapper.js');
       actionResult = await runScreenMapping(page, job, job.request.params);
    } else if (job.request.action === 'consulta_os_exposicao') {
       const { consultaOsExposicaoAltoValorSemAdiantamento } = await import('./actions/consultas_os.js');
       actionResult = await consultaOsExposicaoAltoValorSemAdiantamento(page, job.request.params);
    } else if (job.request.action === 'consulta_cmv_loja') {
       const { handleConsultaCMVLoja } = await import('./actions/consulta_cmv_loja.js');
       actionResult = await handleConsultaCMVLoja(page, job.request.params);
    } else if (job.request.action === 'consulta_contas_pagar_exposicao') {
       const { handleConsultaContasPagarExposicao } = await import('./actions/consulta_contas_pagar_exposicao.js');
       actionResult = await handleConsultaContasPagarExposicao(page, job.request.params);
    } else if (job.request.action === 'consulta_os_semana') {
       const { handleConsultaOSSemana } = await import('./actions/consulta_os_semana.js');
       actionResult = await handleConsultaOSSemana(page, job.request.params);
    } else if (job.request.action === 'consulta_os_ultima_loja') {
       const { handleConsultaOSUltimaLoja } = await import('./actions/consulta_os_ultima_loja.js');
       actionResult = await handleConsultaOSUltimaLoja(page, job.request.params);
    } else {
       throw new Error(`Ação não implementada no driver: ${job.request.action}`);
    }

    job.status = job.status === 'partial' ? 'partial' : 'completed';
    job.result = actionResult;

    const finalScPath = path.join(screenshotsDir, `success_${job.id}.png`);
    await page.screenshot({ path: finalScPath });
    job.evidence.screenshot_path = finalScPath;
    
  } catch (e: any) {
    const scPath = path.join(screenshotsDir, `error_${job.id}.png`);
    await page.screenshot({ path: scPath, fullPage: true }).catch(() => {});
    job.evidence.screenshot_path = scPath;

    console.error(`[Playwright Worker] Erro no job ${job.id}:`, e.message);
    
    if (e.message === 'session_expired' || e.message === 'login_failed') {
      job.status = 'session_expired';
      job.error = e.message;
    } else if (e.message === 'access_denied') {
      job.status = 'failed';
      job.error = 'cloudflare_403';
    } else {
      job.status = job.status === 'partial' ? 'partial' : 'failed';
      job.error = e.message;
    }
  } finally {
    await browser.close();
  }
}
