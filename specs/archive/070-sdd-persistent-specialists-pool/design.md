# Design Técnico — Spec 070: SDD v2 (Especialistas Persistentes · Issues · Higiene de Commits)

## 1. Princípios de Design
1. **Skills agnósticas**: nenhum `SKILL.md` de ciclo cita domínio de projeto. Eles executam protocolos sobre arquivos que o setup instala.
2. **Coletar → Concluir → Verificar**: script determinístico coleta, agente conclui, script verifica. O verificador é o oráculo.
3. **Memória-arquivo = verdade; sessão do agente = cache.**
4. **Escritor único** para arquivos compartilhados (memória, spec-plan): especialistas devolvem *deltas*; o líder aplica.
5. **Stdlib-only**: scripts em Node ≥ 22 (`.mjs` + `// @ts-check`), sem `npm install`, rodam em qualquer máquina/VPS onde `git`/`gh` existam. Contratos em JSON Schema.
6. **Idempotência e reversibilidade**: tudo versionado em git; reexecução não duplica nem sobrescreve aprendizado.

## 2. Mapa de Arquivos

> **Fonte da verdade versionada**: as skills globais ficam **fora** de qualquer repositório git, então não dá para isolá-las em worktrees nem testá-las com histórico. Todo o código nasce em **`tools/sdd/<skill>/…`** neste repositório (testado, revisável, commitável) e o script `tools/sdd/sync_skills.mjs` instala o resultado em `C:\Users\User\.gemini\config\skills\` verificando hash SHA-256 (origem == destino). A árvore abaixo é o **destino instalado**.

### 2.1 Dentro das skills globais (`C:\Users\User\.gemini\config\skills\`)
```
sdd-setup/
  SKILL.md                      # + passos: roster, config, hook, regra gerenciada
  taxonomy.json                 # dependência -> categoria (genérico, extensível)
  schemas/{evidence,roster-lock,sdd-config}.schema.json
  scripts/
    collect_evidence.mjs        # estágio 1
    verify_roster.mjs           # estágio 3 (gates G1..G5)
    install_roster.mjs          # estágio 4 (idempotente, preserva memória)
    install_hooks.mjs           # .githooks/commit-msg vendorizado + core.hooksPath
sdd-proposal/
  SKILL.md                      # + match de roster, fan-out, issues, alocação de id
  schemas/{scout,issues}.schema.json
  scripts/{match_roster.mjs, verify_scout.mjs, sync_issues.mjs, next_spec_id.mjs}
sdd-apply/
  SKILL.md                      # + fan-out por especialista, changeset, evidência, fechar issues
  schemas/{changeset,evidence-record}.schema.json
  scripts/{changeset.mjs, record_evidence.mjs, close_issues.mjs}
sdd-archive/
  SKILL.md                      # reescrito: triagem, commit atribuído, lint, audit
  schemas/memory-delta.schema.json
  scripts/{triage.mjs, build_commit.mjs, commit_lint.mjs, audit_log.mjs, apply_memory_delta.mjs}
```

### 2.2 No projeto (criado/atualizado por `/sdd-setup`)
```
.agent/
  sdd.config.json                       # flags: specialists, issues, commitPolicy, hookMode
  specialists/
    roster.lock.json                    # versão, hash de evidências, lineage (commitado)
    registry.local.json                 # handles/sessões (GITIGNORED, local à máquina)
    SETUP_REPORT.md                     # decisões + evidências + confidence
    <id>/SPECIALIST.md                  # bloco gerenciado + bloco humano
  memory/specialists/<id>.md            # memória viva (commitada)
  memory/specialists/_archive/<id>.<ano>.md   # consolidação do que passou do teto
  rules/ia.md                           # + bloco gerenciado sobre especialistas persistentes
.githooks/commit-msg                    # lint vendorizado (versão estampada)
specs/<id>/
  scouts/scout_<id>.md
  issues.json  issues.md
  changeset.json
  evidence/<task>.md
```
`.gitignore` recebe `registry.local.json`.

## 3. WS-A — Algoritmos

### 3.1 `collect_evidence.mjs` (estágio 1)
Entrada: raiz do repo. Saída: `evidence.json` (itens `{id, kind, ref, weight, payload}`).
1. `graphify update` (se disponível; senão pula e registra `structure: degraded`). Lê `graphify-out/graph.json` (12,7 MB → `JSON.parse` em memória é aceitável) e agrega nós por **diretório de 2 níveis** → vetor de comunidades por unidade.
2. `git log --name-only -n 500` → matriz de co-alteração; similaridade Jaccard entre unidades.
3. Manifestos de dependência → categorias via `taxonomy.json`.
4. `specs/**/proposal.md` → TF-IDF por spec; termos dominantes por unidade (via arquivos citados).
5. `.agent/memory/*.md` → entradas `## [data] — [...]` com `{arquivo, linhaInicial, data, tema}`.
6. Operação: `deploy/`, `scripts/`, `.github/`, `Dockerfile*`, crons.
Exclusões fixas: `node_modules`, `.git`, `graphify-out`, `.tmp`, artefatos de build, binários.

### 3.2 Síntese (estágio 2, executada pelo agente líder do setup)
Insumo: apenas `evidence.json` + schema. Saída: `roster.proposed.json`. Restrições impostas no prompt e conferidas no estágio 3:
- clusterização aglomerativa sobre `0.4·estrutura + 0.35·coalteração + 0.15·vocabulário + 0.10·deps`; `k` ótimo por coesão/separação em `[kmin,kmax]`;
- todo `goldenRule`/`forbiddenPattern` carrega `evidenceIds[]`;
- `id = "specialist-" + slug(termo dominante + categoria)` (determinístico).

### 3.3 `verify_roster.mjs` (estágio 3) — gates

| Gate | Cálculo | Reprova se |
| :-- | :-- | :-- |
| G1 | arquivos rastreados (`git ls-files`) ∩ `filePatterns` | cobertura < 95 % |
| G2 | interseção entre pares de globs expandidos | > 25 % |
| G3 | contagem | fora de `[kmin,kmax]` |
| G4 | cada `evidenceId` resolve em `evidence.json` e a âncora (`arquivo:linha`/entrada de memória) existe | qualquer citação inexistente |
| G5 | `install --plan` sobre repo inalterado | diff ≠ vazio |
Saída: `{ok, violations[]}`; exit ≠ 0 devolve ao estágio 2.

### 3.4 `install_roster.mjs` (estágio 4) — modos
`first-run | upgrade | noop | migrate` (decididos por `roster.lock.json` + hash de evidências).
- Escreve só dentro de `<!-- sdd:managed:begin -->…<!-- sdd:managed:end -->`.
- `upgrade`: calcula `lineage` (`keep/rename/split/merge`); em split/merge, **concatena** memórias com cabeçalho de origem; nada é descartado.
- Mineração de memória: para cada entrada de `.agent/memory/*.md`, atribui ao especialista de maior sobreposição de `filePatterns`/keywords e **copia** com `Origem: arquivo#linha`. Entradas sem dono vão para `unassigned` no relatório.
- Emite `SETUP_REPORT.md`.

### 3.5 Runtime: `match_roster.mjs` e `registry`
```
score(s, demanda) = 0.45·kw + 0.35·path + 0.20·mem
  kw   = hits normalizados (sem acento/caixa) de s.domainKeywords na demanda
  path = |arquivos citados ∪ vizinhança `graphify query`| ∩ s.filePatterns| / |citados|
  mem  = sobreposição lexical com títulos da memória do especialista
selecionar: score ≥ 0.25 ; k = clamp(|selecionados|, 0..5)
  k = 0 → líder solo + `roster-gap` em registry/gaps ; k = 1 → consulta única ; k ≥ 2 → fan-out
```
`registry.local.json` guarda, por id: `{backend: "agy-subagent"|"alethe-session"|"orca-worker", handle, lastUsed, memoryHash, activations, spawns, status}`. **Invariante**: no máximo 1 handle por id; `spawns` só incrementa em criação inicial ou `rehydrate`.

Compactar & reidratar: se `contextTokens > limite` ou `memoryHash` mudou externamente → grava delta pendente na memória, cria nova sessão primed (`SPECIALIST.md` + memória), troca handle, registra `rehydrate`.

### 3.6 Scouts
Formato (`scout.schema.json`): front-matter `{specialistId, specId, anchors[], complexity}` + corpo ≤ 40 linhas (diagnóstico, recomendação, riscos). `verify_scout.mjs` confere cada âncora `arquivo:linha` (existe e contém o símbolo citado). Scout reprovado é devolvido ao especialista **uma vez**; persistindo, o líder descarta o item e anota a lacuna.

## 4. WS-B — Issues

### 4.1 `sync_issues.mjs` (proposal)
- Entrada: `spec-plan.md` + `proposal.md`. Saída: `issues.json`, `issues.md`.
- Identidade: marcador `<!-- sdd:spec=<id> task=<n> -->` no corpo. Busca prévia: `gh issue list --search "sdd:spec=<id>" --state all --json number,body`. Existe → `gh issue edit`; não existe → `gh issue create`.
- Labels criados sob demanda (`gh label create --force`).
- Épico com checklist `- [ ] #<n>` das filhas.
- Pré-voo: `gh auth status`, remoto GitHub, `scanSecrets(body)`; qualquer falha → modo `markdown-only`.

### 4.2 `record_evidence.mjs` + `close_issues.mjs` (apply)
```
record_evidence(task): executa comandos de aceite (build gate, harness) via execFile(array);
                       grava specs/<id>/evidence/<task>.md {criterion, command, exit, tail, diffstat}
close_issues(spec):   para cada task [x]:
                        todos critérios com exit==0 E build gate global ok ? close : comment(lacunas)
                      falha #3 → label blocked
                      épico fecha quando filhas fecham
```
Comentário de fechamento inclui: critérios ↔ evidência, "verificado no workspace; aguardando `/sdd-archive`".

## 5. WS-C — Higiene de Commits

### 5.1 `changeset.mjs` (apply)
```
início: baseline = { path -> blobSha } para cada arquivo sujo/untracked
fim:    for path in git status --porcelain:
          if path ∉ baseline            → owned
          elif blobSha(path) ≠ baseline → shared   (sujo antes E alterado agora)
        changeset.json = { specId, owned[], shared[], baselineDirty[] , groups? }
```
Tasks podem declarar `files` no plano; divergência entre declarado e real vira aviso no relatório.

### 5.2 `triage.mjs` (archive)
Baldes sobre `git status --porcelain`: **A** = `owned` da spec; **B** = `owned` de qualquer outro `specs/*/changeset.json` ativo; **C** = restante. `shared` ≠ ∅ → exit especial `NEEDS_DECISION` com a lista e 3 opções. Aceita decisão via `--include/--exclude` repetíveis. Nunca inclui B/C.

### 5.3 `build_commit.mjs`
```
paths = A (+ specs/<id>→specs/archive/<id> via `git mv`) (+ memória atualizada desta spec)
git add -- <paths>                                  # NUNCA . / -A / -a
assert set(git diff --cached --name-only) == set(paths ∪ renames)   # senão reset + abort
msg = render(type, id, summary(H1 do proposal), body(Problema/Solução/Evidência/Refs/Specialists/Spec))
commit_lint(msg, staged, changeset, history)         # exit≠0 → corrige a mensagem, repete
git commit -m <msg>                                   # sem --no-verify
```
`type` inferido: `fix` (spec com sdd-debug/root-cause), `docs` (só `.md`), `test`, `refactor`, `chore` (infra/submódulo), default `feat`.

### 5.4 `commit_lint.mjs` — regras

| Regra | Teste |
| :-- | :-- |
| R1 formato | `^(feat\|fix\|docs\|refactor\|test\|chore)\(<id>\): .{10,72}$` |
| R2 escopo | `<id>` == spec do changeset (exceto `--batch`: `chore: batch deploy specs a-b`) |
| R3 unicidade | assunto ≠ dos últimos 200 commits; similaridade (Dice sobre bigramas) ≤ 0,85 |
| R4 relevância | ≥ 2 termos significativos (sem stopwords) do título da spec presentes no assunto |
| R5 staged | `staged == changeset ∪ renames` |
| R6 mono-spec | caminhos `specs/**` de ≤ 1 spec (exceto `--batch`) |
| R7 segredos | regex `ghp_[A-Za-z0-9]{20,}`, `AKIA[0-9A-Z]{16}`, `-----BEGIN .* KEY-----`, `eyJ[A-Za-z0-9_-]{20,}\.`, valores de `.env` |
| R8 evidência | corpo contém linha `Evidência:` com resultado do build gate |
Hook `commit-msg` reutiliza R1, R3, R7 (`warn` em manual / `enforce` em archive via `SDD_ARCHIVE=1`).

### 5.5 `audit_log.mjs` (`--audit-log`)
Para cada `specs/**/<pasta>`: `git log -1 --format=%h|%s -- <pasta>`; marca divergência se o escopo do assunto ≠ id da pasta; tabela em `specs/archive/COMMIT_AUDIT.md` + contagem de commits que tocaram > 1 spec (reproduz E1/E2).

### 5.6 Fluxo final do archive
```
build gate → apply_memory_delta (líder, escritor único) → triage → [NEEDS_DECISION?]
→ git mv spec → build_commit (lint) → [submódulo? commit separado] → comentar SHA nas issues
→ push origin <branch> (sem force) → resumo
```

## 6. Contratos TypeScript (documentação; validação real via JSON Schema)

```typescript
export type EvidenceKind = 'structure' | 'cochange' | 'dependency' | 'spec' | 'memory' | 'ops';

export interface EvidenceItem {
  readonly id: string;
  readonly kind: EvidenceKind;
  readonly ref: string;            // arquivo#linha | commit | pacote
  readonly weight: number;
  readonly payload: Readonly<Record<string, string | number | readonly string[]>>;
}

export interface Provenance {
  readonly evidenceIds: readonly string[];
  readonly origin: 'memory' | 'code-anchor' | 'stack-default';
}

export interface Rule {
  readonly text: string;
  readonly provenance: Provenance;
}

export interface SpecialistManifest {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly version: number;
  readonly domainKeywords: readonly string[];
  readonly filePatterns: readonly string[];
  readonly goldenRules: readonly Rule[];
  readonly forbiddenPatterns: readonly Rule[];
  readonly memoryPath: string;
  readonly lineage?: { readonly from: readonly string[]; readonly op: 'keep' | 'rename' | 'split' | 'merge' };
}

export type SetupMode = 'first-run' | 'upgrade' | 'noop' | 'migrate';

export interface RosterLock {
  readonly sddVersion: string;
  readonly mode: SetupMode;
  readonly evidenceHash: string;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly specialists: readonly Pick<SpecialistManifest, 'id' | 'version' | 'lineage'>[];
}

export interface RegistryEntry {
  readonly backend: 'agy-subagent' | 'alethe-session' | 'orca-worker';
  readonly handle: string;
  readonly lastUsed: string;
  readonly memoryHash: string;
  readonly activations: number;
  readonly spawns: number;
  readonly status: 'alive' | 'stopped' | 'missing';
}

export interface ScoutFrontMatter {
  readonly specialistId: string;
  readonly specId: string;
  readonly anchors: readonly string[];   // arquivo:linha
  readonly complexity: 'BAIXA' | 'MEDIA' | 'ALTA';
}

export interface IssueRecord {
  readonly task: number | 'epic';
  readonly number: number | null;
  readonly title: string;
  readonly specialistId?: string;
  readonly criteria: readonly { readonly text: string; readonly command: string }[];
  readonly state: 'open' | 'in-progress' | 'closed' | 'blocked' | 'markdown-only';
}

export interface EvidenceRecord {
  readonly taskId: number;
  readonly criterion: string;
  readonly command: readonly string[];
  readonly exitCode: number;
  readonly outputTail: string;
  readonly diffStat: string;
}

export interface Changeset {
  readonly specId: string;
  readonly owned: readonly string[];
  readonly shared: readonly string[];
  readonly baselineDirty: readonly string[];
  readonly groups?: readonly { readonly name: string; readonly paths: readonly string[]; readonly summary: string }[];
}

export interface TriageResult {
  readonly include: readonly string[];      // balde A
  readonly otherSpecs: readonly string[];   // balde B
  readonly orphans: readonly string[];      // balde C
  readonly needsDecision: readonly string[];// shared
}

export interface LintViolation {
  readonly rule: 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'R8';
  readonly detail: string;
}

export interface MemoryDelta {
  readonly specialistId: string;
  readonly featureId: string;
  readonly date: string;
  readonly context: string;
  readonly ruleLearned: string;
  readonly risk: string;
  readonly antiPattern: string;
  readonly anchor: string;      // arquivo:linha verificável
}
```

## 7. Protocolos das Skills (texto-alvo, 100 % agnóstico)

### `sdd-setup` (acréscimos)
1. Detectar modo (`roster.lock.json`). 2. `collect_evidence` → agente conclui → `verify_roster` (≤ 3 iterações) → `install_roster`. 3. Gerar/atualizar `.agent/sdd.config.json`. 4. `install_hooks` (`core.hooksPath=.githooks`, copia lint com versão). 5. Inserir/atualizar **bloco gerenciado** em `.agent/rules/ia.md`: *"Especialistas persistentes do roster são permitidos: não-recursivos, concorrência ≤ 5, autoridade única do líder, escrita só via worktree isolada ou delta."* 6. `.gitignore` ← `registry.local.json`. 7. Relatório.

### `sdd-proposal`
Passo 0: `next_spec_id` (considera `git worktree list`). Passo 1.1: `match_roster` → fan-out somente-leitura (tier barato, `verify_scout`). Passo 1.2: fan-in do líder. Passo 2: gerar spec com tags `[SPECIALIST:<id>]`/`[LEAD]` e **critérios de aceite com comando**. Passo 2.1: `sync_issues`. Hard Stop.

### `sdd-apply`
`changeset begin` → tasks (`[SPECIALIST]` em worktree isolada via Alethe `isolate`; `[LEAD]` direto) → `record_evidence` por task → `git apply --check` + integração → build gate global → `close_issues` → `changeset end`. Hard Stop (sem commit).

### `sdd-archive`
Protocolo da §5.6. Mantém: build gate obrigatório, memória obrigatória, nunca `--force`. Remove: `git add .`, mensagem manual única, `Move-Item`.

## 8. Plano de Testes
Fixtures em `sdd-*/tests/fixtures/` (repos git temporários criados por script):
- `fx-three-dirty-specs` → C1, C5; `fx-dup-subject` → C2; `fx-no-gh` → B3; `fx-empty-repo` → A3; `fx-grown-repo` → A2; `fx-ghost-anchor` → G4/A5.
- Teste de regressão do problema original: reconstrói 3 specs sujas e prova que o archive da primeira **não** altera `git log -1 -- specs/<outras>`.
- `tsc --noEmit --allowJs --checkJs` sobre os `.mjs`.
- Execução real (dry-run) deste repositório: A1.
