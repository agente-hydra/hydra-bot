/**
 * src/hydra-sync/conversation_history_service.ts
 * Serviço de consulta estruturada ao histórico conversacional (conversation_messages / agent_interaction_logs).
 * 
 * Atende com precisão milimétrica a perguntas retrospectivas como:
 * "qual foi a minha primeira pergunta?" (Turnos 833 e 834)
 * "quantas perguntas eu já fiz hoje?"
 * "o que eu perguntei antes?"
 * 
 * Elimina a adivinhação espúria baseada na janela recente de 4 mensagens.
 */

import type Database from 'better-sqlite3';
import type {
  ConversationHistoryQuery,
  ConversationHistoryResult
} from './types/vault_contract.js';

interface ConversationMessageRow {
  id: number;
  phone: string;
  role: 'user' | 'assistant';
  content: string;
  tool_used: string | null;
  tool_params: string | null;
  created_at: string;
}

interface UserProfileRow {
  phone: string;
  persona: string;
  loja_slug: string | null;
  memory_generation: number;
  daily_memory_reset_at: string | null;
}

/**
 * Normaliza número de telefone removendo sufixos de mensageria (@s.whatsapp.net, @c.us)
 * e caracteres não numéricos, mantendo a sequência de dígitos.
 */
export function normalizePhone(rawPhone: string): string {
  if (!rawPhone) return '';
  const noSuffix = rawPhone.split('@')[0] || '';
  return noSuffix.replace(/\D/g, '');
}

/**
 * Retorna variantes aceitas de telefone para lookup no banco (com e sem DDI 55).
 */
export function getPhoneVariants(rawPhone: string): string[] {
  const clean = normalizePhone(rawPhone);
  if (!clean) return [];
  const variants = new Set<string>();
  variants.add(clean);

  if (clean.startsWith('55') && clean.length >= 12) {
    variants.add(clean.slice(2)); // Sem 55
  } else if (!clean.startsWith('55') && (clean.length === 10 || clean.length === 11)) {
    variants.add(`55${clean}`); // Com 55
  }

  return Array.from(variants);
}

/**
 * Detecta se a mensagem do usuário é uma consulta meta-conversacional de histórico.
 */
export function isConversationHistoryQuery(text: string): boolean {
  if (!text) return false;
  const norm = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  // "qual foi a minha primeira pergunta", "qual foi minha 1 pergunta", "o que eu perguntei primeiro"
  const isFirstQuestion = /\b(primeir[ao]|1[aªº]?)\s+pergunta\b/i.test(norm) ||
    /\b(qual\s+foi\s+a\s+minha\s+1\s+pergunta|qual\s+foi\s+minha\s+primeira\s+pergunta)\b/i.test(norm) ||
    /\bo\s+que\s+(eu\s+)?perguntei\s+(primeiro|no\s+come[cç]o|inicialmente)\b/i.test(norm) ||
    /\bqual\s+foi\s+o\s+primeiro\s+comando\b/i.test(norm);

  // "quantas perguntas eu já fiz", "total de perguntas"
  const isCount = /\b(quantas\s+perguntas|total\s+de\s+perguntas|quantos\s+turnos)\b/i.test(norm);

  // "o que eu perguntei antes", "perguntas anteriores", "últimas perguntas"
  const isRecent = /\b(o\s+que\s+(eu\s+)?perguntei\s+(antes|anteriormente)|ultimas\s+perguntas|perguntas\s+anteriores)\b/i.test(norm);

  return isFirstQuestion || isCount || isRecent;
}

/**
 * Classifica a intenção específica de histórico conversacional.
 */
export function detectHistoryQueryType(text: string): 'first_question' | 'recent_turns' | 'turn_count' | null {
  if (!text) return null;
  const norm = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  if (
    /\b(primeir[ao]|1[aªº]?)\s+pergunta\b/i.test(norm) ||
    /\b(qual\s+foi\s+a\s+minha\s+1\s+pergunta|qual\s+foi\s+minha\s+primeira\s+pergunta)\b/i.test(norm) ||
    /\bo\s+que\s+(eu\s+)?perguntei\s+(primeiro|no\s+come[cç]o|inicialmente)\b/i.test(norm) ||
    /\bqual\s+foi\s+o\s+primeiro\s+comando\b/i.test(norm)
  ) {
    return 'first_question';
  }

  if (/\b(quantas\s+perguntas|total\s+de\s+perguntas|quantos\s+turnos)\b/i.test(norm)) {
    return 'turn_count';
  }

  if (
    /\b(o\s+que\s+(eu\s+)?perguntei\s+(antes|anteriormente)|ultimas\s+perguntas|perguntas\s+anteriores|historico\s+recente)\b/i.test(norm)
  ) {
    return 'recent_turns';
  }

  return null;
}

/**
 * Formata timestamp ISO para representação legível em português (Horário de Brasília).
 */
export function formatDateTimeBR(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    const dateStr = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const timeStr = d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
    return `${dateStr} às ${timeStr}`;
  } catch {
    return isoString;
  }
}

/**
 * Executa a consulta autorizada de histórico conversacional diretamente sobre a tabela
 * conversation_messages (e perfis de geração), retornando fatos auditáveis.
 */
export function queryConversationHistory(
  db: Database.Database,
  query: ConversationHistoryQuery
): ConversationHistoryResult {
  const phoneClean = normalizePhone(query.phone);
  const variants = getPhoneVariants(query.phone);

  if (variants.length === 0) {
    return {
      queryType: query.queryType,
      found: false,
      explanation: 'Identidade telefônica inválida ou ausente para consulta de histórico.'
    };
  }

  const phonePlaceholders = variants.map(() => '?').join(', ');

  // 1. Obter perfil e limites de geração (caso escopo seja current_generation)
  let resetBoundary: string | null = null;
  let activeGenerationId = query.generationId;

  try {
    const profileStmt = db.prepare(`
      SELECT phone, persona, loja_slug, memory_generation, daily_memory_reset_at
      FROM hydra_user_profiles
      WHERE phone IN (${phonePlaceholders})
      LIMIT 1
    `);
    const profile = profileStmt.get(...variants) as UserProfileRow | undefined;
    if (profile) {
      if (!activeGenerationId) {
        activeGenerationId = profile.memory_generation;
      }
      if (profile.daily_memory_reset_at) {
        resetBoundary = profile.daily_memory_reset_at;
      }
    }
  } catch {
    // Tabela hydra_user_profiles pode não existir em ambientes de teste reduzidos
  }

  // Se escopo for current_generation e não tiver resetBoundary explícito em profile,
  // buscar o último comando de reset do usuário nas mensagens
  if (query.scope === 'current_generation' && !resetBoundary) {
    try {
      const resetStmt = db.prepare(`
        SELECT created_at
        FROM conversation_messages
        WHERE phone IN (${phonePlaceholders})
          AND role = 'user'
          AND (content LIKE '/reset%' OR content LIKE '!reset%')
        ORDER BY id DESC
        LIMIT 1
      `);
      const resetRow = resetStmt.get(...variants) as { created_at: string } | undefined;
      if (resetRow) {
        resetBoundary = resetRow.created_at;
      }
    } catch {
      // Ignora erro se coluna não existir
    }
  }

  // 2. Montar cláusulas de escopo temporal
  const whereClauses: string[] = [`phone IN (${phonePlaceholders})`];
  const params: unknown[] = [...variants];

  if (query.scope === 'today') {
    // Hoje no fuso de Brasília ou local: data YYYY-MM-DD
    const today = new Date().toISOString().slice(0, 10);
    whereClauses.push(`created_at >= ?`);
    params.push(`${today} 00:00:00`);
  } else if (query.scope === 'current_generation') {
    if (resetBoundary) {
      whereClauses.push(`created_at > ?`);
      params.push(resetBoundary);
    }
  }

  // 3. Execução conforme queryType
  if (query.queryType === 'first_question') {
    const userWhere = [...whereClauses, `role = 'user'`, `content NOT LIKE '/reset%'`, `content NOT LIKE '!reset%'`];
    const sql = `
      SELECT id, phone, role, content, tool_used, tool_params, created_at
      FROM conversation_messages
      WHERE ${userWhere.join(' AND ')}
      ORDER BY id ASC
      LIMIT 1
    `;

    const row = db.prepare(sql).get(...params) as ConversationMessageRow | undefined;

    if (!row) {
      return {
        queryType: 'first_question',
        found: false,
        explanation: 'Nenhuma pergunta de usuário encontrada no histórico registrado para o escopo selecionado.'
      };
    }

    const formattedDate = formatDateTimeBR(row.created_at);

    // Verificar se há histórico mais antigo anterior a um reset para desambiguação honesta
    let priorContext = '';
    if (query.scope === 'current_generation' && resetBoundary) {
      const priorSql = `
        SELECT id, content, created_at
        FROM conversation_messages
        WHERE phone IN (${phonePlaceholders})
          AND role = 'user'
          AND content NOT LIKE '/reset%'
          AND created_at <= ?
        ORDER BY id ASC
        LIMIT 1
      `;
      const priorRow = db.prepare(priorSql).get(...variants, resetBoundary) as ConversationMessageRow | undefined;
      if (priorRow) {
        priorContext = ` (Nota: antes do último reset, sua primeira pergunta histórica foi "${priorRow.content}" em ${formatDateTimeBR(priorRow.created_at)}).`;
      }
    }

    return {
      queryType: 'first_question',
      found: true,
      firstQuestion: {
        text: row.content,
        timestamp: row.created_at,
        turnId: String(row.id)
      },
      explanation: `A sua primeira pergunta registrada ${query.scope === 'current_generation' ? 'nesta sessão' : 'nesta conversa'} foi: "${row.content}" (em ${formattedDate}).${priorContext}`
    };
  }

  if (query.queryType === 'recent_turns') {
    const limit = Math.max(1, Math.min(query.limit || 5, 20));
    const sql = `
      SELECT id, phone, role, content, tool_used, tool_params, created_at
      FROM conversation_messages
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY id DESC
      LIMIT ?
    `;

    const rows = db.prepare(sql).all(...params, limit) as ConversationMessageRow[];
    const reversed = [...rows].reverse();

    const countStmt = db.prepare(`
      SELECT COUNT(*) as total
      FROM conversation_messages
      WHERE ${whereClauses.join(' AND ')}
    `);
    const countRow = countStmt.get(...params) as { total: number } | undefined;
    const totalCount = countRow ? countRow.total : rows.length;

    return {
      queryType: 'recent_turns',
      found: reversed.length > 0,
      messages: reversed.map((r) => ({
        role: r.role,
        content: r.content,
        timestamp: r.created_at,
        turnId: String(r.id)
      })),
      totalTurnCount: totalCount,
      explanation: `Recuperados os últimos ${reversed.length} turnos de um total de ${totalCount} mensagens registradas.`
    };
  }

  if (query.queryType === 'turn_count') {
    const userCountStmt = db.prepare(`
      SELECT COUNT(*) as total
      FROM conversation_messages
      WHERE ${whereClauses.join(' AND ')} AND role = 'user'
    `);
    const userCountRow = userCountStmt.get(...params) as { total: number } | undefined;
    const userCount = userCountRow ? userCountRow.total : 0;

    return {
      queryType: 'turn_count',
      found: userCount > 0,
      totalTurnCount: userCount,
      explanation: `Você realizou ${userCount} pergunta(s) ${query.scope === 'today' ? 'hoje' : 'no total registrado'}.`
    };
  }

  return {
    queryType: query.queryType,
    found: false,
    explanation: 'Tipo de consulta de histórico não suportado.'
  };
}

/**
 * Constrói balão formatado no padrão WhatsApp Hydra para resposta imediata do assistente.
 */
export function formatConversationHistoryReply(result: ConversationHistoryResult): string {
  if (!result.found) {
    return `> *Histórico da Conversa*\n\nNão encontrei registros de perguntas anteriores para este período no histórico oficial.`;
  }

  if (result.queryType === 'first_question' && result.firstQuestion) {
    const dataFmt = formatDateTimeBR(result.firstQuestion.timestamp);
    return `> *Histórico da Conversa*\n\nA sua primeira pergunta registrada foi:\n> *"${result.firstQuestion.text}"*\n\n- *Data/Hora:* ${dataFmt}\n- *Registro:* Mensagem #${result.firstQuestion.turnId}`;
  }

  if (result.queryType === 'turn_count') {
    return `> *Histórico da Conversa*\n\nVocê já realizou *${result.totalTurnCount || 0}* pergunta(s) no período consultado.`;
  }

  if (result.queryType === 'recent_turns' && result.messages) {
    const lines = result.messages.map((m) => {
      const prefix = m.role === 'user' ? '👤 *Você:*' : '🤖 *Hydra:*';
      const time = formatDateTimeBR(m.timestamp).split(' às ')[1] || '';
      return `${prefix} "${m.content.slice(0, 80)}${m.content.length > 80 ? '...' : ''}" ${time ? `_(${time})_` : ''}`;
    });
    return `> *Últimos Turnos da Conversa*\n\n${lines.join('\n')}`;
  }

  return result.explanation;
}
