import { Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

export async function ensureCompany(page: Page, slugEmpresa: string, maxAttempts = 3): Promise<void> {
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
      // 1. Verificar se já está na empresa correta
      const lblSigla = page.locator('#lblSiglaEmpresa');
      const current = await lblSigla.textContent({ timeout: 5000 }).catch(() => '');
      if (current && current.trim() === targetCompany) {
        console.log(`[Core] Já estamos na empresa ${targetCompany}.`);
        return;
      }

      console.log(`[Core] Empresa atual (${current?.trim()}) é diferente. Iniciando troca para ${targetCompany} (Tentativa ${attempt}/${maxAttempts})...`);

      // 2. Abrir modal com espera de visibilidade
      await lblSigla.waitFor({ state: 'visible', timeout: 8000 });
      await lblSigla.click();
      await page.waitForTimeout(500);

      // 3. Selecionar dropdown e clicar botão de troca
      const select = page.locator('#ddlTrocarEmpresa');
      await select.waitFor({ state: 'visible', timeout: 8000 });
      
      const optionSelected = await select.selectOption({ label: targetCompany }).then(() => true).catch(async () => {
        // Fallback por inclusão parcial se label exata falhar
        return await page.evaluate((target) => {
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
      });

      if (!optionSelected) {
        console.warn(`[Core] Tentativa de seleção de '${targetCompany}' no select falhou ou não encontrou item correspondente.`);
      }

      const btn = page.locator('#ctl00_btnTrocarEmpresa');
      await btn.waitFor({ state: 'visible', timeout: 5000 });
      await btn.click();

      // 4. Aguardar recarregamento e estabilização de rede/DOM
      await page.waitForLoadState('load', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(2500);

      // 5. Validar header pós-troca
      const updated = await page.locator('#lblSiglaEmpresa').textContent({ timeout: 8000 }).catch(() => '');
      if (updated && updated.trim() === targetCompany) {
        console.log(`[Core] ✅ Troca para ${targetCompany} confirmada com sucesso!`);
        return;
      }
      
      console.warn(`[Core] Header pós-troca ('${updated?.trim()}') ainda difere de '${targetCompany}'.`);
    } catch (err: any) {
      console.warn(`[Core] Erro na tentativa ${attempt} de troca para ${targetCompany}: ${err.message}`);
      if (attempt === maxAttempts) throw err;
      // Recarregar a página antes da próxima tentativa para resetar ViewState
      const baseUrl = process.env.OI_URL || 'https://sistemaoficinainteligente.com.br';
      await page.goto(`${baseUrl}/wfOrdemDeServicoBusca.aspx`, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(2000 * attempt);
    }
  }

  throw new Error(`[Core] Falha definitiva ao trocar para ${targetCompany} após ${maxAttempts} tentativas.`);
}
