import { analisarAuditoriaRede, formatarMensagemWhatsApp, ConsolidadoRede } from './hydra_audit_engine.js';
import { gerarBriefingExecutivoIA } from './ai_briefing.js';
import { WhatsAppClient } from './whatsapp_client.js';
import { salvarSnapshotHistorico } from './delta_storage.js';
import { executarCrawlerMetas, obterMetasConsolidado } from './metas_crawler.js';
import { getDatabaseConnection } from './db_repository.js';
import { getUserPersonalizationSummary, cleanPhone, getTodayDateString } from './user_memory_repository.js';
import { spawnSync } from 'child_process';
import * as path from 'path';
import * as crypto from 'crypto';
import type Database from 'better-sqlite3';

// Telefones oficiais da diretoria (Davi e Marcos)
export const DESTINATARIOS = [
  '5511996242812', // Davi
  '5511970671717'  // Marcos
];

export interface BriefingDispatchRecord {
  id: number;
  data_referencia: string;
  destinatario: string;
  tipo_relatorio: string;
  status_envio: string; // 'enviado' ou 'falha'
  topicos_inclusos: string | null;
  payload_hash: string;
  sent_at: string;
}

export interface BriefingDispatchInput {
  dataReferencia: string;
  destinatario: string;
  tipoRelatorio: string;
  statusEnvio: 'enviado' | 'falha' | 'SENT';
  topicosInclusos?: string[];
  payloadHash: string;
}

export interface ExecutarAuditoriaOptions {
  crawlsDir?: string;
  skipCrawl?: boolean;
  refreshMetas?: boolean;
  sendWhatsApp?: boolean;
  preview?: boolean;
  isCompact?: boolean;
  autoYes?: boolean;
  destinatarios?: string[];
  db?: Database.Database;
  customWhatsAppSender?: (phone: string, text: string) => Promise<{ statusHttp: number; sucesso: boolean; error?: string }>;
  consolidadoRede?: ConsolidadoRede;
  dataReferencia?: string;
}

/**
 * Garante a criação idempotente da tabela hydra_briefing_dispatches no SQLite.
 */
export function ensureBriefingDispatchesTable(db: Database.Database): void {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS hydra_briefing_dispatches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        data_referencia TEXT NOT NULL,
        destinatario TEXT NOT NULL,
        tipo_relatorio TEXT NOT NULL,
        status_envio TEXT NOT NULL,
        topicos_inclusos TEXT,
        payload_hash TEXT NOT NULL,
        sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(data_referencia, destinatario, tipo_relatorio)
      );
      CREATE INDEX IF NOT EXISTS idx_briefing_dispatches_ref ON hydra_briefing_dispatches(data_referencia, destinatario);
    `);
  } catch (err: any) {
    console.error('[Hydra Auditor] Erro ao criar tabela hydra_briefing_dispatches:', err?.message || err);
  }
}

/**
 * Calcula o hash SHA-256 do payload para auditoria de integridade.
 */
export function calcularPayloadHash(conteudo: string): string {
  return crypto.createHash('sha256').update(conteudo.trim()).digest('hex');
}

/**
 * Recupera registro de despacho existente para (data_referencia, destinatario, tipo_relatorio).
 */
export function getBriefingDispatch(
  db: Database.Database,
  dataReferencia: string,
  destinatario: string,
  tipoRelatorio: string
): BriefingDispatchRecord | null {
  ensureBriefingDispatchesTable(db);
  const p = cleanPhone(destinatario);

  const row = db.prepare(`
    SELECT id, data_referencia, destinatario, tipo_relatorio, status_envio, topicos_inclusos, payload_hash, sent_at
    FROM hydra_briefing_dispatches
    WHERE data_referencia = ? AND destinatario = ? AND tipo_relatorio = ?
  `).get(dataReferencia, p, tipoRelatorio) as BriefingDispatchRecord | undefined;

  return row || null;
}

/**
 * Verifica se o briefing já foi despachado com sucesso ('enviado' ou 'SENT').
 * Garante a IDEMPOTÊNCIA estrita: rerun nunca duplica envio.
 */
export function isBriefingAlreadyDispatched(
  db: Database.Database,
  dataReferencia: string,
  destinatario: string,
  tipoRelatorio: string
): boolean {
  const row = getBriefingDispatch(db, dataReferencia, destinatario, tipoRelatorio);
  if (!row) return false;
  return row.status_envio === 'enviado' || row.status_envio === 'SENT';
}

/**
 * Registra ou atualiza o despacho no banco SQLite.
 * REGRA DE OURO: 'enviado' só é registrado após confirmação de HTTP 201 da Evolution API.
 */
export function recordBriefingDispatch(
  db: Database.Database,
  input: BriefingDispatchInput
): void {
  ensureBriefingDispatchesTable(db);
  const p = cleanPhone(input.destinatario);
  const statusNormalizado = input.statusEnvio === 'SENT' ? 'enviado' : input.statusEnvio;
  const topicosJson = JSON.stringify(input.topicosInclusos || []);

  db.prepare(`
    INSERT INTO hydra_briefing_dispatches (
      data_referencia, destinatario, tipo_relatorio, status_envio, topicos_inclusos, payload_hash, sent_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(data_referencia, destinatario, tipo_relatorio) DO UPDATE SET
      status_envio = excluded.status_envio,
      topicos_inclusos = excluded.topicos_inclusos,
      payload_hash = excluded.payload_hash,
      sent_at = CURRENT_TIMESTAMP
  `).run(
    input.dataReferencia,
    p,
    input.tipoRelatorio,
    statusNormalizado,
    topicosJson,
    input.payloadHash
  );
}

/**
 * Executa o fluxo de auditoria, personalização e despacho controlado.
 */
export async function executarAuditoriaEBriefing(options?: ExecutarAuditoriaOptions) {
  const crawlsDir = options?.crawlsDir || '/home/operacional/hydra-data/crawls';
  const skipCrawl = options?.skipCrawl ?? true;
  const refreshMetas = options?.refreshMetas ?? false;
  const isPreview = options?.preview ?? (!options?.sendWhatsApp);
  const isSendWhatsApp = options?.sendWhatsApp ?? false;
  const isCompact = options?.isCompact ?? false;
  const autoYes = options?.autoYes ?? false;
  const targetPhones = options?.destinatarios || DESTINATARIOS;

  let db: Database.Database;
  if (options?.db) {
    db = options.db;
  } else {
    try {
      db = getDatabaseConnection();
    } catch {
      db = null as any;
    }
  }

  if (db) {
    ensureBriefingDispatchesTable(db);
  }

  console.log(`\n================================================================`);
  console.log(`HYDRA AUDITOR OPERACIONAL — INÍCIO DA ROTINA`);
  console.log(`Data/Hora: ${new Date().toISOString()}`);
  console.log(`Modo de Execução: ${isPreview ? '🔍 MODO PREVIEW (--preview)' : '🚀 DISPARO WHATSAPP (--send-whatsapp)'}`);
  console.log(`Formato da Mensagem: ${isCompact ? 'Compacto (--compact)' : 'Executivo Completo'}`);
  console.log(`Destinatários: ${targetPhones.join(', ')}`);
  console.log(`================================================================\n`);

  // 1. Atualizar Mapa de Metas Oficial se necessário
  if (!options?.consolidadoRede && (!skipCrawl || refreshMetas)) {
    try {
      console.log('[Hydra Service] Extraindo Mapa de Metas oficial (wfMapaDeMeta.aspx)...');
      await executarCrawlerMetas(crawlsDir);
    } catch (err: any) {
      console.warn(`[Hydra Service] Falha ao extrair Mapa de Metas: ${err.message}. Usando dados existentes.`);
    }
  }

  // 2. Executar crawler Playwright se solicitado
  if (!options?.consolidadoRede && !skipCrawl) {
    console.log('[Hydra Service] Disparando crawler Playwright nas lojas...');
    const crawlerScript = path.resolve('src/hydra-sync/deep-crawler.ts');
    const result = spawnSync('node', ['./node_modules/tsx/dist/cli.mjs', crawlerScript], {
      stdio: 'inherit',
      cwd: '/opt/bots'
    });
    if (result.status !== 0) {
      console.error('[Hydra Service] Erro na execução do crawler. Código:', result.status);
    }
  }

  // 3. Executar Motor de Auditoria Operacional
  console.log('\n[Hydra Service] Processando auditoria operacional...');
  const consolidadoRede = options?.consolidadoRede || analisarAuditoriaRede(crawlsDir);

  console.log(`- Faturamento no Mês: R$ ${consolidadoRede.faturamentoTotal.toFixed(2)}`);
  console.log(`- Total de OS no Mês: ${consolidadoRede.totalOSs}`);
  console.log(`- Veículos com OS Aberta: ${consolidadoRede.totalPatioAtivo}`);
  console.log(`- Alertas Financeiros (> R$ 2.500 sem sinal): ${consolidadoRede.alertasFinanceiros.length}`);
  console.log(`- Veículos Abertos há 5+ Dias: ${consolidadoRede.carrosTravados.length}`);

  const dataReferencia = options?.dataReferencia || consolidadoRede.dataReferencia || getTodayDateString();
  const tipoRelatorio = isCompact ? 'briefing_compacto' : 'briefing_executivo';
  const resultadosPorDestinatario: Array<{
    phone: string;
    mensagem: string;
    topicos: string[];
    payloadHash: string;
    statusEnvio: string;
    puladoPorIdempotencia: boolean;
  }> = [];

  // 4. Gerar Versão Personalizada por Destinatário (Davi vs Marcos)
  for (const phone of targetPhones) {
    const cleanP = cleanPhone(phone);
    console.log(`\n----------------------------------------------------------------`);
    console.log(`[Hydra Service] Processando briefing para destinatário: ${cleanP}`);

    // Consulta perfil e memória multinível do usuário
    let personalizacao: any = null;
    let topicosSolicitados: string[] = [];
    let defaultLoja: string | undefined = undefined;

    if (db) {
      try {
        personalizacao = getUserPersonalizationSummary(db, cleanP);
        topicosSolicitados = personalizacao.topPersonalizedTopics;
        defaultLoja = personalizacao.defaultLojaSlug;
        console.log(`  Memória do Usuário: persona=${personalizacao.activePersona}, loja=${defaultLoja || 'rede'}, topicos=${topicosSolicitados.join(', ') || 'nenhum'}`);
      } catch (err: any) {
        console.warn(`  [Hydra Service] Erro ao carregar memória de ${cleanP}:`, err.message);
      }
    }

    // Gera briefing IA considerando no máximo 2 tópicos personalizados com fonte atualizada
    let briefingPersonalizado: any = null;
    try {
      briefingPersonalizado = await gerarBriefingExecutivoIA(consolidadoRede, {
        destinatario: cleanP,
        lojaSlug: defaultLoja,
        topicosPersonalizados: topicosSolicitados,
        db: db || undefined
      });
    } catch (err: any) {
      console.warn(`  [Hydra Service] Erro no briefing IA para ${cleanP}:`, err.message);
    }

    // Cria clone do consolidado com a camada de briefing individualizada
    const consolidadoIndividual: ConsolidadoRede = {
      ...consolidadoRede,
      briefingIA: briefingPersonalizado || undefined
    };

    const modoFormatacao = isCompact ? 'compacto' : 'padrao';
    const mensagemTexto = formatarMensagemWhatsApp(consolidadoIndividual, modoFormatacao);
    const payloadHash = calcularPayloadHash(mensagemTexto);
    const topicosInclusos = briefingPersonalizado?.topicosPersonalizados?.map((t: any) => t.topico) || [];

    console.log(`\n================================================================`);
    console.log(`🔍 PREVIEW PERSONALIZADO — ${cleanP} (${dataReferencia} · ${tipoRelatorio})`);
    console.log(`Hash do Payload: ${payloadHash.slice(0, 16)}...`);
    console.log(`Tópicos Personalizados Incluídos: ${topicosInclusos.length > 0 ? topicosInclusos.join(', ') : 'Nenhum (padrão rede)'}`);
    console.log(`----------------------------------------------------------------`);
    console.log(mensagemTexto);
    console.log(`================================================================\n`);

    // 5. Verificação de Idempotência
    let puladoPorIdempotencia = false;
    if (db && isBriefingAlreadyDispatched(db, dataReferencia, cleanP, tipoRelatorio)) {
      puladoPorIdempotencia = true;
      console.log(`[Hydra Service] ⏭️ IDEMPOTÊNCIA: ${cleanP} já recebeu o relatório ${tipoRelatorio} referente a ${dataReferencia}. Envio suprimido.`);
    }

    resultadosPorDestinatario.push({
      phone: cleanP,
      mensagem: mensagemTexto,
      topicos: topicosInclusos,
      payloadHash,
      statusEnvio: puladoPorIdempotencia ? 'enviado' : (isPreview ? 'preview' : 'pendente'),
      puladoPorIdempotencia
    });
  }

  // Se estiver em modo preview ou envio não autorizado, encerra aqui
  if (isPreview || !isSendWhatsApp) {
    console.log('\n[Hydra Service] ℹ️ Modo Preview concluído com sucesso. Nenhuma mensagem foi despachada ao WhatsApp.');
    console.log('[Hydra Service] Para autorizar o envio real para a diretoria, execute com: --send-whatsapp\n');
    return resultadosPorDestinatario;
  }

  // 6. Confirmação interativa se em TTY e sem autoYes
  if (!autoYes && process.stdin.isTTY) {
    const readline = await import('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const resposta = await new Promise<string>((resolve) => {
      rl.question('Confirmar disparo real para a Diretoria no WhatsApp via Evolution API? (s/n): ', (ans) => {
        rl.close();
        resolve(ans.trim().toLowerCase());
      });
    });

    if (resposta !== 's' && resposta !== 'sim' && resposta !== 'y') {
      console.log('[Hydra Service] 🛑 Envio cancelado pelo operador.');
      return resultadosPorDestinatario;
    }
  }

  // 7. Disparo Controlado via Evolution API com verificação rigorosa de HTTP 201
  console.log('\n[Hydra Service] Iniciando despacho via Evolution API...');
  const whatsappClient = new WhatsAppClient({ db: db || undefined });

  for (const item of resultadosPorDestinatario) {
    if (item.puladoPorIdempotencia) {
      console.log(`  -> Pulando ${item.phone} (já enviado previamente).`);
      continue;
    }

    console.log(`  -> Disparando para ${item.phone}...`);
    let httpStatus = 0;
    let sendSuccess = false;
    let erroDetalhe: string | undefined;

    if (options?.customWhatsAppSender) {
      // Injeção de sender customizado (útil para testes unitários/mock)
      try {
        const customRes = await options.customWhatsAppSender(item.phone, item.mensagem);
        httpStatus = customRes.statusHttp;
        sendSuccess = customRes.sucesso;
        erroDetalhe = customRes.error;
      } catch (err: any) {
        httpStatus = 500;
        sendSuccess = false;
        erroDetalhe = err?.message;
      }
    } else {
      try {
        const evoRes = await whatsappClient.sendText(item.phone, item.mensagem);
        httpStatus = evoRes.statusHttp;
        sendSuccess = evoRes.sucesso;
        erroDetalhe = evoRes.erro;
      } catch (err: any) {
        httpStatus = 500;
        sendSuccess = false;
        erroDetalhe = err?.message;
      }
    }

    // REGRA DE OURO: 'enviado' (SENT) só pode ser gravado no banco APÓS a confirmação
    // de envio bem-sucedido via Evolution API (HTTP 201). Se falhar, grava 'falha'.
    const isSent = Boolean(sendSuccess && httpStatus === 201);

    if (db) {
      recordBriefingDispatch(db, {
        dataReferencia,
        destinatario: item.phone,
        tipoRelatorio,
        statusEnvio: isSent ? 'enviado' : 'falha',
        topicosInclusos: item.topicos,
        payloadHash: item.payloadHash
      });
    }

    item.statusEnvio = isSent ? 'enviado' : 'falha';

    if (isSent) {
      console.log(`     ✅ Despacho confirmado! HTTP 201 Created para ${item.phone} (Gravado como SENT/enviado).`);
    } else {
      console.error(`     ❌ Falha no despacho para ${item.phone} (HTTP ${httpStatus}: ${erroDetalhe || 'desconhecido'}). Gravado como 'falha'.`);
    }
  }

  // 8. Salvar snapshot histórico permanente
  try {
    const backupPath = salvarSnapshotHistorico(consolidadoRede as any);
    console.log(`\n[Hydra Service] Snapshot histórico salvo: ${backupPath}`);
  } catch (err: any) {
    console.warn(`[Hydra Service] Falha ao salvar snapshot: ${err.message}`);
  }

  console.log('\n[Hydra Service] ✅ Rotina concluída com sucesso!\n');
  return resultadosPorDestinatario;
}

/**
 * Ponto de entrada CLI quando executado diretamente
 */
async function main() {
  const args = process.argv.slice(2);
  const isPreview = args.includes('--preview') || !args.includes('--send-whatsapp');
  const sendWhatsApp = args.includes('--send-whatsapp') && !args.includes('--preview');
  const skipCrawl = args.includes('--skip-crawl') || !args.includes('--crawl');
  const refreshMetas = args.includes('--refresh-metas');
  const isCompact = args.includes('--compact');
  const autoYes = args.includes('--yes') || args.includes('--cron-auto');

  await executarAuditoriaEBriefing({
    skipCrawl,
    refreshMetas,
    preview: isPreview,
    sendWhatsApp,
    isCompact,
    autoYes
  });
}

// Executa apenas se chamado diretamente
if (process.argv[1] && process.argv[1].endsWith('hydra_auditor_service.ts')) {
  main().catch(err => {
    console.error('[Hydra Service] ERRO FATAL:', err);
    process.exit(1);
  });
}
