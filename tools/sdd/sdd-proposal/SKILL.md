---
name: sdd-proposal
description: "Planejamento estruturado SDD v2. Consulta especialistas persistentes, gera scouts verificados, aloca ID seguro multi-worktree, cria spec formal, sincroniza issues e aplica Hard Stop."
triggers: [proposal, planejar, criar spec, sdd-proposal, vibe-proposal]
---

# SDD Proposal — Planejamento com Especialistas Persistentes & Issues

<skill>
<overview>
Planejamento formal do ciclo SDD v2. Aloca IDs livres sem colisão em worktrees, consulta o roster de especialistas persistentes via score contextual, valida relatórios de scout contra alucinações, gera os documentos de especificação, registra o ciclo de issues (GitHub ou Markdown) e aciona o Hard Stop.
</overview>

<guardrails>
- <rule type="mandatory">Só especificação e issues. Não escreva código de produção no proposal.</rule>
- <rule type="mandatory">O texto da skill é 100% agnóstico de domínio — sem papéis hardcoded.</rule>
- <rule type="mandatory">Validação estrita de scouts: todo scout deve ter front-matter válido, <= 40 linhas e âncoras físicas reais.</rule>
- <rule type="mandatory">Hard Stop absoluto ao final do proposal. Aguarde a invocação do apply pelo usuário.</rule>
</guardrails>

<steps>
<step number="0" name="Alocação de ID Seguro">
Determine o próximo ID livre varrendo o workspace atual e todas as worktrees ativas:
```bash
node tools/sdd/sdd-proposal/scripts/next_spec_id.mjs
```
Crie a pasta da spec: `specs/<id>-<slug>/`.
</step>

<step number="1" name="Match do Roster & Scouts de Especialistas (WS-A)">
1. **Roteamento Contextual:**
   Avalie a demanda contra o roster ativo:
   ```bash
   node tools/sdd/sdd-proposal/scripts/match_roster.mjs "<demanda do usuário>"
   ```
   - `k = 0`: Líder planeja solo (registra aviso de roster-gap).
   - `k = 1`: Consulta pontual ao especialista selecionado.
   - `k >= 2`: Fan-out de batedores (máximo 5) consultando os especialistas relevantes.

2. **Reuso de Sessão:**
   A ativação de especialistas consulta `.agent/specialists/registry.local.json` e preserva sessões vivas (evitando re-spawns desnecessários).

3. **Entrega e Verificação do Scout:**
   Cada especialista consultado entrega seu relatório em `specs/<id>/scouts/scout_<id>.md` (diagnóstico, recomendação e âncoras `arquivo:linha`).
   O líder valida com o oráculo determinístico:
   ```bash
   node tools/sdd/sdd-proposal/scripts/verify_scout.mjs specs/<id>/scouts/scout_<id>.md
   ```
   Reprova se exceder 40 linhas ou contiver âncoras inexistentes no repositório.
</step>

<step number="2" name="Geração dos Documentos da Spec">
O líder consolida o plano em `specs/<id>/`:

1. **`proposal.md`**:
   - Problema detalhado
   - Solução proposta
   - Especialistas envolvidos
   - Riscos e mitigação

2. **`design.md`**:
   - Fluxo de dados e arquitetura
   - Contratos e interfaces (copiadas do código real, sem fabricação)
   - Mapeamento de arquivos afetados

3. **`spec-plan.md`**:
   - Divisão em tarefas atômicas atribuídas:
     - `- [ ] [SPECIALIST:<id>] **T<n> — <título>**`
     - `- [ ] [LEAD] **T<n> — <título>**` (para arquivos compartilhados e integração)
   - Critérios de aceite com comando determinístico:
     `- **Aceite:** <descrição do critério>`

4. **Sincronização de Issues (WS-B):**
   ```bash
   node tools/sdd/sdd-proposal/scripts/sync_issues.mjs <id>
   ```
   Gera issues rastreáveis no GitHub (ou em `issues.md`/`issues.json` em modo offline) com marcadores de idempotência `<!-- sdd:spec=<id> task=<n> -->`.
</step>

<step number="3" name="Hard Stop">
Apresente o resumo da spec gerada, a lista de especialistas ativados, as issues criadas e PARE imediatamente.

> "Spec `<id>` planejada com sucesso. Para implementar: `/sdd-apply <id>`."
</step>
</steps>
</skill>
