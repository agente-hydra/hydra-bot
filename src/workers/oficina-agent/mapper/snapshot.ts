import { Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

export async function capturePageEvidence(page: Page, jobId: string, url: string, postbackTarget: string | null) {
  // Hash para gerar um nome de arquivo único e seguro para Windows
  const hashObj = crypto.createHash('md5').update(url + (postbackTarget || '') + Date.now()).digest('hex');
  const baseName = `${hashObj.substring(0, 12)}`;
  
  const evidenceDir = path.resolve(`docs/evidence/mapper/${jobId}`);
  if (!fs.existsSync(evidenceDir)) fs.mkdirSync(evidenceDir, { recursive: true });

  const screenshotPath = path.join(evidenceDir, `${baseName}.png`);
  const snapshotPath = path.join(evidenceDir, `${baseName}.snapshot.json`);

  // Aguardar possíveis transições visuais lentas pararem
  await page.waitForTimeout(1000);

  // 1. Screenshot
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch((e) => {
    console.error(`[Snapshot] Erro ao capturar screenshot:`, e.message);
  });

  // 2. ARIA Snapshot
  try {
     const ariaSnapshot = await page.accessibility.snapshot();
     fs.writeFileSync(snapshotPath, JSON.stringify(ariaSnapshot, null, 2));
  } catch (e: any) {
     fs.writeFileSync(snapshotPath, JSON.stringify({ error: 'failed_to_capture_aria', details: e.message }));
  }

  return {
     screenshot_ref: `docs/evidence/mapper/${jobId}/${baseName}.png`,
     snapshot_ref: `docs/evidence/mapper/${jobId}/${baseName}.snapshot.json`
  };
}
