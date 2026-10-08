import { Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Preenche campos de data de sistemas webforms legado, escapando do popup de calendário.
 */
export async function setDateRange(page: Page, dateFrom?: string, dateTo?: string) {
    if (dateFrom) {
        const df = dateFrom.includes('-') ? dateFrom.split('-').reverse().join('/') : dateFrom;
        await page.fill('#ctl00_cph_txtDataInicial', df);
        await page.keyboard.press('Escape'); // bypass no calendário overlay
    }
    
    if (dateTo) {
        const dt = dateTo.includes('-') ? dateTo.split('-').reverse().join('/') : dateTo;
        await page.fill('#ctl00_cph_txtDataFinal', dt);
        await page.keyboard.press('Escape');
    }
}

/**
 * Prepara o rádio de formato (se existir) para Excel e aguarda o download via botão de submit.
 * Salva na pasta temp-roi e retorna o caminho absoluto.
 */
export async function exportToExcel(page: Page, buttonSelector: string, timeoutMs = 15000): Promise<string> {
    const excelLabel = page.locator('label[for="ctl00_cph_rblFormato_1"]'); // O padrão de relatórios de sistema
    if (await excelLabel.isVisible()) {
        await excelLabel.click({ force: true });
    } else {
        // Tenta buscar "excel" genérico
        const genericExcel = page.locator('label:has-text("excel")').first();
        if (await genericExcel.isVisible()) {
            await genericExcel.click({ force: true });
        }
    }

    const tempDir = path.resolve('./temp-roi');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    console.log(`[UX] Exportando via botão: ${buttonSelector}`);
    const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: timeoutMs }),
        page.click(buttonSelector, { force: true })
    ]);

    const filePath = path.join(tempDir, `export_${Date.now()}.xls`);
    await download.saveAs(filePath);
    
    return filePath;
}
