import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '/opt/bots/.env' });
dotenvConfig();
import { executarCrawlerMetas } from './metas_crawler.js';

async function test() {
  console.log('--- TESTE DE EXTRAÇÃO DO MAPA DE METAS ---');
  const metas = await executarCrawlerMetas('/home/operacional/hydra-data/crawls');
  console.log('\n--- RESULTADO OBTIDO ---');
  console.log(`Faturamento Total Rede: R$ ${metas.faturamentoTotal.toLocaleString('pt-BR')}`);
  console.log(`Total de OSs Rede: ${metas.totalOSs}`);
  console.log('Lojas:');
  metas.lojas.forEach((l, i) => {
    console.log(`  ${i + 1}. ${l.nome} (${l.slug}): R$ ${l.faturamentoTotal.toLocaleString('pt-BR')} | ${l.volumeOS} OSs | TK Médio: R$ ${l.ticketMedio.toFixed(2)}`);
  });
}

test().catch(err => {
  console.error('Falha no teste:', err);
  process.exit(1);
});
