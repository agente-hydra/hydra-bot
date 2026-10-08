import * as fs from 'fs';
import * as path from 'path';
import { 
  getDatabaseConnection, 
  salvarMetasDiarias, 
  registrarExecucaoCrawl, 
  getMetasConsolidadas, 
  MetaLojaItem 
} from './db_repository.js';
import { 
  validarIntegridadeMetas, 
  ResultadoMapaMetas 
} from './metas_crawler.js';

export interface ReconciliacaoReport {
  sucesso: boolean;
  dataReferencia: string;
  posicaoHora: string;
  lojasReconciliadas: number;
  totalFatJson: number;
  totalFatSqlite: number;
  totalOSJson: number;
  totalOSSqlite: number;
  detalhesLojas: Array<{
    loja_slug: string;
    fatJson: number;
    fatSqlite: number;
    osJson: number;
    osSqlite: number;
    status: 'MATCH' | 'MISMATCH';
  }>;
}

export function executarReconciliacaoMetas(
  jsonPath: string = '/home/operacional/hydra-data/crawls/metas_rede.json',
  dbPath?: string
): ReconciliacaoReport {
  console.log(`[Reconciliação] 🔍 Lendo metas de: ${jsonPath}`);
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Arquivo de metas não encontrado: ${jsonPath}`);
  }

  const rawJson = fs.readFileSync(jsonPath, 'utf-8');
  const metas = JSON.parse(rawJson) as ResultadoMapaMetas;

  console.log(`[Reconciliação] 🛡️ Validando integridade dos dados...`);
  const validacao = validarIntegridadeMetas(metas);
  if (!validacao.valido) {
    throw new Error(`Falha de integridade no JSON de metas: ${validacao.motivo}`);
  }
  console.log(`[Reconciliação] ✅ Integridade aprovada (10 lojas comerciais, R$ ${validacao.somaLojasFaturamento.toFixed(2)}).`);

  const db = getDatabaseConnection(dbPath);

  // Derivar data_referencia YYYY-MM-DD e posicao_hora
  const dtPosicao = new Date(metas.posicaoDataHora);
  const dataRef = metas.posicaoDataHora.split('T')[0];
  const posicaoHora = dtPosicao.toLocaleTimeString('pt-BR', { 
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit', 
    minute: '2-digit' 
  });

  const itemsParaSalvar: MetaLojaItem[] = metas.lojas
    .filter(l => !l.slug.toLowerCase().includes('master'))
    .map(l => ({
      loja_slug: l.slug,
      faturamento_mes: l.faturamentoTotal,
      volume_os: l.volumeOS,
      ticket_medio: l.ticketMedio
    }));

  console.log(`[Reconciliação] 💾 Gravando ${itemsParaSalvar.length} lojas em metas_diarias (Data: ${dataRef}, Hora: ${posicaoHora})...`);
  salvarMetasDiarias(db, itemsParaSalvar, dataRef, posicaoHora);

  registrarExecucaoCrawl(db, {
    loja_slug: 'REDE',
    tipo_crawl: 'METAS',
    data_referencia: dataRef,
    inicio_em: new Date().toISOString(),
    fim_em: new Date().toISOString(),
    total_registros: itemsParaSalvar.length,
    total_abertas: 0,
    status: 'SUCCESS'
  });

  // Reconciliação e comparação cruzada JSON vs SQLite
  console.log(`[Reconciliação] ⚖️ Realizando conferência cruzada JSON vs SQLite...`);
  const rowsSqlite = getMetasConsolidadas(db, dataRef);
  const mapSqlite = new Map<string, any>();
  for (const r of rowsSqlite) {
    mapSqlite.set(r.loja_slug.toLowerCase(), r);
  }

  let totalFatSqlite = 0;
  let totalOSSqlite = 0;
  let allMatched = true;
  const detalhesLojas: ReconciliacaoReport['detalhesLojas'] = [];

  for (const item of itemsParaSalvar) {
    const sqlRow = mapSqlite.get(item.loja_slug.toLowerCase());
    if (!sqlRow) {
      allMatched = false;
      detalhesLojas.push({
        loja_slug: item.loja_slug,
        fatJson: item.faturamento_mes,
        fatSqlite: 0,
        osJson: item.volume_os,
        osSqlite: 0,
        status: 'MISMATCH'
      });
      continue;
    }

    const diffFat = Math.abs(sqlRow.faturamento_mes - item.faturamento_mes);
    const diffOS = Math.abs(sqlRow.volume_os - item.volume_os);
    const matched = diffFat <= 0.01 && diffOS === 0;
    if (!matched) allMatched = false;

    totalFatSqlite += sqlRow.faturamento_mes;
    totalOSSqlite += sqlRow.volume_os;

    detalhesLojas.push({
      loja_slug: item.loja_slug,
      fatJson: item.faturamento_mes,
      fatSqlite: sqlRow.faturamento_mes,
      osJson: item.volume_os,
      osSqlite: sqlRow.volume_os,
      status: matched ? 'MATCH' : 'MISMATCH'
    });
  }

  const diffRedeFat = Math.abs(totalFatSqlite - metas.faturamentoTotal);
  if (diffRedeFat > 0.10) {
    allMatched = false;
  }

  console.log('\n📊 ========== RELATÓRIO DE RECONCILIAÇÃO CRUZADA ==========');
  console.log(`Data de Referência: ${dataRef} às ${posicaoHora}`);
  console.log(`Lojas analisadas: ${itemsParaSalvar.length} (esperado: 10)`);
  console.log('------------------------------------------------------------');
  for (const d of detalhesLojas) {
    const sJson = `R$ ${d.fatJson.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    const sSql = `R$ ${d.fatSqlite.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    console.log(`[${d.status}] ${d.loja_slug.padEnd(16)} | JSON: ${sJson.padEnd(14)} | SQLite: ${sSql.padEnd(14)} | OSs: ${d.osSqlite}`);
  }
  console.log('------------------------------------------------------------');
  console.log(`TOTAL REDE JSON  : R$ ${metas.faturamentoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${metas.totalOSs} OSs)`);
  console.log(`TOTAL REDE SQLITE: R$ ${totalFatSqlite.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${totalOSSqlite} OSs)`);
  console.log(`STATUS FINAL     : ${allMatched ? '✅ [100% MATCH]' : '❌ [MISMATCH DETECTED]'}`);
  console.log('============================================================\n');

  if (!allMatched) {
    throw new Error('Falha na reconciliação: divergência entre JSON e SQLite detectada.');
  }

  return {
    sucesso: allMatched,
    dataReferencia: dataRef,
    posicaoHora,
    lojasReconciliadas: itemsParaSalvar.length,
    totalFatJson: metas.faturamentoTotal,
    totalFatSqlite,
    totalOSJson: metas.totalOSs,
    totalOSSqlite,
    detalhesLojas
  };
}

// Se executado diretamente via CLI
if (process.argv[1] && process.argv[1].endsWith('reconciliar_metas.ts')) {
  try {
    const jsonPath = process.argv[2] || '/home/operacional/hydra-data/crawls/metas_rede.json';
    executarReconciliacaoMetas(jsonPath);
    console.log('✅ Reconciliação concluída com sucesso!');
    process.exit(0);
  } catch (err: any) {
    console.error(`❌ Erro na reconciliação: ${err.message}`);
    process.exit(1);
  }
}
