/**
 * mcp_contas_pagar.ts
 *
 * Ferramenta MCP para consulta de Contas a Pagar (Pagamentos Efetuados)
 * Suporta busca estruturada relacional por período, loja e favorecido/fornecedor,
 * bem como busca semântica em linguagem natural indexada em vetor e FTS5.
 */

import Database from 'better-sqlite3';
import {
  consultarContasPagarRelacional,
  LancamentoContaPagar,
  FiltrosContasPagar
} from './db_repository.js';
import { buscarContasPagarSemantica, ResultadoBuscaContasPagar } from './contas_pagar_vector.js';

export interface MCPConsultarContasPagarArgs {
  termo_busca?: string;
  tipo_busca?: 'semantica' | 'exata' | 'todas';
  data_inicio?: string; // YYYY-MM-DD
  data_fim?: string;    // YYYY-MM-DD
  loja_slug?: string;
  fornecedor?: string;
  limite?: number;
}

export interface MCPConsultarContasPagarResposta {
  total_encontrado: number;
  soma_valor_pago: number;
  filtros_aplicados: {
    termo?: string;
    tipo_busca: string;
    data_inicio?: string;
    data_fim?: string;
    loja_slug?: string;
    fornecedor?: string;
  };
  lancamentos: Array<{
    id: string;
    loja: string;
    codigo_erp: number;
    parcela: string;
    fornecedor: string;
    descricao: string;
    tipo: string;
    data_vencimento: string;
    data_pagamento: string;
    valor_pago: number;
    similaridade_distancia?: number;
  }>;
}

/**
 * Handler oficial da ferramenta MCP `consultar_contas_pagar`
 */
export async function handleConsultarContasPagar(
  db: Database.Database,
  args: MCPConsultarContasPagarArgs = {}
): Promise<MCPConsultarContasPagarResposta> {
  const limite = Math.min(Math.max(args.limite || 20, 1), 100);
  const tipoBusca = args.tipo_busca || (args.termo_busca ? 'semantica' : 'todas');

  let itens: Array<LancamentoContaPagar & { distance?: number }> = [];

  if (tipoBusca === 'semantica' && args.termo_busca) {
    itens = await buscarContasPagarSemantica(db, args.termo_busca, limite, {
      lojaSlug: args.loja_slug,
      dataInicio: args.data_inicio,
      dataFim: args.data_fim
    });
  } else {
    itens = consultarContasPagarRelacional(db, {
      dataInicio: args.data_inicio,
      dataFim: args.data_fim,
      lojaSlug: args.loja_slug,
      fornecedor: args.fornecedor,
      termo: args.termo_busca,
      limite
    });
  }

  const somaValorPago = itens.reduce((acc, curr) => acc + (curr.valorPago || 0), 0);

  return {
    total_encontrado: itens.length,
    soma_valor_pago: Number(somaValorPago.toFixed(2)),
    filtros_aplicados: {
      termo: args.termo_busca,
      tipo_busca: tipoBusca,
      data_inicio: args.data_inicio,
      data_fim: args.data_fim,
      loja_slug: args.loja_slug,
      fornecedor: args.fornecedor
    },
    lancamentos: itens.map(item => ({
      id: item.id,
      loja: item.lojaSlug,
      codigo_erp: item.codigo,
      parcela: item.parcela,
      fornecedor: item.fornecedor,
      descricao: item.descricao,
      tipo: item.tipo,
      data_vencimento: item.dataVencimento,
      data_pagamento: item.dataPagamento,
      valor_pago: Number(item.valorPago.toFixed(2)),
      similaridade_distancia: item.distance
    }))
  };
}
