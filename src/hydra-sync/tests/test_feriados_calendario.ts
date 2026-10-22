/**
 * test_feriados_calendario.ts
 *
 * Suíte de testes unitários TypeScript strict para o módulo de feriados e janelas acumuladas.
 */

import {
  verificarFeriado,
  isDiaDespachoMatinal,
  calcularJanelaAcumulada
} from '../feriados_calendario.js';
import { calcularPeriodoContasPagar } from '../contas_pagar_crawler.js';

function runTests(): void {
  console.log('🧪 Iniciando testes de feriados em TypeScript strict...');

  // 1. Feriado 12/10/2026
  const f = verificarFeriado('2026-10-12');
  if (!f.isFeriado) throw new Error('Falha: 12/10/2026 não foi detectado como feriado');
  if (isDiaDespachoMatinal('2026-10-12')) throw new Error('Falha: 12/10/2026 não pode ser dia de despacho matinal');
  console.log(`  ✅ [TS] 12/10/2026 é feriado: ${f.nome}`);

  // 2. Terça 13/10/2026 (Pós-Feriado)
  const jTer = calcularJanelaAcumulada('2026-10-13');
  if (jTer.motivo !== 'pos_feriado') throw new Error(`Falha: motivo esperado 'pos_feriado', obtido '${jTer.motivo}'`);
  if (jTer.dataInicioBR !== '09/10/2026') throw new Error(`Falha: dataInicioBR esperada '09/10/2026', obtida '${jTer.dataInicioBR}'`);
  if (jTer.dataFimBR !== '12/10/2026') throw new Error(`Falha: dataFimBR esperada '12/10/2026', obtida '${jTer.dataFimBR}'`);
  if (jTer.diasCobertos !== 4) throw new Error(`Falha: diasCobertos esperado 4, obtido ${jTer.diasCobertos}`);
  console.log(`  ✅ [TS] Terça 13/10 cobre de ${jTer.dataInicioBR} a ${jTer.dataFimBR} (4 dias)`);

  // 3. Crawler Contas a Pagar (Hoje - Data de Vencimento conforme spec hydra-daily-financial-cashflow-balance)
  const rangeCP = calcularPeriodoContasPagar(new Date('2026-10-13T12:00:00Z'));
  if (rangeCP.dataInicialFormatada !== '13/10/2026') throw new Error(`Falha no crawler: dataInicial ${rangeCP.dataInicialFormatada}`);
  if (rangeCP.dataFinalFormatada !== '13/10/2026') throw new Error(`Falha no crawler: dataFinal ${rangeCP.dataFinalFormatada}`);
  if (rangeCP.filtroValor !== '2') throw new Error(`Falha no crawler: filtroValor esperado '2' (Vencimento), obtido '${rangeCP.filtroValor}'`);
  console.log(`  ✅ [TS] Crawler Contas a Pagar (Vencimento Hoje): ${rangeCP.dataInicialFormatada} a ${rangeCP.dataFinalFormatada} (Filtro: ${rangeCP.filtroValor})`);

  console.log('🎉 TODOS OS TESTES TYPESCRIPT PASSARAM COM SUCESSO!');
}

runTests();
