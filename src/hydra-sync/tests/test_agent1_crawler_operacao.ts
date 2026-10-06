import * as fs from 'fs';
import * as path from 'path';
import assert from 'assert';
import {
  EMPRESAS_RELATORIO,
  parseMoeda,
  parsePercent,
  parseIntBR,
  parseTabelasRelatorio,
  validarIntegridadeRelatorioOperacao,
  extrairTabelasRelatorioOperacao
} from '../relatorio_operacao_crawler.js';
import {
  getDatabaseConnection,
  salvarRelatorioOperacao,
  getCMVByStore
} from '../db_repository.js';
import { recordDataWorkerRun } from '../data_worker_log.js';
import { ensureCompany } from '../../workers/oficina-agent/playwright/actions/core.js';

let passedTests = 0;
let totalTests = 0;

async function it(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ? [PASS] ${name}`);
  } catch (err) {
    console.error(`  ? [FAIL] ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function runTests() {
  console.log('?? Iniciando Suite de Testes do Agente 1 (Crawler OS & CMV Gestao Periodica)...\n');

  // =========================================================================
  // GRUPO 1: Catalogo e Troca de Empresa (10 Lojas Operacionais)
  // =========================================================================
  console.log('--- Grupo 1: Catalogo e Troca de Empresa (10 Lojas Elegiveis) ---');

  await it('1.1 - EMPRESAS_RELATORIO contem exatamente as 10 lojas operacionais', () => {
    const lojas = Object.keys(EMPRESAS_RELATORIO);
    assert.strictEqual(lojas.length, 10, `Esperado 10 lojas, recebido ${lojas.length}`);
    const esperado = [
      'MPdompedro1',
      'MPJabaquara',
      'MPJorgeBeretta',
      'MPkennedy',
      'MPpiraporinha',
      'MPplanalto',
      'MPrudge',
      'MPSantoAndre',
      'ReiDoModulo',
      'ReiDoOleoMaua'
    ];
    for (const slug of esperado) {
      assert.ok(EMPRESAS_RELATORIO[slug], `Loja ${slug} deve estar presente`);
    }
  });

  await it('1.2 - Loja administrativa MPMaster expressamente EXCLUIDA do catalogo operacional', () => {
    assert.strictEqual(EMPRESAS_RELATORIO['MPMaster'], undefined);
    assert.strictEqual('MPMaster' in EMPRESAS_RELATORIO, false);
  });

  await it('1.3 - Todas as 10 lojas operacionais estao devidamente mapeadas em empresas.json', () => {
    const empresasConfigPath = path.resolve('docs/app-map/empresas.json');
    assert.ok(fs.existsSync(empresasConfigPath), 'empresas.json deve existir');
    const empresas = JSON.parse(fs.readFileSync(empresasConfigPath, 'utf-8'));

    for (const slug of Object.keys(EMPRESAS_RELATORIO)) {
      assert.ok(empresas[slug], `Slug ${slug} deve estar em empresas.json`);
      assert.ok(empresas[slug].nome_header, `Slug ${slug} deve ter nome_header`);
      assert.ok(empresas[slug].nome_amigavel, `Slug ${slug} deve ter nome_amigavel`);
    }
  });

  await it('1.4 - ensureCompany confirma a troca para cada uma das 10 lojas elegiveis', async () => {
    const empresas = JSON.parse(fs.readFileSync(path.resolve('docs/app-map/empresas.json'), 'utf-8'));

    for (const slug of Object.keys(EMPRESAS_RELATORIO)) {
      const targetHeader = empresas[slug].nome_header;
      let currentHeader = 'EMPRESA_ANTERIOR';

      // Mock Page do Playwright
      const mockPage: any = {
        locator: (selector: string) => ({
          textContent: async () => currentHeader,
          waitFor: async () => {},
          click: async () => {},
          selectOption: async (opt: any) => {
            if (opt.label === targetHeader) {
              currentHeader = targetHeader;
            }
          }
        }),
        waitForTimeout: async () => {},
        waitForLoadState: async () => {},
        evaluate: async (fn: any, arg: any) => true,
        goto: async () => {}
      };

      await ensureCompany(mockPage, slug);
      assert.strictEqual(currentHeader, targetHeader, `Empresa atual deve ser ${targetHeader} apos troca`);
    }
  });

  await it('1.5 - ensureCompany rejeita empresa desconhecida / nao mapeada', async () => {
    const mockPage: any = { locator: () => ({ textContent: async () => '' }) };
    await assert.rejects(
      async () => {
        await ensureCompany(mockPage, 'LojaInvalida999');
      },
      /mapeada/i
    );
  });

  // =========================================================================
  // GRUPO 2: Extracao e Validacao Matematica (Areas + Linha Totalizadora CMV)
  // =========================================================================
  console.log('\n--- Grupo 2: Extracao e Validacao Matematica (Areas e Linha Totalizadora de CMV) ---');

  await it('2.1 - Funcoes auxiliares de parsing numerico (parseMoeda, parsePercent, parseIntBR)', () => {
    assert.strictEqual(parseMoeda('R$ 117.270,19'), 117270.19);
    assert.strictEqual(parseMoeda('R$ -5.576,57'), -5576.57);
    assert.strictEqual(parseMoeda('-R$ 1.000,50'), -1000.50);
    assert.strictEqual(parseMoeda('R$ (2.500,00)'), -2500.00);
    assert.strictEqual(parseMoeda(''), 0);

    assert.strictEqual(parsePercent('24,89%'), 24.89);
    assert.strictEqual(parsePercent('100,00 %'), 100);
    assert.strictEqual(parsePercent('0%'), 0);
    assert.strictEqual(parsePercent(' - '), 0);

    assert.strictEqual(parseIntBR('12'), 12);
    assert.strictEqual(parseIntBR('1.500'), 1500);
    assert.strictEqual(parseIntBR(''), 0);
  });

  await it('2.2 - parseTabelasRelatorio extrai areas, midia e linha totalizadora oficial de CMV', () => {
    const rawFixture = {
      rowsArea: [
        ['Area', 'Faturamento', '% Fat.', 'Desconto', 'Fat. Liquido', 'Custo', 'CMV %', 'Lucro Bruto', '% Lucro Bruto'],
        ['SERVICO PRESTADO', 'R$ 47.249,72', '40,29%', 'R$ -6.097,39', 'R$ 41.152,33', 'R$ 0,00', '0,00%', 'R$ 47.249,72', '100,00%'],
        ['MECANICA', 'R$ 33.751,65', '28,78%', 'R$ 2,60', 'R$ 33.754,25', 'R$ 15.264,08', '45,22%', 'R$ 18.487,57', '54,78%'],
        ['TERCEIRIZADO', 'R$ 24.552,63', '20,94%', 'R$ -30,00', 'R$ 24.522,63', 'R$ 8.948,00', '36,44%', 'R$ 15.604,63', '63,56%'],
        ['PECAS', 'R$ 11.716,19', '9,99%', 'R$ 548,22', 'R$ 12.264,41', 'R$ 4.971,44', '42,43%', 'R$ 6.744,75', '57,57%'],
        ['', 'R$ 117.270,19', '100,00%', 'R$ -5.576,57', 'R$ 111.693,62', 'R$ 29.183,52', '24,89%', 'R$ 88.086,67', '75,11%']
      ],
      rowsMidia: [
        ['Pesquisa de Midia', 'Faturamento', '% Fat.', 'Qtd. OS', 'Ticket Medio'],
        ['Google', 'R$ 70.364,57', '60,00%', '37', 'R$ 1.901,75'],
        ['Balcao', 'R$ 35.182,28', '30,00%', '15', 'R$ 2.345,49'],
        ['Indicacao', 'R$ 11.723,34', '10,00%', '8', 'R$ 1.465,42'],
        ['Total', 'R$ 117.270,19', '100,00%', '60', 'R$ 1.954,50']
      ]
    };

    const extracao = parseTabelasRelatorio(rawFixture, 'MPJabaquara');
    assert.ok(extracao, 'Extracao deve ser preenchida');
    assert.strictEqual(extracao.lojaSlug, 'MPJabaquara');

    // Validacao da Linha Totalizadora de CMV
    assert.strictEqual(extracao.cmv.faturamento_total, 117270.19);
    assert.strictEqual(extracao.cmv.desconto_total, -5576.57);
    assert.strictEqual(extracao.cmv.custo_total, 29183.52);
    assert.strictEqual(extracao.cmv.cmv_percentual, 24.89);
    assert.strictEqual(extracao.cmv.lucro_bruto, 88086.67);

    // Validacao das Areas
    assert.strictEqual(extracao.areas.length, 4);
    assert.strictEqual(extracao.areas[0].area, 'SERVICO PRESTADO');
    assert.strictEqual(extracao.areas[0].faturamento, 47249.72);
    assert.strictEqual(extracao.areas[1].area, 'MECANICA');
    assert.strictEqual(extracao.areas[1].cmv_percentual, 45.22);

    // Validacao da Midia
    assert.strictEqual(extracao.midia.length, 3);
    assert.strictEqual(extracao.midia[0].canal, 'Google');
    assert.strictEqual(extracao.midia[0].qtd_os, 37);
  });

  await it('2.3 - Validacao matematica: somatorio das areas bate com o totalizador oficial (tolerancia R$ 1,00)', () => {
    const rawFixture = {
      rowsArea: [
        ['Area', 'Faturamento', '% Fat.', 'Desconto', 'Fat. Liquido', 'Custo', 'CMV %', 'Lucro Bruto', '% Lucro Bruto'],
        ['SERVICO PRESTADO', 'R$ 47.249,72', '40,29%', 'R$ 0,00', 'R$ 47.249,72', 'R$ 0,00', '0,00%', 'R$ 47.249,72', '100,00%'],
        ['MECANICA', 'R$ 33.751,65', '28,78%', 'R$ 0,00', 'R$ 33.751,65', 'R$ 15.264,08', '45,22%', 'R$ 18.487,57', '54,78%'],
        ['TERCEIRIZADO', 'R$ 24.552,63', '20,94%', 'R$ 0,00', 'R$ 24.552,63', 'R$ 8.948,00', '36,44%', 'R$ 15.604,63', '63,56%'],
        ['PECAS', 'R$ 11.716,19', '9,99%', 'R$ 0,00', 'R$ 11.716,19', 'R$ 4.971,44', '42,43%', 'R$ 6.744,75', '57,57%'],
        ['', 'R$ 117.270,19', '100,00%', 'R$ 0,00', 'R$ 117.270,19', 'R$ 29.183,52', '24,89%', 'R$ 88.086,67', '75,11%']
      ],
      rowsMidia: [
        ['Canal', 'Faturamento', '% Fat.', 'Qtd. OS', 'Ticket Medio'],
        ['Balcao', 'R$ 117.270,19', '100,00%', '50', 'R$ 2.345,40']
      ]
    };

    const extracao = parseTabelasRelatorio(rawFixture, 'MPJabaquara');
    assert.doesNotThrow(() => {
      validarIntegridadeRelatorioOperacao(extracao);
    });
  });

  await it('2.4 - Rejeita extracao com divergencia matematica superior a R$ 1,00', () => {
    const rawInvalido = {
      rowsArea: [
        ['Area', 'Faturamento', '% Fat.', 'Desconto', 'Fat. Liquido', 'Custo', 'CMV %', 'Lucro Bruto', '% Lucro Bruto'],
        ['SERVICO PRESTADO', 'R$ 40.000,00', '40,00%', 'R$ 0,00', 'R$ 40.000,00', 'R$ 0,00', '0,00%', 'R$ 40.000,00', '100,00%'],
        ['', 'R$ 100.000,00', '100,00%', 'R$ 0,00', 'R$ 100.000,00', 'R$ 25.000,00', '25,00%', 'R$ 75.000,00', '75,00%']
      ],
      rowsMidia: []
    };

    const extracao = parseTabelasRelatorio(rawInvalido, 'MPJabaquara');
    assert.throws(
      () => {
        validarIntegridadeRelatorioOperacao(extracao);
      },
      /Inconsistencia|difere/i
    );
  });

  await it('2.5 - Rejeita faturamento_total ou cmv_percentual nao positivo ou nao finito', () => {
    const rawZero = {
      rowsArea: [
        ['Area', 'Faturamento', '% Fat.', 'Desconto', 'Fat. Liquido', 'Custo', 'CMV %', 'Lucro Bruto', '% Lucro Bruto'],
        ['SERVICO', 'R$ 0,00', '0%', 'R$ 0,00', 'R$ 0,00', 'R$ 0,00', '0%', 'R$ 0,00', '0%'],
        ['', 'R$ 0,00', '0%', 'R$ 0,00', 'R$ 0,00', 'R$ 0,00', '0%', 'R$ 0,00', '0%']
      ],
      rowsMidia: []
    };

    const extracao = parseTabelasRelatorio(rawZero, 'MPJabaquara');
    assert.throws(
      () => {
        validarIntegridadeRelatorioOperacao(extracao, false);
      },
      /faturamento_total|invalido/i
    );
  });

  await it('2.6 - Distingue falha de extracao (grid ausente/vazia) e protege snapshot anterior valido', async () => {
    // 1. Grid ausente no DOM
    const mockPageGridAusente: any = {
      evaluate: async () => ({ rowsArea: null, rowsMidia: null })
    };
    await assert.rejects(
      async () => {
        await extrairTabelasRelatorioOperacao(mockPageGridAusente, 'MPJabaquara');
      },
      /nao localizada/i
    );

    // 2. Grid vazia no DOM
    const mockPageGridVazia: any = {
      evaluate: async () => ({ rowsArea: [], rowsMidia: [] })
    };
    await assert.rejects(
      async () => {
        await extrairTabelasRelatorioOperacao(mockPageGridVazia, 'MPJabaquara');
      },
      /vazia|sem linhas/i
    );

    // 3. Protecao: NUNCA sobrescrever snapshot valido por tabela vazia
    const extracaoVazia: any = {
      lojaSlug: 'MPJabaquara',
      areas: [{ area: 'SERVICO', faturamento: 0, custo: 0, cmv_percentual: 0, lucro_bruto: 0 }],
      cmv: { faturamento_total: 0, cmv_percentual: 0, custo_total: 0, lucro_bruto: 0, lucro_bruto_percentual: 0 }
    };
    assert.throws(
      () => {
        validarIntegridadeRelatorioOperacao(extracaoVazia, true /* snapshotAnteriorExiste */);
      },
      /preservando snapshot anterior/i
    );
  });

  // =========================================================================
  // GRUPO 3: Teste de Falha Intermediaria (Circuit Breaker)
  // =========================================================================
  console.log('\n--- Grupo 3: Teste de Falha Intermediaria & Circuit Breaker ---');

  await it('3.1 - Falha em uma loja nao aborta o loop geral; preserva snapshot anterior e registra em hydra_data_worker_runs', async () => {
    const testDbPath = '/tmp/test_agent1_circuit_breaker.db';
    const testCrawlsDir = '/tmp/test_crawls_circuit_breaker';
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(testCrawlsDir)) fs.rmSync(testCrawlsDir, { recursive: true, force: true });
    fs.mkdirSync(testCrawlsDir, { recursive: true });

    const db = getDatabaseConnection(testDbPath);

    // Snapshot pre-existente da Loja B
    const snapshotLojaB = {
      lojaSlug: 'MPJorgeBeretta',
      dataInicio: '2026-09-01',
      dataFim: '2026-09-30',
      cmv: {
        loja_slug: 'MPJorgeBeretta',
        data_inicio: '2026-09-01',
        data_fim: '2026-09-30',
        faturamento_total: 84613.61,
        desconto_total: -2500.00,
        custo_total: 16711.18,
        cmv_percentual: 19.75,
        lucro_bruto: 67902.43,
        lucro_bruto_percentual: 80.25
      },
      areas: [
        {
          loja_slug: 'MPJorgeBeretta',
          data_inicio: '2026-09-01',
          data_fim: '2026-09-30',
          area: 'MECANICA',
          faturamento: 84613.61,
          faturamento_percentual: 100,
          desconto: 0,
          custo: 16711.18,
          cmv_percentual: 19.75,
          lucro_bruto: 67902.43,
          lucro_bruto_percentual: 80.25
        }
      ],
      midia: [
        {
          loja_slug: 'MPJorgeBeretta',
          data_inicio: '2026-09-01',
          data_fim: '2026-09-30',
          canal: 'Balcao',
          faturamento: 84613.61,
          faturamento_percentual: 100,
          qtd_os: 40,
          ticket_medio: 2115.34
        }
      ],
      dataHoraCaptura: '2026-09-30T10:00:00.000Z'
    };

    const arquivoSnapshotB = path.join(testCrawlsDir, 'relatorio_operacao_MPJorgeBeretta.json');
    fs.writeFileSync(arquivoSnapshotB, JSON.stringify(snapshotLojaB, null, 2));

    salvarRelatorioOperacao(db, {
      lojaSlug: snapshotLojaB.lojaSlug,
      dataInicio: snapshotLojaB.dataInicio,
      dataFim: snapshotLojaB.dataFim,
      cmv: snapshotLojaB.cmv,
      areas: snapshotLojaB.areas,
      midia: snapshotLojaB.midia
    });

    // Simulacao do loop sequencial com 3 lojas: Loja A (Sucesso), Loja B (Falha), Loja C (Sucesso)
    const lojas = ['MPdompedro1', 'MPJorgeBeretta', 'MPkennedy'];
    const lojasProcessadasComSucesso: string[] = [];
    const lojasComFalha: string[] = [];

    for (const slug of lojas) {
      const inicioLoja = new Date().toISOString();
      try {
        if (slug === 'MPJorgeBeretta') {
          // Simula erro de navegacao / timeout na extracao
          throw new Error('Timeout de 15000ms excedido ao aguardar #ctl00_cph_grdFaturamentoPorArea');
        }

        salvarRelatorioOperacao(db, {
          lojaSlug: slug,
          dataInicio: '2026-09-01',
          dataFim: '2026-09-30',
          cmv: {
            loja_slug: slug,
            data_inicio: '2026-09-01',
            data_fim: '2026-09-30',
            faturamento_total: 50000,
            desconto_total: 0,
            custo_total: 10000,
            cmv_percentual: 20,
            lucro_bruto: 40000,
            lucro_bruto_percentual: 80
          },
          areas: [
            {
              loja_slug: slug,
              data_inicio: '2026-09-01',
              data_fim: '2026-09-30',
              area: 'MECANICA',
              faturamento: 50000,
              custo: 10000,
              cmv_percentual: 20,
              lucro_bruto: 40000,
              lucro_bruto_percentual: 80
            }
          ]
        });

        recordDataWorkerRun(db, {
          kind: 'OPERACAO',
          lojaSlug: slug,
          dataReferencia: '2026-09-30',
          startedAt: inicioLoja,
          status: 'SUCCESS',
          itemCount: 2
        });

        lojasProcessadasComSucesso.push(slug);
      } catch (err: any) {
        // CIRCUIT BREAKER
        lojasComFalha.push(slug);
        recordDataWorkerRun(db, {
          kind: 'OPERACAO',
          lojaSlug: slug,
          dataReferencia: '2026-09-30',
          startedAt: inicioLoja,
          status: 'ERROR',
          error: err.message
        });
      }
    }

    // 1. Loop continuou ate o final
    assert.deepStrictEqual(lojasProcessadasComSucesso, ['MPdompedro1', 'MPkennedy'], 'Lojas A e C devem ter completado');
    assert.deepStrictEqual(lojasComFalha, ['MPJorgeBeretta'], 'Loja B deve constar como falha');

    // 2. Snapshot em disco da Loja B permanece intacto
    assert.ok(fs.existsSync(arquivoSnapshotB), 'Snapshot da loja B deve permanecer em disco');
    const conteudoSnapshotB = JSON.parse(fs.readFileSync(arquivoSnapshotB, 'utf-8'));
    assert.strictEqual(conteudoSnapshotB.cmv.faturamento_total, 84613.61, 'Dados do snapshot anterior devem estar intactos');

    // 3. SQLite da Loja B permanece intacto
    const cmvB = getCMVByStore(db, { lojaSlug: 'MPJorgeBeretta' });
    assert.strictEqual(cmvB.length, 1);
    assert.strictEqual(cmvB[0].faturamento_total, 84613.61);

    // 4. Falha registrada no worker log
    const runsB = db.prepare('SELECT * FROM hydra_data_worker_runs WHERE loja_slug = ?').all('MPJorgeBeretta');
    assert.strictEqual(runsB.length, 1);
    assert.strictEqual(runsB[0].status, 'ERROR');
    assert.ok(runsB[0].error.includes('Timeout de 15000ms'));

    db.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (fs.existsSync(testCrawlsDir)) fs.rmSync(testCrawlsDir, { recursive: true, force: true });
  });

  // =========================================================================
  // GRUPO 4: Teste de Idempotencia Total
  // =========================================================================
  console.log('\n--- Grupo 4: Teste de Idempotencia (Sem Duplicacao Nem Corrupcao de Totais) ---');

  await it('4.1 - Executar salvarRelatorioOperacao duas vezes consecutivas nao duplica linhas nem altera totais', () => {
    const testDbPath = '/tmp/test_agent1_idempotency.db';
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    const db = getDatabaseConnection(testDbPath);

    const dados = {
      lojaSlug: 'MPpiraporinha',
      dataInicio: '2026-09-01',
      dataFim: '2026-09-30',
      cmv: {
        loja_slug: 'MPpiraporinha',
        data_inicio: '2026-09-01',
        data_fim: '2026-09-30',
        faturamento_total: 112149.18,
        desconto_total: -1200.50,
        custo_total: 23427.96,
        cmv_percentual: 20.89,
        lucro_bruto: 88721.22,
        lucro_bruto_percentual: 79.11
      },
      areas: [
        {
          loja_slug: 'MPpiraporinha',
          data_inicio: '2026-09-01',
          data_fim: '2026-09-30',
          area: 'SERVICO PRESTADO',
          faturamento: 60000.00,
          faturamento_percentual: 53.50,
          desconto: 0,
          custo: 5000.00,
          cmv_percentual: 8.33,
          lucro_bruto: 55000.00,
          lucro_bruto_percentual: 91.67
        },
        {
          loja_slug: 'MPpiraporinha',
          data_inicio: '2026-09-01',
          data_fim: '2026-09-30',
          area: 'MECANICA',
          faturamento: 52149.18,
          faturamento_percentual: 46.50,
          desconto: -1200.50,
          custo: 18427.96,
          cmv_percentual: 35.34,
          lucro_bruto: 33721.22,
          lucro_bruto_percentual: 64.66
        }
      ],
      midia: [
        {
          loja_slug: 'MPpiraporinha',
          data_inicio: '2026-09-01',
          data_fim: '2026-09-30',
          canal: 'Google',
          faturamento: 80000.00,
          faturamento_percentual: 71.33,
          qtd_os: 30,
          ticket_medio: 2666.67
        },
        {
          loja_slug: 'MPpiraporinha',
          data_inicio: '2026-09-01',
          data_fim: '2026-09-30',
          canal: 'Balcao',
          faturamento: 32149.18,
          faturamento_percentual: 28.67,
          qtd_os: 15,
          ticket_medio: 2143.28
        }
      ]
    };

    // 1a Execucao
    salvarRelatorioOperacao(db, dados);

    const countCMV1 = db.prepare('SELECT COUNT(*) as count FROM cmv_lojas').get().count;
    const countAreas1 = db.prepare('SELECT COUNT(*) as count FROM faturamento_areas').get().count;
    const countMidia1 = db.prepare('SELECT COUNT(*) as count FROM pesquisa_midia').get().count;

    assert.strictEqual(countCMV1, 1, 'cmv_lojas deve ter 1 linha');
    assert.strictEqual(countAreas1, 2, 'faturamento_areas deve ter 2 linhas');
    assert.strictEqual(countMidia1, 2, 'pesquisa_midia deve ter 2 linhas');

    // 2a Execucao com os MESMOS dados
    salvarRelatorioOperacao(db, dados);

    const countCMV2 = db.prepare('SELECT COUNT(*) as count FROM cmv_lojas').get().count;
    const countAreas2 = db.prepare('SELECT COUNT(*) as count FROM faturamento_areas').get().count;
    const countMidia2 = db.prepare('SELECT COUNT(*) as count FROM pesquisa_midia').get().count;

    assert.strictEqual(countCMV2, 1, 'cmv_lojas NAO deve duplicar linhas');
    assert.strictEqual(countAreas2, 2, 'faturamento_areas NAO deve duplicar linhas');
    assert.strictEqual(countMidia2, 2, 'pesquisa_midia NAO deve duplicar linhas');

    // Verificacao de nao-corrupcao de valores
    const rowCMV = db.prepare('SELECT * FROM cmv_lojas WHERE loja_slug = ?').get('MPpiraporinha');
    assert.strictEqual(rowCMV.faturamento_total, 112149.18, 'Faturamento total deve permanecer o mesmo');
    assert.strictEqual(rowCMV.custo_total, 23427.96, 'Custo total deve permanecer o mesmo');
    assert.strictEqual(rowCMV.cmv_percentual, 20.89, 'CMV % deve permanecer o mesmo');

    db.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  await it('4.2 - Executar salvarRelatorioOperacao com atualizacao atualiza dados in-place via ON CONFLICT', () => {
    const testDbPath = '/tmp/test_agent1_update.db';
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    const db = getDatabaseConnection(testDbPath);

    // Insercao inicial
    salvarRelatorioOperacao(db, {
      lojaSlug: 'MPkennedy',
      dataInicio: '2026-09-01',
      dataFim: '2026-09-30',
      cmv: {
        loja_slug: 'MPkennedy',
        data_inicio: '2026-09-01',
        data_fim: '2026-09-30',
        faturamento_total: 30000,
        custo_total: 6000,
        cmv_percentual: 20,
        lucro_bruto: 24000,
        lucro_bruto_percentual: 80
      }
    });

    // Atualizacao com nova ingestao posterior no mesmo periodo
    salvarRelatorioOperacao(db, {
      lojaSlug: 'MPkennedy',
      dataInicio: '2026-09-01',
      dataFim: '2026-09-30',
      cmv: {
        loja_slug: 'MPkennedy',
        data_inicio: '2026-09-01',
        data_fim: '2026-09-30',
        faturamento_total: 35693.39,
        custo_total: 7560.10,
        cmv_percentual: 21.18,
        lucro_bruto: 28133.29,
        lucro_bruto_percentual: 78.82
      }
    });

    const rows = db.prepare('SELECT * FROM cmv_lojas WHERE loja_slug = ?').all('MPkennedy');
    assert.strictEqual(rows.length, 1, 'Deve continuar com apenas 1 registro');
    assert.strictEqual(rows[0].faturamento_total, 35693.39, 'Faturamento total deve ter sido atualizado');
    assert.strictEqual(rows[0].cmv_percentual, 21.18, 'CMV % deve ter sido atualizado');

    db.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  // =========================================================================
  // Relatorio Final
  // =========================================================================
  console.log('\n========================================================');
  console.log(`?? RESULTADO FINAL: ${passedTests}/${totalTests} TESTES APROVADOS!`);
  console.log('========================================================\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Erro fatal nos testes:', err);
  process.exit(1);
});

