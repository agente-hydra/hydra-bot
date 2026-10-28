# Plano de Implementação — Spec 041: Integração Dinâmica Alethe + SDD

## Fases de Execução

- [x] **Fase 1: Atualização da Skill `sdd-proposal`**
  - [x] 1.1 Inserir seção 1.1 em `C:\Users\User\.gemini\config\skills\sdd-proposal\SKILL.md` descrevendo o uso de batedores Alethe (`scout-then-build`) para codebases desconhecidas ou volumosas (4+ arquivos).
  - [x] 1.2 Inserir seção 2.1 padronizando as tags de execução no `spec-plan.md`: `[LEAD]` para tarefas acopladas e `[PARALLEL: <id>]` para tarefas independentes e disjuntas.

- [x] **Fase 2: Atualização da Skill `sdd-apply`**
  - [x] 2.1 Inserir seção de bifurcação dinâmica em `C:\Users\User\.gemini\config\skills\sdd-apply\SKILL.md`:
    - Modo A: Direto (padrão sequencial no workspace atual).
    - Modo B: Orquestrado via Alethe (playbook `parallel-worktrees` com geração de `diff.patch` e integração pelo líder).
  - [x] 2.2 Reafirmar as salvaguardas: save-state contínuo (`[/]`, `[x]`), auto-healing (máx 3 tentativas) e Build Gate absoluto.

- [x] **Fase 3: Harmonização das Regras de Operação (`ia.md`)**
  - [x] 3.1 Atualizar `C:\Users\User\.gemini\config\rules\ia.md` (Global) na seção de Identidade para explicitar a autorização de workers delimitados Alethe sob demanda, mantendo a proibição de subagentes descontrolados sem budget.
  - [x] 3.2 Atualizar `.agent/rules/ia.md` no repositório local mantendo paridade com as regras globais.

- [x] **Fase 4: Documentação na Memória Persistente do Projeto**
  - [x] 4.1 Registrar na memória `.agent/memory/infra.md` a adoção do padrão híbrido SDD + Alethe, listando os playbooks aplicáveis a cada cenário.

- [x] **Fase 5: Teste & Validação da Esteira**
  - [x] 5.1 Executar teste de validação de comandos `alethe` integrado com o `spec-plan.md`.
  - [x] 5.2 Verificar se as skills respondem corretamente aos triggers sem quebrar fluxos legados.
