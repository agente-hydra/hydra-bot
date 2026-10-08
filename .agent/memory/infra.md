# Infra Memory — AGY Workspace
> Criado em: 2026-09-11. Atualizado pelo /vibe-archive após cada feature.
> Contém: Deploy, VPS, SSH, DNS, Cloudflare, domínios, CI/CD, variáveis de ambiente.

<!-- Entradas adicionadas pelo /vibe-archive -->

## [2026-10-06] — [Infra: Agendador de Tarefas Hydra Pátio & OS (Windows Task Scheduler)]
**Contexto:** Configuração do agendamento matinal silencioso da conciliação de Pátio e OS no Windows.
**Regra aprendida:**
1. Task Scheduler: Tarefa `\Hydra-Patio-OS-Diario` agendada diariamente às 07:30:00 AM executando `C:\Users\User\Desktop\agy\projects\hydra-rede\run_patio_reconciliation.bat`.
2. Pipeline de Dois Estágios: Às 07:30 AM o crawler Playwright executa a coleta das 10 lojas do Oficina Inteligente e constrói a planilha Excel; o `Timer Guard` trava a thread até 08:00:00 AM, momento em que o envio para a diretoria (`+55 11 94066-7032`) é liberado.
3. Roteamento de Falha: Exceções em qualquer etapa abortam o envio ao cliente e disparam diagnóstico com logs completos para o dev (`+55 11 99624-2812`).

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
