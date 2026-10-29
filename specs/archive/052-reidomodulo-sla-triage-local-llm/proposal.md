# Proposta: Confirmação Privada de Reconexão, Watchdog SLA 5-Min Rei do Módulo e Triagem por LLM Local

**ID da Spec:** `052-reidomodulo-sla-triage-local-llm`  
**Data:** 29/10/2026  
**Status:** PROPOSTA / AGUARDANDO APROVAÇÃO (`/vibe-apply 052-reidomodulo-sla-triage-local-llm`)  
**Target:** VPS Linux Operacional (`100.126.50.101`) / Evolution API v2 (`evo.tork.services`) / Chatwoot (`chat.tork.services`) / Node.js 22 LTS / `llama-server` C++  

---

## 1. Contexto e Dores Operacionais

1. **Ausência de Feedback Direto ao Gerente na Reconexão:**
   - Na implementação do Hub Central de QR Code (Spec 051), quando um gerente ou responsável escaneia o QR Code, a reconexão dispara imediatamente um aviso de sucesso comemorativo no **Grupo Oficial Mecânica TI** (`120363425738307789@g.us`).
   - Porém, o celular da própria loja (`store.phoneCanonical`) não recebe nenhuma mensagem de retorno. O gerente que acabou de apontar a câmera fica sem confirmação em seu próprio chat com a Hydra, sem saber se a sincronização concluiu com sucesso ou se a tela congelou.
   
2. **Gargalo de Atendimento no "Rei do Módulo" (SLA 5 Minutos):**
   - Na unidade especializada **Rei do Módulo** (Chatwoot Inbox 11 / Instância `REI DO MODULO`), o atendente técnico **Rafinha** divide seu tempo entre reparo em bancada (ECUs, TCUs, módulos de injeção, imobilizadores) e atendimento de balcão e WhatsApp.
   - Mensagens críticas de clientes com veículos parados em oficinas parceiras solicitando orçamento, prazo de teste na bancada ou compatibilidade de peças ficam frequentemente sem resposta por mais de 5 a 10 minutos.
   - Quando o cliente espera mais de 5 minutos sem nenhum retorno, a probabilidade de fechamento despenca e o cliente busca concorrentes ou liga cobrando.

3. **Risco de Falsos Positivos e Fadiga de Alertas (Alert Fatigue):**
   - Nem toda mensagem de cliente sem resposta constitui abandono de atendimento:
     - **Encerramentos e Agradecimentos:** Mensagens como *"valeu"*, *"blz"*, *"show"*, *"obrigado"*, *"👍"*, *"combinado"* não exigem réplica humana.
     - **Última Resposta do Atendente:** Conversas onde o próprio Rafinha foi o último a enviar mensagem e o cliente não respondeu mais.
     - **Fluxos Automatizados / Fora de Horário:** Mensagens recebidas na madrugada ou comprovantes enviados após confirmação verbal.
   - Disparar alertas a cada 5 minutos sem entender o padrão da conversa causará saturação, fazendo com que o atendente silencie ou ignore os avisos de SLA.

4. **Estudo de Viabilidade de LLM Local vs. Nuvem:**
   - Enviar cada mensagem de cliente em tempo real para modelos de nuvem como GPT-4 ou Gemini Pro aumenta a latência de rede e infla custos de tokens desnecessariamente.
   - Comunidades especializadas em Edge AI (Reddit `r/LocalLLaMA` e X/Twitter) consagraram Small Language Models (SLMs) de 1B a 2B parâmetros capazes de executar em CPU comum sem exigência de GPU, com latência inferior a 800ms e consumo de RAM abaixo de 1.4 GB.

---

## 2. Solução Proposta em 3 Pilares Estratégicos

### Pilar 1: Confirmação Privada Automática de Reconexão (Loja/Gerente)
- **Gatilho:** No loop sequencial do `watchdog_daemon.js`, assim que o estado da instância transiciona para `open` e existe um incidente ativo em aberto.
- **Ação:** Além de invocar `notifyGroupResolved(store, incident)`, invoca simultaneamente `notifyStoreManagerResolved(store, incident)`.
- **Governança de Mensageria:** Remetente estritamente restrito à instância oficial `hydra` (`5511917837618`). Proibição incondicional de envio usando instâncias de gerentes.
- **Destinatário:** Número oficial da loja cadastrado (`store.phoneCanonical`).
- **Template Anti-Slop:** Mensagem limpa e profissional informando que a sessão foi restabelecida com sucesso, tempo fora do ar e confirmação de retorno operacional dos relatórios e atendimentos.

### Pilar 2: Watchdog de SLA 5-Minutos com Link WhatsApp e Chatwoot
- **Integração no Gateway & Redis Existentes (`/home/operacional/watchdog/`):**
  - Desacoplamento da Inbox 11: Remoção de `IGNORED_INBOXES` em `gateway.js`, mas manutenção estrita em `PROCEDURAL_AUDIT_EXCLUDED_INBOXES` (proibição de auditoria física de elevador/vídeo).
  - Controle de fila de alta performance via Redis ZSET (`reidomodulo_sla:pending`) e chave de metadados (`reidomodulo_sla:conv:<id>`), espelhado na arquitetura madura do `central_sla.js`, porém com janela de 300s (5 min).
  - Tratamento nativo de mídias: Áudios de clientes (`att_type = 1` / `.oga`) e fotos de etiquetas/módulos Bosch/Magneti Marelli (`att_type = 0`) armam o SLA positivamente de forma automática.
- **Correção da Falha Crítica do `waiting_since` do Chatwoot:**
  - O campo nativo `waiting_since` do Chatwoot acumula falsos positivos históricos (conversas antigas retidas apenas com `👍` ou `obrigado`). A triagem determinística em cascata resolve essa falha na raiz, só armando SLA para pendências ativas reais.
- **Critério de Disparo de SLA:**
  1. Estado da conversa no Chatwoot está `open` e não é grupo de WhatsApp (`group_type === 0`).
  2. Última mensagem da conversa foi enviada pelo **cliente** (`message_type === 0`).
  3. Tempo decorrido desde a mensagem do cliente: **≥ 5 minutos** (`now - created_at >= 300.000ms`).
  4. Triagem Inteligente determinou que a mensagem **exige resposta humana** (`requires_reply === true`).
  5. Cooldown e Idempotência: Chave Redis `reidomodulo_sla:alerted:<convId>` (cooldown de 45 min) e persistência SQLite.
- **Conteúdo Obrigatório do Alerta WhatsApp:**
  - 🚨 Selo visual de SLA 5 Minutos.
  - Nome do cliente e telefone formatado.
  - Horário exato do envio da mensagem (`HH:mm:ss`).
  - Tempo de espera decorrido ("Esperando há 5 min").
  - Trecho / citação da última mensagem do cliente (ou indicação de áudio/foto de peça).
  - Motivo identificado pela triagem (ex: "Dúvida sobre prazo de teste na bancada").
  - **Link direto de WhatsApp para conversa imediata:** `https://wa.me/55...`
  - **Link direto para o ticket no Chatwoot:** `https://chat.tork.services/app/accounts/1/conversations/:id`
- **Destino do Alerta:** Enviado via `hydra` diretamente para o WhatsApp do Rafinha (`5511950614929` / `5511950615823`) e grupo de supervisão de TI.

### Pilar 3: Arquitetura de Triagem em Cascata (Cascading Triage) com LLM Local
- **Estudo Comparativo de Modelos Locais (Reddit/X Benchmarks):**
  - **Qwen 2.5 1.5B-Instruct GGUF (Q4_K_M) — ESCOLHIDO:**
    - Tamanho em disco: ~980 MB.
    - Consumo de RAM: ~1.2 GB sob `mlock`.
    - Throughput em 4 vCPUs (sem GPU): 38 a 46 tokens/segundo.
    - Latência de inferência: ~650ms.
    - Compreensão de Português Brasileiro (PT-BR) coloquial e gírias automotivas ("módulo", "bancada", "imob", "chicote", "gravar chave", "reset") superior a modelos equivalentes.
    - Aderência impecável a JSON Schema estruturado.
  - *Llama 3.2 1B-Instruct:* Rápido, porém alucina mais em nuances de gírias e fechamento em português.
  - *Gemma 2 2B:* Excelente raciocínio, porém consome ~1.9 GB em Q4 e exige maior largura de banda de memória, elevando a latência de CPU para ~1.4s.
  - *SmolLM2 1.7B:* Otimizado para inglês; fraco em jargões mecânicos do Brasil.
- **Motor de Inferência Nativo:** `llama-server` (C++ `llama.cpp` compilado com AVX2), rodando como serviço leve local na porta `8081` (`127.0.0.1:8081`).
  - Travado estritamente em 4 threads (`-t 4`), reservando as outras 4 vCPUs da VPS para Node.js, Redis, PostgreSQL e Playwright.
- **Fluxo em Cascata (Cascading Guard):**
  1. **Camada 1 — Heurística Determinística / Regex (<1ms, 0 CPU):** Filtra ~65% das mensagens imediatamente (agradecimentos, emojis isolados, confirmações "ok/blz/show", e mensagens onde o atendente foi o último a falar).
  2. **Camada 2 — SLM Local Qwen 2.5 1.5B (<800ms, R$ 0,00):** Analisa os últimos 3 a 5 turnos de diálogo e retorna JSON estrito (`requires_reply: boolean`, `confidence: number`, `category: string`, `reason: string`).
  3. **Camada 3 — Cloud Fallback (Gemini 2.5 Flash):** Acionada exclusivamente se o servidor local estiver offline ou se a confiança da SLM for inferior a `0.70`.

---

## 3. Contratos de Dados e Exemplos de Mensagens

### 3.1. Template de Reconexão Privada ao Gerente
```text
✅ *[HYDRA INFORMA] WHATSAPP RECONECTADO COM SUCESSO!*

Olá, *{{MANAGER_NAME}}*!

O WhatsApp da sua loja (*{{LOJA_NOME}}*) foi reconectado e já está 100% operacional no sistema.

• *Instância:* `{{INSTANCE_NAME}}`
• *Número:* `{{PHONE}}`
• *Horário de Retorno:* {{HORA_RETORNO}}
• *Tempo Fora do Ar:* {{TEMPO_DURACAO}}

As ordens de serviço, relatórios e conversas com clientes continuam sincronizando normalmente. Obrigado pela rápida conexão!
```

### 3.2. Template de Alerta SLA 5 Minutos (Rei do Módulo)
```text
🚨 *[REI DO MÓDULO] ALERTA DE SLA (5 MIN)*

⚠️ *Cliente aguardando resposta do Rafinha há mais de 5 minutos!*

• *Cliente:* João Silva
• *Telefone:* `+55 11 98765-4321`
• *Horário da Mensagem:* 14:32:15
• *Tempo de Espera:* ⏱️ 5 min

💬 *Última Mensagem do Cliente:*
"Boa tarde Rafinha, conseguiu testar o módulo da Spin na bancada? O carro tá parado aqui na oficina."

🎯 *Classificação:* Orçamento / Prazo de Bancada (Triagem Automática)

📲 *Clique para Responder no WhatsApp:*
👉 https://wa.me/5511987654321

💻 *Abrir no Chatwoot:*
👉 https://chat.tork.services/app/accounts/1/conversations/1234
```

---

## 4. Matriz de Riscos & Mitigações

| Risco | Probabilidade | Impacto | Mitigação Arquitetural |
|---|---|---|---|
| **Spam / Tempestade de Alertas no WhatsApp do Rafinha** | Média | Alto | Trava de Idempotência em SQLite: no máximo 1 alerta por mensagem não respondida. Se o cliente enviar novas mensagens, agrupa no mesmo contexto. |
| **Gargalo de CPU na VPS pelo `llama-server`** | Baixa | Médio | Limitação estrita via flag `-t 4` (4 vCPUs) e prioridade `nice 10`. Sobram 4 vCPUs intactas para Node.js e Redis. |
| **Falsos Positivos em Mensagens Banais** | Média | Médio | Camada 1 Regex Shield filtra instantaneamente "ok", "valeu", "show", "👍", "combinado" com confiança 0.99 sem tocar no modelo. |
| **Queda do Serviço de LLM Local** | Baixa | Baixo | Fallback transparente para Gemini 2.5 Flash na nuvem com timeout de 2.000ms. Zero impacto na continuidade dos alertas. |
| **Violação de Remetente no WhatsApp** | Baixa | Crítico | Validação estrita por software: apenas `hydra` (`5511917837618`) é autorizada a despachar mensagens. Tentativas de envio por instâncias de gerentes são bloqueadas com throw imediato. |

---

## 5. Próximo Passo
Aguardando aprovação via `/vibe-apply 052-reidomodulo-sla-triage-local-llm` para início da implementação.
