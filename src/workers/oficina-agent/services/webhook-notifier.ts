import { config } from 'dotenv';
config();

const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL;

// Cache simples para deduplicação (em memória, reinicia se o worker cair)
// Chave: string que identifica a OS ou métrica. Valor: timestamp do último disparo
const alertCache = new Map<string, number>();
const DEDUP_MS = 24 * 60 * 60 * 1000; // 24 horas

export interface AlertPayload {
  alert_type: 'anomaly_detected';
  severity: 'high' | 'medium' | 'low';
  source: 'oficina_worker_ondemand';
  reference_id: string; // Ex: numero da OS
  details: {
    expected_supabase: any;
    found_ui: any;
    diff_description: string;
  };
  evidence_url?: string;
}

export async function sendIncongruenceAlert(payload: AlertPayload): Promise<boolean> {
  const cacheKey = `${payload.alert_type}_${payload.reference_id}`;
  const lastFired = alertCache.get(cacheKey);
  const now = Date.now();

  if (lastFired && (now - lastFired) < DEDUP_MS) {
    console.log(`[Alert Webhook] Alerta suprimido por deduplicação (24h): ${cacheKey}`);
    return false;
  }

  if (!ALERT_WEBHOOK_URL) {
    console.log(`[Alert Webhook] (DRY RUN) Incongruência detectada, mas ALERT_WEBHOOK_URL não está configurado:`, JSON.stringify(payload, null, 2));
    alertCache.set(cacheKey, now);
    return false;
  }

  try {
    const res = await fetch(ALERT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
       console.error(`[Alert Webhook] Falha ao disparar webhook: ${res.statusText}`);
       return false;
    }

    console.log(`[Alert Webhook] ✅ Alerta enviado com sucesso para ${cacheKey}`);
    alertCache.set(cacheKey, now);
    return true;

  } catch (err) {
    console.error(`[Alert Webhook] Erro fatal ao disparar webhook:`, err);
    return false;
  }
}
