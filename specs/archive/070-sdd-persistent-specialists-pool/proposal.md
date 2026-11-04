# Proposal — Spec 070: SDD v2 — Especialistas Persistentes (descobertos no Setup), Ciclo de Issues e Higiene de Commits no Archive

> Evolui a [Spec 041](../041-sdd-alethe-orquestracao-dinamica/proposal.md) (ponte Alethe): os batedores anônimos descartáveis passam a ser **especialistas persistentes**, e o ciclo ganha **issues rastreáveis** e **commits atribuíveis por spec**.

## 1. Resumo Executivo

| Workstream | Entrega | Quem decide / onde mora |
| :--- | :--- | :--- |
| **WS-A — Especialistas persistentes** | Roster de 2–6 especialistas, com memória própria acumulativa, reutilizados a cada ciclo (nunca recriados). | O **`/sdd-setup`** descobre e instala sozinho. `proposal`/`apply`/`archive` só **consomem** o roster (zero papel hardcoded). |
| **WS-B — Ciclo de issues** | `/sdd-proposal` cria as issues (épico + 1 por task); `/sdd-apply` fecha **somente** as comprovadas, com evidência. | `gh` CLI, mapa `specs/<id>/issues.json`, idempotente. |
| **WS-C — Higiene de commits no archive** | 1 commit por spec, só com os arquivos daquela spec, mensagem que descreve aquela spec, validada por lint determinístico. | `changeset.json` gravado no apply + `commit-lint` no archive e em git hook. |

Princípio comum às três: **script coleta e verifica (determinístico), agente conclui (LLM), compilador/linter é o oráculo** — nada de "parece correto".

---

## 2. Evidências Verificadas (estado real do repositório em 04/11/2026)

| # | Fato | Como foi verificado |
| :-- | :--- | :--- |
| E1 | **12 pastas de spec** exibem o mesmo último commit `859a741 feat(046): fix interceptacao de modal changebrand…`: 039–045, `backstudio-lead-triage-pipeline`, `conciliacao-patio-rede-2310`, `deploy-deskcomm-crm-isolated-vps`, `vertex-ai-provider-deskcomm`, `archive`. O commit tocou **61 arquivos** (memória, rules, skills, submódulo e 12 specs). | `git log -1 -- specs/<pasta>` por pasta + `git show --name-only 859a741` |
| E2 | **11 specs** (047, 048, 049, 050, 054, 058–063) + `specs/archive` exibem `38c4a4f feat(067): diagnostico apibrasil…`. | idem |
| E3 | O GitHub mostra, na árvore, o **último commit que tocou cada pasta**. Um commit "varre-tudo" faz dezenas de pastas parecerem cópias umas das outras — é exatamente a percepção de "script/commit em massa". | comportamento da UI + E1/E2 |
| E4 | Causa-raiz no skill: [sdd-archive](file:///C:/Users/User/.gemini/config/skills/sdd-archive/SKILL.md) passo 4–5 faz `Move-Item` + `git add .` + **uma** mensagem escrita para a spec corrente. Tudo que estava sujo (de outras specs) entra junto. | leitura do SKILL.md |
| E5 | **Risco ativo agora**: working tree sujo mistura 3 specs (068: `intent_rewriter.ts`, `tempario_*`; 069: `agent_dispatcher.ts`, 6 arquivos de import `.js`; 070). Um `git add .` hoje geraria mais um commit "varre-tudo". Há ainda `tsconfig.tempario.json` **compartilhado** por 068 e 069 (atribuição ambígua). | `git status -s` |
| E6 | Histórico recente também tem lixo de granularidade: 6+ commits `chore: atualizar ponteiro do hydra-rede` de 08/10; submódulos `projects/hydra-rede` e `projects/infinyx` não inicializados. | `git log`, `git submodule status` |
| E7 | `graphify-out/` está no `.gitignore` (0 arquivos rastreados) e `graph.json` (12,7 MB) traz `community`/`community_name`/`source_file` por nó — sinal estrutural pronto para clusterização. | `git ls-files`, leitura do schema |
| E8 | O Alethe já suporta **sessões retomáveis** (`sessionId` para follow-ups focados) e tiers/quotas; este ambiente também permite **reviver subagente por mensagem** após restart (aviso do sistema). Ou seja: contexto persistente de especialista é viável sem inventar infraestrutura. | `SKILL.md` do Alethe (linhas 29–30, 288) + notice de restart |
| E9 | Numeração de spec colide entre worktrees: o workspace `REDE-BOT` já tem `specs/071-diagnostico-auditoria-chat-link-orcamento-diadema`, enquanto aqui a próxima seria 071. Issues/labels `spec:<id>` precisam de id único. | `Get-ChildItem` nas worktrees do Orca |
| E10 | `gh` 2.98 autenticado (conta `mktfun`), remoto `origin → agente-hydra/hydra-bot`, branch `main`. Pré-requisitos de WS-B atendidos. | `gh auth status`, `git remote -v` |
| E11 | `.agent/memory/domain.md` tem 533 linhas/84 KB — acima do orçamento de contexto das regras. Memória por especialista resolve a diluição. | `Get-ChildItem`, leitura |

---

## 3. WS-A — Especialistas Persistentes

### 3.1 Regra de ouro
> **Skills de ciclo não definem papéis.** Quem define é o `/sdd-setup`, por **evidência do projeto**. Rodar o setup num projeto novo ou já em andamento instala tudo e chega **sozinho** à conclusão de quais especialistas existem.

### 3.2 Descoberta autônoma no `/sdd-setup` (pipeline em 4 estágios)

```
[1 COLETAR]  script determinístico → evidence.json (cada item com id citável)
[2 CONCLUIR] agente líder sintetiza o roster, OBRIGADO a citar ids de evidência
[3 VERIFICAR] script valida schema + cobertura + citações reais (oráculo)
[4 INSTALAR] grava manifestos/memória de forma idempotente (preserva o que já foi aprendido)
```
Se o estágio 3 reprovar, volta ao 2 com a lista de violações (máx. 3 iterações; depois grava o melhor roster válido e marca `confidence: low` no relatório).

**Sinais coletados (estágio 1)** — todos genéricos, nenhum nome de domínio fixo:

| Sinal | Fonte | Uso |
| :--- | :--- | :--- |
| Estrutura | comunidades do `graphify` (`community_name`, `source_file`) agregadas por diretório | fronteiras de código |
| Acoplamento histórico | co-alteração em `git log` (Jaccard sobre os últimos 500 commits) | une pastas que mudam juntas |
| Dependências | `package.json`/`requirements.txt`/`pyproject` mapeadas por `taxonomy.json` genérico (browser-automation, web-server, database, messaging, ui-framework, embeddings, mcp…) | nome/keywords/regras de stack |
| Histórico de specs | títulos + `proposal.md` de `specs/**` (TF-IDF) | vocabulário real do domínio |
| Memória existente | cabeçalhos/entradas de `.agent/memory/*.md` | regras e anti-patterns **com proveniência** (arquivo + data) |
| Operação | arquivos de deploy/CI/scripts (`deploy/`, `scripts/*.sh`, `.github/`) | fronteira infra |

**Conclusão (estágio 2)** — clusterização aglomerativa sobre a matriz de similaridade combinada; `k` entre `kmin` e `kmax` escolhido por coesão/separação; repositório pequeno → `kmin = 2`; grande → `kmax = 6`. Nome/papel vêm dos termos TF-IDF dominantes + categoria de dependência.

**Portões de verificação (estágio 3)** — reprovação = não instala:

| Gate | Critério |
| :--- | :--- |
| G1 Cobertura | ≥ 95 % dos arquivos-fonte rastreados pertencem a ≥ 1 especialista; "sem dono" ≤ 5 % |
| G2 Sobreposição | nenhum par com > 25 % de `filePatterns` em comum |
| G3 Cardinalidade | `kmin ≤ N ≤ kmax` |
| G4 Proveniência | toda `goldenRule`/`forbiddenPattern` cita `evidenceId` existente (entrada de memória datada **ou** âncora `arquivo:linha` que existe). **Sem regra inventada.** Projeto sem histórico → regras vazias com `provenance: stack-default` |
| G5 Estabilidade | `id` determinístico (slug do cluster); reexecução sem mudança no repo → diff vazio |

### 3.3 Instalação idempotente e upgrade de projeto em andamento

`/sdd-setup` detecta o modo pelo `roster.lock.json`:

| Modo | Condição | Comportamento |
| :--- | :--- | :--- |
| `first-run` | sem lock | descobre, instala, **minera** memórias legadas (copia com citação de origem; **não apaga** `domain.md`/`infra.md`) |
| `upgrade` | lock presente, repo mudou | recalcula; propõe `keep/rename/split/merge` com `lineage`; **memória preservada byte a byte** fora dos blocos gerenciados |
| `noop` | sem mudança | nenhuma escrita |
| `migrate` | projeto já usa SDD v1 | instala só o que falta (roster, config, hook, regra) |

Manifestos usam bloco `<!-- sdd:managed:begin/end -->`; o que o humano escrever fora do bloco nunca é sobrescrito. Tudo fica versionado em git (reversível) e documentado em `SETUP_REPORT.md` com as evidências de cada decisão.

### 3.4 Reutilização real — "sem ficar criando agente novo"

A **memória em arquivo é a fonte da verdade**; a conversa/sessão do agente é só **cache quente**.

```
ativar(especialista):
  1. lê .agent/memory/specialists/<id>.md (frio)
  2. registry.local.json tem handle vivo?  → send_message / sessionId (reuso)
  3. handle parado (restart)?               → reviver por mensagem
  4. sem handle ou contexto saturado?       → criar UMA vez, aprimorar com SPECIALIST.md + memória,
                                              registrar handle (singleton por id)
  5. nunca existem 2 instâncias do mesmo id
```
Adoção oportunista: subagentes já existentes (ex.: "VPS Infra & Logs Auditor") são mapeados ao especialista de keywords mais próximas e reviv­idos por mensagem, em vez de duplicados.

### 3.5 Fan-Out / Fan-In nas três fases (agnóstico)

| Fase | Entrada | Fan-Out | Fan-In (volta ao líder) |
| :--- | :--- | :--- | :--- |
| `proposal` | demanda do usuário **numa só porta** (o líder) | casamento determinístico demanda→roster; consulta 1 a 5 especialistas **somente-leitura** (cada um com sua memória) → `scouts/scout_<id>.md` (≤ 40 linhas, âncoras `arquivo:linha` verificadas por script) | líder lê só os scouts e escreve `proposal/design/spec-plan` |
| `apply` | `/sdd-apply <id>` | tasks `[SPECIALIST:<id>]` de arquivos disjuntos em worktree isolada; `[LEAD]` no workspace | líder valida `git apply --check`, integra patches, roda build gate |
| `archive` | `/sdd-archive <id>` | **todos** os participantes devolvem um `memory-delta` | líder (**escritor único**, evita corrida) anexa às memórias, consolida, commita |

Navalha de Ockham (herdada da 041): 0 domínios casados → líder solo + registro de `roster-gap`; 1 domínio → consulta única, sem fan-out; fan-out só com ≥ 2 domínios. Lacunas recorrentes disparam sugestão de `/sdd-setup` (upgrade).

---

## 4. WS-B — Ciclo de Issues (proposal cria · apply resolve)

**`/sdd-proposal`** (após gerar a spec, antes do Hard Stop):
- cria 1 **issue-épico** (`[spec-070] <título>`) + 1 issue por task do `spec-plan.md` (agrupa por especialista se > 12);
- corpo: contexto, arquivos, **critérios de aceite verificáveis** (cada um com comando/assert), dono (`specialist:<id>`), link da spec; labels `spec:070`, `specialist:<id>`, `type:*`;
- **idempotente**: marcador oculto `<!-- sdd:spec=070 task=3 -->`; reexecutar atualiza, não duplica; grava `specs/<id>/issues.json` (task→nº) e `issues.md` (espelho legível);
- **degrada com graça**: sem `gh`/auth/remoto GitHub → só `issues.md` + aviso, sem falhar;
- **scan de segredos** no corpo antes de enviar (`ghp_`, `AKIA`, `eyJ…`, `.env`).

**`/sdd-apply`** (ao concluir cada task):
- "comprovado" = **todos** os critérios de aceite da task têm evidência registrada em `specs/<id>/evidence/<task>.md` (comando, exit code, cauda da saída, `git diff --stat`) **e** o build gate global passou;
- comprovado → comentário com a evidência + `gh issue close --reason completed`;
- parcial → comentário listando lacunas, **issue segue aberta**; 3ª falha → label `blocked`;
- nunca fecha por "parece certo"; o épico fecha quando todas as filhas fecham.

Máquina de estados: `open → in-progress (apply inicia) → closed:completed (evidência) | open+blocked`. O `archive` só **referencia** (`Refs #N` + comentário com o SHA do commit).

---

## 5. WS-C — Higiene de Commits no `/sdd-archive`

**Diagnóstico**: E1–E4. O problema não é "mensagem ruim" apenas; é **atribuição**: o commit não sabe a que spec cada arquivo pertence.

**Solução**:
1. **`changeset.json` gravado no `/sdd-apply`**: baseline (hash de blob por arquivo sujo no início) → ao final, `files = {arquivos cujo blob mudou}` ∖ baseline não tocado. Arquivos sujos no início **e** alterados pela spec (ex.: `tsconfig.tempario.json`) viram `shared`.
2. **Triagem pré-commit no archive** (`git status --porcelain` → 3 baldes): **A** da spec corrente (entra), **B** de outras specs com changeset próprio (**nunca** entra), **C** órfãos (relatório; nunca varre). `shared` → para e pede decisão (incluir / excluir / `git add -p`).
3. **Staging explícito**: `git add -- <paths>`; **proibidos** `git add .`, `-A`, `-a`, `--no-verify`. Gate: `git diff --cached --name-only` ≡ changeset exato; senão `git reset` e aborta.
4. **Um commit por spec** (`--batch` explícito para deploy em massa: `chore: batch deploy specs 047-063` listando as specs no corpo). Spec grande pode declarar `groups[]` → um commit por grupo.
5. **`git mv`** (não `Move-Item`) para `specs/archive/<id>`: a árvore passa a mostrar o commit **daquela** spec em cada pasta.
6. **Mensagem gerada de evidências, não digitada**: `type(<id>): <resumo imperativo ≤72>` derivado do H1 do `proposal.md`; corpo = Problema / Solução / Evidência (build gate + harness) / `Refs #N` / `Specialists:` / `Spec:`. Tipo (`feat|fix|docs|refactor|test|chore`) inferido do plano.
7. **`commit-lint` determinístico** (reprova e corrige, sem bypass): escopo == id da spec · assunto ≠ qualquer dos últimos 200 (exato ou similaridade > 0,85) · ≥ 2 termos significativos do título da spec no assunto · staged == changeset · ≤ 1 spec por commit (exceto `--batch`) · scan de segredos · corpo com linha de evidência.
8. **Commits auxiliares separados**: ponteiro de submódulo → `chore(<submodule>): bump pointer`; `graphify-out/` segue ignorado (E7).
9. **Push dinâmico** (`git push origin <branch-atual>`; nunca `--force`).
10. **`sdd-archive --audit-log`** (somente leitura): lista pastas cujo último commit não pertence à spec → `specs/archive/COMMIT_AUDIT.md` (reproduz o diagnóstico E1/E2 sob demanda).
11. **Hook `commit-msg` vendorizado** em `.githooks/` (instalado pelo setup via `core.hooksPath`): `enforce` durante archive, `warn` em commits manuais (configurável).

> Histórico já poluído **não é reescrito** (sem `filter-repo`/force-push sem consentimento explícito). A correção é *forward-only*: cada pasta passa a mostrar o commit certo no próximo toque legítimo.

---

## 6. Contratos de Dados (fonte da verdade: JSON Schema em `sdd-*/schemas/`)

`evidence.json` · `roster.lock.json` · `registry.local.json` (gitignored; handles são locais) · `scout.md` (front-matter validado) · `issues.json` · `evidence/<task>.md` · `changeset.json` · `memory-delta.md` · `.agent/sdd.config.json` (flags `specialists`, `issues`, `commitPolicy`, `hookMode`). Interfaces TypeScript completas no [design.md](./design.md).

---

## 7. Critérios de Aceite (mensuráveis)

| ID | Critério | Prova |
| :-- | :--- | :--- |
| A1 | Setup neste repo conclui 3–6 especialistas, G1–G5 verdes, 100 % das regras com proveniência existente | `verify_roster` exit 0 |
| A2 | Reexecutar setup sem mudança → diff vazio; com nova pasta → `upgrade` preserva memória byte a byte fora do bloco gerenciado | teste de fixture |
| A3 | Repo vazio (só `package.json`) → ≥ 2 especialistas por stack, **0 regras inventadas** | fixture |
| A4 | Segundo `proposal` no mesmo domínio: `spawns = 0`, `activations ≥ 1` | `registry.local.json` |
| A5 | Cada scout ≤ 40 linhas e 100 % das âncoras `arquivo:linha` existem | `verify_scout` |
| B1 | Proposal cria épico + N filhas; reexecução cria **0 duplicadas** | fixture com `gh` simulado |
| B2 | Apply fecha só tasks com `evidence/<task>.md`; sem evidência a issue segue aberta com comentário | idem |
| B3 | Sem `gh`/auth → degrada para `issues.md`, exit 0 | idem |
| B4 | Nenhum corpo de issue/commit contém padrão de segredo | scan |
| C1 | Fixture com 3 specs sujas: archive de uma gera commit **só** com o changeset dela | `git show --name-only` ∩ outras = ∅ |
| C2 | Assunto duplicado ou escopo ≠ spec → lint reprova | teste |
| C3 | Log de comandos do archive **não contém** `git add .`/`-A`/`--no-verify` | grep no log |
| C4 | `git log -1 -- specs/archive/<id>` começa com `type(<id>)` em 100 % dos novos archives | `--audit-log` |
| C5 | `shared`/órfão nunca é commitado sem decisão explícita | teste |

---

## 8. Riscos e Mitigações

| Risco | Impacto | Mitigação |
| :--- | :--- | :--- |
| Clusterização ruim (fragmenta/une demais) | roster inútil | gates G1–G3, `kmin/kmax`, 3 iterações, `confidence` no relatório, reversível via git |
| Agente "inventa" regras de domínio | alucina padrões | G4: sem citação de evidência existente → reprova |
| Contexto de especialista satura/envenena | respostas ruins | memória-arquivo como verdade; `compact & rehydrate`; teto 150 linhas/arquivo com consolidação para `_archive/` |
| Issues fechadas antes do commit | issue "resolvida" sem código no `main` | comentário "verificado no workspace, aguardando archive"; archive comenta o SHA; falha de archive → label `needs-commit` |
| Atribuição ambígua de arquivos compartilhados | commit errado | `shared` bloqueia e pergunta; nunca adivinha |
| Conflito de patches entre especialistas | merge quebrado | só arquivos disjuntos em paralelo; `git apply --check`; compartilhados = `[LEAD]` |
| Regra `ia.md` proíbe subagentes "descontrolados" | choque de política | setup grava bloco gerenciado: roster persistente é **permitido**, não-recursivo, teto de concorrência 3–5, autoridade única do líder |
| Colisão de id entre worktrees (E9) | issues/labels duplicados | alocar `max(id)+1` considerando `git worktree list` |
| Skills globais dependem de runtime do projeto | quebra em outras máquinas | scripts em Node stdlib puro (`.mjs`, `@ts-check`), zero dependências; hook vendorizado |
| Segredo vazando em issue/commit | exposição | scan obrigatório; `.env*` já no `.gitignore` |

## 9. Fora de Escopo
Reescrita de histórico (`filter-repo`/force-push) · recursão de especialistas · execução remota via Orca (`--on`) · UI própria · alteração de `sdd-debug`.

## 10. Hard Stop
Proposal refinado; nenhum arquivo fora de `specs/070-…/` foi alterado. Aguardar `/sdd-apply 070`.
