# Design Técnico — Spec 041: Integração Dinâmica Alethe + SDD

## 1. Fluxo Arquitetural Unificado

```mermaid
flowchart TD
    subgraph SDD_Proposal [Fluxo /vibe-proposal]
        P1[Início: /vibe-proposal] --> P2{Investigação > 3 arquivos ou desconhecido?}
        P2 -- "Não (Simples/Direto)" --> P3[Líder inspeciona com view_file]
        P2 -- "Sim (Amplo/Complexo)" --> P4[Aciona Batedores Alethe: scout-then-build\nWorkers flash-low em modo read-only]
        P4 --> P5[Batedores devolvem result.md resumidos]
        P5 --> P6[Líder sintetiza diagnóstico com 80% menos tokens]
        P3 --> P6
        P6 --> P7["Gera specs/<id>/\n- proposal.md\n- design.md\n- spec-plan.md (com tags [LEAD] e [PARALLEL])"]
        P7 --> P8[CIRCUIT BREAKER: Hard Stop]
    end

    subgraph SDD_Apply [Fluxo /vibe-apply]
        A1["Início: /vibe-apply <id>"] --> A2{spec-plan contém 2+ tasks [PARALLEL]?}
        A2 -- "Não (Sequencial/Acoplado)" --> A3[Modo Direto: Líder executa no workspace atual\nSave-state: [/] -> [x]]
        A2 -- "Sim (Disjunto/Independente)" --> A4[Modo Orquestrado: Alethe parallel-worktrees\nSpawna workers em git worktrees separadas]
        A4 --> A5[Workers produzem diff.patch + outcome.json]
        A5 --> A6[Líder audita e integra patches na branch principal\nMarca tasks [x] no spec-plan.md]
        A3 --> A7[Build Gate: npm test / npm run build]
        A6 --> A7
        A7 --> A8{Compilador / Testes OK?}
        A8 -- Sim --> A9[CIRCUIT BREAKER: Hard Stop]
        A8 -- "Falha (<= 3 retries)" --> A10[Auto-Healing / Rollback]
    end
```

---

## 2. Detalhamento das Alterações

### 2.1. Alteração em `sdd-proposal/SKILL.md`

#### A. Seção Nova: "1.1 Scan Otimizado com Batedores (Alethe)"
```markdown
### 1.1. Scan Otimizado com Batedores (Alethe — Opcional)
- **Quando usar:** Quando a task exigir inspecionar 4+ arquivos desconhecidos, rastrear múltiplos subsistemas ou ler logs extensos.
- **Como executar:** Em vez de carregar dezenas de arquivos no contexto do líder:
  1. Crie um plano rápido de batedores (`plan.json`) com `strategy: research` ou `scout-then-build`.
  2. Workers rodam no tier `cheap` (`gemini-3.8-flash-low`) em modo `read-only`.
  3. Cada worker entrega um `result.md` com a resposta cirúrgica.
  4. O líder lê apenas a síntese dos batedores, mantendo o contexto limpo para arquitetar a solução.
```

#### B. Seção Nova: "2.1 Classificação de Tasks no `spec-plan.md`"
```markdown
### 2.1. Classificação de Tarefas no spec-plan.md
Ao listar as tasks atômicas em `spec-plan.md`, classifique a estratégia de execução:
- `- [ ] [LEAD] <descrição>`: Tarefas acopladas, alterações em arquivos compartilhados, definições de banco ou que exigem julgamento crítico do líder.
- `- [ ] [PARALLEL: <worktree_id>] <descrição>`: Tarefas totalmente independentes em arquivos disjuntos (ex: componente UI isolado, script utilitário de teste, adapter independente), prontas para serem implementadas em paralelo.
```

---

### 2.2. Alteração em `sdd-apply/SKILL.md`

#### A. Seção Atualizada: "2. Executar Tasks (Bifurcação Dinâmica)"
```markdown
### 2. Executar Tasks (Bifurcação Dinâmica)

O líder inspeciona o `spec-plan.md` e escolhe o modo mais eficiente:

#### Modo A: Execução Direta (Padrão para tasks lineares ou acopladas)
- Para cada task `- [ ] [LEAD]` (ou tasks sem tags paralelas):
  1. Marque como `- [/] In Progress`.
  2. Implemente no workspace atual.
  3. Marque como `- [x] Completed`.

#### Modo B: Execução Orquestrada Alethe (Para 2+ tasks [PARALLEL] disjuntas)
- Se o plano contiver tarefas independentes que tocam arquivos totalmente separados:
  1. O líder gera o plano de execução (`plan.json`) usando o playbook `parallel-worktrees`.
  2. O script `orchestrate.py run plan.json` spawna os workers em worktrees temporárias (`git worktree add`).
  3. Cada worker gera seu `diff.patch` e seu `result.md`.
  4. O líder inspeciona os patches, aplica-os na branch principal (`git apply <patch>`), remove as worktrees e marca as tasks como `[x]` no `spec-plan.md`.
  5. Se uma tarefa falhar no worker, o líder assume a tarefa no modo direto com auto-healing.
```

---

### 2.3. Harmonização com as Regras de Operação (`ia.md`)

Atualmente, `ia.md` possui:
`Agente single-agent, headless, stack Next.js + Supabase + shadcn/ui. Modo direto — sem subagentes por tarefa.`

#### Ajuste Factual:
A proibição original visava **subagentes descontrolados de conversação (`invoke_subagent` recursivos e sem budget)** que alucinam e explodem quotas sem governança.
O Alethe opera sob um paradigma estritamente diferente:
- **Workers Delimitados por Processo (CLI):** Rodam em isolamento de sandbox (`read-only` ou `worktree`), com teto estrito de tempo/tokens (`budget`), e entregam apenas patches verificáveis para a auditoria do líder.
- A regra será ajustada para:
  ```markdown
  ## Identidade & Governança de Agentes
  Agente single-agent soberano, headless, stack Next.js + Supabase + shadcn/ui.
  - Modo direto é o padrão para tarefas ordinárias.
  - Proibido o uso de subagentes recursivos/descontrolados em memória.
  - Autorizado o uso da skill 'alethe' para delegar unidades delimitadas com isolamento em git worktree, budget estrito de tokens e integração com evidência pelo líder.
  ```

---

## 3. Segurança e Protocolo de Worktrees

1. **Anti-Colisão no Git:**
   - Alethe cria worktrees em `.alethe/worktrees/<worker_id>` e automaticamente adiciona `.alethe/worktrees/` ao `.git/info/exclude`.
   - Nenhum worker tem permissão de dar `git commit` ou `git push` direto na branch principal.
2. **Revisão Obrigatória de Patches:**
   - O líder é a única autoridade que executa `git apply` ou insere código na branch de trabalho.
3. **Rollback Determinístico:**
   - Se um worker gerar um patch quebrado ou com erro de sintaxe, o patch é sumariamente descartado sem nenhum dano à branch principal.
