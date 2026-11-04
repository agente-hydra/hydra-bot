# Spec 060 — Proposta: Resolução Definitiva de Captcha e Streaming em Tempo Real para Login Remoto na VPS

**ID da Spec:** `060-hydra-rede-captcha-bypass-live-auth`  
**Data:** 03/11/2026  
**Status:** PROPOSTA / RFC EM AVALIAÇÃO  
**Autores:** DeepMind Agentic Pair (Antigravity) & Engenharia Operacional Tork  
**Workspace:** `C:\Users\User\Desktop\agy` e `C:\Users\User\orca\workspaces\VRM\REDE-BOT`  
**Host de Produção:** Servidor Local On-Premise (`100.126.50.101` via Tailscale, Vivo Fibra São Bernardo do Campo / SP)

---

## 1. Contexto e Problema Operacional

O ecossistema Hydra Rede é responsável pela extração diária de dados contábeis, taxas e juros de 10 estabelecimentos comerciais no portal Meu Rede (`meu.userede.com.br`) para viabilizar o Mapa de Metas e a Conciliação Pátio x Rede das 08:00 AM. O servidor de execução é uma máquina local no ABC Paulista conectada via Vivo Fibra (IP público `200.232.213.226`).

Nas últimas semanas, dois problemas recorrentes e impeditivos foram reportados:
1. **Queda Constante em Captcha:** O portal Meu Rede implementou Akamai Bot Manager aliado a reCAPTCHA Enterprise. Mesmo com IP local da Vivo Fibra, o invisible-playwright sofreu timeout e o fallback em Playwright headless padrão foi detectado imediatamente (`navigator.webdriver = true` e assinaturas CDP), disparando HTTP 403 (`POST /security/authorize`). Como a sessão expira diariamente por inatividade, todo dia o bot é obrigado a tentar login e cai no captcha.
2. **Ponte Interativa Inoperante e Travada (`/rede-auth`):** O link de auxílio manual (`rede_interactive_auth.py` rodando no PM2) utiliza um servidor HTTP Python monothread síncrono com polling de JPEG. Quando o operador acessa o link pelo celular ou computador:
   - A imagem fica completamente congelada sem atualizar em tempo real.
   - O clique na tela não responde ou trava o processo por mais de 5 segundos (`the page did not handle mouse event within 5s`).
   - O frontend entra em trava `busy = true` e cancela as requisições de atualização de tela.
   - O login não é concluído, forçando atrasos no despacho matinal oficial.

---

## 2. Solução Proposta

A solução é composta por dois pilares integrados que atacam as causas raízes de forma definitiva:

### Pilar 1: Sessão Permanente Anti-Captcha (Keep-Alive Daemon)
Em vez de permitir que os cookies de autenticação expirem diariamente forçando novos logins em horários críticos:
- **Daemon de Manutenção Ativa (`rede_session_keeper.js`):** Um processo leve no PM2 realiza requisições de heartbeat a cada 15 a 20 minutos com jitter temporal e rotação de endpoints leves (`/home`, `/relatorio`).
- **Persistência Criptografada de `storageState_rede.json`:** Os tokens e cookies renovados são gravados atomicamente.
- **Resultado:** A sessão permanece eternamente ativa no portal. O crawler executa suas extrações na madrugada sem nunca passar pela tela de login e sem enfrentar reCAPTCHAs.
- **Fallback Automatizado com Solver API (CapSolver / 2Captcha):** Caso uma invalidação imprevista ocorra, o crawler integra um adaptador que extrai a `sitekey` do reCAPTCHA Enterprise, solicita o token resolvido via API e injeta o `g-recaptcha-response` automaticamente, sem intervenção humana.

### Pilar 2: Nova Ponte Remota com Streaming Fluido 30-60 FPS (Xvfb + noVNC + CDP)
Substituir o script Python monothread `rede_interactive_auth.py` pela arquitetura comprovada da indústria:
- **Display Virtual Xvfb (`:99`) + Chrome Headed:** O navegador roda em modo visual (headed) dentro de uma tela virtual Linux na VPS, o que aumenta drasticamente a pontuação de confiança no Akamai em comparação ao headless.
- **noVNC sobre WebSockets:** Transmissão em tempo real de vídeo/canvas a 30-60 FPS direto para o navegador ou celular do operador via protocolo RFB/WebSocket.
- **Interação Tátil/Mouse Nativa:** Toques na tela do celular são traduzidos diretamente para eventos de entrada do X11, garantindo latência inferior a 50ms e zero travamento por locks de Playwright.
- **Conexão CDP com Auto-Finalização:** O Playwright se conecta via `chromium.connectOverCDP('http://127.0.0.1:9222')`, preenche automaticamente as credenciais, e apenas aguarda o operador marcar o reCAPTCHA. Assim que o painel `/home` é alcançado, o Playwright salva o `storageState_rede.json` e encerra a ponte com sucesso.

---

## 3. Contratos de Dados e Interfaces Principais

### 3.1. Estado do Keep-Alive (`data/session_keeper_status.json`)
```typescript
export interface SessionKeeperStatus {
  readonly status: 'ACTIVE' | 'EXPIRED' | 'REFRESHING' | 'ERROR';
  readonly lastHeartbeat: string;
  readonly lastHttpResponse: number;
  readonly cookiesCount: number;
  readonly consecutiveFailures: number;
  readonly sessionAgeHours: number;
  readonly nextScheduledPing: string;
}
```

### 3.2. Contrato da Ponte de Autenticação Remota
```typescript
export interface LiveAuthBridgeConfig {
  readonly display: string; // Ex: ":99"
  readonly vncPort: number; // 5900 (apenas localhost)
  readonly webPort: number; // 6080 (servido via Traefik em https://bot.tork.services/rede-auth)
  readonly cdpPort: number; // 9222 (apenas localhost)
  readonly timeoutMinutes: number; // 15 minutos de inatividade
}

export interface LiveAuthResult {
  readonly success: boolean;
  readonly authenticatedAt?: string;
  readonly cookiesCount?: number;
  readonly storageStatePath: string;
  readonly error?: string;
}
```

---

## 4. Análise de Riscos e Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| **Exposição de portas VNC/CDP na internet** | Alto | VNC (`5900`) e CDP (`9222`) são vinculados **estritamente a `127.0.0.1`**. O acesso web ao noVNC ocorre via Traefik com proxy reverso seguro e autenticação por token ou Basic Auth. |
| **Consumo de memória por processos Xvfb e Chrome zumbis** | Médio | Gerenciamento de ciclo de vida com auto-cleanup (desliga o Xvfb e o Chrome após a sessão ser salva ou por timeout de 15 minutos). |
| **CapSolver API fora do ar ou sem saldo** | Baixo | O solver automático é apenas a camada 3 de redundância (a camada 1 é o Keep-Alive que evita 99% dos logins, e a camada 2 é a ponte fluida noVNC para intervenção manual). |

---

## 5. Próximos Passos (Ciclo SDD)

A proposta técnica e os requisitos foram formulados.  
Para detalhar os componentes e a arquitetura física: consulte [`design.md`](file:///C:/Users/User/Desktop/agy/specs/060-hydra-rede-captcha-bypass-live-auth/design.md).
