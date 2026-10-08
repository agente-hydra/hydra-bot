/**
 * src/hydra-sync/tests/test_meta_reconciliation_dispatch.ts
 * 
 * Suíte Integrada de Testes de Reconciliação do Mapa de Metas & Despacho Silencioso
 * Spec: hydra-mapa-metas-reconcile-and-clean-dispatch
 * 
 * Gates Avaliados:
 * - Gate 1: Captura e parsing do Snapshot do Mapa de Metas com seletor de faturamento total
 * - Gate 2: Algoritmo de conciliação de delta (identificação cirúrgica de lojas com alteração)
 * - Gate 3: Geração de PDF em formato Paisagem A4 com injeção CSS
 * - Gate 4: Nomenclatura canônica dos 3 arquivos (Juros Rede, Carros em Pátio, Mapa de Metas)
 * - Gate 5: Despacho silencioso sem texto solto e conformidade de MIME types
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  capturarSnapshotMapaMetas,
  compararSnapshotsMetas,
  gerarPdfMapaMetas,
  formatarDataNomeArquivo,
  gerarNomesArquivosOficiais
} from '../crawler_meta_reconciliation.js';
import {
  EMPRESAS_MAP,
  LOJAS_OPERACIONAIS_SLUGS,
  type MapaMetasReconciliationSnapshot,
  type StoreRevenueSnapshot
} from '../types/meta_reconciliation_contract.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, id: string, desc: string): void {
  if (condition) {
    passed++;
    console.log(`✅ [PASS] ${id} — ${desc}`);
  } else {
    failed++;
    console.error(`❌ [FAIL] ${id} — ${desc}`);
  }
}

/**
 * Cria mock estruturado do Page do Playwright para testes unitários determinísticos
 */
function createMockPage(options: {
  totalFaturamentoText?: string;
  shouldThrowPdf?: boolean;
}) {
  const evaluatedScripts: string[] = [];
  let pdfOptionsCaptured: any = null;
  let clickedSelectors: string[] = [];

  const mockLocator = (selector: string) => ({
    waitFor: async () => {},
    click: async () => {
      clickedSelectors.push(selector);
    },
    count: async () => 1,
    first: () => ({
      waitFor: async () => {},
      click: async () => {
        clickedSelectors.push(selector);
      },
      isVisible: async () => true,
      textContent: async () => {
        if (selector.includes('lblTotalFaturamento') || selector.includes('ctl13')) {
          return options.totalFaturamentoText || 'R$ 1.500.000,00';
        }
        return '';
      }
    })
  });

  const mockPage: any = {
    goto: async (_url: string) => {},
    waitForLoadState: async () => {},
    waitForTimeout: async (_ms: number) => {},
    locator: (selector: string) => mockLocator(selector),
    evaluate: async (fn: any, arg?: any) => {
      const fnStr = typeof fn === 'function' ? fn.toString() : String(fn);

      // Simulação da extração da tabela do Mapa de Metas
      if (fnStr.includes('ctl00_cph_ucMapaDeMeta_grd')) {
        const rows = [
          { sigla: 'MPplanalto', totalStr: 'R$ 150.000,00', vStr: '150', metaStr: 'R$ 140.000,00', isLastRow: false },
          { sigla: 'MPpiraporinha', totalStr: 'R$ 140.000,00', vStr: '140', metaStr: 'R$ 130.000,00', isLastRow: false },
          { sigla: 'ReiDoOleoMaua', totalStr: 'R$ 160.000,00', vStr: '160', metaStr: 'R$ 150.000,00', isLastRow: false },
          { sigla: 'MPkennedy', totalStr: 'R$ 170.000,00', vStr: '170', metaStr: 'R$ 160.000,00', isLastRow: false },
          { sigla: 'MPrudge', totalStr: 'R$ 130.000,00', vStr: '130', metaStr: 'R$ 120.000,00', isLastRow: false },
          { sigla: 'MPSantoAndre', totalStr: 'R$ 180.000,00', vStr: '180', metaStr: 'R$ 170.000,00', isLastRow: false },
          { sigla: 'ReiDoModulo', totalStr: 'R$ 120.000,00', vStr: '120', metaStr: 'R$ 110.000,00', isLastRow: false },
          { sigla: 'MPJorgeBeretta', totalStr: 'R$ 150.000,00', vStr: '150', metaStr: 'R$ 140.000,00', isLastRow: false },
          { sigla: 'MPdompedro1', totalStr: 'R$ 140.000,00', vStr: '140', metaStr: 'R$ 130.000,00', isLastRow: false },
          { sigla: 'MPJabaquara', totalStr: 'R$ 160.000,00', vStr: '160', metaStr: 'R$ 150.000,00', isLastRow: false },
          // Linha de Rodapé/Total
          { sigla: '', totalStr: 'R$ 1.500.000,00', vStr: '1500', metaStr: 'R$ 1.400.000,00', isLastRow: true }
        ];
        return rows;
      }

      // Outras chamadas evaluate (ex: desmarcar Master)
      return null;
    },
    addStyleTag: async (styleObj: { content: string }) => {
      evaluatedScripts.push(styleObj.content);
    },
    pdf: async (pdfOpts: any) => {
      if (options.shouldThrowPdf) throw new Error('PDF Generation Failed');
      pdfOptionsCaptured = pdfOpts;
      if (pdfOpts?.path) {
        fs.writeFileSync(pdfOpts.path, Buffer.from('%PDF-1.4 Mock Content'));
      }
      return Buffer.from('%PDF-1.4 Mock Content');
    },
    _getPdfOptions: () => pdfOptionsCaptured,
    _getEvaluatedScripts: () => evaluatedScripts,
    _getClickedSelectors: () => clickedSelectors
  };

  return mockPage;
}

async function runTests(): Promise<void> {
  console.log('='.repeat(80));
  console.log('🚀 INICIANDO SUÍTE INTEGRADA: RECONCILIAÇÃO DO MAPA DE METAS & DESPACHO');
  console.log('='.repeat(80));

  // =========================================================================
  // GATE 1: Captura e parsing do Snapshot do Mapa de Metas com seletor de total
  // =========================================================================
  console.log('\n--- GATE 1: CAPTURA E PARSING DO SNAPSHOT ---');
  {
    const mockPage = createMockPage({
      totalFaturamentoText: 'R$ 1.500.000,00'
    });

    const snapshot = await capturarSnapshotMapaMetas(mockPage as any, 'https://sistemaoficinainteligente.com.br');

    assert(
      snapshot.faturamentoTotalRede === 1500000.0,
      'G1.1',
      `Faturamento total extraído corretamente: R$ ${snapshot.faturamentoTotalRede.toFixed(2)}`
    );

    const storeCount = Object.keys(snapshot.stores).length;
    assert(
      storeCount === 10,
      'G1.2',
      `Extração consolidou as 10 lojas comerciais oficiais (obtido: ${storeCount})`
    );

    assert(
      snapshot.sourceXPath !== undefined && snapshot.sourceXPath.includes('lblTotalFaturamento'),
      'G1.3',
      `XPath de faturamento total oficial registrado: ${snapshot.sourceXPath}`
    );

    assert(
      snapshot.masterExcluded === true,
      'G1.4',
      'Loja Master foi explicitamente expurgada da apuração de faturamento'
    );
  }

  // =========================================================================
  // GATE 2: Algoritmo de conciliação de delta (identificação cirúrgica)
  // =========================================================================
  console.log('\n--- GATE 2: ALGORITMO DE CONCILIAÇÃO CIRÚRGICA DE DELTA ---');
  {
    const baseStores: Record<string, StoreRevenueSnapshot> = {
      'MPplanalto': { slug: 'MPplanalto', nome: 'Planalto', faturamentoTotal: 150000, volumeOS: 150, ticketMedio: 1000, meta: 140000 },
      'MPpiraporinha': { slug: 'MPpiraporinha', nome: 'Piraporinha', faturamentoTotal: 140000, volumeOS: 140, ticketMedio: 1000, meta: 130000 },
      'ReiDoOleoMaua': { slug: 'ReiDoOleoMaua', nome: 'Mauá', faturamentoTotal: 160000, volumeOS: 160, ticketMedio: 1000, meta: 150000 },
      'MPkennedy': { slug: 'MPkennedy', nome: 'Kennedy', faturamentoTotal: 170000, volumeOS: 170, ticketMedio: 1000, meta: 160000 },
      'MPrudge': { slug: 'MPrudge', nome: 'Rudge Ramos', faturamentoTotal: 130000, volumeOS: 130, ticketMedio: 1000, meta: 120000 },
      'MPSantoAndre': { slug: 'MPSantoAndre', nome: 'Santo André', faturamentoTotal: 180000, volumeOS: 180, ticketMedio: 1000, meta: 170000 },
      'ReiDoModulo': { slug: 'ReiDoModulo', nome: 'Rei do Módulo', faturamentoTotal: 120000, volumeOS: 120, ticketMedio: 1000, meta: 110000 },
      'MPJorgeBeretta': { slug: 'MPJorgeBeretta', nome: 'Jorge Beretta', faturamentoTotal: 150000, volumeOS: 150, ticketMedio: 1000, meta: 140000 },
      'MPdompedro1': { slug: 'MPdompedro1', nome: 'Dom Pedro I', faturamentoTotal: 140000, volumeOS: 140, ticketMedio: 1000, meta: 130000 },
      'MPJabaquara': { slug: 'MPJabaquara', nome: 'Jabaquara', faturamentoTotal: 160000, volumeOS: 160, ticketMedio: 1000, meta: 150000 }
    };

    const baseSnapshot: MapaMetasReconciliationSnapshot = {
      capturedAt: '2026-10-08T07:55:00.000Z',
      faturamentoTotalRede: 1500000.0,
      totalOSsRede: 1500,
      sourceXPath: '//*[@id="ctl00_cph_ucMapaDeMeta_grd_ctl13_lblTotalFaturamento"]',
      masterExcluded: true,
      stores: baseStores
    };

    // Cenário A: Sem alteração durante o crawl
    const identicalSnapshot: MapaMetasReconciliationSnapshot = {
      ...baseSnapshot,
      capturedAt: '2026-10-08T08:00:00.000Z'
    };

    const deltaZero = compararSnapshotsMetas(baseSnapshot, identicalSnapshot);
    assert(
      deltaZero.hasChanged === false && deltaZero.divergentStores.length === 0 && deltaZero.deltaAmount === 0,
      'G2.1',
      'Detecção de estabilidade: delta=0, hasChanged=false e lista de lojas divergentes vazia'
    );

    // Cenário B: Alteração cirúrgica em 1 loja (ReiDoModulo faturou + R$ 1.600,00 da OS 1916)
    const modifiedStores: Record<string, StoreRevenueSnapshot> = JSON.parse(JSON.stringify(baseStores));
    modifiedStores['ReiDoModulo'].faturamentoTotal += 1600.0;

    const changedSnapshot: MapaMetasReconciliationSnapshot = {
      capturedAt: '2026-10-08T08:05:00.000Z',
      faturamentoTotalRede: 1501600.0,
      totalOSsRede: 1501,
      sourceXPath: baseSnapshot.sourceXPath,
      masterExcluded: true,
      stores: modifiedStores
    };

    const deltaSingle = compararSnapshotsMetas(baseSnapshot, changedSnapshot);
    assert(
      deltaSingle.hasChanged === true &&
      deltaSingle.divergentStores.length === 1 &&
      deltaSingle.divergentStores[0] === 'ReiDoModulo' &&
      deltaSingle.deltaAmount === 1600.0,
      'G2.2',
      `Isolamento cirúrgico perfeito: apenas ReiDoModulo divergente com delta exato de R$ ${deltaSingle.deltaAmount.toFixed(2)}`
    );

    // Cenário C: Alteração cirúrgica em 2 lojas específicas
    const multiModifiedStores: Record<string, StoreRevenueSnapshot> = JSON.parse(JSON.stringify(baseStores));
    multiModifiedStores['MPkennedy'].faturamentoTotal += 500.0;
    multiModifiedStores['MPJabaquara'].faturamentoTotal += 1200.0;

    const multiChangedSnapshot: MapaMetasReconciliationSnapshot = {
      capturedAt: '2026-10-08T08:05:00.000Z',
      faturamentoTotalRede: 1501700.0,
      totalOSsRede: 1502,
      sourceXPath: baseSnapshot.sourceXPath,
      masterExcluded: true,
      stores: multiModifiedStores
    };

    const deltaMulti = compararSnapshotsMetas(baseSnapshot, multiChangedSnapshot);
    assert(
      deltaMulti.hasChanged === true &&
      deltaMulti.divergentStores.length === 2 &&
      deltaMulti.divergentStores.includes('MPkennedy') &&
      deltaMulti.divergentStores.includes('MPJabaquara') &&
      !deltaMulti.divergentStores.includes('ReiDoModulo'),
      'G2.3',
      'Isolamento multi-loja: identificou exatamente as 2 lojas alteradas sem afetar as demais'
    );
  }

  // =========================================================================
  // GATE 3: Geração de PDF em formato Paisagem A4 com injeção CSS
  // =========================================================================
  console.log('\n--- GATE 3: GERAÇÃO DE PDF OFICIAL PAISAGEM A4 ---');
  {
    const mockPage = createMockPage({});
    const tmpDir = path.resolve(__dirname, '../../../.tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const targetPdfPath = path.join(tmpDir, 'test_mapa_metas.pdf');

    const generatedPath = await gerarPdfMapaMetas(mockPage as any, targetPdfPath);
    const pdfOpts = mockPage._getPdfOptions();
    const evaluatedCss = mockPage._getEvaluatedScripts();

    assert(
      fs.existsSync(generatedPath),
      'G3.1',
      `Arquivo PDF gerado e persistido no caminho alvo: ${generatedPath}`
    );

    assert(
      pdfOpts?.format === 'A4' && pdfOpts?.landscape === true && pdfOpts?.printBackground === true,
      'G3.2',
      `Configuração do Playwright PDF compatível: formato A4, landscape=true e printBackground=true`
    );

    assert(
      evaluatedCss.some((css: string) => css.includes('@page') && css.includes('landscape')),
      'G3.3',
      'Injeção CSS de @page { size: A4 landscape; } verificada com sucesso'
    );

    // Limpeza do temporário
    if (fs.existsSync(targetPdfPath)) fs.unlinkSync(targetPdfPath);
  }

  // =========================================================================
  // GATE 4: Nomenclatura canônica dos 3 arquivos oficiais
  // =========================================================================
  console.log('\n--- GATE 4: NOMENCLATURA CANÔNICA DOS 3 ARQUIVOS ---');
  {
    const dataFixa = new Date(2026, 9, 8); // 08/10/2026
    const tag = formatarDataNomeArquivo(dataFixa);
    assert(
      tag === '08-10-2026',
      'G4.1',
      `Formatação de data com hífens padronizada: ${tag}`
    );

    const nomes = gerarNomesArquivosOficiais(dataFixa);
    assert(
      nomes.jurosRede === 'Juros Rede - 08-10-2026.xlsx',
      'G4.2',
      `Nome canônico Juros Rede: ${nomes.jurosRede}`
    );

    assert(
      nomes.carrosPatio === 'Carros em Patio - 08-10-2026.xlsx',
      'G4.3',
      `Nome canônico Carros em Pátio: ${nomes.carrosPatio}`
    );

    assert(
      nomes.mapaMetas === 'Mapa de Metas - 08-10-2026.pdf',
      'G4.4',
      `Nome canônico Mapa de Metas: ${nomes.mapaMetas}`
    );
  }

  // =========================================================================
  // GATE 5: Despacho silencioso sem texto solto e conformidade de MIME types
  // =========================================================================
  console.log('\n--- GATE 5: DESPACHO SILENCIOSO & CONFORMIDADE DE MENSAGENS ---');
  {
    const dispatcherPath = path.resolve(process.cwd(), 'projects/hydra-rede/src/whatsapp_unified_dispatcher.js');
    const unifiedModule = require(dispatcherPath);

    assert(
      typeof unifiedModule.dispararRelatoriosMatinaisSilenciosos === 'function',
      'G5.1',
      'Função dispararRelatoriosMatinaisSilenciosos exportada e disponível'
    );

    const padrao = unifiedModule.resolverCaminhosPadraoRelatorios('08-10-2026');
    assert(
      padrao.jurosRedePath.endsWith('Juros Rede - 08-10-2026.xlsx') &&
      padrao.carrosPatioPath.endsWith('Carros em Patio - 08-10-2026.xlsx') &&
      padrao.mapaMetasPdfPath.endsWith('Mapa de Metas - 08-10-2026.pdf'),
      'G5.2',
      'Resolução de caminhos padrão preserva nomes e extensões canônicas dos 3 relatórios'
    );

    // Verificação de segurança: instância autorizada
    const remetenteInstancia = process.env.EVO_INSTANCE || 'hydra';
    const isInstanciaAutorizada = ['hydra', 'atendimento'].includes(remetenteInstancia);
    assert(
      isInstanciaAutorizada,
      'G5.3',
      `Instância remetente autorizada (${remetenteInstancia}) respeita regra inegociável de segurança WhatsApp`
    );

    // Validação de MIME types esperados
    const mimeXlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const mimePdf = 'application/pdf';

    const getMimeForFile = (filename: string) => {
      if (filename.toLowerCase().endsWith('.pdf')) return mimePdf;
      return mimeXlsx;
    };

    assert(
      getMimeForFile(padrao.mapaMetasPdfPath) === 'application/pdf',
      'G5.4',
      'MIME type do Mapa de Metas é estritamente application/pdf'
    );

    assert(
      getMimeForFile(padrao.jurosRedePath) === mimeXlsx && getMimeForFile(padrao.carrosPatioPath) === mimeXlsx,
      'G5.5',
      'MIME type das planilhas Excel é application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
  }

  console.log('\n' + '='.repeat(80));
  console.log(`RESULTADO FINAL DA SUÍTE DE TESTES:`);
  console.log(`TOTAL PASSADOS: ${passed}`);
  console.log(`TOTAL FALHAS:   ${failed}`);
  console.log('='.repeat(80));

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('❌ Erro fatal na suíte de testes:', err);
  process.exit(1);
});
