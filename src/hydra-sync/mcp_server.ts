import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  getDatabaseConnection,
  getPatioOverview,
  getOSDetails,
  getAgingCars,
  getFinancialAlerts,
  getMetasConsolidadas,
  getHighestValueOS,
  getOSByItemCount,
  getChecklistAudit,
  getStoreDrilldown,
  searchOS,
  semanticSearchOS,
  checkVectorExtensionStatus,
  verificarFrescorMetas,
} from './db_repository.js';
import { getEmbedder } from './embeddings.js';
import { processarDecisaoAuditada } from './decision_engine.js';
import { retrieveOperationalData } from './hybrid_retrieval.js';
import { resolveCaseContextByOs, buildCaseOperationalSummary } from './case_memory_reader.js';
import { handleConsultarContasPagar } from './mcp_contas_pagar.js';

const server = new Server(
  {
    name: 'hydra-ops-sqlite-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Conexão persistente com o banco de dados SQLite WAL
const db = getDatabaseConnection();

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get_patio_overview',
        description: 'Retorna a visão consolidada de pátio por loja: quantidade de veículos fisicamente presentes na oficina (em atendimento ativo), pendências de baixa no ERP, valor em serviço e saldo a receber.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_aging_cars',
        description: 'Lista veículos retidos no pátio com ordens de serviço em aberto há X dias ou mais.',
        inputSchema: {
          type: 'object',
          properties: {
            dias_minimos: {
              type: 'number',
              description: 'Dias mínimos de retenção no pátio (default: 5)',
              default: 5,
            },
          },
        },
      },
      {
        name: 'get_financial_alerts',
        description: 'Lista ordens de serviço em aberto com alto saldo a receber e sem pagamento ou sinal registrado.',
        inputSchema: {
          type: 'object',
          properties: {
            saldo_minimo: {
              type: 'number',
              description: 'Valor mínimo de saldo a receber (default: 2500)',
              default: 2500,
            },
          },
        },
      },
      {
        name: 'get_sales_performance',
        description: 'Retorna o ranking de faturamento, volume de ordens e ticket médio oficial por loja extraídos do Mapa de Metas.',
        inputSchema: {
          type: 'object',
          properties: {
            data_referencia: {
              type: 'string',
              description: 'Data de referência no formato DD/MM/YYYY (opcional, default: última posição)',
            },
          },
        },
      },
      {
        name: 'execute_readonly_sql',
        description: 'Executa uma consulta SQL arbitrária de leitura (SELECT) diretamente no banco hydra_ops.db.',
        inputSchema: {
          type: 'object',
          properties: {
            sql: {
              type: 'string',
              description: 'Consulta SQL estritamente de leitura (SELECT/WITH)',
            },
          },
          required: ['sql'],
        },
      },
      {
        name: 'get_executive_briefing',
        description: 'Gera o briefing executivo oficial consolidado da rede (faturamento, OSs, gargalos de pátio, alertas financeiros e ações recomendadas de 0 a 3 itens baseadas em evidências).',
        inputSchema: {
          type: 'object',
          properties: {
            data_referencia: {
              type: 'string',
              description: 'Data de referência (DD/MM/YYYY) para metas. Opcional.',
            },
          },
        },
      },
      {
        name: 'get_highest_value_os',
        description: 'Retorna as ordens de serviço de maior (ou menor) valor da rede ou de uma loja específica, com dados completos do veículo, placa, cliente e saldo a receber.',
        inputSchema: {
          type: 'object',
          properties: {
            loja_slug: {
              type: 'string',
              description: 'Slug da loja (opcional, ex: MPdompedro1, MPrudge)',
            },
            limit: {
              type: 'number',
              description: 'Quantidade máxima de OSs a retornar (default: 5)',
              default: 5,
            },
            ordem: {
              type: 'string',
              description: 'Ordem de ordenação: DESC para maiores valores (default), ASC para menores valores',
              enum: ['DESC', 'ASC'],
              default: 'DESC',
            },
          },
        },
      },
      {
        name: 'get_os_details',
        description: 'Detalhamento profundo de uma Ordem de Servi?o pelo raw_payload: servi?os discriminados, pe?as e produtos, formas de pagamento detalhadas por parcela, executores, documentos anexos, notas fiscais e checklists operacionais.',
        inputSchema: {
          type: 'object',
          properties: {
            os_id: {
              type: 'string',
              description: 'N?mero ou identificador da Ordem de Servi?o (obrigat?rio)',
            },
            loja_slug: {
              type: 'string',
              description: 'Slug da loja (opcional)',
            },
          },
          required: ['os_id'],
        },
      },
      {
        name: 'get_os_by_parts_count',
        description: 'Retorna o ranking de veículos/ordens de serviço com maior quantidade de peças/itens cadastrados, detalhando as principais peças aplicadas.',
        inputSchema: {
          type: 'object',
          properties: {
            loja_slug: {
              type: 'string',
              description: 'Slug da loja (opcional)',
            },
            limit: {
              type: 'number',
              description: 'Quantidade máxima de OSs a retornar (default: 5)',
              default: 5,
            },
          },
        },
      },
      {
        name: 'get_checklist_audit',
        description: 'Auditoria de checklists operacionais: retorna quantas OSs estão sem Checklist de Entrada (Inspeção) e sem Checklist do Mecânico, ranking de pendência por loja e lista detalhada das OSs mais antigas.',
        inputSchema: {
          type: 'object',
          properties: {
            loja_slug: {
              type: 'string',
              description: 'Slug da loja (opcional, para auditar apenas uma unidade)',
            },
          },
        },
      },
      {
        name: 'get_store_drilldown',
        description: 'Raio-X completo e consolidado de uma loja: faturamento no mês, metas, ticket médio, veículos físicos no pátio em atendimento ativo, pendências de baixa no ERP, carros travados >5 dias, checklists e alertas.',
        inputSchema: {
          type: 'object',
          properties: {
            loja_slug: {
              type: 'string',
              description: 'Slug da loja (obrigatório, ex: MPrudge, MPdompedro1, MPpiraporinha)',
            },
          },
          required: ['loja_slug'],
        },
      },
      {
        name: 'search_os',
        description: 'Busca direta de ordens de serviço por Placa do veículo, Número da OS, Nome do Veículo ou Nome do Cliente.',
        inputSchema: {
          type: 'object',
          properties: {
            termo: {
              type: 'string',
              description: 'Termo de busca (placa, número de OS, modelo do carro ou nome do cliente)',
            },
          },
          required: ['termo'],
        },
      },
      {
        name: 'semantic_search_os',
        description: 'Busca semântica inteligente de ordens de serviço por similaridade vetorial (ex: "corolla com barulho", "bmw que entrou semana passada").',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Texto ou descrição para buscar por similaridade semântica',
            },
            limit: {
              type: 'number',
              description: 'Quantidade máxima de resultados (default: 5)',
              default: 5,
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_vector_engine_status',
        description: 'Retorna o status de integridade e diagnóstico da extensão sqlite-vec (carregamento, versão, contagem de vetores indexados).',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_os_case_history',
        description: 'Retorna a posição consolidada do histórico de atendimento e do grafo da Ordem de Serviço: aprovação de orçamento pelo cliente, motivo documentado de atraso, próximo passo prometido e compromissos acordados no WhatsApp.',
        inputSchema: {
          type: 'object',
          properties: {
            os_id: {
              type: 'string',
              description: 'Número da Ordem de Serviço (obrigatório, ex: "501")',
            },
            loja_slug: {
              type: 'string',
              description: 'Slug da loja (opcional, ex: "jabaquara", "dompedro1")',
            },
          },
          required: ['os_id'],
        },
      },
      {
        name: 'consultar_contas_pagar',
        description: 'Consulta lançamentos de contas pagas da rede (favorecidos, peças, tributos, pró-labore, compras). Suporta filtros por data, loja e fornecedor, além de busca semântica em linguagem natural indexada em vetor.',
        inputSchema: {
          type: 'object',
          properties: {
            termo_busca: {
              type: 'string',
              description: 'Termo ou pergunta em linguagem natural para buscar despesas/pagamentos (ex: "pagamento de autopeças", "recolhimento de impostos")',
            },
            tipo_busca: {
              type: 'string',
              description: 'Tipo de busca: "semantica" (vetorial), "exata" ou "todas"',
              enum: ['semantica', 'exata', 'todas'],
              default: 'semantica',
            },
            data_inicio: {
              type: 'string',
              description: 'Data de pagamento inicial (formato YYYY-MM-DD)',
            },
            data_fim: {
              type: 'string',
              description: 'Data de pagamento final (formato YYYY-MM-DD)',
            },
            loja_slug: {
              type: 'string',
              description: 'Slug da loja para filtrar (ex: "maua", "rudge_ramos", "jabaquara")',
            },
            fornecedor: {
              type: 'string',
              description: 'Nome do favorecido ou fornecedor (busca parcial)',
            },
            limite: {
              type: 'number',
              description: 'Limite de registros a retornar (padrão: 20)',
              default: 20,
            },
          },
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'get_patio_overview': {
        const dados = getPatioOverview(db);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(dados, null, 2),
            },
          ],
        };
      }

      case 'get_aging_cars': {
        const dias = typeof args?.dias_minimos === 'number' ? args.dias_minimos : 5;
        const dados = getAgingCars(db, dias);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(dados, null, 2),
            },
          ],
        };
      }

      case 'get_financial_alerts': {
        const saldo = typeof args?.saldo_minimo === 'number' ? args.saldo_minimo : 2500;
        const dados = getFinancialAlerts(db, saldo);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(dados, null, 2),
            },
          ],
        };
      }

      case 'get_sales_performance': {
        const dataRef = typeof args?.data_referencia === 'string' ? args.data_referencia : undefined;
        const dados = getMetasConsolidadas(db, dataRef);
        const frescor = verificarFrescorMetas(db, 26);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                data_referencia_oficial: frescor.dataMaisRecente,
                posicao_hora: frescor.posicaoHora,
                is_stale: !frescor.isValido,
                idade_horas: frescor.idadeHoras,
                metas: dados,
              }, null, 2),
            },
          ],
        };
      }

      case 'execute_readonly_sql': {
        const sql = String(args?.sql || '').trim();
        const upper = sql.toUpperCase();

        // Guardrails de Segurança Rigorosos: Apenas leitura
        if (!upper.startsWith('SELECT') && !upper.startsWith('WITH') && !upper.startsWith('EXPLAIN')) {
          throw new Error('Apenas queries de leitura (SELECT, WITH, EXPLAIN) são permitidas.');
        }

        const forbidden = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'ATTACH', 'DETACH', 'VACUUM', 'CREATE', 'REPLACE'];
        for (const word of forbidden) {
          const regex = new RegExp(`\\b${word}\\b`, 'i');
          if (regex.test(sql)) {
            throw new Error(`Comando '${word}' proibido em modo readonly.`);
          }
        }

        const results = db.prepare(sql).all();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      }

      case 'get_executive_briefing': {
        const dataRef = typeof args?.data_referencia === 'string' ? args.data_referencia : undefined;
        const patio = getPatioOverview(db);
        const aging = getAgingCars(db, 5);
        const financial = getFinancialAlerts(db, 2500);
        const metas = getMetasConsolidadas(db, dataRef);

        const totalPatioAtivo = patio.reduce((acc: number, p: any) => acc + (p.total_abertas || 0), 0);
        const faturamentoTotal = metas.reduce((acc: number, m: any) => acc + (m.faturamento_mes || 0), 0);
        const totalOSsMes = metas.reduce((acc: number, m: any) => acc + (m.volume_os || 0), 0);
        const ticketMedioRede = totalOSsMes > 0 ? faturamentoTotal / totalOSsMes : 0;

        const alertasParaDecisao = financial.map((f: any) => ({
          loja: f.loja_slug,
          osId: f.os_id,
          valorTotal: f.total_os,
          saldoAReceber: f.valor_restante,
        }));

        const carrosParaDecisao = aging.map((c: any) => ({
          loja: c.loja_slug,
          osId: c.os_id,
          diasNoPatio: c.dias_no_patio,
        }));

        const raioXLojas = metas.map((m: any) => ({
          slug: m.loja_slug,
          nome: m.loja_slug,
          faturamentoMes: m.faturamento_mes,
          volumeOsMes: m.volume_os,
          ticketMedio: m.ticket_medio,
        }));

        const decisao = processarDecisaoAuditada({
          alertasFinanceiros: alertasParaDecisao,
          carrosTravados: carrosParaDecisao,
          totalPatioAtivo,
          ticketMedioRede,
          raioXLojas,
        });

        const briefing = {
          resumo_executivo: {
            faturamento_mes_acumulado: faturamentoTotal,
            total_os_mes: totalOSsMes,
            veiculos_com_os_aberta_patio: totalPatioAtivo,
            veiculos_parados_5_dias_ou_mais: aging.length,
            percentual_retencao_patio: totalPatioAtivo > 0 ? `${Math.round((aging.length / totalPatioAtivo) * 100)}%` : '0%',
            ticket_medio_rede: ticketMedioRede,
          },
          pontos_atencao: decisao.pontosAtencao,
          proximas_acoes_prioritarias: decisao.proximasAcoes,
          alertas_financeiros_top: financial.slice(0, 10),
          top_gargalos_patio: aging.slice(0, 10),
          desempenho_lojas: metas,
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(briefing, null, 2),
            },
          ],
        };
      }

      case 'get_highest_value_os': {
        const lojaSlug = typeof args?.loja_slug === 'string' ? args.loja_slug : undefined;
        const limit = typeof args?.limit === 'number' ? args.limit : 5;
        const ordem = args?.ordem === 'ASC' ? 'ASC' : 'DESC';
        const dados = getHighestValueOS(db, { loja_slug: lojaSlug, limit, ordem });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(dados, null, 2),
            },
          ],
        };
      }

      case 'get_os_details': {
        const osId = String(args?.os_id || args?.osId || '');
        const lojaSlug = args?.loja_slug ? String(args.loja_slug) : (args?.lojaSlug ? String(args.lojaSlug) : undefined);
        const dados = getOSDetails(db, { os_id: osId, loja_slug: lojaSlug });

        // Enriquecimento transparente de Histórico de Atendimento e Grafo (Task 5)
        let historicoAtendimento: Record<string, unknown> | null = null;
        try {
          const resolvedLoja = lojaSlug || (dados as { os?: { loja_slug?: string } })?.os?.loja_slug;
          if (resolvedLoja && osId) {
            const caseCtx = resolveCaseContextByOs(db, resolvedLoja, osId);
            if (caseCtx) {
              historicoAtendimento = {
                cobertura: caseCtx.coverage,
                origem_evidencia: caseCtx.evidenceOrigin,
                motivo_atraso_documentado: caseCtx.documentedDelayReason || null,
                proximo_passo_prometido: caseCtx.nextPromisedStep || null,
                data_ultima_observacao: caseCtx.lastObservationDate || null,
                limitacao_declarada: caseCtx.isLimitationDeclared
              };
            }
          }
        } catch {}

        const respostaFinal = dados && typeof dados === 'object'
          ? { ...dados, historico_atendimento: historicoAtendimento }
          : dados;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(respostaFinal, null, 2),
            },
          ],
        };
      }

      case 'get_os_by_parts_count': {
        const lojaSlug = typeof args?.loja_slug === 'string' ? args.loja_slug : undefined;
        const limit = typeof args?.limit === 'number' ? args.limit : 5;
        const dados = getOSByItemCount(db, lojaSlug, limit);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(dados, null, 2),
            },
          ],
        };
      }

      case 'get_checklist_audit': {
        const lojaSlug = typeof args?.loja_slug === 'string' ? args.loja_slug : undefined;
        const dados = getChecklistAudit(db, lojaSlug);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(dados, null, 2),
            },
          ],
        };
      }

      case 'get_store_drilldown': {
        const lojaSlug = String(args?.loja_slug || '').trim();
        if (!lojaSlug) throw new Error('O parâmetro loja_slug é obrigatório.');
        const dados = getStoreDrilldown(db, lojaSlug);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(dados, null, 2),
            },
          ],
        };
      }

      case 'search_os': {
        const termo = String(args?.termo || '').trim();
        if (!termo) throw new Error('O parâmetro termo é obrigatório.');

        const looksLikePlaca = /^[A-Z]{3}-?[0-9][A-Z0-9][0-9]{2}$/i.test(termo);
        const looksLikeOS = /^(OS[-_#\s]*)?[0-9]+$/i.test(termo);

        const retrievalResult = await retrieveOperationalData(db, {
          canonicalQuestion: termo,
          intent: looksLikeOS || looksLikePlaca ? 'CONSULTA_OS' : 'BUSCA_VEICULO',
          placa: looksLikePlaca ? termo : undefined,
          osId: looksLikeOS ? termo : undefined,
          serviceTerms: !looksLikeOS && !looksLikePlaca ? termo : undefined,
          onlyOpen: false
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                source: retrievalResult.source,
                total: retrievalResult.records.length,
                resultados: retrievalResult.records,
                filtersApplied: retrievalResult.filtersApplied
              }, null, 2),
            },
          ],
        };
      }

      case 'semantic_search_os': {
        const query = String(args?.query || '').trim();
        if (!query) throw new Error('O parâmetro query é obrigatório.');

        const retrievalResult = await retrieveOperationalData(db, {
          canonicalQuestion: query,
          intent: 'BUSCA_SERVICO',
          serviceTerms: query,
          onlyOpen: false
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                source: retrievalResult.source,
                total: retrievalResult.records.length,
                resultados: retrievalResult.records,
                filtersApplied: retrievalResult.filtersApplied
              }, null, 2),
            },
          ],
        };
      }

      case 'get_vector_engine_status': {
        const status = checkVectorExtensionStatus(db);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(status, null, 2),
            },
          ],
        };
      }

      case 'get_os_case_history': {
        const osId = String(args?.os_id || args?.osId || '').trim();
        const lojaSlug = args?.loja_slug ? String(args.loja_slug).trim() : (args?.lojaSlug ? String(args.lojaSlug).trim() : '');

        if (!osId) {
          throw new Error('Parâmetro os_id é obrigatório para get_os_case_history.');
        }

        let resolvedStore = lojaSlug;
        if (!resolvedStore) {
          const osRow = db.prepare(`SELECT loja_slug FROM ordens_servico WHERE os_id = ? LIMIT 1`).get(osId) as { loja_slug?: string } | undefined;
          resolvedStore = osRow?.loja_slug || '';
        }

        const caseCtx = resolveCaseContextByOs(db, resolvedStore, osId);

        if (!caseCtx) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  status: 'NO_MATCH',
                  os_id: osId,
                  loja_slug: resolvedStore || null,
                  mensagem: `Ordem de Serviço #${osId} não localizada no sistema operacional.`
                }, null, 2),
              },
            ],
          };
        }

        const resultPayload = {
          status: 'AVAILABLE',
          os_id: caseCtx.order.osId,
          loja_slug: caseCtx.order.storeSlug,
          veiculo: `${caseCtx.order.vehicleModel}${caseCtx.order.plate ? ` (${caseCtx.order.plate})` : ''}`,
          cliente_nome: caseCtx.order.clientName || null,
          status_oficina: caseCtx.order.statusGrid,
          dias_no_patio: caseCtx.order.daysInYard,
          valor_total: caseCtx.order.totalAmount,
          saldo_devedor: caseCtx.order.remainingBalance,
          origem_evidencia: caseCtx.evidenceOrigin,
          cobertura: caseCtx.coverage,
          posicao_consolidada: {
            motivo_atraso_documentado: caseCtx.documentedDelayReason || null,
            proximo_passo_prometido: caseCtx.nextPromisedStep || null,
            data_ultima_observacao: caseCtx.lastObservationDate || null,
          },
          limitacao_declarada: caseCtx.isLimitationDeclared,
          resumo_formatado: buildCaseOperationalSummary(caseCtx),
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(resultPayload, null, 2),
            },
          ],
        };
      }

      case 'consultar_contas_pagar': {
        const dados = await handleConsultarContasPagar(db, args as any);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(dados, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Ferramenta desconhecida: ${name}`);
    }
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Erro ao executar ${name}: ${error.message}`,
        },
      ],
    };
  }
});

export async function startMcpServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[MCP Server] Hydra Ops SQLite MCP Server iniciado via Stdio.');
}

if (process.argv[1] && process.argv[1].endsWith('mcp_server.ts')) {
  startMcpServer().catch((err) => {
    console.error('[MCP Server] Erro fatal:', err);
    process.exit(1);
  });
}
