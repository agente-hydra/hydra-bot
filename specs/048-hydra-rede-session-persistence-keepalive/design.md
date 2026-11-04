# Design Técnico — Spec 048: Hydra Rede — Persistência Contínua de Sessão, Keep-Alive Inteligente e Prevenção de Logouts na VPS

## 1. Fluxo de Sessão e Linha do Tempo

```mermaid
flowchart TD
    subgraph PM2 Daemon ["VPS PM2 — rede-auth-bridge (24/7)"]
        A["Navegador Chromium Stealth Ativo"] --> B["SessaoKeepAliveDaemon<br/>(Loop a cada 10 a 14 min)"]
        B --> C{"Sessão Autenticada?"}
        C -->|Sim| D["Dispara GET Autenticado<br/>/api/fl2/prd/v1/downloads/queue"]
        D --> E{"HTTP Status?"}
        E -->|200 OK| F["Sliding Window Renovada no Itaú/Rede!"]
        F --> G["context.storageState() gravado em disco<br/>(storageState_rede.json & cookies.json)"]
        G --> H["Agenda próximo pulso com jitter orgânico (10-14m)"]
        
        E -->|401 / 403 / Redirect| I["Marca isAuthenticated = false"]
        I --> J["BLOQUEIA submissão cega headless (Anti-reCAPTCHA)"]
        J --> K["Dispara Alerta Imediato Dev no WhatsApp<br/>(Link https://bot.tork.services/rede-auth)"]
    end

    subgraph Crawler CLI ["Esteira Noturna / Madrugada (05:00 AM)"]
        L["run_nightly_prep.js / index.js"] --> M["Lê storageState_rede.json fresco do disco"]
        M --> N["Abre Contexto Playwright"]
        N --> O["Acessa portal Meu Rede"]
        O --> P{"Sessão Válida?"}
        P -->|Sim (Keep-Alive manteve viva)| Q["Extrai as 10 lojas com sucesso centavo a centavo!"]
        P -->|Não| R["Alerta Dev e encerra limpo sem lock de reCAPTCHA"]
    end
```

---

## 2. Contratos de Dados e Interfaces

### 2.1 Interface do Keep-Alive Status

```typescript
export interface KeepAliveStatus {
  lastPingAt: string | null;
  lastStatus: 'healthy' | 'warning' | 'expired' | 'idle';
  lastHttpStatusCode: number | null;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  nextScheduledPingAt: string | null;
  cookiesCount: number;
  storageStatePath: string;
}

export interface KeepAliveResult {
  ok: boolean;
  statusCode: number;
  durationMs: number;
  url: string;
  error?: string;
}
```

### 2.2 Configuração do Daemon Keep-Alive

```typescript
export interface KeepAliveConfig {
  baseIntervalMs: number; // 12 minutos = 720.000 ms
  jitterMinMs: number;    // -120.000 ms (-2 min)
  jitterMaxMs: number;    // +120.000 ms (+2 min)
  targetEndpoint: string; // 'https://meu.userede.com.br/api/fl2/prd/v1/downloads/queue'
  maxFailuresBeforeAlert: number; // 1 (alerta imediato)
}
```

---

## 3. Módulos a Modificar e Criar

### 3.1 Novo Módulo Modular: `projects/hydra-rede/src/session_keepalive.js`
- Exporta funções limpas e testáveis:
  - `calcularProximoIntervaloComJitter(baseMs, minJitterMs, maxJitterMs): number`
  - `executarPingKeepAlive({ page, context, endpoint }): Promise<KeepAliveResult>`
  - `salvarSessaoAtomica({ context, storagePath, cookiesPath }): Promise<boolean>`
  - `tratarResultadoKeepAlive(result, state, onAlertCallback): KeepAliveStatus`

### 3.2 Modificação em `projects/hydra-rede/src/rede_session_bridge.js`
- **Comportamento atual:** Loop estático que só inspeciona `page.url()` a cada 3s e tenta `fillCredentialsOnly()` ao menor sinal de logout.
- **Novo comportamento:**
  - Remove tentativa de preenchimento e clique forçado de senha quando o status for desconectado.
  - Instancia `iniciarSessaoKeepAlive()` que executa periodicamente enquanto `isAuthenticated === true`.
  - Exibe no dashboard Web (`/rede-auth` e `/api/status`) a telemetria do Keep-Alive (último ping, status, cookies mantidos).
  - Em caso de falha HTTP 401/403, envia alerta preventivo via `enviarAlertaDev` no WhatsApp.

### 3.3 Modificação em `projects/hydra-rede/src/scraper.js`
- Na função `verificarOuLogar(page, context)`:
  - Se a página for redirecionada para a tela de login (`/login` ou formulário de senha visível), **NUNCA** submeter o formulário cegamente.
  - Consultar se a ponte local (`http://127.0.0.1:3899/rede-auth/api/status`) tem uma sessão autenticada recente.
  - Se a sessão expirou, registrar log claro e lançar erro estruturado solicitando reautenticação manual via Web Bridge, impedindo o banimento de IP ou o acionamento de reCAPTCHAs de alta agressividade.

### 3.4 Novo Teste Automatizado: `projects/hydra-rede/tests/test_session_persistence.js`
- Teste unitário abrangente cobrindo:
  1. Cálculo de jitter e distribuição de horários do keep-alive.
  2. Mock de ping bem-sucedido (200 OK) e persistência de cookies/storageState.
  3. Mock de sessão expirada (401/403) acionando alerta preventivo sem reCAPTCHA.
  4. Proteção anti-blind-submit em `scraper.js`.
- Integrar a suíte ao executor mestre `projects/hydra-rede/tests/run_all_tests.js` como Suíte 8.

---

## 4. Análise de Riscos e Mitigações

| Risco | Impacto | Mitigação Arquitetural |
|---|---|---|
| Rede alterar endpoint `/downloads/queue` | Keep-alive receber 404 | Utilizar fallback para toque no DOM via `page.evaluate()` que carrega `/home` sem recarregar a página inteira |
| Reinicialização inesperada do container PM2 | Perda da contagem em memória | Persistência do último timestamp em `data/keepalive_state.json` |
| Spam de alertas no WhatsApp em caso de desconexão prolongada | Incomodar desenvolvedor | Trava de cooldown anti-flood no alerta do WhatsApp (máximo 1 alerta a cada 3 horas por desautenticação) |
| Envio de mensagens usando número de gerente | Violação crítica de segurança | Uso exclusivo da função `enviarAlertaDev` que canaliza exclusivamente pela instância `hydra` |