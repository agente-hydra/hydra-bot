# Infra Memory — AGY Workspace
> Criado em: 2026-09-11. Atualizado pelo /vibe-archive após cada feature.
> Contém: Deploy, VPS, SSH, DNS, Cloudflare, domínios, CI/CD, variáveis de ambiente.

<!-- Entradas adicionadas pelo /vibe-archive -->

## [2026-10-06] — [Infra: Agendador de Tarefas Hydra Pátio & OS (Windows Task Scheduler)]
**Contexto:** Configuração inicial no Windows (DEPRECADO).
**Status:** MIGRADO PARA VPS LINUX EM 2026-10-08.
**Regra aprendida:** O Agendador de Tarefas do Windows depende da máquina do usuário estar ligada e conectada, o que quebra relatórios matinais caso a máquina esteja suspensa. Foi 100% substituído por cron nativo na VPS.

## [2026-10-22] — [Feature ID: fix-patio-stale-crawler-and-zero-balance]
**Contexto:** Diagnóstico e recuperação da defasagem de 25h no Deep Crawler de Pátio que zerou os pagamentos D-1 (`PAGAMENTOS: "—"`) nas 10 lojas do ERP Oficina Inteligente e derrubou a Conciliação Pátio x Rede para 14%. Implementação de locks desacoplados e gate determinístico anti-vacuidade.
**Regra aprendida:**
1. **Desacoplamento de Locks do Crawler Diário:** `run-hydra-daily-full.sh` utiliza `/tmp/hydra-deep-crawler.lock`. O lock antigo `/tmp/hydra-data-refresh.lock` causava contenção com o worker de metas horárias (`run-hydra-hourly-finance.sh`), impedindo a conclusão dos crawls matinais.
2. **Gate de Qualidade & Não-Vacuidade da Conciliação:** Função `validarQualidadeConciliacao` no `run_unified_morning_dispatch.js` bloqueia incondicionalmente o despacho à diretoria/financeiro caso a acurácia seja `< 20%` com receita > R$ 5.000 ou se 4+ lojas estiverem com pátio zerado, emitindo alerta prioritário para o Dev (`11996242812`).
3. **Reconciliação Cirúrgica em Tempo Real:** O Deep Crawler detecta deltas de faturamento durante a execução do lote de 10 lojas e re-extrai cirurgicamente a loja divergente antes de consolidar `extracao_mes.json` e o banco SQLite.
4. **Sucesso Operacional Validado:** Após reprocessamento, o Pátio subiu de R$ 0 para R$ 46.035,82 recebidos e a Conciliação Pátio x Rede alcançou 97,5% de acurácia global (22 transações casadas, R$ 38.755,74 conciliados e 9/10 lojas com 100%).
**Risco identificado:** Execuções manuais do crawler sobrepondo horários de abertura de caixa no ERP podem encontrar faturamento flutuante caso não utilizem o double-check pós-crawl.
**Não fazer:** Nunca liberar envio matinal para diretoria/financeiro sem validação de sanidade contra dados stale; nunca compartilhar o mesmo arquivo de lock entre processos com janelas de execução e finalidades distintas.

## [2026-10-22] — [Feature ID: hydra-rede-incident-2026-10-21-remediation-and-containment]
**Contexto:** Remediação do incidente da Rede de 21/10/2026, contenção definitiva contra timeouts de reCAPTCHA/WAF e isolamento de processos na VPS.
**Regra aprendida:**
1. **Sessão Persistente & reCAPTCHA:** O portal da Rede ativou reCAPTCHA v2 e verificação Akamai. A solução definitiva utiliza storageState persistente (`data/storageState_rede.json`) com resolução automática do frame `#recaptcha-anchor` ou ponte remota segura (`rede_session_bridge.js`) para intervenção manual em caso de desafio de imagem.
2. **Encadeamento de Release e Symlinks:** O script `run-hydra-hourly-finance.sh` depende de `tsx`. O symlink `/home/operacional/hydra/node_modules -> /home/operacional/hydra-deploy/current/node_modules` é obrigatório para evitar falha `MODULE_NOT_FOUND` de módulos compartilhados.
3. **Limpeza de Scripts Ad-Hoc:** Scripts de teste e inspeção pontuais (`.cjs`) nunca devem permanecer na raiz do projeto; devem ser mantidos exclusivamente em `.tmp/` ou pastas de teste controladas.
**Risco identificado:** Se o storageState expirar e o reCAPTCHA exigir resolução visual por imagens, o scraper headless pode reter o envio matinal.
**Não fazer:** Nunca definir `headless: false` em ambiente Linux sem servidor X11; nunca modificar scripts em produção sem versionamento atômico.

## [2026-10-23] — [Feature ID: 031-playwright-anti-flakiness-robustez-rede]
**Contexto:** Refatoração e blindagem da infraestrutura de automação Playwright do portal Meu Rede (`hydra-rede`), eliminando flakiness e instabilidade com base nos 5 pilares estratégicos da Spec 031 e auditoria técnica de produção.
**Regra aprendida:**
1. **Fim dos Timeouts Estáticos & Auto-Waiting:** Banimento completo de `page.waitForTimeout()`. Toda interação sensível a hidratação de SPA (como a troca de estabelecimentos) utiliza `expectToPass` com `locator.or()` cobrindo o cabeçalho moderno (`header-bar` e drawer lateral `#c-header-drawer`) e clássico (`#nav-config` e `.c-header__button`), com auto-retry ativo de até 25s.
2. **Reciclagem de Página por Loja:** Criar uma nova aba (`context.newPage()`) e fechar (`page.close()`) a cada iteração do loop de 10 lojas elimina o acúmulo de nós no DOM e vazamento de memória RAM, mantendo o consumo estável em ~190 MB (vs >1.2 GB anteriormente).
3. **Playwright Tracing por Chunks:** O tracing é iniciado uma vez no contexto (`context.tracing.start({ screenshots: true, snapshots: true })`) e fatiado por loja com `context.tracing.startChunk({ title })`. No sucesso, `stopChunk()` é chamado sem argumentos para descartar o chunk em memória sem erro de tipagem; em exceções, `stopChunk({ path })` gera o `trace_${ec}_erro.zip` direcionado para auditoria.
4. **Validação Intra-Lógica In-Flight (`src/intra_extraction_validator.js`):** Validação imediata do arquivo baixado em memória: zero-byte check, assinatura ZIP/XLSX (`PK\x03\x04`), **EC Identity Guard** (busca do EC nas primeiras 15 linhas) e **Anti-Duplicação Condicional** (hash SHA-256 ativado exclusivamente para arquivos com mais de 5 linhas e EC divergente, prevenindo falso-positivo em feriados e domingos).
5. **Heartbeat Vespertino (19:15 PM) & Stale Data Gate (16h):** `src/run_evening_heartbeat.js` roda às 19:15 PM no crontab da VPS para pré-extrair as vendas consolidadas e testar preventivamente a sessão do portal. O Stale Data Gate em `patio_hydra_bot_adapter.js` foi aumentado de 12h para 16h para permitir que a carga das 19:15 passe tranquilamente no despacho matinal das 07:45/08:00 AM. Se o reCAPTCHA travar o login, um alerta imediato no WhatsApp do desenvolvedor é disparado pela instância `hydra`.
6. **Contingência Local Windows Desktop (`scripts/run_local_emergency.bat`):** Permite extração rápida na máquina local do operador com Chrome visível (`headless: false`) e realiza **Sincronização Quádrupla via SCP** (`Juros*.xlsx`, `Conciliacao*.xlsx`, `logs/audit_*.json` e `data/state_*.json`), liberando o Audit Gate da VPS sem necessidade de reprocessamento.
**Não fazer:**
- Nunca usar `stopChunk({ path: null })` ou `{ force: true }` em elementos que sofrem re-renderização Angular.
- Nunca aplicar trava de colisão de hash SHA-256 de forma cega em planilhas vazias ou sem dados.
- Nunca usar instâncias de WhatsApp de gerentes de loja para disparos de alerta ou relatórios — APENAS `hydra` e `atendimento`.

## [2026-10-23] — [Bugfix: Correção de Datas D-1 na Rede, Novo Layout SPA e Conciliação Pátio x Rede]
**Contexto:** O relatório matinal de Juros Rede e Conciliação do dia 23/10 falhou ao puxar dados do dia 21/10 em vez de 22/10, gerando conciliação com 0% de acurácia. Além disso, o portal Meu Rede atualizou o cabeçalho para um novo componente SPA (`header-bar` com drawer lateral).
**Regra aprendida:**
1. **Janela de Datas no Noturno e Matinal:** O `run_nightly_prep.js` e o `run_unified_morning_dispatch.js` devem sempre passar explicitamente `--data=${janela.dataInicioBR}` ao invocar `node src/index.js --build-only --now`. Sem `--data`, o `index.js` resolvia `new Date()` no dia D-1 (23:00) como ontem (21/10), gerando o arquivo errado que era então espelhado para a data de entrega matinal.
2. **Espelhamento Canônico:** O arquivo gerado para a data contábil `Juros Rede - 22-10-2026.xlsx` deve ser espelhado como `Juros Rede - 23-10-2026.xlsx` para manter conformidade com o despachador matinal.
3. **Suporte Dual ao Header Meu Rede:** O portal Rede possui 2 layouts ativos: o clássico (`#nav-config` / `a.changebrand`) e o novo (`header-bar`, `.c-header__button`, drawer lateral `#c-header-drawer` com `#main-button-change-establishment`). O automator Playwright (`src/scraper.js`) deve suportar ambos com detecção reativa e manter intacto o lightbox `.modalchangebrand`.
4. **Filtro Estrito na Fila de Downloads:** A API `downloads/queue` da Rede pode retornar relatórios de recebimentos antigos. O scraper deve filtrar estritamente por `x.fileName.includes('Rel_Vendas')` para nunca ingerir planilhas corrompidas ou de outro tipo.
5. **Quality Gate da Conciliação:** `run_unified_morning_dispatch.js` valida se a acurácia é consistente e se as 10 lojas foram processadas antes do envio silencioso ao Financeiro (`5511940667032`).
**Não fazer:**
- Nunca invocar `index.js` sem `--data` dentro de cron jobs que rodam antes da meia-noite (D-1 23:00).
- Nunca permitir que relatórios parciais com 0 matches ou acurácia abaixo da tolerância sejam despachados para o canal da diretoria/financeiro.

## [2026-10-08] — [Infra: Automação Pátio & OS na VPS Linux (Crontab Encadeado)]
**Contexto:** Migração completa da conciliação diária de Pátio & OS para a VPS Linux (`operacional@100.126.50.101`).
**Regra aprendida:**
1. **Encadeamento Pós-Crawler no Cron:** Configurado `15 3 * * * /home/operacional/hydra/scripts/run-hydra-daily-full.sh && /home/operacional/hydra-rede/scripts/run-patio.sh`. O crawler diário unificado roda às 03:15 AM e, assim que finaliza com sucesso (~03:45 AM), dispara imediatamente a conciliação de pátio com os dados frescos de `/home/operacional/hydra-data/crawls/`.
2. **Desacoplamento de Locks:** `run-hydra-daily-full.sh` libera o lock `/tmp/hydra-data-refresh.lock` ao terminar, permitindo que a rotina de pátio processe o ledger e a planilha Excel e aguarde pontualmente as 08:00 AM (`Timer Guard`) sem bloquear os workers de financeiro horários das 04:00, 05:00, 06:00 e 07:00.
3. **Isolamento de Deploy:** O código reside em `/home/operacional/hydra-rede/` fora da árvore gerenciada pelo `sync.py` (`hydra-deploy`), prevenindo falhas de release drift.
4. **Segurança WhatsApp:** Envio exclusivo via instância `hydra` com fallback de alerta para o Dev (+55 11 99624-2812).


## [2026-10-06] — [Infra: Agendador de Tarefas Hydra Rede (Windows Task Scheduler)]
**Contexto:** Configuração do agendamento matinal silencioso do relatório de juros da Rede no Windows.
**Regra aprendida:**
1. Task Scheduler: Tarefa `\Hydra-Rede-Juros-Diario` agendada diariamente às 07:50:00 AM executando `C:\Users\User\Desktop\agy\projects\hydra-rede\run_juros_rede.bat`.
2. Execução Headless: Navegador Playwright Chromium configurado com flags anti-detecção e downloads automáticos em fila S3 sem interface gráfica.
3. WhatsApp Evolution API: Instância `hydra` em `https://evo.tork.services`, disparando documentos em base64 com timeout estendido de 60s.
**Não fazer:**
- Nunca agendar a extração exatamente no minuto do envio (08:00) devido à latência de download da fila S3 da Rede (~3-4 minutos).


## [2026-09-18] — Setup Infinyx (mktfun/infinyx)
**GitHub:** `https://github.com/mktfun/infinyx.git` — Conta: `mktfun` — Token ativo com escopo total `repo`
**Branch padrão:** `main` — HEAD: `5c02866` (feat: parallax stacked cards no Metodo 6D)
**Git identity configurada:** `Antigravity AI <ai@clawhub.com>`
**Git path:** `git` via PATH do usuário (MinGit não encontrado no caminho padrão `C:\Users\admin\...`)
**Graphify:** Indexado com `--code-only` — 580 nós, 715 arestas, 85 comunidades em `graphify-out/graph.json`
**GH CLI auth:** Token via `$env:GH_TOKEN` (ephemeral por sessão) — conta `mktfun` autenticada
**Memória do projeto:** `.agent/memory/` criada em `projects/infinyx/`
