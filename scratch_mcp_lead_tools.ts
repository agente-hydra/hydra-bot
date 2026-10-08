import type Database from 'better-sqlite3';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { leadMcpServer } from './mcp_lead_server.js';
import {
  getAllStoreManagers,
  resolveStoreAndManager,
  getEffectiveRecipientPhone,
  checkNotificationIdempotency,
  recordManagerNotification,
  StoreManagerRecord
} from './manager_registry.js';
import { WhatsAppClient } from './whatsapp_client.js';
import { sanitizeWhatsAppMarkdown } from './format_utils.js';

export interface RegisterLeadToolsOptions {
  db: Database.Database;
  customWhatsAppClient?: {
    sendText: (phone: string, text: string) => Promise<{ sucesso: boolean; messageId?: string; statusHttp: number; erro?: string; duracaoMs: number }>;
  };
}

/**
 * Formata telefone brasileiro para visual limpo: (XX) XXXXX-XXXX ou (XX) XXXX-XXXX
 */
export function formatBrazilianPhone(rawPhone: string): string {
  if (!rawPhone) return '';
  const digits = rawPhone.replace(/\D/g, '');
  const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;

  if (local.length === 11) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }
  if (local.length === 10) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }
  return rawPhone.trim();
}

/**
 * Compositor de Card de Lead Agendado no padrão nativo Hydra
 */
export function composeHydraLeadCard(params: {
  isTestOverride: boolean;
  storeName: string;
  managerName: string;
  managerPhone: string;
  clientName: string;
  clientPhone: string;
  scheduledDate: string;
  scheduledTime: string;
  vehicle?: string;
  serviceRequested?: string;
  originLead?: string;
  notes?: string;
}): string {
  const lines: string[] = [];

  if (params.isTestOverride) {
    lines.push(`🧪 *[MODO DE TESTE — DESTINATÁRIO REAL: ${params.storeName} / ${params.managerName} (${params.managerPhone})]*\n`);
  }

  // Título e Horário em destaque
  lines.push(`*NOVO AGENDAMENTO • ${params.storeName.toUpperCase()}*`);
  lines.push(`${params.scheduledDate} às ${params.scheduledTime}\n`);

  // Informações principais com alinhamento limpo do Hydra
  lines.push(`- *Cliente:* ${params.clientName.trim()}`);
  lines.push(`- *WhatsApp:* ${formatBrazilianPhone(params.clientPhone)}`);

  if (params.vehicle && params.vehicle.trim()) {
    lines.push(`- *Veículo:* ${params.vehicle.trim()}`);
  }

  if (params.serviceRequested && params.serviceRequested.trim()) {
    lines.push(`- *Serviço:* ${params.serviceRequested.trim()}`);
  }

  if (params.originLead && params.originLead.trim()) {
    lines.push(`- *Origem:* ${params.originLead.trim()}`);
  }

  if (params.notes && params.notes.trim()) {
    lines.push(`\n*Observações:*\n${params.notes.trim()}`);
  }

  lines.push(`\n_Central de Atendimento Mecânica Popular • Box reservado_`);

  return sanitizeWhatsAppMarkdown(lines.join('\n'));
}

/**
 * Compositor de Card de Cancelamento de Lead no padrão nativo Hydra
 */
export function composeHydraCancelCard(params: {
  isTestOverride: boolean;
  storeName: string;
  managerName: string;
  managerPhone: string;
  clientName: string;
  clientPhone: string;
  scheduledDate: string;
  scheduledTime: string;
  cancelReason?: string;
  rescheduleIntended?: boolean;
  vehicle?: string;
  notes?: string;
}): string {
  const lines: string[] = [];

  if (params.isTestOverride) {
    lines.push(`🧪 *[MODO DE TESTE — DESTINATÁRIO REAL: ${params.storeName} / ${params.managerName} (${params.managerPhone})]*\n`);
  }

  lines.push(`*CANCELAMENTO DE AGENDAMENTO — ${params.storeName.toUpperCase()}*`);
  lines.push(`Horário que estava reservado: ${params.scheduledDate} às ${params.scheduledTime}\n`);

  lines.push(`- *Cliente:* ${params.clientName.trim()}`);
  lines.push(`- *WhatsApp:* ${formatBrazilianPhone(params.clientPhone)}`);

  if (params.vehicle && params.vehicle.trim()) {
    lines.push(`- *Veículo:* ${params.vehicle.trim()}`);
  }

  if (params.cancelReason && params.cancelReason.trim()) {
    lines.push(`- *Motivo:* ${params.cancelReason.trim()}`);
  }

  if (typeof params.rescheduleIntended === 'boolean') {
    lines.push(`- *Pretende reagendar:* ${params.rescheduleIntended ? 'Sim' : 'Não'}`);
  }

  if (params.notes && params.notes.trim()) {
    lines.push(`\n*Observações:*\n${params.notes.trim()}`);
  }

  lines.push(`\n_Central de Atendimento Mecânica Popular • Vaga liberada no pátio_`);

  return sanitizeWhatsAppMarkdown(lines.join('\n'));
}

export function registerLeadNotificationTools(options: RegisterLeadToolsOptions): void {
  const db = options.db;

  // 1. Declaracao das Tools MCP
  leadMcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'list_store_managers',
          description: 'Lista as 10 lojas operacionais atendidas, seus nomes oficiais e se o canal do gerente está ativo.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'notify_manager_lead_scheduled',
          description: 'Envia notificação formal no WhatsApp do gerente da unidade física através da instância oficial de Atendimento da Mecânica Popular (com registro no Chatwoot), informando um novo lead agendado.',
          inputSchema: {
            type: 'object',
            properties: {
              loja: {
                type: 'string',
                description: 'Nome da loja ou slug (ex: "Jorge Beretta", "Kennedy", "Jabaquara", "Dom Pedro", "Planalto", "Mauá", "Santo André", "Rudge", "Piraporinha", "Rei do Módulo").'
              },
              cliente_nome: {
                type: 'string',
                description: 'Nome do cliente agendado.'
              },
              cliente_telefone: {
                type: 'string',
                description: 'Telefone ou WhatsApp do cliente com DDD.'
              },
              data_agendamento: {
                type: 'string',
                description: 'Data do agendamento (ex: "08/10/2026").'
              },
              horario_agendamento: {
                type: 'string',
                description: 'Horário do agendamento (ex: "10:00", "14:30").'
              },
              veiculo: {
                type: 'string',
                description: 'Veículo do cliente (modelo, ano, placa se houver).'
              },
              servico_pretendido: {
                type: 'string',
                description: 'Serviço desejado (ex: "Troca de óleo de câmbio e filtro").'
              },
              origem_lead: {
                type: 'string',
                description: 'Canal de entrada (ex: "Google Ads", "Instagram", "Site").'
              },
              observacoes: {
                type: 'string',
                description: 'Observações adicionais informadas pelo cliente.'
              },
              id_externo: {
                type: 'string',
                description: 'ID único do lead/agendamento no CRM externo para garantia de envio único e idempotência.'
              }
            },
            required: ['loja', 'cliente_nome', 'cliente_telefone', 'data_agendamento', 'horario_agendamento']
          }
        },
        {
          name: 'notify_manager_lead_cancelled',
          description: 'Envia alerta formal no WhatsApp do gerente da unidade física através da instância de Atendimento informando cancelamento ou desistência de agendamento.',
          inputSchema: {
            type: 'object',
            properties: {
              loja: {
                type: 'string',
                description: 'Nome da loja onde o agendamento estava marcado.'
              },
              cliente_nome: {
                type: 'string',
                description: 'Nome do cliente que cancelou.'
              },
              cliente_telefone: {
                type: 'string',
                description: 'Telefone do cliente.'
              },
              data_agendamento: {
                type: 'string',
                description: 'Data que estava agendada.'
              },
              horario_agendamento: {
                type: 'string',
                description: 'Horário que estava agendado.'
              },
              veiculo: {
                type: 'string',
                description: 'Veículo do cliente, se informado.'
              },
              motivo_cancelamento: {
                type: 'string',
                description: 'Motivo do cancelamento (ex: "Imprevisto financeiro", "Vendeu o carro").'
              },
              reagendamento_pretendido: {
                type: 'boolean',
                description: 'Se o cliente demonstrou interesse em remarcar futuramente.'
              },
              observacoes: {
                type: 'string',
                description: 'Notas complementares.'
              },
              id_externo: {
                type: 'string',
                description: 'ID único para idempotência do cancelamento.'
              }
            },
            required: ['loja', 'cliente_nome', 'cliente_telefone', 'data_agendamento', 'horario_agendamento']
          }
        }
      ]
    };
  });

  // 2. Execucao das Tools MCP
  leadMcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // TOOL A: list_store_managers
    if (name === 'list_store_managers') {
      const managers = getAllStoreManagers(db);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              sucesso: true,
              totalLojas: managers.length,
              lojas: managers.map(m => ({
                slug: m.loja_slug,
                nome: m.loja_nome,
                gerente: m.gerente_nome,
                canalAtivo: m.is_active === 1
              }))
            }, null, 2)
          }
        ]
      };
    }

    // TOOL B: notify_manager_lead_scheduled
    if (name === 'notify_manager_lead_scheduled') {
      const {
        loja,
        cliente_nome,
        cliente_telefone,
        data_agendamento,
        horario_agendamento,
        veiculo,
        servico_pretendido,
        origem_lead,
        observacoes,
        id_externo
      } = (args || {}) as any;

      if (!loja || !cliente_nome || !cliente_telefone || !data_agendamento || !horario_agendamento) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                sucesso: false,
                status: 'ERRO_PARAMETROS',
                erro: 'Campos obrigatórios ausentes: loja, cliente_nome, cliente_telefone, data_agendamento, horario_agendamento'
              })
            }
          ]
        };
      }

      // Verificacao de idempotencia (24h)
      const idempotency = checkNotificationIdempotency(db, id_externo, 'LEAD_SCHEDULED');
      if (idempotency.isDuplicate) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                sucesso: true,
                status: 'DUPLICADO',
                mensagem: `Notificação já enviada anteriormente para o id_externo '${id_externo}'. Disparo ignorado para evitar duplicação.`,
                existingId: idempotency.existingId
              }, null, 2)
            }
          ]
        };
      }

      // Resolucao de Loja e Gerente
      const storeRes = resolveStoreAndManager(db, loja);
      if (!storeRes.success || !storeRes.manager) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                sucesso: false,
                status: 'ERRO_LOJA',
                erro: storeRes.error || `Loja '${loja}' não encontrada.`,
                lojasValidas: storeRes.availableStores
              }, null, 2)
            }
          ]
        };
      }

      const mgr = storeRes.manager;
      const recipient = getEffectiveRecipientPhone(mgr.phone_canonical);

      // Composicao da Mensagem (Padrao Nativo Hydra)
      const textoMsg = composeHydraLeadCard({
        isTestOverride: recipient.isTestOverride,
        storeName: mgr.loja_nome,
        managerName: mgr.gerente_nome,
        managerPhone: mgr.phone_canonical,
        clientName: cliente_nome,
        clientPhone: cliente_telefone,
        scheduledDate: data_agendamento,
        scheduledTime: horario_agendamento,
        vehicle: veiculo,
        serviceRequested: servico_pretendido,
        originLead: origem_lead,
        notes: observacoes
      });

      const notifId = `lead_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const startMs = Date.now();

      // Disparo WhatsApp via Instancia atendimento
      let sendResult: { sucesso: boolean; messageId?: string; statusHttp: number; erro?: string; duracaoMs: number };

      if (options.customWhatsAppClient) {
        sendResult = await options.customWhatsAppClient.sendText(recipient.phone, textoMsg);
      } else {
        const client = new WhatsAppClient({ instance: 'atendimento' });
        const res = await client.sendText(recipient.phone, textoMsg);
        sendResult = {
          sucesso: res.sucesso,
          messageId: res.messageId,
          statusHttp: res.statusHttp,
          erro: res.erro,
          duracaoMs: res.duracaoMs
        };
      }

      const duracaoTotal = Date.now() - startMs;
      const statusFinal = sendResult.sucesso ? 'SENT' : 'FAILED';

      // Registro de Auditoria no SQLite
      recordManagerNotification(db, {
        id: notifId,
        id_externo,
        tipo: 'LEAD_SCHEDULED',
        loja_slug: mgr.loja_slug,
        gerente_phone: mgr.phone_canonical,
        cliente_nome,
        cliente_phone: cliente_telefone,
        data_agendamento,
        horario_agendamento,
        instancia_emissora: 'atendimento',
        payload_json: JSON.stringify(args || {}),
        mensagem_texto: textoMsg,
        status: statusFinal,
        evolution_message_id: sendResult.messageId,
        status_http: sendResult.statusHttp,
        duracao_ms: duracaoTotal,
        erro_detalhe: sendResult.erro
      });

      if (!sendResult.sucesso) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                sucesso: false,
                status: 'FALHA_ENVIO',
                erro: `Falha ao entregar WhatsApp na instância 'atendimento': ${sendResult.erro}`,
                destinatarioTentado: recipient.phone,
                loja: mgr.loja_nome
              }, null, 2)
            }
          ]
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              sucesso: true,
              status: 'ENVIADO',
              loja: mgr.loja_nome,
              gerente: mgr.gerente_nome,
              telefoneDestino: recipient.isTestOverride ? `${recipient.phone} (TESTE)` : `${mgr.phone_canonical.slice(0, 4)}****${mgr.phone_canonical.slice(-2)}`,
              instanciaEmissora: 'atendimento',
              evolutionMessageId: sendResult.messageId,
              duracaoMs: duracaoTotal
            }, null, 2)
          }
        ]
      };
    }

    // TOOL C: notify_manager_lead_cancelled
    if (name === 'notify_manager_lead_cancelled') {
      const {
        loja,
        cliente_nome,
        cliente_telefone,
        data_agendamento,
        horario_agendamento,
        veiculo,
        motivo_cancelamento,
        reagendamento_pretendido,
        observacoes,
        id_externo
      } = (args || {}) as any;

      if (!loja || !cliente_nome || !cliente_telefone || !data_agendamento || !horario_agendamento) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                sucesso: false,
                status: 'ERRO_PARAMETROS',
                erro: 'Campos obrigatórios ausentes: loja, cliente_nome, cliente_telefone, data_agendamento, horario_agendamento'
              })
            }
          ]
        };
      }

      // Verificacao de idempotencia (24h)
      const idempotency = checkNotificationIdempotency(db, id_externo, 'LEAD_CANCELLED');
      if (idempotency.isDuplicate) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                sucesso: true,
                status: 'DUPLICADO',
                mensagem: `Cancelamento já notificado anteriormente para o id_externo '${id_externo}'. Disparo ignorado.`,
                existingId: idempotency.existingId
              }, null, 2)
            }
          ]
        };
      }

      // Resolucao de Loja e Gerente
      const storeRes = resolveStoreAndManager(db, loja);
      if (!storeRes.success || !storeRes.manager) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                sucesso: false,
                status: 'ERRO_LOJA',
                erro: storeRes.error || `Loja '${loja}' não encontrada.`,
                lojasValidas: storeRes.availableStores
              }, null, 2)
            }
          ]
        };
      }

      const mgr = storeRes.manager;
      const recipient = getEffectiveRecipientPhone(mgr.phone_canonical);

      // Composicao da Mensagem de Cancelamento (Padrao Nativo Hydra)
      const textoMsg = composeHydraCancelCard({
        isTestOverride: recipient.isTestOverride,
        storeName: mgr.loja_nome,
        managerName: mgr.gerente_nome,
        managerPhone: mgr.phone_canonical,
        clientName: cliente_nome,
        clientPhone: cliente_telefone,
        scheduledDate: data_agendamento,
        scheduledTime: horario_agendamento,
        cancelReason: motivo_cancelamento,
        rescheduleIntended: reagendamento_pretendido,
        vehicle: veiculo,
        notes: observacoes
      });

      const notifId = `canc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const startMs = Date.now();

      let sendResult: { sucesso: boolean; messageId?: string; statusHttp: number; erro?: string; duracaoMs: number };

      if (options.customWhatsAppClient) {
        sendResult = await options.customWhatsAppClient.sendText(recipient.phone, textoMsg);
      } else {
        const client = new WhatsAppClient({ instance: 'atendimento' });
        const res = await client.sendText(recipient.phone, textoMsg);
        sendResult = {
          sucesso: res.sucesso,
          messageId: res.messageId,
          statusHttp: res.statusHttp,
          erro: res.erro,
          duracaoMs: res.duracaoMs
        };
      }

      const duracaoTotal = Date.now() - startMs;
      const statusFinal = sendResult.sucesso ? 'SENT' : 'FAILED';

      // Registro de Auditoria no SQLite
      recordManagerNotification(db, {
        id: notifId,
        id_externo,
        tipo: 'LEAD_CANCELLED',
        loja_slug: mgr.loja_slug,
        gerente_phone: mgr.phone_canonical,
        cliente_nome,
        cliente_phone: cliente_telefone,
        data_agendamento,
        horario_agendamento,
        instancia_emissora: 'atendimento',
        payload_json: JSON.stringify(args || {}),
        mensagem_texto: textoMsg,
        status: statusFinal,
        evolution_message_id: sendResult.messageId,
        status_http: sendResult.statusHttp,
        duracao_ms: duracaoTotal,
        erro_detalhe: sendResult.erro
      });

      if (!sendResult.sucesso) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                sucesso: false,
                status: 'FALHA_ENVIO',
                erro: `Falha ao entregar cancelamento na instância 'atendimento': ${sendResult.erro}`,
                destinatarioTentado: recipient.phone,
                loja: mgr.loja_nome
              }, null, 2)
            }
          ]
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              sucesso: true,
              status: 'ENVIADO',
              loja: mgr.loja_nome,
              gerente: mgr.gerente_nome,
              telefoneDestino: recipient.isTestOverride ? `${recipient.phone} (TESTE)` : `${mgr.phone_canonical.slice(0, 4)}****${mgr.phone_canonical.slice(-2)}`,
              instanciaEmissora: 'atendimento',
              evolutionMessageId: sendResult.messageId,
              duracaoMs: duracaoTotal
            }, null, 2)
          }
        ]
      };
    }

    throw new Error(`Tool desconhecida: ${name}`);
  });
}