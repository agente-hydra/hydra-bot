---
name: sdd-archive
description: "Consolidação e arquivamento auditado SDD v2. Executa triagem seletiva de arquivos, commit com escopo único (sem contaminação), validação de regras de commit R1..R8, persistência de memória e auditoria."
triggers: [archive, arquivar, finalizar spec, sdd-archive, vibe-archive]
---

# SDD Archive — Consolidação Auditada & Higiene de Commits

<skill>
<overview>
Consolida e arquiva a spec com garantia matemática de isolamento e higiene no histórico git. Elimina contaminações onde múltiplos specs compartilhavam o mesmo commit. Realiza triagem determinística de arquivos, staging estritamente seletivo por caminho (nunca curingas), validação de regras convencionais e de unicidade (R1..R8), consolidação de memória do especialista e push dinâmico.
</overview>

<guardrails>
- <rule type="prohibition">É TERMINANTEMENTE PROIBIDO executar `git add .`, `git add -A` ou `git add -u`. Todo staging é estritamente seletivo via caminhos explícitos.</rule>
- <rule type="prohibition">É TERMINANTEMENTE PROIBIDO usar `git commit --no-verify` ou contornar hooks de validação.</rule>
- <rule type="prohibition">É TERMINANTEMENTE PROIBIDO usar `git push --force` ou `git push -f`.</rule>
- <rule type="mandatory">Build Gate obrigatório: se o build falhar, nenhum arquivo é movido ou commitado.</rule>
- <rule type="isolation">Mono-spec: um commit deve conter arquivos de NO MÁXIMO UMA spec (exceto no modo explícito --batch).</rule>
</guardrails>

<steps>
<step number="1" name="Build Gate Pré-Archive">
Execute o oráculo determinístico de build do repositório:
```bash
npm run build || npx tsc --noEmit || npm test
```
Se houver qualquer erro de compilação ou teste, interrompa o processo imediatamente. Não mova arquivos nem commite.
</step>

<step number="2" name="Consolidação de Memória (Líder como Escritor Único)">
Aplique os aprendizados duradouros da spec na memória dedicada do especialista:
```bash
node tools/sdd/sdd-archive/scripts/apply_memory_delta.mjs
```
Ou adicione a lição aprendida em `.agent/memory/specialists/<id>.md`:
```markdown
## [YYYY-MM-DD] — [Feature: <id>]
- **Contexto:** O que foi construído ou corrigido.
- **Regra aprendida:** Insight técnico indispensável para futuras sessões.
- **Risco identificado:** Possível regressão ou ponto de atenção.
- **Não fazer:** Anti-pattern observado.
```
</step>

<step number="3" name="Triagem Determinística de Arquivos (WS-C)">
Inspecione a working tree contra o changeset da spec:
```bash
node tools/sdd/sdd-archive/scripts/triage.mjs <id>
```
O oráculo separa os arquivos modificados em:
- **Balde A (Include):** Arquivos declarados como `owned` no `changeset.json` desta spec e a pasta `specs/<id>/`.
- **Balde B (Other Specs):** Arquivos pertencentes a outros specs concorrentes no workspace (permanecem intocados).
- **Balde C (Orphans):** Arquivos órfãos não rastreados (permanecem intocados).
- **Shared:** Arquivos compartilhados que já estavam sujos antes da spec. Se houver itens compartilhados, o script emite `NEEDS_DECISION`. Decida via `--include <path>` ou `--exclude <path>`.
</step>

<step number="4" name="Atualização de Grafo (Graphify)">
Se a ferramenta topológica estiver disponível no ambiente:
```bash
graphify update || true
```
</step>

<step number="5" name="Staging Seletivo, Linting & Commit Auditado">
Execute a esteira de commit do archive:
```bash
node tools/sdd/sdd-archive/scripts/build_commit.mjs <id>
```
Este comando executa a seguinte sequência atômica:
1. Move a pasta da spec para `specs/archive/<id>/` (via `git mv`).
2. Faz o staging EXCLUSIVO dos caminhos do Balde A via `git add -- <path1> <path2>...`.
3. Executa assert no índice: `git diff --cached --name-only` deve coincidir exatamente com os arquivos da spec arquivada.
4. Gera mensagem padronizada no formato convencional `feat(<id>): <resumo>` com corpo estruturado (Problema, Solução, Evidência, Refs).
5. Executa o linter de commit (`commit_lint.mjs`) validando as regras R1 a R8:
   - **R1:** Formato `type(<id>): summary` entre 10 e 72 caracteres.
   - **R2:** Escopo idêntico ao ID da spec.
   - **R3:** Unicidade do assunto (Dice similarity <= 0.85 contra últimos 200 commits).
   - **R4:** Relevância de termos em relação ao título da spec.
   - **R5:** Arquivos em staging pertencem ao changeset.
   - **R6:** Nenhuma outra spec tocada simultaneamente no commit.
   - **R7:** Scan estrito contra vazamento de tokens ou segredos.
   - **R8:** Linha obrigatória de evidência no corpo.
6. Realiza o commit real.
</step>

<step number="6" name="Push Dinâmico">
Obtenha a branch corrente e sincronize com a origem de forma segura (sem `--force`):
```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git push origin "$BRANCH"
```
</step>

<step number="7" name="Auditoria Opcional do Histórico">
Para auditar a saúde de todos os commits de specs no repositório:
```bash
node tools/sdd/sdd-archive/scripts/audit_log.mjs
```
Gera `specs/archive/COMMIT_AUDIT.md` documentando a integridade de escopos e listando eventuais commits legados contaminados.
</step>

<step number="8" name="Resumo Final">
Apresente ao usuário:
- ✅ Build gate verificado
- 📝 Lições registradas na memória
- 📦 Spec arquivada em `specs/archive/<id>`
- 🔗 SHA do commit limpo e arquivos afetados
</step>
</steps>
</skill>
