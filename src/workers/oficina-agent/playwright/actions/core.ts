import { Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

export interface EnsureCompanyOptions {
  maxAttempts?: number;
  headerTimeoutMs?: number;
  forceReloadOnRetry?: boolean;
}

async function recoverSessionIfLoggedOut(page: Page): Promise<boolean> {
  const baseUrl = process.env.OI_URL || process.env.OFICINA_BASE_URL || 'https://sistemaoficinainteligente.com.br';
  const user = process.env.OI_USER || process.env.OFICINA_USER;
  const pass = process.env.OI_PASS || process.env.OFICINA_PASSWORD;

  if (!user || !pass) {
    console.warn('[Core] Credenciais de login não configuradas no ambiente para auto-recuperação.');
    return false;
  }

  try {
    const currentUrl = typeof page.url === 'function' ? page.url() : '';
    if (!currentUrl.includes('/login')) {
      if (typeof page.goto === 'function') {
        await page.goto(`${baseUrl}/login`, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
      }
    }
    if (typeof page.waitForTimeout === 'function') {
      await page.waitForTimeout(2000);
    }

    if (typeof page.frameLocator === 'function') {
      const captchaFrame = page.frameLocator('iframe[src*="cloudflare"], iframe[src*="turnstile"]').first();
      const captchaCheckbox = captchaFrame.locator('input[type="checkbox"], .ctp-checkbox-label');
      if (await captchaCheckbox.isVisible({ timeout: 4000 }).catch(() => false)) {
        await captchaCheckbox.click({ force: true }).catch(() => {});
        if (typeof page.waitForTimeout === 'function') {
          await page.waitForTimeout(4000);
        }
      }
    }

    const email = page.locator('input[type="email"], input[type="text"], input[name="login"]').first();
    const password = page.locator('input[type="password"]').first();
    if (await email.isVisible({ timeout: 5000 }).catch(() => false)) {
      await email.fill(user);
      await password.fill(pass);
      const btn = page.locator('button:has-text("Entrar"), button:has-text("Login"), input[type="submit"]').first();
      if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await btn.click();
      } else {
        await password.press('Enter');
      }
      if (typeof page.waitForTimeout === 'function') {
        await page.waitForTimeout(4000);
      }
      console.log(`[Core] Sessão re-autenticada com sucesso. URL atual: ${typeof page.url === 'function' ? page.url() : ''}`);
      if (typeof page.goto === 'function') {
        await page.goto(`${baseUrl}/wfOrdemDeServicoBusca.aspx`, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
      }
      return true;
    }
  } catch (err: any) {
    console.warn(`[Core] Falha ao tentar re-autenticação automática: ${err?.message || err}`);
  }
  return false;
}

export async function ensureCompany(
  page: Page,
  slugEmpresa: string,
  optionsOrMaxAttempts: EnsureCompanyOptions | number = 3
): Promise<void> {
  const options: EnsureCompanyOptions =
    typeof optionsOrMaxAttempts === 'number'
      ? { maxAttempts: optionsOrMaxAttempts }
      : (optionsOrMaxAttempts || {});

  const maxAttempts = options.maxAttempts ?? 3;
  const headerTimeoutMs = options.headerTimeoutMs ?? 12000;

  console.log(`[Core] Resolvendo slug da empresa: ${slugEmpresa}`);
  
  // 1. Carregar configuração de empresas (de-para)
  const configPath = path.resolve('docs/app-map/empresas.json');
  if (!fs.existsSync(configPath)) {
    throw new Error(`[Core] Arquivo de configuração de empresas não encontrado em ${configPath}`);
  }
  
  const empresasConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const empresaData = empresasConfig[slugEmpresa];
  
  if (!empresaData) {
    throw new Error(`[Core] Empresa '${slugEmpresa}' não mapeada no arquivo de configuração.`);
  }

  const targetCompany = empresaData.nome_header;
  console.log(`[Core] Slug '${slugEmpresa}' resolvido para '${targetCompany}'. Verificando header...`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // 0. Checagem de redirecionamento ou deslogamento
      const currentUrl = typeof page.url === 'function' ? page.url() : '';
      if (currentUrl.includes('/login') || currentUrl.includes('Default.aspx')) {
        console.warn(`[Core] ⚠️ Deslogamento ou redirect detectado em ${currentUrl}. Executando re-autenticação ativa...`);
        await recoverSessionIfLoggedOut(page);
      }

      // 1. Verificar se já está na empresa correta
      const lblSigla = page.locator('#lblSiglaEmpresa');
      const current = await lblSigla.textContent({ timeout: 5000 }).catch(() => '');
      if (current && current.trim() === targetCompany) {
        console.log(`[Core] Já estamos na empresa ${targetCompany}.`);
        return;
      }

      console.log(`[Core] Empresa atual (${current?.trim() || 'indefinida'}) é diferente. Iniciando troca para ${targetCompany} (Tentativa ${attempt}/${maxAttempts})...`);

      // 2. Abrir modal com espera de visibilidade (timeout ampliado para 12s)
      await lblSigla.waitFor({ state: 'visible', timeout: headerTimeoutMs });
      await lblSigla.click();
      if (typeof page.waitForTimeout === 'function') {
        await page.waitForTimeout(500);
      }

      // 3. Selecionar dropdown e clicar botão de troca
      const select = page.locator('#ddlTrocarEmpresa');
      await select.waitFor({ state: 'visible', timeout: 8000 });
      
      const optionSelected = await select.selectOption({ label: targetCompany }).then(() => true).catch(async () => {
        // Fallback por inclusão parcial se label exata falhar
        if (typeof page.evaluate === 'function') {
          return await page.evaluate((target: string) => {
            const sel = document.getElementById('ddlTrocarEmpresa') as HTMLSelectElement;
            if (!sel) return false;
            for (let i = 0; i < sel.options.length; i++) {
              if (sel.options[i].text.includes(target) || target.includes(sel.options[i].text.trim())) {
                sel.selectedIndex = i;
                return true;
              }
            }
            return false;
          }, targetCompany);
        }
        return false;
      });

      if (!optionSelected) {
        console.warn(`[Core] Tentativa de seleção de '${targetCompany}' no select falhou ou não encontrou item correspondente.`);
      }

      const btn = page.locator('#ctl00_btnTrocarEmpresa');
      await btn.waitFor({ state: 'visible', timeout: 5000 });
      await btn.click();

      // 4. Aguardar recarregamento e estabilização de rede/DOM
      if (typeof page.waitForLoadState === 'function') {
        await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
      }
      if (typeof page.waitForTimeout === 'function') {
        await page.waitForTimeout(2500);
      }

      // 5. Validar header pós-troca (timeout ampliado para 12s)
      const updated = await page.locator('#lblSiglaEmpresa').textContent({ timeout: headerTimeoutMs }).catch(() => '');
      if (updated && updated.trim() === targetCompany) {
        console.log(`[Core] ✅ Troca para ${targetCompany} confirmada com sucesso!`);
        return;
      }
      
      console.warn(`[Core] Header pós-troca ('${updated?.trim()}') ainda difere de '${targetCompany}'.`);
    } catch (err: any) {
      console.warn(`[Core] Erro na tentativa ${attempt} de troca para ${targetCompany}: ${err.message}`);
      if (attempt === maxAttempts) throw err;
      
      // Active Recovery: Recarregar a página antes da próxima tentativa para resetar ViewState / modal overlays
      const baseUrl = process.env.OI_URL || process.env.OFICINA_BASE_URL || 'https://sistemaoficinainteligente.com.br';
      console.log(`[Core] [Active Recovery] Recarregando página para resetar pipeline ASP.NET (Tentativa ${attempt + 1})...`);
      
      if (typeof page.reload === 'function') {
        await page.reload({ waitUntil: 'load', timeout: 20000 }).catch(async () => {
          if (typeof page.goto === 'function') {
            await page.goto(`${baseUrl}/wfOrdemDeServicoBusca.aspx`, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
          }
        });
      } else if (typeof page.goto === 'function') {
        await page.goto(`${baseUrl}/wfOrdemDeServicoBusca.aspx`, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
      }

      // Checa novamente se o reload redirecionou para login
      const postReloadUrl = typeof page.url === 'function' ? page.url() : '';
      if (postReloadUrl.includes('/login') || postReloadUrl.includes('Default.aspx')) {
        await recoverSessionIfLoggedOut(page);
      }

      if (typeof page.waitForTimeout === 'function') {
        await page.waitForTimeout(2000 * attempt);
      }
    }
  }

  throw new Error(`[Core] Falha definitiva ao trocar para ${targetCompany} após ${maxAttempts} tentativas.`);
}
