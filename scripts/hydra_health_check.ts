import path from 'path';
import { fileURLToPath } from 'url';
import { getDatabaseConnection, getHydraHealthSnapshot, HydraHealthMetrics } from '../src/hydra-sync/db_repository.js';

async function main() {
  const isJson = process.argv.includes('--json');
  const dbPath = process.env.HYDRA_DB_PATH || (
    process.platform === 'win32'
      ? path.resolve(process.cwd(), '.tmp', 'hydra_ops.db')
      : '/home/operacional/hydra-data/hydra_ops.db'
  );

  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6380';

  let redisClient: any = null;
  try {
    const Redis = (await import('ioredis')).default;
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      retryStrategy: () => null
    });
    // Suppress unhandled redis connection errors
    redisClient.on('error', () => {});
  } catch {
    // Redis optional fallback
    redisClient = null;
  }

  let db: any = null;
  try {
    db = getDatabaseConnection(dbPath);
  } catch (err: any) {
    console.error(`[HEALTH] Erro ao abrir banco SQLite em ${dbPath}:`, err.message);
    process.exit(1);
  }

  try {
    const snapshot: HydraHealthMetrics = await getHydraHealthSnapshot(db, redisClient);

    if (redisClient) {
      try {
        await redisClient.quit();
      } catch {}
    }

    if (isJson) {
      console.log(JSON.stringify(snapshot, null, 2));
      process.exit(snapshot.statusGeral === 'UNHEALTHY' ? 1 : 0);
    }

    // CLI Formatter
    const statusIcon = snapshot.statusGeral === 'HEALTHY' ? '🟢 HEALTHY' : (snapshot.statusGeral === 'DEGRADED' ? '🟡 DEGRADED' : '🔴 UNHEALTHY');
    const frescorIcon = snapshot.metas.frescor === 'FRESH' ? '🟢 FRESH' : (snapshot.metas.frescor === 'STALE' ? '🟡 STALE' : '🔴 CRITICAL');

    console.log('\n======================================================================');
    console.log(`🐙 HYDRA OPERATIONAL HEALTH SNAPSHOT`);
    console.log(`Timestamp: ${snapshot.timestamp}`);
    console.log(`STATUS GERAL: ${statusIcon}`);
    console.log('======================================================================');

    console.log('\n1. 📡 CRAWLERS RECENTES (crawls_execucoes):');
    if (snapshot.crawlers.length === 0) {
      console.log('   (Nenhuma execução recente registrada)');
    } else {
      for (const c of snapshot.crawlers.slice(0, 5)) {
        const icon = c.status === 'SUCCESS' ? '✓' : '⚠️';
        console.log(`   [${icon}] ${c.tipo.padEnd(8)} | Loja: ${c.loja_slug.padEnd(16)} | Status: ${c.status.padEnd(16)} | Reg: ${String(c.registros).padStart(3)} | Duração: ${c.duracaoMs}ms | Em: ${c.ultimaExecucao || 'N/A'}`);
      }
    }

    console.log('\n2. 🎯 METAS & FRESCOR (metas_diarias):');
    console.log(`   Data Mais Recente: ${snapshot.metas.dataReferenciaMaisRecente || 'N/A'}`);
    console.log(`   Idade dos Dados:   ${snapshot.metas.idadeEmHoras}h (Status: ${frescorIcon})`);
    console.log(`   Lojas Sincronizadas: ${snapshot.metas.lojasCompletas} lojas registradas`);

    console.log('\n3. 🔍 ÍNDICE VETORIAL (sqlite-vec):');
    console.log(`   Vetores Indexados: ${snapshot.indiceVetorial.totalVetores}`);
    console.log(`   OSs Abertas no Pátio: ${snapshot.indiceVetorial.totalOSsAbertas}`);
    console.log(`   Cobertura Semântica: ${snapshot.indiceVetorial.coberturaPct}%`);

    console.log('\n4. 🐕 WATCHDOG QUEUE (Redis):');
    console.log(`   Tarefas Pendentes:   ${snapshot.watchdogQueue.pendentes}`);
    console.log(`   Em Processamento:    ${snapshot.watchdogQueue.processando}`);

    console.log('\n5. 🧠 TELEMETRIA IA (ai_briefing_telemetry - 24h):');
    console.log(`   Total de Chamadas:   ${snapshot.telemetriaIA.totalChamadas24h}`);
    console.log(`   Taxa de Sucesso:     ${snapshot.telemetriaIA.taxaSucessoPct}%`);
    console.log(`   Duração Média:       ${snapshot.telemetriaIA.duracaoMediaMs}ms`);
    console.log(`   Falhas:              Timeouts: ${snapshot.telemetriaIA.timeouts} | Indisponível: ${snapshot.telemetriaIA.indisponibilidades} | Inválido: ${snapshot.telemetriaIA.respostasInvalidas} | Slop Fallback: ${snapshot.telemetriaIA.slopFallbacks}`);

    console.log('\n6. 💬 ENVIOS WHATSAPP (whatsapp_delivery_logs - 24h):');
    console.log(`   Total de Envios:     ${snapshot.enviosWhatsApp.totalEnvios24h}`);
    console.log(`   Taxa de Confirmação: ${snapshot.enviosWhatsApp.taxaEntregaConfirmadaPct}%`);
    console.log(`   Falhas HTTP:         ${snapshot.enviosWhatsApp.falhasHttp}`);
    console.log(`   Média de Tentativas: ${snapshot.enviosWhatsApp.mediaTentativasPorEnvio}`);
    console.log('======================================================================\n');

  } catch (err: any) {
    console.error('[HEALTH] Erro ao consolidar métricas de saúde:', err.message);
    process.exit(1);
  } finally {
    if (db) {
      try { db.close(); } catch {}
    }
  }
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
