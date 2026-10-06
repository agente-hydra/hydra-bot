import { chromium, type Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { config as dotenvConfig } from 'dotenv';
import { ensureCompany } from '../workers/oficina-agent/playwright/actions/core.js';
import { handleOSDeepInspector, extrairDetalhe } from '../workers/oficina-agent/playwright/actions/os_deep_inspector.js';
import { format } from 'date-fns';
import { getDatabaseConnection, salvarLoteOSs, upsertOSEmbedding, formalizarTransicaoNominalOS } from './db_repository.js';
import { getEmbedder } from './embeddings.js';
import { EMPRESAS_RELATORIO, coletarRelatorioOperacaoLoja } from './relatorio_operacao_crawler.js';
import { recordDataWorkerRun } from './data_worker_log.js';

dotenvConfig({ path: '/opt/bots/.env' });
dotenvConfig();

const EMPRESAS_PATH = path.resolve('docs/app-map/empresas.json');
const OUT_DIR = '/home/operacional/hydra-data/crawls';
const BASE = process.env.OI_URL || 'https://sistemaoficinainteligente.com.br';

async function login(page: Page) {
  console.log('[Deep Crawler] Efetuando login...');
  await page.goto(`${BASE}/login`, { waitUntil: 'load' });
  await page.waitForTimeout(3000);

  // Bypass Cloudflare Turnstile se aparecer
  const captchaFrame = page.frameLocator('iframe[src*="cloudflare"], iframe[src*="turnstile"]').first();
  const captchaCheckbox = captchaFrame.locator('input[type="checkbox"], .ctp-checkbox-label');
  if (await captchaCheckbox.isVisible({ timeout: 4000 }).catch(() => false)) {
    await captchaCheckbox.click({ force: true });
    await page.waitForTimeout(5000);
  }

  // Preencher credenciais WebForms ASP.NET
  const email = page.locator('input[type="email"], input[type="text"], input[name="login"]').first();
  const pass  = page.locator('input[type="password"]').first();
  await email.waitFor({ state: 'visible', timeout: 20000 });
  await email.fill(process.env.OI_USER || '');
  await pass.fill(process.env.OI_PASS || '');

  const btn = page.locator('button:has-text("Entrar"), button:has-text("Login"), input[type="submit"]').first();
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await btn.click();
  } else {
    await pass.press('Enter');
  }
  await page.waitForTimeout(5000);
  console.log('[Deep Crawler] Login OK. URL:', page.url());
}

async function indexarEmbeddingsLote(db: any, slug: string, documentos: any[]): Promise<void> {
  try {
    const embedder = await getEmbedder();
    if (!embedder) {
      console.warn(`[Deep Crawler] Embedder não disponível, pulando indexação vetorial para ${slug}.`);
      return;
    }

    console.log(`[Deep Crawler] Gerando embeddings vetoriais para ${documentos.length} OSs de ${slug}...`);
    let count = 0;

    for (const doc of documentos) {
      const osId = String(doc.os_id || doc.id || '');
      if (!osId) continue;

      const osKey = `${osId}:${slug}`;
      const textParts = [
        doc.veiculo || '',
        doc.placa || '',
        doc.cliente_nome || doc.cliente || '',
        doc.status_grid || '',
        doc.responsavel || '',
        slug
      ].filter(Boolean).join(' ');

      if (textParts.trim().length === 0) continue;

      try {
        const vector = await embedder.embed(textParts);
        upsertOSEmbedding(db, osKey, vector);
        count++;
      } catch (err: any) {
        // Ignora erro individual para não interromper lote
      }
    }

    console.log(`[Deep Crawler] ✅ [Embeddings] ${count} vetores indexados em vec_ordens_servico para ${slug}.`);
  } catch (err: any) {
    console.warn(`[Deep Crawler] ⚠️ Erro na indexação vetorial de ${slug}:`, err?.message || err);
  }
}

async function run() {
  const targetSlug = process.argv[2];
  if (targetSlug && !EMPRESAS_RELATORIO[targetSlug]) {
    throw new Error(`Loja não elegível para OS→CMV: ${targetSlug}. Apenas as 10 lojas operacionais são permitidas (MPMaster proibido).`);
  }

  // Catálogo estrito das 10 lojas operacionais (excluindo MPMaster)
  const slugs = targetSlug ? [targetSlug] : Object.keys(EMPRESAS_RELATORIO);

  let empresasConfig: Record<string, { nome_header: string; nome_amigavel: string }> = {};
  if (fs.existsSync(EMPRESAS_PATH)) {
    try {
      empresasConfig = JSON.parse(fs.readFileSync(EMPRESAS_PATH, 'utf-8'));
    } catch {
      // fallback
    }
  }

  console.log(`[Deep Crawler] Iniciando ciclo unificado sequencial (OS → CMV) para ${slugs.length} lojas: ${slugs.join(', ')}`);

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  const db = getDatabaseConnection();
  const inicioCiclo = new Date();

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const extracao_completa: any[] = [];
  const lojasSucesso: string[] = [];
  const lojasPendentes: Array<{ slug: string; falhaOS: boolean; falhaCMV: boolean; motivo?: string }> = [];

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript('window.__name = function(t, v) { return t; };');
    const page = await context.newPage();

    await login(page);

    for (const slug of slugs) {
      const nomeAmigavel = empresasConfig[slug]?.nome_amigavel || EMPRESAS_RELATORIO[slug] || slug;
      console.log(`\n======================================================`);
      console.log(`[Deep Crawler] ====== ${nomeAmigavel} (${slug}) ======`);
      console.log(`======================================================`);

      const inicioLoja = new Date();
      let osSucesso = false;
      let cmvSucesso = false;
      let motivoFalhaOS: string | undefined = undefined;
      let motivoFalhaCMV: string | undefined = undefined;

      const parcialPath = path.join(OUT_DIR, `extracao_mes_${slug}.json`);
      const hojePath = path.join(OUT_DIR, `extracao_hoje_${slug}.json`);

      // a) Trocar para a empresa e confirmar (ensureCompany) & b) Concluir a coleta e persistência de OSs
      try {
        console.log(`[Deep Crawler] [${slug}] Etapa 1/2: Seleção de empresa e ingestão de OSs...`);
        await page.goto(`${BASE}/wfOrdemDeServicoBusca.aspx`, { waitUntil: 'load', timeout: 30000 });
        await ensureCompany(page, slug);

        let documentos: any[] = [];
        let paginacaoCompleta = true;
        let totalPaginas = 1;
        let totalEsperadoGrid: number | undefined = undefined;

        const resInspector: any = await handleOSDeepInspector(page, { loja: slug });
        if (Array.isArray(resInspector)) {
          documentos = resInspector;
          paginacaoCompleta = true;
          totalPaginas = 1;
        } else if (resInspector && typeof resInspector === 'object') {
          documentos = resInspector.documentos || [];
          paginacaoCompleta = resInspector.paginacaoCompleta ?? true;
          totalPaginas = resInspector.totalPaginas || 1;
          totalEsperadoGrid = resInspector.totalAbertasNativo;
        }

        if (documentos.length === 0) {
          throw new Error('Nenhum documento retornado na extração de OS');
        }

        // Sincronizar com SQLite WAL
        const totalAbertos = documentos.filter(d =>
          d.is_aberta !== undefined
            ? d.is_aberta === 1
            : (!d.status_grid?.toLowerCase().includes('fechad') && !d.status_grid?.toLowerCase().includes('fatur'))
        ).length;

        const resRecon = salvarLoteOSs(db, slug, documentos, {
          extracaoCompleta: documentos.length > 0 && paginacaoCompleta,
          paginacaoCompleta: paginacaoCompleta,
          provaPaginacaoNativa: paginacaoCompleta,
          totalEsperadoGrid: totalEsperadoGrid || totalAbertos,
          totalPaginas: totalPaginas,
        });

        console.log(
          `[Deep Crawler] Reconciliação ${slug}: status=${resRecon.status} (anteriores: ${resRecon.abertasAnteriores}, novas: ${resRecon.abertasNovas}, delta: ${resRecon.deltaAbertas}, páginas: ${totalPaginas}, completa: ${paginacaoCompleta})`
        );

        if (resRecon.status === 'QUARANTINE') {
          console.warn(`[Deep Crawler] ⚠️ Lote da loja ${slug} entrou em QUARENTENA por falta de comprovação de paginação nativa.`);
        }

        // Checagem nominal individual de OSs em transição pendente antes de formalizar encerramento cadastral ou cancelamento (E3-E2.4)
        if (resRecon.status === 'SUCCESS') {
          const pendentes = db.prepare(`
            SELECT os_id, loja_slug, status_grid FROM ordens_servico
            WHERE loja_slug = ? AND estado_operacional = 'TRANSICAO_PENDENTE'
          `).all(slug) as Array<{ os_id: string; loja_slug: string; status_grid: string }>;

          if (pendentes.length > 0) {
            console.log(`[Deep Crawler] [${slug}] 🔍 Verificando nominalmente ${pendentes.length} OSs em TRANSICAO_PENDENTE...`);
            for (const p of pendentes) {
              try {
                const detalhe = await extrairDetalhe(page, p.os_id, BASE);
                const statusGeral = String(detalhe.status_grid || '').toUpperCase();
                const isFechada = statusGeral.includes('FECHAD') || statusGeral.includes('FATUR') || Boolean(detalhe.data_fim) || Boolean((detalhe as any).faturamento_data);
                const isCancelada = statusGeral.includes('CANCEL');

                if (isFechada) {
                  formalizarTransicaoNominalOS(db, p.os_id, slug, 'ENCERRADA', 'VALIDACAO_NOMINAL_FECHADA', detalhe);
                  console.log(`[Deep Crawler] [${slug}] ✅ OS #${p.os_id} formalizada como ENCERRADA via checagem nominal.`);
                } else if (isCancelada) {
                  formalizarTransicaoNominalOS(db, p.os_id, slug, 'CANCELADA', 'VALIDACAO_NOMINAL_CANCELADA', detalhe);
                  console.log(`[Deep Crawler] [${slug}] ✅ OS #${p.os_id} formalizada como CANCELADA via checagem nominal.`);
                } else if (detalhe.extracao_completa) {
                  formalizarTransicaoNominalOS(db, p.os_id, slug, 'ABERTA', 'VALIDACAO_NOMINAL_ABERTA', detalhe);
                  console.log(`[Deep Crawler] [${slug}] ✅ OS #${p.os_id} confirmada como ABERTA via checagem nominal.`);
                } else {
                  console.warn(JSON.stringify({event: 'hydra_os_detail_incomplete', loja: slug, stage: 'nominal', reason: 'DETAIL_INCOMPLETE'}));
                  console.log(`[Deep Crawler] [${slug}] ℹ️ OS #${p.os_id} mantida em TRANSICAO_PENDENTE (inconclusiva: ${detalhe.erro || 'sem detalhe'}).`);
                }
              } catch (nomErr: any) {
                console.warn(`[Deep Crawler] [${slug}] ⚠️ Falha na verificação nominal individual da OS #${p.os_id}:`, nomErr?.message || nomErr);
              }
            }
          }
        }

        // Indexação Vetorial
        await indexarEmbeddingsLote(db, slug, documentos);

        const resultadoLoja = {
          slug_loja: slug,
          nome_amigavel: nomeAmigavel,
          data_extracao: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
          total_documentos: documentos.length,
          total_abertos: totalAbertos,
          total_fechados: documentos.filter(d =>
            d.is_aberta !== undefined
              ? d.is_aberta === 0
              : (d.status_grid?.toLowerCase().includes('fechad') || d.status_grid?.toLowerCase().includes('fatur'))
          ).length,
          total_com_detalhe: documentos.filter(d => d.extracao_completa).length,
          documentos,
          erro: null,
        };

        fs.writeFileSync(parcialPath, JSON.stringify(resultadoLoja, null, 2));
        fs.writeFileSync(hojePath, JSON.stringify(resultadoLoja, null, 2));
        console.log(`[Deep Crawler] [${slug}] Parcial de OS salvo em disco: ${parcialPath}`);

        extracao_completa.push(resultadoLoja);
        osSucesso = true;

        recordDataWorkerRun(db, {
          kind: 'OS',
          lojaSlug: slug,
          dataReferencia: format(new Date(), 'yyyy-MM-dd'),
          startedAt: inicioLoja.toISOString(),
          status: 'SUCCESS',
          itemCount: documentos.length
        });
      } catch (osErr: any) {
        motivoFalhaOS = String(osErr?.message || osErr);
        console.warn(`[Deep Crawler] ⚠️ CIRCUIT BREAKER ATIVADO (OS) para ${slug}: ${motivoFalhaOS}`);
        console.warn(`  Ação: Preservando snapshot anterior de OS em disco e no SQLite.`);

        recordDataWorkerRun(db, {
          kind: 'OS',
          lojaSlug: slug,
          dataReferencia: format(new Date(), 'yyyy-MM-dd'),
          startedAt: inicioLoja.toISOString(),
          status: 'ERROR',
          error: motivoFalhaOS
        });

        // Preservar snapshot anterior de OS se existir
        if (fs.existsSync(parcialPath)) {
          try {
            const dadosAnteriores = JSON.parse(fs.readFileSync(parcialPath, 'utf-8'));
            if (dadosAnteriores.documentos && dadosAnteriores.documentos.length > 0) {
              console.log(`  Snapshot de OS preservado com ${dadosAnteriores.documentos.length} OSs anteriores.`);
              extracao_completa.push({
                ...dadosAnteriores,
                aviso: `Dados preservados do último snapshot bem-sucedido (${dadosAnteriores.data_extracao}). Erro atual: ${motivoFalhaOS}`,
              });
            }
          } catch {
            // ignora erro ao ler snapshot anterior
          }
        }
      }

      // c) Imediatamente na mesma sessão, abrir Gestão Periódica em wfRelatorioOperacao.aspx, extrair CMV, Áreas e Mídia e salvar no SQLite
      try {
        console.log(`[Deep Crawler] [${slug}] Etapa 2/2: Ingestão de CMV e Gestão Periódica na mesma sessão...`);
        await coletarRelatorioOperacaoLoja(page, slug, db, OUT_DIR);
        cmvSucesso = true;
      } catch (cmvErr: any) {
        motivoFalhaCMV = String(cmvErr?.message || cmvErr);
        console.warn(`[Deep Crawler] ⚠️ CIRCUIT BREAKER ATIVADO (CMV) para ${slug}: ${motivoFalhaCMV}`);
        console.warn(`  Ação: Preservando snapshot anterior de CMV em disco e no SQLite. Prosseguindo para demais lojas.`);
      }

      // d) Só então avançar para a próxima loja: atualizar contabilidade do ciclo
      if (osSucesso && cmvSucesso) {
        lojasSucesso.push(slug);
        console.log(`[Deep Crawler] ✅ Ciclo completo da loja ${slug} (OS + CMV) finalizado com sucesso!`);
      } else {
        lojasPendentes.push({
          slug,
          falhaOS: !osSucesso,
          falhaCMV: !cmvSucesso,
          motivo: [motivoFalhaOS ? `OS: ${motivoFalhaOS}` : '', motivoFalhaCMV ? `CMV: ${motivoFalhaCMV}` : ''].filter(Boolean).join(' | ')
        });
        console.warn(`[Deep Crawler] ⚠️ Loja ${slug} concluída com pendências (OS: ${osSucesso ? 'OK' : 'FALHA'}, CMV: ${cmvSucesso ? 'OK' : 'FALHA'}). Prosseguindo para próxima loja...`);
      }
    }

    // Consolidar tudo
    const finalData = {
      data_extracao: format(new Date(), 'yyyy-MM-dd HH:mm:ss'),
      total_lojas: extracao_completa.length,
      lojas: extracao_completa,
    };

    const finalPath = path.join(OUT_DIR, 'extracao_mes.json');
    fs.writeFileSync(finalPath, JSON.stringify(finalData, null, 2));
    fs.writeFileSync(path.join(OUT_DIR, 'extracao_hoje.json'), JSON.stringify(finalData, null, 2));
    console.log(`\n[Deep Crawler] ✅ Consolidação salva em ${finalPath}`);
  } finally {
    await browser.close();
  }

  // Registrar status consolidado do ciclo diário
  const cicloSucessoTotal = lojasPendentes.length === 0;
  const statusCiclo = cicloSucessoTotal ? 'SUCCESS' : 'ERROR';
  const resumoPendentes = lojasPendentes
    .map(p => `${p.slug} [${p.falhaOS ? 'OS' : ''}${p.falhaOS && p.falhaCMV ? '+' : ''}${p.falhaCMV ? 'CMV' : ''}]`)
    .join(', ');

  recordDataWorkerRun(db, {
    kind: 'CICLO_UNIFICADO',
    lojaSlug: 'REDE',
    dataReferencia: format(new Date(), 'yyyy-MM-dd'),
    startedAt: inicioCiclo.toISOString(),
    status: statusCiclo,
    itemCount: lojasSucesso.length,
    error: cicloSucessoTotal ? undefined : `Lojas pendentes (${lojasPendentes.length}/${slugs.length}): ${resumoPendentes}`
  });

  console.log(`\n======================================================`);
  console.log(`[Deep Crawler] STATUS CONSOLIDADO DO CICLO DIÁRIO`);
  console.log(`[Deep Crawler] Lojas com sucesso total (OS + CMV): ${lojasSucesso.length}/${slugs.length}`);
  if (!cicloSucessoTotal) {
    console.warn(`[Deep Crawler] ⚠️ Lojas com pendências: ${resumoPendentes}`);
    throw new Error(`Ciclo diário incompleto: ${lojasSucesso.length}/${slugs.length} lojas com sucesso total. Pendentes: ${resumoPendentes}`);
  } else {
    console.log(`[Deep Crawler] 🎯 SUCESSO TOTAL: 10/10 lojas processadas com sucesso!`);
  }
}

run().catch(err => {
  console.error('[Deep Crawler] ERRO CRÍTICO:', err?.message || err);
  process.exit(1);
});