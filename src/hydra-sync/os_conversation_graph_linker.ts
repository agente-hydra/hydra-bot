/**
 * src/hydra-sync/os_conversation_graph_linker.ts
 * Motor de Interligação em Grafo entre Ordens de Serviço (OS) e Conversas de Chat (Spec 059)
 * 
 * Responsabilidades:
 * 1. Correlaciona deterministicamente Ordens de Serviço (ERP) com Conversas de Atendimento (Chatwoot/WhatsApp).
 * 2. Aplica as 3 regras contratuais:
 *    - Regra L1 (Telefone): Correspondência exata de telefone internacional E.164.
 *    - Regra L2 (Placa): Menção da placa do veículo no histórico da conversa da mesma loja/inbox.
 *    - Regra L3 (Menção de OS): Citação explícita do número da OS no chat ("OS 4453", "OS #1916").
 * 3. Projeta nós e arestas com namespace atômico em `hydra_case_graph_nodes` e `hydra_case_graph_edges`.
 * 4. Mantém a posição consolidada da OS em `hydra_case_current_position` e links rápidos em `hydra_conversation_os_links`.
 * 
 * Stack: TypeScript Strict (zero `any`, zero `@ts-ignore`).
 */

import Database from 'better-sqlite3';
import { ensureCaseAnalysisTables } from './real_analysis_repository.js';
import { ChatwootConversationReader } from './chatwoot_conversation_reader.js';
import type { SanitizedChatMessage } from './types/chatwoot_contract.js';

export type LinkMethod = 'PHONE_MATCH' | 'PLATE_MATCH' | 'OS_MENTION';
export type LinkConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface LinkEvaluationInput {
  readonly osId: number;
  readonly lojaSlug: string;
  readonly plate?: string;
  readonly vehicleModel?: string;
  readonly customerName?: string;
  readonly customerPhone?: string;
  readonly erpStatus?: string;
  readonly conversationId: number;
  readonly inboxId?: number;
  readonly contactPhone?: string;
  readonly contactName?: string;
  readonly messages?: readonly SanitizedChatMessage[];
}

export interface LinkResult {
  readonly isLinked: boolean;
  readonly linkMethod?: LinkMethod;
  readonly confidence?: LinkConfidence;
  readonly evidence?: string;
}

export interface LinkedOrderView {
  readonly osId: number;
  readonly lojaSlug: string;
  readonly plate?: string;
  readonly vehicleModel?: string;
  readonly customerName?: string;
  readonly customerPhone?: string;
  readonly erpStatus?: string;
  readonly linkMethod: LinkMethod;
  readonly confidence: LinkConfidence;
}

export interface LinkedConversationView {
  readonly conversationId: number;
  readonly lojaSlug: string;
  readonly contactName?: string;
  readonly contactPhone?: string;
  readonly linkMethod: LinkMethod;
  readonly confidence: LinkConfidence;
  readonly chatwootUrl: string;
  readonly waLink?: string;
}

export interface OsCaseGraphView {
  readonly osId: number;
  readonly lojaSlug: string;
  readonly vehiclePlate?: string;
  readonly vehicleModel?: string;
  readonly customerName?: string;
  readonly customerPhone?: string;
  readonly currentErpStatus: string;
  readonly delayReason?: string;
  readonly nextPromisedStep?: string;
  readonly linkedConversations: readonly LinkedConversationView[];
  readonly recentFacts: readonly {
    readonly subject: string;
    readonly excerpt: string;
    readonly author: string;
    readonly date: string;
  }[];
  readonly updatedAt: string;
}

export class OsConversationGraphLinker {
  private readonly accountId = '1';
  private readonly sourceId = 'chatwoot';

  constructor(private readonly db: Database.Database) {
    ensureCaseAnalysisTables(this.db);
  }

  /**
   * Avalia as regras contratuais para verificar se há correlação factual entre OS e Conversa.
   */
  public static evaluateLink(input: LinkEvaluationInput): LinkResult {
    const { osId, plate, customerPhone, contactPhone, messages = [] } = input;

    // Regra L1: Match por Telefone do Cliente
    const cleanOsPhone = ChatwootConversationReader.normalizePhone(customerPhone);
    const cleanContactPhone = ChatwootConversationReader.normalizePhone(contactPhone);

    if (cleanOsPhone && cleanContactPhone && cleanOsPhone.length >= 10) {
      if (cleanOsPhone === cleanContactPhone || cleanOsPhone.slice(-8) === cleanContactPhone.slice(-8)) {
        return {
          isLinked: true,
          linkMethod: 'PHONE_MATCH',
          confidence: 'HIGH',
          evidence: `Telefone coincidente: OS (${cleanOsPhone}) = Contato (${cleanContactPhone})`
        };
      }
    }

    // Regra L2: Match por Placa do Veículo mencionada no chat
    if (plate && plate.trim().length >= 6) {
      const cleanPlate = plate.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      const plateRegex = new RegExp(`\\b${cleanPlate.slice(0, 3)}[- ]?${cleanPlate.slice(3)}\\b`, 'i');

      for (const msg of messages) {
        if (msg.content && plateRegex.test(msg.content.replace(/[^A-Za-z0-9]/g, ' '))) {
          return {
            isLinked: true,
            linkMethod: 'PLATE_MATCH',
            confidence: 'HIGH',
            evidence: `Placa ${plate} identificada no texto da mensagem #${msg.messageId}`
          };
        }
      }
    }

    // Regra L3: Match por Menção Explícita de OS no chat
    if (osId && osId > 0) {
      const osMentionRegex = new RegExp(`\\b(?:os|ordem\\s*de\\s*servi[cç]o)\\s*#?\\s*${osId}\\b`, 'i');

      for (const msg of messages) {
        if (msg.content && osMentionRegex.test(msg.content)) {
          return {
            isLinked: true,
            linkMethod: 'OS_MENTION',
            confidence: 'HIGH',
            evidence: `Citação explícita de OS #${osId} na mensagem #${msg.messageId}`
          };
        }
      }
    }

    return { isLinked: false };
  }

  /**
   * Executa a vinculação transacional, gerando nós e arestas no grafo relacional.
   */
  public link(input: LinkEvaluationInput): LinkResult {
    const evalRes = OsConversationGraphLinker.evaluateLink(input);
    if (!evalRes.isLinked || !evalRes.linkMethod || !evalRes.confidence) {
      return evalRes;
    }

    const {
      osId,
      lojaSlug,
      plate,
      vehicleModel,
      customerName,
      customerPhone,
      erpStatus = 'ABERTO',
      conversationId,
      contactPhone,
      contactName,
      messages = []
    } = input;

    const linkTx = this.db.transaction(() => {
      // 1. Grava o vínculo no índice relacional
      this.db.prepare(`
        INSERT INTO hydra_conversation_os_links (
          conversation_id, os_id, loja_slug, link_method, confidence, created_at
        ) VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(conversation_id, os_id, loja_slug) DO UPDATE SET
          link_method = excluded.link_method,
          confidence = excluded.confidence
      `).run(conversationId, osId, lojaSlug, evalRes.linkMethod, evalRes.confidence);

      // 2. Projeta Nós do Grafo
      const insertNode = this.db.prepare(`
        INSERT INTO hydra_case_graph_nodes (
          node_id, entity_type, label, account_id, loja_slug, attributes_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(node_id) DO UPDATE SET
          attributes_json = excluded.attributes_json,
          updated_at = excluded.updated_at
      `);

      // Nó da Conversa
      const convNodeId = `CONVERSA:${this.sourceId}:${this.accountId}:${lojaSlug}:${conversationId}`;
      insertNode.run(
        convNodeId,
        'CONVERSA',
        `Conversa #${conversationId}`,
        this.accountId,
        lojaSlug,
        JSON.stringify({ conversationId, contactName, contactPhone })
      );

      // Nó da Ordem de Serviço
      const osNodeId = `ORDEM_SERVICO:${this.sourceId}:${this.accountId}:${lojaSlug}:${osId}`;
      insertNode.run(
        osNodeId,
        'ORDEM_SERVICO',
        `OS #${osId} (${lojaSlug})`,
        this.accountId,
        lojaSlug,
        JSON.stringify({ osId, lojaSlug, plate, vehicleModel, customerName, erpStatus })
      );

      // 3. Projeta Aresta: CONVERSA -> TREATS_ORDER -> ORDEM_SERVICO
      const insertEdge = this.db.prepare(`
        INSERT INTO hydra_case_graph_edges (
          edge_id, from_node_id, to_node_id, relation_type, status,
          version, link_method, confidence, loja_slug, evidence_ref, created_at
        ) VALUES (?, ?, ?, 'TREATS_ORDER', 'ACTIVE', 1, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(edge_id) DO UPDATE SET
          status = excluded.status,
          link_method = excluded.link_method,
          confidence = excluded.confidence,
          evidence_ref = excluded.evidence_ref
      `);

      const edgeId = `${convNodeId}->TREATS_ORDER->${osNodeId}`;
      insertEdge.run(
        edgeId,
        convNodeId,
        osNodeId,
        evalRes.linkMethod,
        evalRes.confidence,
        lojaSlug,
        evalRes.evidence || 'Vínculo automático'
      );

      // 4. Se houver placa, projeta nó de veículo e aresta BELONGS_TO_VEHICLE
      if (plate) {
        const cleanPlate = plate.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        const vehNodeId = `VEICULO:${this.sourceId}:${this.accountId}:${lojaSlug}:${cleanPlate}`;
        insertNode.run(
          vehNodeId,
          'VEICULO',
          `Veículo ${cleanPlate} (${vehicleModel || 'Modelo N/D'})`,
          this.accountId,
          lojaSlug,
          JSON.stringify({ plate: cleanPlate, model: vehicleModel })
        );

        const edgeVehId = `${osNodeId}->BELONGS_TO_VEHICLE->${vehNodeId}`;
        this.db.prepare(`
          INSERT INTO hydra_case_graph_edges (
            edge_id, from_node_id, to_node_id, relation_type, status,
            version, link_method, confidence, loja_slug, evidence_ref, created_at
          ) VALUES (?, ?, ?, 'BELONGS_TO_VEHICLE', 'ACTIVE', 1, 'STRUCTURAL', 'HIGH', ?, 'Placa da OS', datetime('now'))
          ON CONFLICT(edge_id) DO UPDATE SET status = excluded.status
        `).run(edgeVehId, osNodeId, vehNodeId, lojaSlug);
      }

      // 5. Atualiza a Posição Atual (State Reducer)
      let delayReason: string | undefined = undefined;
      let nextStep: string | undefined = undefined;

      // Extrai possíveis motivos de atraso ou autorização nas mensagens recentes
      for (const msg of messages) {
        if (!msg.content) continue;
        const lower = msg.content.toLowerCase();
        if (lower.includes('atraso') || lower.includes('aguardando peca') || lower.includes('aguardando aprova') || lower.includes('retifica')) {
          delayReason = msg.content.slice(0, 200);
        }
        if (lower.includes('aprovado') || lower.includes('autorizado') || lower.includes('pode fazer') || lower.includes('fechou')) {
          nextStep = 'Serviço autorizado pelo cliente';
        }
      }

      this.db.prepare(`
        INSERT INTO hydra_case_current_position (
          loja_slug, os_id, source_id, account_id, vehicle_plate, vehicle_model,
          customer_name, customer_phone, current_erp_status, reported_delay_cause,
          next_promised_step, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(loja_slug, os_id) DO UPDATE SET
          vehicle_plate = COALESCE(excluded.vehicle_plate, hydra_case_current_position.vehicle_plate),
          vehicle_model = COALESCE(excluded.vehicle_model, hydra_case_current_position.vehicle_model),
          customer_name = COALESCE(excluded.customer_name, hydra_case_current_position.customer_name),
          customer_phone = COALESCE(excluded.customer_phone, hydra_case_current_position.customer_phone),
          current_erp_status = excluded.current_erp_status,
          reported_delay_cause = COALESCE(excluded.reported_delay_cause, hydra_case_current_position.reported_delay_cause),
          next_promised_step = COALESCE(excluded.next_promised_step, hydra_case_current_position.next_promised_step),
          updated_at = excluded.updated_at
      `).run(
        lojaSlug,
        osId,
        this.sourceId,
        this.accountId,
        plate || null,
        vehicleModel || null,
        customerName || null,
        customerPhone || contactPhone || null,
        erpStatus,
        delayReason || null,
        nextStep || null
      );
    });

    linkTx();
    return evalRes;
  }

  /**
   * Busca todas as conversas vinculadas a uma OS específica.
   */
  public findLinkedConversationsForOs(
    lojaSlug: string,
    osId: number
  ): readonly LinkedConversationView[] {
    const rows = this.db.prepare(`
      SELECT 
        l.conversation_id, l.loja_slug, l.link_method, l.confidence,
        n.attributes_json
      FROM hydra_conversation_os_links l
      LEFT JOIN hydra_case_graph_nodes n 
        ON n.node_id = 'CONVERSA:chatwoot:1:' || l.loja_slug || ':' || l.conversation_id
      WHERE l.loja_slug = ? AND l.os_id = ?
      ORDER BY l.created_at DESC
    `).all(lojaSlug, osId) as {
      conversation_id: number;
      loja_slug: string;
      link_method: LinkMethod;
      confidence: LinkConfidence;
      attributes_json?: string;
    }[];

    const reader = new ChatwootConversationReader();

    return rows.map(r => {
      let attrs: { contactName?: string; contactPhone?: string } = {};
      try {
        if (r.attributes_json) attrs = JSON.parse(r.attributes_json);
      } catch {}

      return {
        conversationId: r.conversation_id,
        lojaSlug: r.loja_slug,
        contactName: attrs.contactName,
        contactPhone: attrs.contactPhone,
        linkMethod: r.link_method,
        confidence: r.confidence,
        chatwootUrl: reader.buildChatwootUrl(r.conversation_id),
        waLink: ChatwootConversationReader.buildWaLink(attrs.contactPhone)
      };
    });
  }

  /**
   * Busca todas as Ordens de Serviço vinculadas a uma conversa específica.
   */
  public findLinkedOrdersForConversation(
    conversationId: number
  ): readonly LinkedOrderView[] {
    const rows = this.db.prepare(`
      SELECT 
        l.os_id, l.loja_slug, l.link_method, l.confidence,
        p.vehicle_plate, p.vehicle_model, p.customer_name, p.customer_phone, p.current_erp_status
      FROM hydra_conversation_os_links l
      LEFT JOIN hydra_case_current_position p
        ON p.loja_slug = l.loja_slug AND p.os_id = l.os_id
      WHERE l.conversation_id = ?
      ORDER BY l.created_at DESC
    `).all(conversationId) as {
      os_id: number;
      loja_slug: string;
      link_method: LinkMethod;
      confidence: LinkConfidence;
      vehicle_plate?: string;
      vehicle_model?: string;
      customer_name?: string;
      customer_phone?: string;
      current_erp_status?: string;
    }[];

    return rows.map(r => ({
      osId: r.os_id,
      lojaSlug: r.loja_slug,
      plate: r.vehicle_plate,
      vehicleModel: r.vehicle_model,
      customerName: r.customer_name,
      customerPhone: r.customer_phone,
      erpStatus: r.current_erp_status,
      linkMethod: r.link_method,
      confidence: r.confidence
    }));
  }

  /**
   * Retorna a visão completa em Grafo de uma Ordem de Serviço (Raio-X de Atendimento).
   */
  public getOsCaseGraphView(lojaSlug: string, osId: number): OsCaseGraphView | null {
    const pos = this.db.prepare(`
      SELECT * FROM hydra_case_current_position
      WHERE loja_slug = ? AND os_id = ?
    `).get(lojaSlug, osId) as {
      loja_slug: string;
      os_id: number;
      vehicle_plate?: string;
      vehicle_model?: string;
      customer_name?: string;
      customer_phone?: string;
      current_erp_status?: string;
      reported_delay_cause?: string;
      next_promised_step?: string;
      updated_at: string;
    } | undefined;

    if (!pos) return null;

    const linkedConvs = this.findLinkedConversationsForOs(lojaSlug, osId);

    // Busca fatos recentes associados a essa OS na tabela de afirmações analisadas
    const factsRows = this.db.prepare(`
      SELECT subject_type, raw_excerpt, author_role, event_timestamp
      FROM hydra_afirmacoes_analisadas
      WHERE target_os_id = ?
      ORDER BY event_timestamp DESC
      LIMIT 10
    `).all(osId) as {
      subject_type: string;
      raw_excerpt: string;
      author_role: string;
      event_timestamp: string;
    }[];

    const recentFacts = factsRows.map(f => ({
      subject: f.subject_type,
      excerpt: f.raw_excerpt,
      author: f.author_role,
      date: f.event_timestamp
    }));

    return {
      osId: pos.os_id,
      lojaSlug: pos.loja_slug,
      vehiclePlate: pos.vehicle_plate,
      vehicleModel: pos.vehicle_model,
      customerName: pos.customer_name,
      customerPhone: pos.customer_phone,
      currentErpStatus: pos.current_erp_status || 'ABERTO',
      delayReason: pos.reported_delay_cause,
      nextPromisedStep: pos.next_promised_step,
      linkedConversations: linkedConvs,
      recentFacts,
      updatedAt: pos.updated_at
    };
  }
}
