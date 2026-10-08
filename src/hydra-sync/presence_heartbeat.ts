/**
 * src/hydra-sync/presence_heartbeat.ts
 * Gestor de Presença Contínua ("Digitando...") Anti-Flap para WhatsApp (Evolution API).
 * Mantém pulso estável a cada 4 segundos durante processamento de IA/MCP,
 * evitando que o status expire e desapareça da tela do usuário.
 */

export interface PresenceSender {
  sendPresence(phone: string, presence: 'composing' | 'paused', delayMs?: number): Promise<void>;
}

export class PresenceHeartbeatKeeper {
  private static instance: PresenceHeartbeatKeeper | null = null;
  private activeTimers: Map<string, { intervalId: NodeJS.Timeout; timeoutId: NodeJS.Timeout }> = new Map();

  private constructor() {}

  public static getInstance(): PresenceHeartbeatKeeper {
    if (!PresenceHeartbeatKeeper.instance) {
      PresenceHeartbeatKeeper.instance = new PresenceHeartbeatKeeper();
    }
    return PresenceHeartbeatKeeper.instance;
  }

  /**
   * Inicia o pulso contínuo de presença para o número informado.
   * Se já houver um timer ativo para o telefone, reinicia-o de forma limpa.
   */
  public start(
    phone: string,
    sender: PresenceSender,
    intervalMs: number = 4000,
    maxDurationMs: number = 60000
  ): void {
    const cleanPhone = String(phone).replace(/\D/g, '');
    if (!cleanPhone) return;

    // Cancela pulso anterior se existente
    this.stop(cleanPhone);

    // 1. Disparo inicial imediato
    sender.sendPresence(cleanPhone, 'composing', intervalMs).catch(() => {});

    // 2. Loop de repetição periódico
    const intervalId = setInterval(() => {
      sender.sendPresence(cleanPhone, 'composing', intervalMs).catch(() => {});
    }, intervalMs);

    // 3. Trava de segurança compulsória para evitar vazamento em promessas penduradas
    const timeoutId = setTimeout(() => {
      this.stop(cleanPhone);
    }, maxDurationMs);

    this.activeTimers.set(cleanPhone, { intervalId, timeoutId });
  }

  /**
   * Encerra imediatamente o pulso de presença para o número informado.
   */
  public stop(phone: string): void {
    const cleanPhone = String(phone).replace(/\D/g, '');
    if (!cleanPhone) return;

    const timerEntry = this.activeTimers.get(cleanPhone);
    if (timerEntry) {
      clearInterval(timerEntry.intervalId);
      clearTimeout(timerEntry.timeoutId);
      this.activeTimers.delete(cleanPhone);
    }
  }

  /**
   * Verifica se há presença ativa para um telefone.
   */
  public isPhoneActive(phone: string): boolean {
    const cleanPhone = String(phone).replace(/\D/g, '');
    return this.activeTimers.has(cleanPhone);
  }

  /**
   * Para todos os timers (útil para testes unitários ou encerramento do processo).
   */
  public stopAll(): void {
    for (const [phone] of this.activeTimers) {
      this.stop(phone);
    }
  }
}
