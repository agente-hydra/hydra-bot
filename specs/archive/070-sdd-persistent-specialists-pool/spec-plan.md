# Plano de Execução — Spec 070: SDD v2 (Especialistas Persistentes · Issues · Higiene de Commits)

## Estratégia de Execução
- **Código nasce em `tools/sdd/`** (versionado e testável) e é instalado nas skills globais por `sync_skills.mjs` (hash verificado). Skills globais ficam fora do git, então não são editadas diretamente até a Task 9.
- Ordem: **T0** (fundação) → **T1–T4 em paralelo** (diretórios disjuntos, worktrees isoladas) → **T5–T8** (edição dos 4 `SKILL.md`, arquivos compartilhados → `[LEAD]`, sequencial) → **T9** (instalação) → **T10** (E2E) → **T11** (dogfood do archive).
- Navalha de Ockham: tudo é Node stdlib (`.mjs` + `// @ts-check`); nenhuma dependência nova.
- Cada task só é `[x]` com evidência (comando + exit code) registrada em `specs/070-…/evidence/<task>.md`.

> **Pré-requisito operacional (fora do plano de código):** 068 e 069 estão implementadas e **ainda sem commit**; arquivá-las antes (ou usar `changeset --reconstruct`, T2) evita que o archive de 070 as trate como órfãs (balde C).

---

## Tasks

- [x] [LEAD] **T0 — Fundação `tools/sdd/`**
  - Estrutura `tools/sdd/{sdd-setup,sdd-proposal,sdd-apply,sdd-archive}/{scripts,schemas,tests}` + `tools/sdd/lib/`.
  - `lib/`: `git.mjs` (execFile com array, nunca shell), `secrets.mjs` (R7), `managed-block.mjs` (leitura/escrita de `<!-- sdd:managed -->` preservando bloco humano), `fixtures.mjs` (cria repos git temporários), `schema.mjs` (validador JSON Schema mínimo, sem deps).
  - JSON Schemas: `evidence`, `roster-lock`, `sdd-config`, `scout`, `issues`, `changeset`, `evidence-record`, `memory-delta`.
  - `sync_skills.mjs` (copia + SHA-256) e runner `node --test`.
  - **Aceite:** `node --test tools/sdd` roda (0 testes ainda é ok) e `tsc --noEmit --allowJs --checkJs` verde.

- [x] [PARALLEL: wt-discovery] **T1 — Descoberta de especialistas (WS-A, setup)**
  - Arquivos: `tools/sdd/sdd-setup/{taxonomy.json, scripts/collect_evidence.mjs, scripts/verify_roster.mjs, scripts/install_roster.mjs}` + testes.
  - `collect_evidence`: graphify (agregação por diretório), co-alteração git, dependências→taxonomia, TF-IDF de specs, mineração de memória (com `arquivo#linha`), sinais de ops. Degrada com aviso se graphify indisponível.
  - `verify_roster`: gates G1–G5.
  - `install_roster`: modos `first-run|upgrade|noop|migrate`, bloco gerenciado, `lineage`, mineração de memória **copiando** com origem, `SETUP_REPORT.md`, `--plan` (diff sem escrever).
  - **Aceite:** A1 (neste repo: 3–6 especialistas, G1–G5 verdes), A2 (idempotência + upgrade preserva memória byte a byte), A3 (repo vazio → ≥ 2 por stack, 0 regras inventadas), `fx-ghost-anchor` reprova em G4.

- [x] [PARALLEL: wt-hygiene] **T2 — Higiene de commits (WS-C)**
  - Arquivos: `tools/sdd/sdd-apply/scripts/changeset.mjs`, `tools/sdd/sdd-archive/scripts/{triage,build_commit,commit_lint,audit_log,apply_memory_delta}.mjs`, `tools/sdd/sdd-setup/hooks/commit-msg` + testes.
  - `changeset`: `begin`/`end` (baseline por blob) e `--reconstruct <id>` (spec legada: deriva de arquivos citados nos docs da spec + `git status`, exige confirmação do que for `shared`).
  - `triage`: baldes A/B/C + `NEEDS_DECISION` + `--include/--exclude`.
  - `build_commit`: `git add -- <paths>`, `git mv`, assert `staged == changeset`, mensagem gerada, `groups[]`, `--batch`, auxiliar para submódulo, push `origin <branch>`.
  - `commit_lint`: R1–R8; hook vendorizado reutiliza R1/R3/R7.
  - `audit_log`: gera `COMMIT_AUDIT.md`.
  - **Aceite:** C1–C5. Teste de regressão do problema original (`fx-three-dirty-specs`): archive de A não muda `git log -1 -- specs/B|C`. `fx-dup-subject` reprova. Log de comandos **sem** `git add .`/`-A`/`--no-verify`.

- [x] [PARALLEL: wt-issues] **T3 — Ciclo de issues (WS-B)**
  - Arquivos: `tools/sdd/sdd-proposal/scripts/{sync_issues,next_spec_id}.mjs`, `tools/sdd/sdd-apply/scripts/{record_evidence,close_issues}.mjs` + testes com `gh` simulado (stub no `PATH`).
  - `next_spec_id`: `max(id)+1` considerando `git worktree list` (cobre colisão E9).
  - `sync_issues`: épico + filhas, marcador oculto idempotente, labels sob demanda, scan de segredos, modo `markdown-only` sem `gh`/auth.
  - `record_evidence`/`close_issues`: fecha só com evidência de **todos** os critérios + build gate; parcial → comentário + aberta; falha #3 → `blocked`.
  - **Aceite:** B1–B4 + `fx-no-gh`.

- [x] [PARALLEL: wt-runtime] **T4 — Runtime de especialistas (WS-A, ciclo)**
  - Arquivos: `tools/sdd/sdd-proposal/scripts/{match_roster,verify_scout}.mjs`, `tools/sdd/lib/registry.mjs` + testes.
  - `match_roster`: score `0.45·kw + 0.35·path + 0.20·mem`, k∈[0,5], `roster-gap` quando k=0.
  - `registry`: singleton por id, reuso/reviver/criar-uma-vez/`rehydrate`, contadores `activations/spawns`.
  - `verify_scout`: ≤ 40 linhas + âncoras `arquivo:linha` existentes.
  - **Aceite:** A4 (segundo proposal no mesmo domínio → `spawns = 0`), A5, `fx-ghost-anchor`.

- [x] [LEAD] **T5 — `sdd-setup/SKILL.md` + instalação no projeto**
  - Passos: detectar modo → collect → concluir → verify (≤ 3 iterações) → install; gerar `.agent/sdd.config.json`; `install_hooks.mjs` (`core.hooksPath=.githooks`, lint vendorizado com versão); bloco gerenciado em `.agent/rules/ia.md`; `.gitignore` ← `registry.local.json`.
  - **Aceite:** setup rodado duas vezes seguidas → segundo é `noop` (diff vazio).

- [x] [LEAD] **T6 — `sdd-proposal/SKILL.md`**
  - Passo 0 (`next_spec_id`), 1.1 (match + fan-out somente-leitura + `verify_scout`), 1.2 (fan-in), 2 (spec com `[SPECIALIST:<id>]`/`[LEAD]` e critérios de aceite **com comando**), 2.1 (`sync_issues`). Ajustar a regra "só `.md`" para "`.md` + issues". Hard Stop.
  - **Aceite:** nenhum identificador de domínio do projeto no texto da skill (grep).

- [x] [LEAD] **T7 — `sdd-apply/SKILL.md`**
  - `changeset begin` → execução por especialista (worktree isolada via Alethe) ou líder → `record_evidence` → `git apply --check` + integração → build gate → `close_issues` → `changeset end`. Hard Stop sem commit.
  - **Aceite:** texto sem papéis hardcoded; instruções de auto-healing (3 tentativas) preservadas.

- [x] [LEAD] **T8 — `sdd-archive/SKILL.md` (reescrita)**
  - Fluxo da §5.6 do design; remove `git add .`, `Move-Item` e mensagem manual; adiciona `memory-delta` (escritor único), `--batch`, `--audit-log`, push dinâmico, comentário de SHA nas issues.
  - **Aceite:** `grep -E "git add (\.|-A)|--no-verify|push --force"` no SKILL.md só aparece em seções de **proibição**.

- [x] [LEAD] **T9 — Instalação e espelho de regras**
  - `sync_skills.mjs` → `C:\Users\User\.gemini\config\skills\` (SHA-256 origem==destino).
  - Bloco gerenciado de `ia.md` em `~/.gemini/config/rules/ia.md` e `.agent/rules/ia.md`.
  - **Aceite:** hashes idênticos; `sync_skills --check` verde.

- [x] [LEAD] **T10 — Integração E2E**
  - Rodar o `/sdd-setup` real neste repositório; validar A1 e ler `SETUP_REPORT.md` (confidence, lacunas).
  - Ciclo completo em fixture: proposal (issues) → apply (evidência, fechamento) → archive (commit atribuído).
  - `node --test tools/sdd` 100 % verde; `tsc --noEmit --allowJs --checkJs` sem erros; `sdd-archive --audit-log` neste repo gera `COMMIT_AUDIT.md` reproduzindo E1/E2.
  - **Aceite:** todos os critérios A1–A5, B1–B4, C1–C5 com evidência.

- [x] [LEAD] **T11 — Dogfood (archive de 070 e das pendentes)**
  - Rodar `--reconstruct` para 068/069, confirmar `shared` (`tsconfig.tempario.json`), arquivar 068 → 069 → 070, cada uma com **seu** commit; 070 com `groups[]` (um commit por workstream).
  - **Aceite:** `git log -1 -- specs/archive/068-*`, `…/069-*`, `…/070-*` mostram `type(<id>)` próprio; nenhum commit toca > 1 spec.
