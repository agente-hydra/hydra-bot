# Spec 041: Integração Dinâmica da Orquestração Alethe nos Ciclos SDD (Proposal & Apply)

## 1. Visão Geral & Contexto

O ecossistema Antigravity utiliza o ciclo **SDD (Spec-Driven Development)** como protocolo soberano:
1. `/vibe-proposal` — Planejamento: scan de contexto, memória Obsidian, grafo e geração da spec em `specs/<id>/` com **Hard Stop**.
2. `/vibe-apply` — Implementação: execução sequencial das tarefas da spec com save-state contínuo (`[/]`, `[x]`), auto-healing em até 3 tentativas, **Build Gate** e **Hard Stop**.
3. `/vibe-archive` — Consolidação: build gate, atualização da memória Obsidian, graphify update e commit git.

### O Problema Identificado
1. **Gargalo de Contexto no Proposal:** Em tarefas complexas que tocam múltiplos subsistemas ou dezenas de arquivos legados, o agente líder consome 80k–150k tokens apenas lendo código, saturando a janela de contexto antes mesmo de começar a propor a solução.
2. **Gargalo Sequencial no Apply:** Quando uma spec contém 4 ou 5 tarefas totalmente independentes (ex: criar migration de banco, refatorar componente de UI isolado, escrever scripts de teste, atualizar endpoints auxiliares), a execução puramente sequencial pelo agente líder é lenta e mistura alterações disjuntas no mesmo workspace, aumentando o risco de regressões.
3. **Falta de uma Ponte Dinâmica:** A skill `alethe` foi instalada com sucesso no ambiente, mas ainda não está conectada nativamente como uma opção fluida durante os comandos `/vibe-proposal` e `/vibe-apply`.

---

## 2. Solução Proposta

Implementar uma **ponte dinâmica e adaptativa** entre o ciclo SDD e a engine Alethe, respeitando o princípio de **"Join Mid-Task"**:

### 2.1. Princípio da Navalha de Ockham (Não Orquestrar o Trivial)
O Alethe possui como regra de ouro: *"Do the work yourself when briefing a worker would cost more; delegation always has a floor cost."*
- Se a tarefa tocar até 3 arquivos ou for estritamente acoplada, o líder executa **diretamente**, exatamente como hoje. Zero overhead.
- O Alethe é acionado **dinamicamente apenas quando há ganho comprovado** em economia de contexto (scouts) ou paralelismo seguro (worktrees).

### 2.2. Dinâmica no `/vibe-proposal`
- **Scout-Then-Build para Mapeamento Amplo:** Se a proposta exigir investigar mais de 3 arquivos desconhecidos ou múltiplos subsistemas, o líder aciona batedores Alethe (`gemini-3.8-flash-low` em modo `read-only`).
- **Contexto Blindado:** Os batedores retornam pequenos resumos estruturados (`result.md`). O líder lê apenas os resumos para formular o `proposal.md` e `design.md`.
- **Anotação de Paralelismo no `spec-plan.md`:** O líder classifica as tasks geradas:
  - `[LEAD]` — Tarefas acopladas, decisões arquiteturais, migrations centrais.
  - `[PARALLEL: <worktree>]` — Tarefas independentes em arquivos disjuntos.

### 2.3. Dinâmica no `/vibe-apply`
- **Detecção Automática:** Ao carregar o `spec-plan.md`, o `/vibe-apply` avalia se há tasks marcadas como `[PARALLEL]`.
- **Bifurcação Transparente:**
  - Se NÃO houver tasks paralelas: executa diretamente no workspace atual (modo sequencial padrão).
  - Se HOUVER tasks paralelas: aciona o playbook `parallel-worktrees` via `orchestrate.py`. Cada worker implementa sua fatia em uma worktree temporária (`git worktree add`).
- **Integração com Evidência:** Cada worker gera um `diff.patch`. O líder revisa o diff contra os contratos do `design.md`, aplica na árvore principal e atualiza o save-state (`[x]`).
- **Build Gate Absoluto:** O oráculo final (`tsc --noEmit` / `npm test` / `npm run build`) roda obrigatoriamente após a integração de todas as partes, garantindo zero regressão.

---

## 3. Escopo de Arquivos Afetados

| Arquivo | Modificação |
| :--- | :--- |
| `C:\Users\User\.gemini\config\skills\sdd-proposal\SKILL.md` | Inclusão do passo de avaliação de batedores Alethe (`scout-then-build`) e tagueamento de tasks |
| `C:\Users\User\.gemini\config\skills\sdd-apply\SKILL.md` | Inclusão da bifurcação dinâmica: Direto vs Alethe Parallel Worktrees |
| `C:\Users\User\.gemini\config\rules\ia.md` | Ajuste da regra de single-agent: esclarecer que workers Alethe com contratos delimitados, worktrees e budget rígido são permitidos sob demanda |
| `C:\Users\User\Desktop\agy\.agent\rules\ia.md` | Espelho da regra no projeto local |

---

## 4. Critérios de Aceite

1. **Critério 1 (Preservação do SDD):** As etapas `/vibe-proposal`, `/vibe-apply` e `/vibe-archive`, os arquivos em `specs/<id>/`, os Hard Stops e os Build Gates continuam funcionando de forma 100% idêntica para qualquer tarefa comum.
2. **Critério 2 (Bifurcação Dinâmica no Apply):** Tarefas com arquivos compartilhados ou dependências em cascata rodam diretamente pelo líder; tarefas independentes e disjuntas podem ser paralelizadas em worktrees via Alethe.
3. **Critério 3 (Isolamento Git Inviolável):** Nenhum worker Alethe pode sobrescrever arquivos fora da sua worktree ou comitar direto na branch de trabalho sem aprovação do líder.
4. **Critério 4 (Single-Lead Authority):** O agente líder (você na conversa atual) é sempre o arquiteto soberano: aprova planos, audita diffs, aplica patches e responde ao usuário.
