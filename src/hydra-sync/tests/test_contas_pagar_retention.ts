/**
 * test_contas_pagar_retention.ts
 *
 * Teste unitário rigoroso da política de retenção de Contas a Pagar (mínimo de 2 dias / 48h).
 */

import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';

const requireCJS = createRequire(import.meta.url);
const retentionPath = path.resolve(process.cwd(), 'projects/hydra-rede/src/contas_pagar_retention.js');
const { rotacionarArquivosExcel } = requireCJS(retentionPath);

function runTest() {
  console.log('--- TESTE: Política de Retenção Contas a Pagar (Mínimo 48 horas / 2 dias) ---');

  const testDir = path.resolve(process.cwd(), '.tmp/test_retention_dir');
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  const agora = Date.now();
  const umaHoraMs = 60 * 60 * 1000;

  // Cria 4 arquivos simulados:
  // 1. Recente (12 horas atrás) -> DEVE SER PRESERVADO
  // 2. No limiar (36 horas atrás) -> DEVE SER PRESERVADO (< 48h)
  // 3. Expirado (50 horas atrás) -> DEVE SER EXCLUÍDO (> 48h)
  // 4. Antigo (100 horas atrás) -> DEVE SER EXCLUÍDO (> 48h)
  // 5. Outro arquivo não relacionado (deve ser ignorado)

  const arq1 = path.join(testDir, 'Contas a Pagar - 09-10-2026.xlsx');
  const arq2 = path.join(testDir, 'Contas a Pagar - 08-10-2026.xlsx');
  const arq3 = path.join(testDir, 'Contas a Pagar - 07-10-2026.xlsx');
  const arq4 = path.join(testDir, 'BuscaContasAPagar_antigo.xls');
  const arqIgnorado = path.join(testDir, 'Mapa de Metas - 09-10-2026.pdf');

  fs.writeFileSync(arq1, 'dummy data 12h');
  fs.writeFileSync(arq2, 'dummy data 36h');
  fs.writeFileSync(arq3, 'dummy data 50h');
  fs.writeFileSync(arq4, 'dummy data 100h');
  fs.writeFileSync(arqIgnorado, 'dummy pdf');

  // Ajusta mtime dos arquivos
  const mtime1 = new Date(agora - 12 * umaHoraMs);
  const mtime2 = new Date(agora - 36 * umaHoraMs);
  const mtime3 = new Date(agora - 50 * umaHoraMs);
  const mtime4 = new Date(agora - 100 * umaHoraMs);

  fs.utimesSync(arq1, mtime1, mtime1);
  fs.utimesSync(arq2, mtime2, mtime2);
  fs.utimesSync(arq3, mtime3, mtime3);
  fs.utimesSync(arq4, mtime4, mtime4);

  console.log('Arquivos de teste criados com idades controladas:');
  console.log(`- ${path.basename(arq1)}: 12h atrás (Esperado: MANTIDO)`);
  console.log(`- ${path.basename(arq2)}: 36h atrás (Esperado: MANTIDO)`);
  console.log(`- ${path.basename(arq3)}: 50h atrás (Esperado: EXCLUÍDO)`);
  console.log(`- ${path.basename(arq4)}: 100h atrás (Esperado: EXCLUÍDO)`);

  // Executa rotacionarArquivosExcel com 48h
  const resultado = rotacionarArquivosExcel({
    pastaCrawls: testDir,
    minHorasRetencao: 48,
    dryRun: false
  });

  console.log('\nResultado da execução:', resultado);

  if (resultado.totalAnalisados !== 4) {
    throw new Error(`Esperava 4 arquivos analisados, obtido: ${resultado.totalAnalisados}`);
  }
  if (resultado.mantidos !== 2) {
    throw new Error(`Esperava 2 arquivos mantidos (< 48h), obtido: ${resultado.mantidos}`);
  }
  if (resultado.excluidos !== 2) {
    throw new Error(`Esperava 2 arquivos excluídos (> 48h), obtido: ${resultado.excluidos}`);
  }

  // Verifica existência física no disco
  if (!fs.existsSync(arq1)) throw new Error(`FALHA: ${path.basename(arq1)} (12h) foi excluído indevidamente!`);
  if (!fs.existsSync(arq2)) throw new Error(`FALHA: ${path.basename(arq2)} (36h) foi excluído indevidamente!`);
  if (fs.existsSync(arq3)) throw new Error(`FALHA: ${path.basename(arq3)} (50h) não foi excluído!`);
  if (fs.existsSync(arq4)) throw new Error(`FALHA: ${path.basename(arq4)} (100h) não foi excluído!`);
  if (!fs.existsSync(arqIgnorado)) throw new Error(`FALHA: Arquivo não-excel foi afetado!`);

  console.log('\n✅ TESTE DE RETENÇÃO (48 HORAS / 2 DIAS): 100% PASS!');

  // Cleanup
  fs.rmSync(testDir, { recursive: true, force: true });
}

runTest();
