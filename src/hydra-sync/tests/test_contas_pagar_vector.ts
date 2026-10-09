/**
 * test_contas_pagar_vector.ts
 *
 * Teste unitário e de integração para ingestão relacional, buscas e MCP Tool de Contas a Pagar.
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { parseContasPagarExcel } from '../contas_pagar_parser.js';
import {
  initSchema,
  upsertLoteContasPagar,
  consultarContasPagarRelacional
} from '../db_repository.js';
import { handleConsultarContasPagar } from '../mcp_contas_pagar.js';
import { buscarContasPagarSemantica } from '../contas_pagar_vector.js';

async function runTests() {
  console.log('--- TESTE: Ingestão, Consultas e MCP de Contas a Pagar ---');

  // 1. Inspecionar se temos a fixture real BuscaContasAPagar.xls
  const fixturePath = path.resolve(process.cwd(), 'src/hydra-sync/fixtures/BuscaContasAPagar.xls');
  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Fixture não encontrada em ${fixturePath}`);
  }

  const lancamentos = parseContasPagarExcel(fixturePath);
  console.log(`✓ Fixture carregada: ${lancamentos.length} lançamentos extraídos.`);

  if (lancamentos.length !== 28) {
    throw new Error(`Esperava 28 lançamentos na fixture, obtido: ${lancamentos.length}`);
  }

  // 2. Inicializar banco SQLite em memória
  const db = new Database(':memory:');
  initSchema(db);

  // 3. Teste de Upsert inicial
  console.log('Testando inserção inicial no banco...');
  const res1 = upsertLoteContasPagar(db, lancamentos);
  console.log(`Resultado upsert 1: ${res1.inseridos} inseridos, ${res1.atualizados} atualizados.`);
  if (res1.inseridos !== 28) {
    throw new Error(`Esperava 28 inseridos, obtido: ${res1.inseridos}`);
  }

  // 4. Teste de Idempotência (re-inserir o mesmo lote)
  console.log('Testando idempotência...');
  const res2 = upsertLoteContasPagar(db, lancamentos);
  console.log(`Resultado upsert 2: ${res2.inseridos} inseridos, ${res2.atualizados} atualizados.`);
  if (res2.inseridos !== 0 || res2.atualizados !== 28) {
    throw new Error(`Falha de idempotência: esperava 0 inseridos e 28 atualizados, obtido ${res2.inseridos}/${res2.atualizados}`);
  }

  // 5. Teste de Consultas Relacionais
  console.log('Testando consultas relacionais...');
  const todos = consultarContasPagarRelacional(db);
  if (todos.length !== 28) {
    throw new Error(`Esperava 28 registros no banco, obtido: ${todos.length}`);
  }

  // Filtro por Loja (ex: Mauá)
  const itensMaua = consultarContasPagarRelacional(db, { lojaSlug: 'maua' });
  console.log(`Lançamentos Mauá: ${itensMaua.length}`);
  if (itensMaua.length === 0) {
    throw new Error('Nenhum registro encontrado para loja Mauá.');
  }

  // Filtro por Fornecedor (ex: busca parcial 'PORTO' ou outro fornecedor comum)
  const primeiroFornecedor = lancamentos[0].fornecedor;
  const termoFornecedor = primeiroFornecedor.split(' ')[0];
  const porFornecedor = consultarContasPagarRelacional(db, { fornecedor: termoFornecedor });
  console.log(`Lançamentos para fornecedor '${termoFornecedor}': ${porFornecedor.length}`);
  if (porFornecedor.length === 0) {
    throw new Error(`Nenhum registro encontrado para fornecedor: ${termoFornecedor}`);
  }

  // 6. Teste da MCP Tool `consultar_contas_pagar`
  console.log('\nTestando MCP Tool `handleConsultarContasPagar`...');
  const mcpResGeral = await handleConsultarContasPagar(db, { limite: 10 });
  console.log(`MCP Geral: total=${mcpResGeral.total_encontrado}, soma_paga=R$ ${mcpResGeral.soma_valor_pago}`);
  if (mcpResGeral.total_encontrado !== 10) {
    throw new Error(`MCP Tool esperava 10 itens com limite 10, obteve: ${mcpResGeral.total_encontrado}`);
  }

  // MCP com filtro por termo
  const mcpResFiltro = await handleConsultarContasPagar(db, {
    termo_busca: termoFornecedor,
    tipo_busca: 'exata'
  });
  console.log(`MCP Filtro '${termoFornecedor}': encontrados=${mcpResFiltro.total_encontrado}, soma=R$ ${mcpResFiltro.soma_valor_pago}`);
  if (mcpResFiltro.total_encontrado === 0) {
    throw new Error('MCP Tool falhou ao filtrar por termo.');
  }

  // 7. Teste de Busca Semântica / FTS5 Fallback
  console.log('\nTestando busca semântica / FTS5...');
  const resSemantica = await buscarContasPagarSemantica(db, termoFornecedor, 5);
  console.log(`Busca semântica/FTS5 retornou ${resSemantica.length} resultados.`);
  if (resSemantica.length === 0) {
    throw new Error('Busca semântica / FTS5 não retornou resultados.');
  }

  db.close();
  console.log('\n✅ TESTES DE INGESTÃO, RELACIONAIS, FTS5 E MCP TOOL: 100% PASS!');
}

runTests().catch(err => {
  console.error('❌ ERRO NO TESTE:', err);
  process.exit(1);
});
