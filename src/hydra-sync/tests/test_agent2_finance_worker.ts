import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import xlsx from 'xlsx';
import {
  ensureSchema,
  parseExcelNumber,
  parseVendasDoDiaWorkbook,
  getSaoPauloDateParts,
  atualizarFinancasHorarias,
  TIMEZONE
} from '../hourly_finance_worker.ts';
import {
  validarIntegridadeMetas,
  LOJAS_OPERACIONAIS_SLUGS,
  type ResultadoMapaMetas,
  type LinhaMetasLoja
} from '../metas_crawler.ts';

function buildMockMetas(override?: Partial<ResultadoMapaMetas>): ResultadoMapaMetas {
  const baseLojas: LinhaMetasLoja[] = [
    { slug: 'MPdompedro1', nome: 'Dom Pedro', faturamentoTotal: 100000, volumeOS: 40, ticketMedio: 2500, meta: 110000, previsao: 100000, percentualMeta: 90.9 },
    { slug: 'MPJabaquara', nome: 'Jabaquara', faturamentoTotal: 95000, volumeOS: 38, ticketMedio: 2500, meta: 100000, previsao: 95000, percentualMeta: 95.0 },
    { slug: 'MPJorgeBeretta', nome: 'Jorge Beretta', faturamentoTotal: 90000, volumeOS: 36, ticketMedio: 2500, meta: 95000, previsao: 90000, percentualMeta: 94.7 },
    { slug: 'MPkennedy', nome: 'Kennedy', faturamentoTotal: 85000, volumeOS: 34, ticketMedio: 2500, meta: 90000, previsao: 85000, percentualMeta: 94.4 },
    { slug: 'MPpiraporinha', nome: 'Piraporinha', faturamentoTotal: 80000, volumeOS: 32, ticketMedio: 2500, meta: 85000, previsao: 80000, percentualMeta: 94.1 },
    { slug: 'MPplanalto', nome: 'Planalto', faturamentoTotal: 75000, volumeOS: 30, ticketMedio: 2500, meta: 80000, previsao: 75000, percentualMeta: 93.8 },
    { slug: 'MPrudge', nome: 'Rudge', faturamentoTotal: 70000, volumeOS: 28, ticketMedio: 2500, meta: 75000, previsao: 70000, percentualMeta: 93.3 },
    { slug: 'MPSantoAndre', nome: 'Santo Andre', faturamentoTotal: 110000, volumeOS: 44, ticketMedio: 2500, meta: 120000, previsao: 110000, percentualMeta: 91.7 },
    { slug: 'ReiDoModulo', nome: 'Rei Do Modulo', faturamentoTotal: 65000, volumeOS: 26, ticketMedio: 2500, meta: 70000, previsao: 65000, percentualMeta: 92.9 },
    { slug: 'ReiDoOleoMaua', nome: 'Rei Do Oleo Maua', faturamentoTotal: 60000, volumeOS: 24, ticketMedio: 2500, meta: 65000, previsao: 60000, percentualMeta: 92.3 }
  ];

  const somaFat = baseLojas.reduce((acc, l) => acc + l.faturamentoTotal, 0);
  const somaOS = baseLojas.reduce((acc, l) => acc + l.volumeOS, 0);

  return {
    faturamentoTotal: somaFat,
    totalOSs: somaOS,
    ticketMedioRede: somaFat / somaOS,
    metaTotalRede: 890000,
    faltaTotalRede: 60000,
    atingimentoTotalRede: 93.2,
    posicaoDataHora: '2026-09-30T14:30:00.000Z',
    origem: 'MAPA_METAS_OFICIAL',
    lojas: baseLojas,
    ...override
  };
}

async function runTests(): Promise<void> {
  console.log('===============================================================');
  console.log('Iniciando Suite de Testes: Agente 2 - Coleta Financeira');
  console.log('===============================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function test(name: string, fn: () => void | Promise<void>): void {
    totalTests++;
    try {
      fn();
      console.log(`  [PASS] ${name}`);
      passedTests++;
    } catch (err: any) {
      console.error(`  [FAIL] ${name}: ${err?.message || err}`);
      throw err;
    }
  }

  async function testAsync(name: string, fn: () => Promise<void>): Promise<void> {
    totalTests++;
    try {
      await fn();
      console.log(`  [PASS] ${name}`);
      passedTests++;
    } catch (err: any) {
      console.error(`  [FAIL] ${name}: ${err?.message || err}`);
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // 1. TESTES DE PARSING E VALIDACAO DE PLANILHA VENDAS POR DIA
  // ---------------------------------------------------------------------------
  console.log('Grupo 1: Parsing e Validacao de Planilha Vendas por Dia');

  test('1.1 - Parsing de numero monetario BR, US e edge cases', () => {
    assert.equal(parseExcelNumber(2660.75), 2660.75);
    assert.equal(parseExcelNumber('2.660,75'), 2660.75);
    assert.equal(parseExcelNumber('R$ 15.420,50'), 15420.5);
    assert.equal(parseExcelNumber('1,234.56'), 1234.56);
    assert.equal(parseExcelNumber('R$ 0,00'), 0);
    assert.equal(parseExcelNumber('-'), 0);
    assert.equal(parseExcelNumber(''), 0);
    assert.equal(parseExcelNumber(0), 0);
    assert.equal(parseExcelNumber(null), 0);
    assert.equal(parseExcelNumber(undefined), 0);
  });

  test('1.2 - Planilha padrao com vendas detalhadas e totalizador', () => {
    const ws = xlsx.utils.aoa_to_sheet([
      ['Oficina Inteligente - Relatorio de Operacao'],
      ['Periodo: 30/09/2026 a 30/09/2026'],
      ['Data', 'Loja', 'Qtd OS', 'Faturamento Total'],
      ['30/09/2026', 'MPSantoAndre', '2', 'R$ 2.660,75'],
      ['', 'TOTAL', '2', '2.660,75']
    ]);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'VendasDia');

    const result = parseVendasDoDiaWorkbook(wb);
    assert.equal(result.revenue, 2660.75);
    assert.equal(result.volume, 2);
  });

  test('1.3 - Planilha de loja com 0 vendas confirmado pelo relatorio', () => {
    const ws = xlsx.utils.aoa_to_sheet([
      ['Oficina Inteligente - Relatorio de Operacao'],
      ['Data', 'Loja', 'Qtd OS', 'Faturamento'],
      ['', 'TOTAL', 0, 'R$ 0,00']
    ]);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'VendasDia');

    const result = parseVendasDoDiaWorkbook(wb);
    assert.equal(result.revenue, 0);
    assert.equal(result.volume, 0);
  });

  test('1.4 - Planilha com totalizador em formato TOTAL GERAL e grandes valores', () => {
    const ws = xlsx.utils.aoa_to_sheet([
      ['Relatorio Oficial'],
      ['Data', 'Loja', 'Qtde OS', 'Faturamento Total'],
      ['30/09/2026', 'Loja 1', 10, '120.500,50'],
      ['30/09/2026', 'Loja 2', 5, '35.250,25'],
      ['TOTAL GERAL', '', '15', '155.750,75']
    ]);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'VendasDia');

    const result = parseVendasDoDiaWorkbook(wb);
    assert.equal(result.revenue, 155750.75);
    assert.equal(result.volume, 15);
  });

  test('1.5 - Planilha corrompida sem cabecalho deve lancar excecao', () => {
    const ws = xlsx.utils.aoa_to_sheet([
      ['Relatorio sem colunas'],
      ['A', 'B', 'C']
    ]);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'VendasDia');

    assert.throws(
      () => parseVendasDoDiaWorkbook(wb),
      /faturamento/i
    );
  });

  test('1.6 - Planilha sem linha de totalizador (TOTAL) deve lancar excecao', () => {
    const ws = xlsx.utils.aoa_to_sheet([
      ['Data', 'Loja', 'Qtd OS', 'Faturamento Total'],
      ['30/09/2026', 'MPdompedro1', 1, '500,00']
    ]);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'VendasDia');

    assert.throws(
      () => parseVendasDoDiaWorkbook(wb),
      /totalizador/i
    );
  });

  // ---------------------------------------------------------------------------
  // 2. TESTES DE TIMEZONE AMERICA/SAO_PAULO (VIRADA DE DIA E MES)
  // ---------------------------------------------------------------------------
  console.log('\nGrupo 2: Timezone Estrito America/Sao_Paulo (Viradas de Dia e Mes)');

  test('2.1 - Virada de mes: 2026-10-01T01:30:00Z em UTC deve ser 2026-09-30 as 22h em SP', () => {
    const d = new Date('2026-10-01T01:30:00Z');
    const { day, hour } = getSaoPauloDateParts(d);
    assert.equal(day, '2026-09-30', 'O dia deve permanecer em setembro no fuso de SP');
    assert.equal(hour, '22', 'A hora deve ser 22h no fuso de SP');
  });

  test('2.2 - Virada exata de meia-noite: 2026-10-01T03:00:00Z em UTC deve ser 2026-10-01 as 00h em SP', () => {
    const d = new Date('2026-10-01T03:00:00Z');
    const { day, hour } = getSaoPauloDateParts(d);
    assert.equal(day, '2026-10-01', 'O dia deve virar para 1 de outubro exatamente as 03:00 UTC');
    assert.equal(hour, '00', 'A hora deve ser 00h em SP');
  });

  test('2.3 - Virada de ano: 2027-01-01T02:00:00Z em UTC deve ser 2026-12-31 as 23h em SP', () => {
    const d = new Date('2027-01-01T02:00:00Z');
    const { day, hour } = getSaoPauloDateParts(d);
    assert.equal(day, '2026-12-31', 'O dia deve ser 31 de dezembro de 2026');
    assert.equal(hour, '23', 'A hora deve ser 23h');
  });

  test('2.4 - Virada de fevereiro para marco: 2026-03-01T02:45:00Z em UTC deve ser 2026-02-28 as 23h em SP', () => {
    const d = new Date('2026-03-01T02:45:00Z');
    const { day, hour } = getSaoPauloDateParts(d);
    assert.equal(day, '2026-02-28', 'O dia deve ser 28 de fevereiro');
    assert.equal(hour, '23', 'A hora deve ser 23h');
  });

  // ---------------------------------------------------------------------------
  // 3. TESTES DE IDEMPOTENCIA EM METAS_HORARIAS E FATURAMENTO_DIARIO_HORARIO
  // ---------------------------------------------------------------------------
  console.log('\nGrupo 3: Idempotencia em metas_horarias e faturamento_diario_horario');

  await testAsync('3.1 - Repeticao da mesma hora atualiza registros sem duplicar linhas', async () => {
    const db = new Database(':memory:');
    ensureSchema(db);

    const targetDate = new Date('2026-09-30T17:00:00Z'); // 14h em SP
    const metas1 = buildMockMetas();

    // Primeira execucao: 10 lojas com vendas do dia iniciais
    const coletorVendas1 = async (_page: any, slug: string) => {
      return { revenue: 1000, volume: 1 };
    };

    const res1 = await atualizarFinancasHorarias({
      db,
      targetDate,
      metasResult: metas1,
      coletorVendasFn: coletorVendas1
    });

    assert.equal(res1.metas, 10);
    assert.equal(res1.vendasDia, 10);

    const countMetas1 = db.prepare('SELECT count(*) as total FROM metas_horarias').get() as { total: number };
    const countVendas1 = db.prepare('SELECT count(*) as total FROM faturamento_diario_horario').get() as { total: number };
    assert.equal(countMetas1.total, 10);
    assert.equal(countVendas1.total, 10);

    // Segunda execucao para a MESMA data e hora, porem com valores incrementados
    const coletorVendas2 = async (_page: any, slug: string) => {
      return { revenue: 2500, volume: 2 };
    };

    const res2 = await atualizarFinancasHorarias({
      db,
      targetDate,
      metasResult: metas1,
      coletorVendasFn: coletorVendas2
    });

    assert.equal(res2.metas, 10);
    assert.equal(res2.vendasDia, 10);

    // Contagem deve permanecer rigorosamente 10 (idempotencia perfeita)
    const countMetas2 = db.prepare('SELECT count(*) as total FROM metas_horarias').get() as { total: number };
    const countVendas2 = db.prepare('SELECT count(*) as total FROM faturamento_diario_horario').get() as { total: number };
    assert.equal(countMetas2.total, 10, 'metas_horarias nao pode duplicar linhas na mesma hora');
    assert.equal(countVendas2.total, 10, 'faturamento_diario_horario nao pode duplicar linhas na mesma hora');

    // Valores devem ter sido atualizados
    const amostraVenda = db.prepare(
      "SELECT faturamento_dia, volume_os_dia FROM faturamento_diario_horario WHERE data_referencia = '2026-09-30' AND posicao_hora = '14' AND loja_slug = 'MPSantoAndre'"
    ).get() as { faturamento_dia: number; volume_os_dia: number };

    assert.equal(amostraVenda.faturamento_dia, 2500, 'Faturamento do dia deve ser atualizado pelo ON CONFLICT');
    assert.equal(amostraVenda.volume_os_dia, 2, 'Volume de OS do dia deve ser atualizado pelo ON CONFLICT');

    db.close();
  });

  // ---------------------------------------------------------------------------
  // 4. TESTES DE TOLERANCIA A FALHA PARCIAL E HISTORICO EM HYDRA_DATA_WORKER_RUNS
  // ---------------------------------------------------------------------------
  console.log('\nGrupo 4: Tolerancia a Falha Parcial e Auditoria de Execucao');

  await testAsync('4.1 - Se 1 loja falhar, as outras 9 sao salvas e o erro e registrado em hydra_data_worker_runs', async () => {
    const db = new Database(':memory:');
    ensureSchema(db);

    const targetDate = new Date('2026-09-30T18:00:00Z'); // 15h em SP
    const metas = buildMockMetas();

    const lojaComFalha = 'MPplanalto';
    const coletorComFalha = async (_page: any, slug: string) => {
      if (slug === lojaComFalha) {
        throw new Error('Falha simulada de timeout no download da planilha');
      }
      return { revenue: 1500, volume: 2 };
    };

    const res = await atualizarFinancasHorarias({
      db,
      targetDate,
      metasResult: metas,
      coletorVendasFn: coletorComFalha
    });

    assert.equal(res.metas, 10, 'Mapa de Metas das 10 lojas foi salvo');
    assert.equal(res.vendasDia, 9, '9 lojas devem ter tido vendas salvas');
    assert.equal(res.falhas.length, 1, 'Exatamente 1 falha deve ser reportada');
    assert.ok(res.falhas[0].includes('MPplanalto'), 'A falha deve ser da loja MPplanalto');

    // Verificar tabela faturamento_diario_horario
    const salvas = db.prepare('SELECT loja_slug FROM faturamento_diario_horario WHERE data_referencia = ? AND posicao_hora = ?')
      .all('2026-09-30', '15') as { loja_slug: string }[];
    assert.equal(salvas.length, 9, 'Devem existir exatamente 9 registros salvos');
    assert.ok(!salvas.some(s => s.loja_slug === lojaComFalha), 'A loja com falha NAO pode ter registro ou zero arbitrario inserido');

    // Verificar tabela hydra_data_worker_runs
    const runsSucesso = db.prepare("SELECT count(*) as total FROM hydra_data_worker_runs WHERE kind = 'VENDAS_DIA' AND status = 'SUCCESS'").get() as { total: number };
    const runsErro = db.prepare("SELECT * FROM hydra_data_worker_runs WHERE kind = 'VENDAS_DIA' AND status = 'ERROR'").all() as any[];

    assert.equal(runsSucesso.total, 9, 'Devem existir 9 runs com SUCCESS');
    assert.equal(runsErro.length, 1, 'Deve existir 1 run com ERROR');
    assert.equal(runsErro[0].loja_slug, lojaComFalha);
    assert.ok(runsErro[0].error.includes('Falha simulada'), 'A mensagem de erro deve ser persistida');

    db.close();
  });

  // ---------------------------------------------------------------------------
  // 5. TESTES DO MAPA DE METAS E REGRA ANTI-MASTER (validarIntegridadeMetas)
  // ---------------------------------------------------------------------------
  console.log('\nGrupo 5: Regras do Mapa de Metas e Protecao Anti-Master');

  test('5.1 - Payload valido com as 10 lojas operacionais e aceito com sucesso', () => {
    const metasValidas = buildMockMetas();
    const validacao = validarIntegridadeMetas(metasValidas);
    assert.equal(validacao.valido, true);
    assert.equal(validacao.erros.length, 0);
    assert.equal(validacao.totalLojas, 10);
  });

  test('5.2 - Payload contendo MPMaster infiltrada deve ser sumariamente rejeitado', () => {
    const payloadInfiltrado = buildMockMetas();
    payloadInfiltrado.lojas.push({
      slug: 'MPMaster',
      nome: 'Master Administrativa',
      faturamentoTotal: 0,
      volumeOS: 0,
      ticketMedio: 0,
      meta: 0
    });
    payloadInfiltrado.faturamentoTotal = payloadInfiltrado.lojas.reduce((acc, l) => acc + l.faturamentoTotal, 0);

    const validacao = validarIntegridadeMetas(payloadInfiltrado);
    assert.equal(validacao.valido, false);
    assert.ok(validacao.erros.some(e => /Master/i.test(e)), 'Deve acusar Master infiltrada');
  });

  test('5.3 - Payload com menos de 10 lojas comerciais deve ser rejeitado', () => {
    const payloadIncompleto = buildMockMetas();
    payloadIncompleto.lojas.pop(); // Remove 10? loja -> fica com 9
    payloadIncompleto.faturamentoTotal = payloadIncompleto.lojas.reduce((acc, l) => acc + l.faturamentoTotal, 0);
    payloadIncompleto.totalOSs = payloadIncompleto.lojas.reduce((acc, l) => acc + l.volumeOS, 0);

    const validacao = validarIntegridadeMetas(payloadIncompleto);
    assert.equal(validacao.valido, false);
    assert.ok(validacao.erros.some(e => /10.*9/.test(e)), 'Deve acusar contagem de lojas incorreta');
  });

  test('5.4 - Payload com faturamento corrompido (NaN ou divergencia de soma) deve ser rejeitado', () => {
    const payloadCorrompido = buildMockMetas();
    payloadCorrompido.lojas[0].faturamentoTotal = NaN as any;

    const validacao = validarIntegridadeMetas(payloadCorrompido);
    assert.equal(validacao.valido, false);
    assert.ok(validacao.erros.some(e => /inv.lido|corrompido/i.test(e)), 'Deve acusar faturamento corrompido');
  });

  test('5.5 - Payload com divergencia grave na soma da rede deve ser rejeitado', () => {
    const payloadDivergente = buildMockMetas({
      faturamentoTotal: 999999999 // Total arbitrario divergente da soma das 10 lojas
    });

    const validacao = validarIntegridadeMetas(payloadDivergente);
    assert.equal(validacao.valido, false);
    assert.ok(validacao.erros.some(e => /diverge/i.test(e)), 'Deve acusar divergencia na soma da rede');
  });

  test('5.6 - Garante que todas as 10 lojas operacionais oficiais estao mapeadas', () => {
    assert.equal(LOJAS_OPERACIONAIS_SLUGS.length, 10);
    assert.ok(!LOJAS_OPERACIONAIS_SLUGS.includes('MPMaster' as any), 'MPMaster nao pode estar nas lojas operacionais');
  });

  console.log('\n===============================================================');
  console.log(`TODOS OS TESTES PASSARAM COM SUCESSO! (${passedTests}/${totalTests})`);
  console.log('===============================================================');
}

runTests().catch(err => {
  console.error('\nFalha na execucao da suite de testes:', err);
  process.exit(1);
});
