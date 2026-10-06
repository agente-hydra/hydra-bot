import type Database from 'better-sqlite3';
/**
 * Dual-Worker Router & Circuit Breaker para Antigravity (AGY)
 * 
 * Gerencia a alternância de processos isolados entre:
 * - Worker Primário (usuário 'operacional')
 * - Worker Secundário (usuário de serviço 'hydra-sec')
 * 
 * Ambos utilizam estritamente o modelo `gemini-3.8-flash-low`.
 * Implementa circuito aberto com base no reset oficial de cota 429,
 * sondas half-open atômicas e telemetria por turno com orçamento global de 50s.
 * 
 * Códigos de Telemetria Padronizados:
 * - H-IA-01: Cota esgotada (RESOURCE_EXHAUSTED / 429)
 * - H-IA-02: Tempo limite excedido (TIMEOUT / orçamento de turno 50s)
 * - H-IA-03: Falha de rede / conectividade (NETWORK / conexão recusada)
 * - H-IA-04: Erro interno do processo (PROCESS_ERROR / falha de execução)
 */

import { spawnSync } from 'child_process';
import http from 'http';
import { URL } from 'url';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export const GLOBAL_TURN_BUDGET_MS = 50000; // 50 segundos compartilhado entre primário e secundário

export type TelemetryErrorCode = 'H-IA-01' | 'H-IA-02' | 'H-IA-03' | 'H-IA-04';

export const FRIENDLY_ERROR_MESSAGES: Record<TelemetryErrorCode, string> = {
  'H-IA-01': 'Cota de processamento do modelo temporariamente excedida (H-IA-01)',
  'H-IA-02': 'Tempo limite global do turno (50s) ou do worker excedido (H-IA-02)',
  'H-IA-03': 'Falha de conectividade com o worker isolado de IA (H-IA-03)',
  'H-IA-04': 'Instabilidade temporária na execução do processo de IA (H-IA-04)'
};

export interface WorkerCircuitInfo {
  id: 'primary' | 'secondary';
  state: CircuitState;
  resetTime?: number;          // Timestamp epoch (ms) quando a cota reseta
  resetsInMs?: number;         // Milissegundos restantes para o reset
  lastErrorType?: string | null;
  consecutiveFailures: number;
  totalCalls: number;
  quotaErrors: number;
  transientErrors: number;
  activeProbe: boolean;
}

export interface WorkerConfig {
  id: 'primary' | 'secondary';
  type: 'cli' | 'http';
  command?: string[];          // Ex: ['/home/operacional/.local/bin/agy'] ou ['/opt/bots/scripts/run-agy-sec.sh']
  endpoint?: string;           // Ex: 'http://127.0.0.1:3344/prompt'
  model: string;               // Sempre 'gemini-3.8-flash-low'
  timeoutMs: number;           // Timeout curto por worker (padrão: 20s)
}

export interface TurnTelemetryRecord {
  correlationId: string;
  persona?: string;
  lojaSlug?: string;
  reviewDecision?: string;
  replanCount: number;
  workerChosen: string;
  latenciaMs: number;
  modelUsed?: string;
  tokens?: {
    prompt?: number;
    completion?: number;
    total?: number;
  };
  errorCode?: string;
  status?: string;
  createdAt?: string;
}

export interface TurnWorkerTelemetry {
  workerChosen: 'primary' | 'secondary' | 'none';
  motor: 'AGY_PRIMARY' | 'AGY_SECONDARY' | 'FALLBACK_API';
  swapReason: 'PRIMARY_QUOTA_EXHAUSTED' | 'PRIMARY_TIMEOUT' | 'PRIMARY_ERROR' | 'PROBE' | null;
  durationMs: number;
  errorType: 'RESOURCE_EXHAUSTED' | 'TIMEOUT' | 'NETWORK' | 'INVALID_CREDENTIAL' | 'PROCESS_ERROR' | null;
  errorCode?: TelemetryErrorCode | null;
  friendlyMessage?: string | null;
  circuitStatus: {
    primary: { state: CircuitState; resetsInMs?: number };
    secondary: { state: CircuitState; resetsInMs?: number };
  };
  responseSource: 'MODEL' | 'DETERMINISTIC_EXECUTOR' | 'UNRESOLVED_CLARIFICATION';
  turnBudgetRemainingMs?: number;
  correlationId?: string;
  persona?: string;
  lojaSlug?: string;
  reviewDecision?: string;
  replanCount?: number;
  modelUsed?: string;
  tokens?: { prompt?: number; completion?: number; total?: number };
}

export interface WorkerExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  isQuotaExhausted?: boolean;
  isTransient?: boolean;
  isInvalidCredential?: boolean;
  isNetworkError?: boolean;
  resetDurationMs?: number;
  durationMs: number;
}

export interface RouterOutput {
  success: boolean;
  rawOutput?: string;
  parsedPlan?: any;
  telemetry: TurnWorkerTelemetry;
  usedFallback: boolean;
  unresolved: boolean;
}

/**
 * Mapeia errorType para código padronizado H-IA-01 a H-IA-04
 */
export function mapErrorToTelemetryCode(
  errorType: TurnWorkerTelemetry['errorType']
): { code: TelemetryErrorCode | null; message: string | null } {
  if (!errorType) return { code: null, message: null };
  switch (errorType) {
    case 'RESOURCE_EXHAUSTED':
      return { code: 'H-IA-01', message: FRIENDLY_ERROR_MESSAGES['H-IA-01'] };
    case 'TIMEOUT':
      return { code: 'H-IA-02', message: FRIENDLY_ERROR_MESSAGES['H-IA-02'] };
    case 'NETWORK':
      return { code: 'H-IA-03', message: FRIENDLY_ERROR_MESSAGES['H-IA-03'] };
    case 'PROCESS_ERROR':
    case 'INVALID_CREDENTIAL':
    default:
      return { code: 'H-IA-04', message: FRIENDLY_ERROR_MESSAGES['H-IA-04'] };
  }
}

/**
 * Analisa e extrai o tempo de reset de mensagens de erro 429 da AGY.
 */
export function parseResetDurationMs(errorMessage: string): number {
  if (!errorMessage) return 300000; // Padrão: 5 minutos

  const match = errorMessage.match(/Resets in\s+(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i);
  if (match) {
    const hours = parseInt(match[1] || '0', 10);
    const minutes = parseInt(match[2] || '0', 10);
    const seconds = parseInt(match[3] || '0', 10);
    const totalMs = ((hours * 3600) + (minutes * 60) + seconds) * 1000;
    if (totalMs > 0) {
      return Math.min(Math.max(totalMs + 5000, 10000), 24 * 3600 * 1000);
    }
  }

  const jsonMatch = errorMessage.match(/\{[\s\S]*"RESOURCE_EXHAUSTED"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.short_error) {
        return parseResetDurationMs(parsed.short_error);
      }
    } catch {}
  }

  return 300000; // 5 minutos fallback
}

/**
 * Detecta se a mensagem de erro caracteriza exaustão de cota
 */
export function isQuotaErrorMessage(msg: string): boolean {
  if (!msg) return false;
  return (
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('code 429') ||
    msg.includes('Individual quota reached') ||
    msg.includes('Quota exceeded')
  );
}

/**
 * Detecta erro de conexão ou socket
 */
export function isNetworkErrorMessage(msg: string): boolean {
  if (!msg) return false;
  return (
    msg.includes('ECONNREFUSED') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('EHOSTUNREACH') ||
    msg.includes('Falha de conexão') ||
    msg.includes('socket hang up')
  );
}

/**
 * Classe principal do Roteador de Processos Isolados
 */
export class DualWorkerRouter {
  private primaryCircuit: WorkerCircuitInfo;
  private secondaryCircuit: WorkerCircuitInfo;
  private primaryConfig: WorkerConfig;
  private secondaryConfig: WorkerConfig;

  // Injeção de executores para testes mock / harness determinístico
  private primaryExecutorOverride?: (prompt: string, model: string, timeoutMs: number) => Promise<WorkerExecutionResult>;
  private secondaryExecutorOverride?: (prompt: string, model: string, timeoutMs: number) => Promise<WorkerExecutionResult>;

  constructor(options?: {
    primaryConfig?: Partial<WorkerConfig>;
    secondaryConfig?: Partial<WorkerConfig>;
    primaryExecutorOverride?: (prompt: string, model: string, timeoutMs: number) => Promise<WorkerExecutionResult>;
    secondaryExecutorOverride?: (prompt: string, model: string, timeoutMs: number) => Promise<WorkerExecutionResult>;
  }) {
    this.primaryConfig = {
      id: 'primary',
      type: 'cli',
      command: [process.env.AGY_PRIMARY_BIN || '/home/operacional/.local/bin/agy'],
      model: 'gemini-3.8-flash-low',
      timeoutMs: 40000,
      ...options?.primaryConfig
    };

    this.secondaryConfig = {
      id: 'secondary',
      type: (process.env.AGY_SEC_TYPE as any) || 'cli',
      endpoint: process.env.AGY_SEC_ENDPOINT || 'http://127.0.0.1:3344/prompt',
      command: [process.env.AGY_SEC_BIN || '/opt/bots/scripts/run-agy-sec.sh'],
      model: 'gemini-3.8-flash-low',
      timeoutMs: 40000,
      ...options?.secondaryConfig
    };

    this.primaryCircuit = {
      id: 'primary',
      state: 'CLOSED',
      consecutiveFailures: 0,
      totalCalls: 0,
      quotaErrors: 0,
      transientErrors: 0,
      activeProbe: false
    };

    this.secondaryCircuit = {
      id: 'secondary',
      state: 'CLOSED',
      consecutiveFailures: 0,
      totalCalls: 0,
      quotaErrors: 0,
      transientErrors: 0,
      activeProbe: false
    };

    this.primaryExecutorOverride = options?.primaryExecutorOverride;
    this.secondaryExecutorOverride = options?.secondaryExecutorOverride;
  }

  public getCircuitStatus() {
    this.refreshCircuitStates();
    const now = Date.now();
    return {
      primary: {
        state: this.primaryCircuit.state,
        resetsInMs: this.primaryCircuit.resetTime ? Math.max(0, this.primaryCircuit.resetTime - now) : undefined,
        consecutiveFailures: this.primaryCircuit.consecutiveFailures,
        totalCalls: this.primaryCircuit.totalCalls,
        quotaErrors: this.primaryCircuit.quotaErrors
      },
      secondary: {
        state: this.secondaryCircuit.state,
        resetsInMs: this.secondaryCircuit.resetTime ? Math.max(0, this.secondaryCircuit.resetTime - now) : undefined,
        consecutiveFailures: this.secondaryCircuit.consecutiveFailures,
        totalCalls: this.secondaryCircuit.totalCalls,
        quotaErrors: this.secondaryCircuit.quotaErrors
      }
    };
  }

  public setExecutorOverrides(overrides: {
    primary?: (prompt: string, model: string, timeoutMs: number) => Promise<WorkerExecutionResult>;
    secondary?: (prompt: string, model: string, timeoutMs: number) => Promise<WorkerExecutionResult>;
  }) {
    if (overrides.primary !== undefined) this.primaryExecutorOverride = overrides.primary;
    if (overrides.secondary !== undefined) this.secondaryExecutorOverride = overrides.secondary;
  }

  public clearExecutorOverrides() {
    this.primaryExecutorOverride = undefined;
    this.secondaryExecutorOverride = undefined;
  }

  public setCircuitState(workerId: 'primary' | 'secondary', state: CircuitState, resetDurationMs?: number) {
    const circuit = workerId === 'primary' ? this.primaryCircuit : this.secondaryCircuit;
    circuit.state = state;
    if (state === 'OPEN') {
      circuit.resetTime = Date.now() + (resetDurationMs || 300000);
    } else {
      circuit.resetTime = undefined;
      circuit.activeProbe = false;
    }
  }

  private refreshCircuitStates(): void {
    const now = Date.now();
    if (this.primaryCircuit.state === 'OPEN' && this.primaryCircuit.resetTime && now >= this.primaryCircuit.resetTime) {
      this.primaryCircuit.state = 'HALF_OPEN';
      this.primaryCircuit.activeProbe = false;
    }
    if (this.secondaryCircuit.state === 'OPEN' && this.secondaryCircuit.resetTime && now >= this.secondaryCircuit.resetTime) {
      this.secondaryCircuit.state = 'HALF_OPEN';
      this.secondaryCircuit.activeProbe = false;
    }
  }

  private async executeWorker(
    worker: WorkerConfig,
    prompt: string,
    timeoutMsOverride?: number
  ): Promise<WorkerExecutionResult> {
    const effectiveTimeout = timeoutMsOverride !== undefined ? timeoutMsOverride : worker.timeoutMs;
    const workerWithTimeout = { ...worker, timeoutMs: effectiveTimeout };

    if (worker.id === 'primary' && this.primaryExecutorOverride) {
      return this.primaryExecutorOverride(prompt, worker.model, effectiveTimeout);
    }
    if (worker.id === 'secondary' && this.secondaryExecutorOverride) {
      return this.secondaryExecutorOverride(prompt, worker.model, effectiveTimeout);
    }

    if (worker.type === 'http' && worker.endpoint) {
      return this.executeHttpWorker(worker.endpoint, prompt, worker.model, effectiveTimeout);
    }

    return this.executeCliWorker(workerWithTimeout, prompt);
  }

  private async executeCliWorker(worker: WorkerConfig, prompt: string): Promise<WorkerExecutionResult> {
    const start = Date.now();
    const cmdList = worker.command && worker.command.length > 0 ? worker.command : ['agy'];
    const bin = cmdList[0];
    const baseArgs = cmdList.slice(1);
    const args = [...baseArgs, '-p', prompt, '--dangerously-skip-permissions', '--model', worker.model];

    try {
      const proc = spawnSync(bin, args, {
        timeout: worker.timeoutMs,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe']
      });

      const durationMs = Date.now() - start;
      const stdout = (proc.stdout || '').trim();
      const stderr = (proc.stderr || '').trim();
      const combined = `${stdout}\n${stderr}`.trim();

      if (proc.status === 0 && stdout && !stdout.startsWith('error:')) {
        return { success: true, output: stdout, durationMs };
      }

      const isQuota = isQuotaErrorMessage(combined);
      const isTimeout = (proc.error && (proc.error as any).code === 'ETIMEDOUT') || durationMs >= worker.timeoutMs;
      const resetMs = isQuota ? parseResetDurationMs(combined) : undefined;
      const isInvalidCred = combined.includes('authentication required') || combined.includes('invalid_grant');
      const isNetwork = isNetworkErrorMessage(combined);

      return {
        success: false,
        error: combined || proc.error?.message || `Exit code ${proc.status}`,
        isQuotaExhausted: isQuota,
        isTransient: isTimeout || proc.status === 143,
        isInvalidCredential: isInvalidCred,
        isNetworkError: isNetwork,
        resetDurationMs: resetMs,
        durationMs
      };
    } catch (err: any) {
      const durationMs = Date.now() - start;
      const combined = err.message || '';
      const isQuota = isQuotaErrorMessage(combined);
      const resetMs = isQuota ? parseResetDurationMs(combined) : undefined;
      const isTimeout = err.code === 'ETIMEDOUT' || durationMs >= worker.timeoutMs;
      const isNetwork = isNetworkErrorMessage(combined);

      return {
        success: false,
        error: combined,
        isQuotaExhausted: isQuota,
        isTransient: isTimeout,
        isNetworkError: isNetwork,
        resetDurationMs: resetMs,
        durationMs
      };
    }
  }

  private async executeHttpWorker(
    endpoint: string,
    prompt: string,
    model: string,
    timeoutMs: number
  ): Promise<WorkerExecutionResult> {
    const start = Date.now();
    return new Promise<WorkerExecutionResult>((resolve) => {
      try {
        const url = new URL(endpoint);
        const postData = JSON.stringify({ prompt, model });

        const req = http.request({
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          },
          timeout: timeoutMs
        }, (res) => {
          let body = '';
          res.setEncoding('utf-8');
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            const durationMs = Date.now() - start;
            try {
              const parsed = JSON.parse(body);
              if (res.statusCode === 200 && parsed.success) {
                return resolve({
                  success: true,
                  output: parsed.output,
                  durationMs
                });
              }

              const errMsg = parsed.error || body;
              const isQuota = isQuotaErrorMessage(errMsg) || res.statusCode === 429;
              const isNetwork = isNetworkErrorMessage(errMsg);
              const resetMs = isQuota ? parseResetDurationMs(errMsg) : undefined;

              return resolve({
                success: false,
                error: errMsg,
                isQuotaExhausted: isQuota,
                isTransient: res.statusCode ? res.statusCode >= 500 : false,
                isNetworkError: isNetwork,
                resetDurationMs: resetMs,
                durationMs
              });
            } catch (parseErr: any) {
              const isQuota = isQuotaErrorMessage(body);
              const isNetwork = isNetworkErrorMessage(body);
              resolve({
                success: false,
                error: `HTTP ${res.statusCode}: ${body.slice(0, 200)}`,
                isQuotaExhausted: isQuota,
                isNetworkError: isNetwork,
                resetDurationMs: isQuota ? parseResetDurationMs(body) : undefined,
                durationMs
              });
            }
          });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({
            success: false,
            error: `Timeout de ${timeoutMs}ms excedido no worker HTTP`,
            isTransient: true,
            durationMs: Date.now() - start
          });
        });

        req.on('error', (err) => {
          resolve({
            success: false,
            error: `Falha de conexão com worker HTTP (${err.message})`,
            isTransient: true,
            isNetworkError: true,
            durationMs: Date.now() - start
          });
        });

        req.write(postData);
        req.end();
      } catch (err: any) {
        resolve({
          success: false,
          error: `Erro ao iniciar requisição HTTP: ${err.message}`,
          isTransient: true,
          isNetworkError: true,
          durationMs: Date.now() - start
        });
      }
    });
  }

  /**
   * Roteia a solicitação do operador com inteligência de circuito, failover e orçamento global de 50s.
   * O tempo gasto no primário é estritamente descontado do secundário para nunca ultrapassar 50s de espera total.
   */
  public async routeRequest(
    prompt: string,
    options?: { maxTurnBudgetMs?: number }
  ): Promise<RouterOutput> {
    const turnBudgetMs = options?.maxTurnBudgetMs ?? GLOBAL_TURN_BUDGET_MS;
    const totalStart = Date.now();
    this.refreshCircuitStates();

    let workerChosen: 'primary' | 'secondary' | 'none' = 'none';
    let motor: 'AGY_PRIMARY' | 'AGY_SECONDARY' | 'FALLBACK_API' = 'FALLBACK_API';
    let swapReason: 'PRIMARY_QUOTA_EXHAUSTED' | 'PRIMARY_TIMEOUT' | 'PRIMARY_ERROR' | 'PROBE' | null = null;
    let finalErrorType: TurnWorkerTelemetry['errorType'] = null;

    // 1. TENTATIVA NO WORKER PRIMÁRIO
    const canTryPrimary = this.primaryCircuit.state === 'CLOSED' ||
      (this.primaryCircuit.state === 'HALF_OPEN' && !this.primaryCircuit.activeProbe);

    if (canTryPrimary) {
      if (this.primaryCircuit.state === 'HALF_OPEN') {
        this.primaryCircuit.activeProbe = true;
        swapReason = 'PROBE';
      }

      this.primaryCircuit.totalCalls++;
      workerChosen = 'primary';
      motor = 'AGY_PRIMARY';

      // Timeout do primário é limitado pelo orçamento total restante do turno
      const primaryEffectiveTimeout = Math.min(this.primaryConfig.timeoutMs, turnBudgetMs);
      const pRes = await this.executeWorker(this.primaryConfig, prompt, primaryEffectiveTimeout);

      if (pRes.success && pRes.output) {
        this.primaryCircuit.state = 'CLOSED';
        this.primaryCircuit.consecutiveFailures = 0;
        this.primaryCircuit.resetTime = undefined;
        this.primaryCircuit.activeProbe = false;

        const durationMs = Date.now() - totalStart;
        const telemetry: TurnWorkerTelemetry = {
          workerChosen: 'primary',
          motor: 'AGY_PRIMARY',
          swapReason,
          durationMs,
          errorType: null,
          circuitStatus: this.getCircuitStatus(),
          responseSource: 'MODEL',
          turnBudgetRemainingMs: Math.max(0, turnBudgetMs - durationMs)
        };

        return {
          success: true,
          rawOutput: pRes.output,
          telemetry,
          usedFallback: false,
          unresolved: false
        };
      }

      // Falha no primário
      this.primaryCircuit.consecutiveFailures++;
      this.primaryCircuit.activeProbe = false;

      if (pRes.isQuotaExhausted) {
        this.primaryCircuit.quotaErrors++;
        this.primaryCircuit.state = 'OPEN';
        const resetMs = pRes.resetDurationMs || 300000;
        this.primaryCircuit.resetTime = Date.now() + resetMs;
        swapReason = 'PRIMARY_QUOTA_EXHAUSTED';
        finalErrorType = 'RESOURCE_EXHAUSTED';
      } else if (pRes.isNetworkError) {
        swapReason = 'PRIMARY_ERROR';
        finalErrorType = 'NETWORK';
      } else if (pRes.isTransient) {
        this.primaryCircuit.transientErrors++;
        swapReason = 'PRIMARY_TIMEOUT';
        finalErrorType = 'TIMEOUT';
      } else {
        swapReason = 'PRIMARY_ERROR';
        finalErrorType = 'PROCESS_ERROR';
      }
    } else {
      swapReason = 'PRIMARY_QUOTA_EXHAUSTED';
      finalErrorType = 'RESOURCE_EXHAUSTED';
    }

    // Calcula tempo gasto até agora e saldo restante do orçamento de turno
    const elapsedSoFar = Date.now() - totalStart;
    const remainingTurnBudgetMs = turnBudgetMs - elapsedSoFar;

    // 2. TENTATIVA NO WORKER SECUNDÁRIO (Failover com tempo residual)
    const canTrySecondary = (this.secondaryCircuit.state === 'CLOSED' ||
      (this.secondaryCircuit.state === 'HALF_OPEN' && !this.secondaryCircuit.activeProbe)) &&
      remainingTurnBudgetMs > 1000; // Pelo menos 1 segundo disponível para chamada

    if (canTrySecondary) {
      if (this.secondaryCircuit.state === 'HALF_OPEN') {
        this.secondaryCircuit.activeProbe = true;
      }

      this.secondaryCircuit.totalCalls++;
      workerChosen = 'secondary';
      motor = 'AGY_SECONDARY';

      // O tempo limite do secundário NUNCA ultrapassa o orçamento restante de 50s!
      const secondaryEffectiveTimeout = Math.min(this.secondaryConfig.timeoutMs, remainingTurnBudgetMs);
      const sRes = await this.executeWorker(this.secondaryConfig, prompt, secondaryEffectiveTimeout);

      if (sRes.success && sRes.output) {
        this.secondaryCircuit.state = 'CLOSED';
        this.secondaryCircuit.consecutiveFailures = 0;
        this.secondaryCircuit.resetTime = undefined;
        this.secondaryCircuit.activeProbe = false;

        const durationMs = Date.now() - totalStart;
        const telemetry: TurnWorkerTelemetry = {
          workerChosen: 'secondary',
          motor: 'AGY_SECONDARY',
          swapReason,
          durationMs,
          errorType: finalErrorType,
          circuitStatus: this.getCircuitStatus(),
          responseSource: 'MODEL',
          turnBudgetRemainingMs: Math.max(0, turnBudgetMs - durationMs)
        };

        return {
          success: true,
          rawOutput: sRes.output,
          telemetry,
          usedFallback: false,
          unresolved: false
        };
      }

      // Falha no secundário
      this.secondaryCircuit.consecutiveFailures++;
      this.secondaryCircuit.activeProbe = false;

      if (sRes.isQuotaExhausted) {
        this.secondaryCircuit.quotaErrors++;
        this.secondaryCircuit.state = 'OPEN';
        const resetMs = sRes.resetDurationMs || 300000;
        this.secondaryCircuit.resetTime = Date.now() + resetMs;
        finalErrorType = 'RESOURCE_EXHAUSTED';
      } else if (sRes.isNetworkError) {
        finalErrorType = 'NETWORK';
      } else if (sRes.isTransient || (Date.now() - totalStart) >= turnBudgetMs) {
        this.secondaryCircuit.transientErrors++;
        finalErrorType = 'TIMEOUT';
      } else {
        finalErrorType = 'PROCESS_ERROR';
      }
    } else if (remainingTurnBudgetMs <= 1000 && !canTrySecondary) {
      // Orçamento de 50s esgotado após o primário
      finalErrorType = 'TIMEOUT';
    }

    // 3. AMBOS WORKERS FALHARAM OU ESGOTARAM O ORÇAMENTO -> FALLBACK DETERMINÍSTICO
    const totalDurationMs = Date.now() - totalStart;
    const { code: errorCode, message: friendlyMessage } = mapErrorToTelemetryCode(finalErrorType);

    const telemetry: TurnWorkerTelemetry = {
      workerChosen: 'none',
      motor: 'FALLBACK_API',
      swapReason,
      durationMs: totalDurationMs,
      errorType: finalErrorType,
      errorCode,
      friendlyMessage,
      circuitStatus: this.getCircuitStatus(),
      responseSource: 'DETERMINISTIC_EXECUTOR',
      turnBudgetRemainingMs: Math.max(0, turnBudgetMs - totalDurationMs)
    };

    return {
      success: false,
      telemetry,
      usedFallback: true,
      unresolved: false
    };
  }
}

// Instância singleton padrão do ecossistema Hydra
export const hydraDualRouter = new DualWorkerRouter();

/**
 * Garante a criação idempotente da tabela de telemetria de turno hydra_turn_telemetry
 */
export function ensureTurnTelemetryTable(db: Database.Database): void {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS hydra_turn_telemetry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        correlation_id TEXT NOT NULL,
        persona TEXT,
        loja_slug TEXT,
        review_decision TEXT,
        replan_count INTEGER DEFAULT 0,
        worker_chosen TEXT,
        latencia_ms INTEGER,
        model_used TEXT,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        total_tokens INTEGER,
        error_code TEXT,
        status TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_turn_telemetry_correlation ON hydra_turn_telemetry(correlation_id);
    `);
  } catch (err: any) {
    console.error('[TELEMETRY] Erro ao criar tabela hydra_turn_telemetry:', err?.message || err);
  }
}

/**
 * Grava telemetria completa de turno: correlationId, persona, lojaSlug, reviewDecision, replanCount, workerChosen, latenciaMs, modelUsed
 */
export function recordTurnTelemetry(db: Database.Database, rec: TurnTelemetryRecord): void {
  ensureTurnTelemetryTable(db);
  try {
    db.prepare(`
      INSERT INTO hydra_turn_telemetry (
        correlation_id, persona, loja_slug, review_decision, replan_count,
        worker_chosen, latencia_ms, model_used, prompt_tokens, completion_tokens,
        total_tokens, error_code, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      rec.correlationId,
      rec.persona || null,
      rec.lojaSlug || null,
      rec.reviewDecision || null,
      rec.replanCount ?? 0,
      rec.workerChosen || 'none',
      rec.latenciaMs ?? 0,
      rec.modelUsed || 'gemini-3.8-flash-low',
      rec.tokens?.prompt ?? null,
      rec.tokens?.completion ?? null,
      rec.tokens?.total ?? null,
      rec.errorCode || null,
      rec.status || 'SUCCESS'
    );
  } catch (err: any) {
    console.error('[TELEMETRY] Erro ao gravar telemetria:', err?.message || err);
  }
}

/**
 * Consulta registro de telemetria por correlationId
 */
export function getTurnTelemetry(db: Database.Database, correlationId: string): TurnTelemetryRecord | null {
  ensureTurnTelemetryTable(db);
  try {
    const row = db.prepare(`
      SELECT correlation_id, persona, loja_slug, review_decision, replan_count,
             worker_chosen, latencia_ms, model_used, prompt_tokens, completion_tokens,
             total_tokens, error_code, status, created_at
      FROM hydra_turn_telemetry
      WHERE correlation_id = ?
      ORDER BY id DESC LIMIT 1
    `).get(correlationId) as any;

    if (!row) return null;
    return {
      correlationId: row.correlation_id,
      persona: row.persona,
      lojaSlug: row.loja_slug,
      reviewDecision: row.review_decision,
      replanCount: row.replan_count,
      workerChosen: row.worker_chosen,
      latenciaMs: row.latencia_ms,
      modelUsed: row.model_used,
      tokens: (row.prompt_tokens != null || row.completion_tokens != null) ? {
        prompt: row.prompt_tokens,
        completion: row.completion_tokens,
        total: row.total_tokens
      } : undefined,
      errorCode: row.error_code,
      status: row.status,
      createdAt: row.created_at
    };
  } catch {
    return null;
  }
}
