---
name: sdd-apply
description: "Implementação direta e orquestrada de specs SDD v2. Executa tarefas com especialistas persistentes, rastreia changeset baseline, grava evidências, fecha issues e aplica Hard Stop."
triggers: [apply, implementar, executar spec, sdd-apply, vibe-apply]
---

# SDD Apply — Implementação com Rastreamento de Changeset & Evidências

<skill>
<overview>
Execução das tarefas planejadas na spec. Inicializa o baseline de mudanças (WS-C) para prevenir contaminação entre specs, delega tarefas aos especialistas persistentes em seus escopos definidos, registra evidências determinísticas de execução, fecha as issues correspondentes mediante build gate e finaliza com Hard Stop sem commit prematuro.
</overview>

<guardrails>
- <rule type="mandatory">A spec é a lei: implemente estritamente os critérios acordados no proposal e design.</rule>
- <rule type="mandatory">Texto 100% agnóstico de domínio — sem especialidades ou papéis hardcoded.</rule>
- <rule type="isolation">O líder é o único escritor do spec-plan e dos arquivos compartilhados; especialistas entregam diffs/código em seus escopos.</rule>
- <rule type="verification">Uma tarefa só é marcada como [x] após execução do comando de aceite e gravação de evidência com exitCode 0.</rule>
- <rule type="mandatory">Hard Stop absoluto: nunca commite, nunca arquive a pasta no apply.</rule>
</guardrails>

<steps>
<step number="0" name="Inicialização do Changeset (WS-C)">
Antes de qualquer alteração de código, capture o baseline do estado atual do repositório:
```bash
node tools/sdd/sdd-apply/scripts/changeset.mjs begin <id>
```
Isso isola alterações não relacionadas já existentes no workspace, impedindo contaminações no commit de arquivamento.
</step>

<step number="1" name="Carregar Spec & Ativar Especialistas">
Leia `specs/<id>/proposal.md`, `design.md` e `spec-plan.md`.
Identifique os especialistas atribuídos a cada tarefa (`[SPECIALIST:<id>]` ou `[LEAD]`).
Consulte `.agent/specialists/registry.local.json` para reutilizar as sessões vivas dos especialistas.
</step>

<step number="2" name="Execução das Tarefas & Registro de Evidências">
Para cada tarefa do `spec-plan.md`:
1. Marque como `- [/]` (In Progress).
2. Execute a implementação:
   - **Tarefas `[SPECIALIST:<id>]`:** Executadas pelo especialista em seu escopo de arquivos (via worktree isolada do Alethe ou execução direta com verificação de escopo).
   - **Tarefas `[LEAD]`:** Executadas pelo líder (arquitetura global, infraestrutura ou múltiplos escopos).
3. Execute o comando de validação/aceite e grave a evidência determinística:
   ```bash
   node tools/sdd/sdd-apply/scripts/record_evidence.mjs <id> <taskId> "<critério de aceite>" <comando...>
   ```
   A evidência é registrada em `specs/<id>/evidence/t<taskId>.md`.
4. Comprovado o exitCode 0, marque como `- [x]` (Completed).
</step>

<step number="3" name="Auto-Healing (em caso de falha)">
- **Tentativa 1:** Correção pontual na causa raiz.
- **Tentativa 2:** Abordagem alternativa preservando os contratos do design.
- **Tentativa 3:** Se persistir → reverta as mutações desta tarefa e notifique o usuário como bloqueio (`blocked`). Nunca tente uma 4ª vez sem alinhamento.
</step>

<step number="4" name="Build Gate Global & Fechamento de Issues (WS-B)">
1. Execute o build gate global do repositório:
   ```bash
   npm run build || npx tsc --noEmit || npm test
   ```
2. Feche as issues correspondentes cujos critérios foram atendidos:
   ```bash
   node tools/sdd/sdd-apply/scripts/close_issues.mjs <id>
   ```
   Issues com falha ou evidência incompleta recebem comentário com as lacunas e permanecem abertas. O Épico é encerrado se todas as tarefas filhas foram aprovadas.
</step>

<step number="5" name="Finalização do Changeset">
Consolide as mudanças da spec comparando com o baseline inicial:
```bash
node tools/sdd/sdd-apply/scripts/changeset.mjs end <id>
```
Gera `specs/<id>/changeset.json` catalogando explicitamente arquivos `owned` e `shared`.
</step>

<step number="6" name="Hard Stop">
Apresente o resumo das tarefas executadas, evidências registradas e status das issues. PARE imediatamente.

> "Implementação concluída e verificada com sucesso. Para auditar e commitar com higiene: `/sdd-archive <id>`."
</step>
</steps>
</skill>
