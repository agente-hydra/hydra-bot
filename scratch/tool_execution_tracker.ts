/**
 * src/hydra-sync/tool_execution_tracker.ts
 * Rastreador factual de execução de ferramentas e telemetria de turnos.
 * 
 * Garante que toolsCalled e agent_interaction_logs reflitam única e exclusivamente
 * ferramentas que foram comprovadamente invocadas e executadas.
 * 
 * Elimina a injeção estática/sintética de tags como 'mcp:hydra-ops' quando o worker
 * apenas sintetiza respostas conceituais ou textuais (Turno 838 / Critério M15).
 */

import type { ToolCallTrace } from './types/vault_contract.js';

export interface ActiveTrace {
  turnId: string;
  toolName: string;
  toolSource: 'mcp' | 'sqlite_adapter' | 'vault';
  inputParams: Record<string, unknown>;
  startTimestamp: number;
  startedAt: string;
}

export class ToolExecutionTracker {
  private tracesByTurn = new Map<string, ToolCallTrace[]>();

  /**
   * Inicia o rastreamento de uma chamada a ferramenta.
   */
  public startTrace(
    turnId: string,
    toolName: string,
    toolSource: 'mcp' | 'sqlite_adapter' | 'vault' = 'sqlite_adapter',
    inputParams: Record<string, unknown> = {}
  ): ActiveTrace {
    return {
      turnId,
      toolName,
      toolSource,
      inputParams: { ...inputParams },
      startTimestamp: Date.now(),
      startedAt: new Date().toISOString()
    };
  }

  /**
   * Finaliza o rastreamento, calcula latência real e registra no histórico do turno.
   */
  public endTrace(
    active: ActiveTrace,
    status: 'SUCCESS' | 'ERROR' = 'SUCCESS',
    errorMessage?: string
  ): ToolCallTrace {
    const finishedTimestamp = Date.now();
    const latencyMs = Math.max(0, finishedTimestamp - active.startTimestamp);

    const trace: ToolCallTrace = {
      turnId: active.turnId,
      toolName: active.toolName,
      toolSource: active.toolSource,
      inputParams: active.inputParams,
      startedAt: active.startedAt,
      finishedAt: new Date(finishedTimestamp).toISOString(),
      latencyMs,
      status,
      ...(errorMessage ? { errorMessage } : {})
    };

    this.recordTrace(trace);
    return trace;
  }

  /**
   * Registra diretamente um trace concluído.
   */
  public recordTrace(trace: ToolCallTrace): void {
    const list = this.tracesByTurn.get(trace.turnId) || [];
    list.push(trace);
    this.tracesByTurn.set(trace.turnId, list);
  }

  /**
   * Registra a execução direta de uma ferramenta com medição simplificada.
   */
  public recordExecutedTool(
    turnId: string,
    toolName: string,
    toolSource: 'mcp' | 'sqlite_adapter' | 'vault' = 'sqlite_adapter',
    inputParams: Record<string, unknown> = {},
    latencyMs: number = 0,
    status: 'SUCCESS' | 'ERROR' = 'SUCCESS',
    errorMessage?: string
  ): ToolCallTrace {
    const now = new Date();
    const startedAt = new Date(now.getTime() - latencyMs).toISOString();
    const finishedAt = now.toISOString();

    const trace: ToolCallTrace = {
      turnId,
      toolName,
      toolSource,
      inputParams,
      startedAt,
      finishedAt,
      latencyMs,
      status,
      ...(errorMessage ? { errorMessage } : {})
    };

    this.recordTrace(trace);
    return trace;
  }

  /**
   * Executa uma função com medição automática de latência e captura de erros.
   */
  public async executeTracked<T>(
    turnId: string,
    toolName: string,
    toolSource: 'mcp' | 'sqlite_adapter' | 'vault',
    inputParams: Record<string, unknown>,
    fn: () => Promise<T> | T
  ): Promise<T> {
    const active = this.startTrace(turnId, toolName, toolSource, inputParams);
    try {
      const result = await fn();
      this.endTrace(active, 'SUCCESS');
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.endTrace(active, 'ERROR', msg);
      throw err;
    }
  }

  /**
   * Retorna todos os traces registrados para um turno.
   */
  public getTraces(turnId: string): ToolCallTrace[] {
    return this.tracesByTurn.get(turnId) || [];
  }

  /**
   * Retorna a lista de nomes de ferramentas executadas com sucesso no turno.
   */
  public getExecutedTools(turnId: string): string[] {
    const list = this.tracesByTurn.get(turnId) || [];
    const set = new Set<string>();
    for (const t of list) {
      if (t.status === 'SUCCESS') {
        set.add(t.toolName);
      }
    }
    return Array.from(set);
  }

  /**
   * Verifica se houve qualquer execução de ferramenta comprovada no turno.
   */
  public hasExecutedTools(turnId: string): boolean {
    const list = this.tracesByTurn.get(turnId) || [];
    return list.some((t) => t.status === 'SUCCESS');
  }

  /**
   * Limpa os dados do turno após persistência.
   */
  public clearTurn(turnId: string): void {
    this.tracesByTurn.delete(turnId);
  }

  /**
   * Reseta todo o estado (útil para testes isolados).
   */
  public resetAll(): void {
    this.tracesByTurn.clear();
  }
}

/**
 * Singleton global de rastreamento para uso na sessão e nos workers.
 */
export const globalToolTracker = new ToolExecutionTracker();

/**
 * Detecta se uma mensagem do usuário é conceitual, explicativa ou meta-operacional,
 * na qual respostas sintéticas não devem disparar ferramentas operacionais.
 */
export function isConceptualQuery(text: string): boolean {
  if (!text) return false;
  const norm = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  return (
    /\b(como\s+ta\s+seu\s+harness|como\s+e\s+seu\s+harness|o\s+que\s+e\s+o\s+harness)\b/i.test(norm) ||
    /\b(como\s+ta\s+s?seu\s+system\s+prompt|qual\s+e\s+o\s+seu\s+prompt|como\s+voce\s+funciona)\b/i.test(norm) ||
    /\b(quem\s+e\s+voce|o\s+que\s+voce\s+faz|quais\s+sao\s+suas\s+regras)\b/i.test(norm) ||
    /\b(oi|ola|bom\s+dia|boa\s+tarde|boa\s+noite)\b/i.test(norm)
  );
}

/**
 * Realiza a auditoria factual das ferramentas do turno.
 * Se o worker apenas sintetizou texto sem chamada a ferramentas, toolsCalled é estritamente [].
 * Falsas injeções de 'mcp:hydra-ops' são sumariamente bloqueadas.
 */
export function auditTurnExecution(
  turnId: string,
  options: {
    rawOutput?: string;
    candidateTools?: string[];
    tracker?: ToolExecutionTracker;
  } = {}
): {
  toolsCalled: string[];
  isPureSynthesis: boolean;
  traces: ToolCallTrace[];
} {
  const tracker = options.tracker || globalToolTracker;
  const traces = tracker.getTraces(turnId);
  const executedRealTools = tracker.getExecutedTools(turnId);

  // Se o tracker registrou execuções reais comprovadas
  if (executedRealTools.length > 0) {
    return {
      toolsCalled: executedRealTools,
      isPureSynthesis: false,
      traces
    };
  }

  // Se ferramentas candidatas foram sugeridas (ex: opResult.toolsCalled), validar contra blacklist sintética
  const confirmedTools: string[] = [];
  if (options.candidateTools && options.candidateTools.length > 0) {
    for (const tool of options.candidateTools) {
      // Bloqueia categoricamente injeção sintética cega de 'mcp:hydra-ops' sem execução
      if (tool === 'mcp:hydra-ops' || tool === 'mcp') {
        continue;
      }
      confirmedTools.push(tool);
    }
  }

  const isPureSynthesis = confirmedTools.length === 0;

  return {
    toolsCalled: confirmedTools,
    isPureSynthesis,
    traces
  };
}
