# Proposta de Engenharia — Spec 079: Reparo Rápido da Rede dentro do Watchdog (AGY CLI + Catálogo Fechado no Invisible Playwright + Contingência Homologada)

## 1. Problema e Contexto Operacional (Evidência Factual de 09/11/2026)

Na manhã de segunda-feira, **09/11/2026**, a esteira da Rede enfrentou três classes distintas de falha que exigiram intervenção de contingência entre 07:30 e 07:41 AM antes do disparo oficial das 08:00 AM:

1. **Bloqueio de Seletor por Tutorial (`joyride-backdrop`):**
   - Na 1ª rodada de extração em `/tmp/rede-0911-4i31woz2/collect_live.log`, ao tentar selecionar **Piraporinha (`EC 47712201`)**, o overlay `.joyride-backdrop` / `.filter-coachmark__overlay` interceptou o clique no seletor de estabelecimentos do cabeçalho (`#nav-config` / `header-bar`), fazendo com que o modal de troca de lojas não abrisse nas 3 tentativas (`Não foi possível localizar o radio-button do EC 47712201`).
2. **Erro de Código / Exportador Sintético:**
   - O `src/scraper.js` apresentava resquício de sintaxe na linha 921 (`acceptDownloads: true` órfão após fechamento de bloco), fazendo `node src/index.js --build-only --now --data=06/11/2026` falhar às 05:00 AM (`nightly_prep_09-11-2026.log`).
   - Adicionalmente, o comando `EXPORT_STORES_BATCH` em `src/invisible/rede_invisible_worker.py:219` continha um fallback que gerava planilhas binárias sintéticas (`generate_binary_rede_xlsx`) caso a coleta viva não estivesse atrelada à fila S3 real do portal.
3. **Limitação Atual do Hook e do Watchdog das 06:00 AM:**
   - Hoje, `src/ai_crawler_healing_hook.js` (`handleCrawlerIncident`) apenas registra o incidente em `ai_crawler_incidents.log` e executa uma `retryFn` cega.
   - O `src/run_morning_watchdog_0600.js` e `src/sanity_gate_patio_rede.js` (`autoHealLojaZerada`) tentam reextrair lojas individualmente, mas não diagnosticam o DOM da sessão ativa nem possuem um executor de reparo tático.

A contingência executada hoje em `/tmp/rede-0911-4i31woz2/collect_live_v2.py` + `validate_live.cjs` + `finish.sh` comprovou que:
- Ao neutralizar `.joyride-backdrop`, abrir o seletor do cabeçalho, confirmar o EC ativo no topo (`EC confirmado no cabecalho: Piraporinha`) e consultar a fila S3 real (`/api/fl2/prd/v1/downloads/queue`), **10/10 ECs reais** foram baixados em 275 segundos (R$ 56.502,87 brutos, R$ 52.641,41 líquidos, 30 transações), promovidos com manifesto e recibo criptográfico válidos e aprovados pelo Auditor AGY antes das 08:00 AM.

---

## 2. Solução Proposta: Reparo Rápido no Caminho do Watchdog

Integrar o **Reparo Rápido da Rede** diretamente no fluxo existente (`ai_crawler_healing_hook.js` e `run_morning_watchdog_0600.js` / `sanity_gate_patio_rede.js`), com **um único ponto de decisão** e **sem adicionar nenhum novo cron**.

Quando o crawler falhar em uma loja ou lote:
1. O **Watchdog / Healing Hook** entrega o incidente estruturado (sanitizado, sem imagens, cookies, tokens ou dados de clientes) ao **AGY CLI** usando a skill versionada **`rede-reparo-rapido`**.
2. O **AGY CLI** lê o log/estado, diagnostica a causa com base em evidência e escolhe **uma única ação de um catálogo fechado** (`ALLOWED_REPAIR_ACTIONS`).
3. O **Executor de Reparo** valida se a ação pertence ao catálogo fechado e a executa **na mesma sessão do Invisible Playwright** (mesmo dono do perfil Firefox persistente), verificando objetivamente o resultado antes de devolver o controle ao fluxo oficial.
4. **Editar código, executar shell arbitrário, rodar JS livre do LLM, alterar crontab ou disparar WhatsApp ficam estritamente fora das permissões do reparo.**

### 2.1 Catálogo Fechado de Ações Autorizadas

| O que aparece no log / DOM | `actionId` Autorizado | Execução Determinística e Verificação |
|---|---|---|
| Clique no seletor interceptado por tutorial conhecido (`joyride-backdrop`, `coachmark`, modal de pesquisa) | `DISMISS_TUTORIAL_AND_RETRY_CLICK` | Injeta neutralização CSS/DOM (`.joyride-backdrop`, `.joyride-step__holder`, `.filter-coachmark__overlay`), fecha botões de tutorial via `SessionGuard.dismiss_known_popups()`, confirma pelo DOM que o seletor do cabeçalho está acessível e repete o clique. |
| Botão mudou de lugar ou de rótulo no cabeçalho/relatório | `INSPECT_AND_CLICK_CANDIDATE` | Inspeciona os controles visíveis por função e nome (`#nav-config`, `header-bar`, `.c-header__button`, `a.description.-Excel`). Clica apenas se houver um único candidato compatível com a etapa e confirma o EC ativo no cabeçalho (`wait_for_function` validando o EC). |
| Exportação travou ou demorou no S3 | `POLL_QUEUE_OR_RESUME_EXPORT` | Consulta a fila oficial `/api/fl2/prd/v1/downloads/queue` antes de pedir nova exportação. Se o item já estiver `DONE` e for novo (`id not in existing_ids`, `pvCode === ec`, `Rel_Vendas`), baixa-o; se não estiver na fila, retoma apenas o EC pendente e exige arquivo novo daquela loja. |
| Sessão caiu ou redirecionou para login | `RECOVER_SESSION_INVISIBLE` | Aciona a recuperação orgânica de sessão já configurada no Invisible (`garantir_sessao_rede` com perfil persistente e `storageState_rede.json`) e confirma acesso ao relatório. Se detectar CAPTCHA visual bloqueante ou MFA (`CHALLENGE_REQUIRED`), encerra como `ESCALATE_ADMIN_AUTH_REQUIRED` para o admin. |
| `SyntaxError`, `MODULE_NOT_FOUND` ou exportador gerando arquivo sintético | `RUN_HOMOLOGATED_CONTINGENCY` | Aciona a **rotina de contingência previamente homologada** (`src/invisible/homologated_contingency_collector.py` + promotor `src/homologated_contingency_promoter.js`, baseados na coleta real de 09/11). Coleta dados reais em diretório de staging isolado, valida 10/10 ECs reais, período exato e promove para produção. Sem versão homologada íntegra, retém o lote e alerta o admin com a causa exata. |

### 2.2 Governança, Autonomia sem Conflito e Prova de Recuperação

- **Skill `rede-reparo-rapido` (`.agents/skills/rede-reparo-rapido/SKILL.md`):**
  - Recebe exclusivamente JSON de texto filtrado: `{ fluxo, etapa, erro, ec, lojaNome, periodo, tentativa, sessionStatus, visibleControls }`.
  - Zero imagens, zero cookies, zero tokens Bearer, zero PII de clientes.
  - Retorna JSON estrito: `{ actionId, evidence, targetControl, confidence, reason }`.
- **Isolamento de Permissões no Executor (`src/rede_fast_repair_engine.js`):**
  - O retorno do AGY é validado contra a whitelist imutável `ALLOWED_REPAIR_ACTIONS`. Qualquer resposta fora do catálogo, tentativa de injeção de comando ou JSON malformado é imediatamente rejeitada (`INVALID_AGY_ACTION_REJECTED`).
- **Uma Sessão, Um Incidente:**
  - Chave canônica de deduplicação: `incidentKey = "${fluxo}:${periodo}:${ec}:${etapa}"`.
  - Lock de sessão única garantindo que Cron, Watchdog e Reparo Rápido passem pelo mesmo dono do perfil Invisible.
  - Limite estrito de **até 2 ações por incidente** (`MAX_ACTIONS_PER_INCIDENT = 2`), cada uma exigindo checagem objetiva de sucesso antes da próxima.
- **A Prova Encerra o Reparo:**
  - Um incidente só é marcado como `RECUPERADO` quando houver **prova material**: arquivo `.xlsx` binário real (`PK\x03\x04`, tamanho > 1KB, não-sintético), EC interno e período conferidos por `processarRelatorioRede` + `validarLojaContraRede`, e manifesto/recibo selados pelo `BatchAuditGuard`.
  - O fluxo oficial recompila os relatórios (`Juros Rede`, `Conciliação Pátio x Rede`), roda a auditoria pré-despacho e respeita o lock de envio. Se faltar evidência perto das 08:00 AM, o Watchdog retém o lote e notifica o admin via instância oficial `hydra`.

---

## 3. Estratégia de Rollout em 3 Fases

1. **Fase 1 — Simulação com os Logs Reais de 09/11:**
   - Reproduzir os 3 cenários reais ocorridos em 09/11 (`joyride-backdrop` em Piraporinha, timeout/fila de exportação S3 e `SyntaxError` / arquivo sintético) em modo dry-run/simulação, validando que a skill `rede-reparo-rapido` e o motor de decisão selecionam a ação exata do catálogo sem executar mutações.
2. **Fase 2 — Teste Isolado com Uma Loja e Testes Adversariais:**
   - Testar fechamento de popup e retomada de timeout exigindo arquivo real.
   - Testar concorrência de dois gatilhos simultâneos (mesmo `incidentKey` / sessão única), rejeição determinística de retorno inválido do AGY (ex: tentativa de rodar shell/editar código) e bloqueio de reaproveitamento de arquivo antigo/sintético.
3. **Fase 3 — Ativação no Matinal da Rede e Homologação da Contingência:**
   - Conectar o ponto único de decisão em `ai_crawler_healing_hook.js` e `run_morning_watchdog_0600.js` / `sanity_gate_patio_rede.js`.
   - Homologar e acoplar a rotina de contingência (`homologated_contingency_collector.py` + `homologated_contingency_promoter.js`) exigindo **10/10 ECs reais, período correto e aprovação integral nos gates**.

---

## 4. Especialistas Envolvidos

- **`specialist-crawler-rede`** (Score: `0.65` — Modo: `single`): Especialista titular responsável pela arquitetura do Invisible Playwright, `SessionGuard`, `BatchAuditGuard`, `ai_crawler_healing_hook.js` e Watchdog Matinal das 06:00 AM.

---

## 5. Riscos e Mitigação

| Risco Identificado | Severidade | Mitigação Determinística |
|---|---|---|
| AGY CLI sugerir ação fora do escopo (ex: editar arquivo ou rodar bash) | Alta | Validação estrita contra enum fechado `ALLOWED_REPAIR_ACTIONS`; o AGY é chamado apenas para classificação/decisão sobre payload textual e nunca executa tools de escrita no reparo. |
| Colisão de processos abrindo o mesmo perfil Firefox simultaneamente | Alta | Lock de proprietário único da sessão Invisible (`single-session-owner`) e deduplicação por `incidentKey = fluxo:periodo:ec:etapa`. |
| Falso positivo de recuperação com arquivo antigo ou sintético | Crítica | Proibição de `generate_binary_rede_xlsx` em produção; exigência de `id` novo na fila S3 ou validação de hash SHA-256 + `mtime` pós-início do reparo + `validarLojaContraRede` + `BatchAuditGuard`. |
| Loop infinito de retentativas atrasando o alerta ao admin | Média | Teto rígido de `MAX_ACTIONS_PER_INCIDENT = 2` e timeout por ação; esgotadas as 2 ações sem prova física do XLSX, o lote é retido e o alerta é enviado via `hydra`. |
