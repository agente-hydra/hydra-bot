---
name: sdd-setup
description: "Configuração inicial e upgrade do ambiente SDD v2 — bootstrap de memória, indexação de dependências/grafo, descoberta autônoma de especialistas persistentes, hooks de higiene e políticas de governança."
triggers: [setup, configurar ambiente, inicializar projeto, bootstrap, sdd-setup, upgrade sdd]
---

# 🚀 SDD Setup — Inicialização Headless, Memória & Roster de Especialistas

<skill>
<overview>
Configura o ambiente de desenvolvimento de forma 100% headless. Inicializa a memória modular Obsidian, a topologia de dependências e executa a Descoberta Autônoma de Especialistas Persistentes (WS-A), gerando o roster formal com seus escopos de arquivos, regras de ouro mineradas do código e memórias dedicadas. Configura hooks de higiene de commit e sincroniza as regras do agente.
</overview>

<guardrails>
- <rule type="mandatory">Operação EXCLUSIVAMENTE headless. Jamais tente comandos interativos que exijam login no browser.</rule>
- <rule type="mandatory">Skills do SDD são 100% agnósticas de domínio: nenhum papel ou especialidade é hardcoded no fluxo.</rule>
- <rule type="security">Nunca exiba tokens ou chaves em texto puro. Mantenha `.env` protegido e no `.gitignore`.</rule>
- <rule type="idempotence">O setup é estritamente idempotente: rodado duas vezes seguidas sobre o mesmo repo sem mudanças, a segunda execução é um `noop` sem perda de anotações manuais.</rule>
</guardrails>

<steps>
<step number="1" name="Validação de Credenciais e Modo Headless">
Verifique a existência das variáveis no ambiente ou em `.env`:
- `GH_TOKEN` (GitHub Personal Access Token)
- `SUPABASE_ACCESS_TOKEN` (se aplicável ao backend)

No PowerShell/bash, injete silenciosamente as variáveis de ambiente sem expor valores:
```powershell
if ($env:GH_TOKEN) { gh auth status }
```
</step>

<step number="2" name="Estrutura Base de Memória e Grafo">
Crie os diretórios fundamentais do projeto:
```bash
mkdir -p .agent/memory/specialists .agent/specialists .agent/rules .githooks specs/archive
```

Indexação topológica de dependências via Graphify (se disponível):
```bash
graphify update || true
```
</step>

<step number="3" name="Descoberta Autônoma de Especialistas (WS-A)">
O processo segue o pipeline determinístico **Coletar → Concluir → Verificar (G1..G5) → Instalar**:

1. **Coleta de Evidências:**
   Execute o coletor determinístico para mapear estrutura, histórico git, manifestos de pacotes e memórias existentes:
   ```bash
   node tools/sdd/sdd-setup/scripts/collect_evidence.mjs evidence.json
   ```

2. **Síntese do Roster pelo Agente Líder:**
   Com base unicamente em `evidence.json`, agrupe o repositório em 2 a 6 especialistas com escopos coesos:
   - Todo especialista deve ter: `id`, `name`, `role`, `filePatterns`, `domainKeywords`, `goldenRules` e `forbiddenPatterns`.
   - Cada regra de ouro DEVE citar o `evidenceId` real correspondente (Zero regras inventadas).
   - Salve a proposta em `roster.proposed.json`.

3. **Verificação Estrita dos Gates (Oráculo):**
   Execute o verificador:
   ```bash
   node tools/sdd/sdd-setup/scripts/verify_roster.mjs roster.proposed.json evidence.json
   ```
   - **G1:** Cobertura de arquivos rastreados >= 95%.
   - **G2:** Sobreposição entre especialistas <= 25%.
   - **G3:** Contagem de especialistas entre [2, 6].
   - **G4:** Todas as âncoras citadas existem fisicamente no disco.
   - Se reprovar, o agente ajusta o `roster.proposed.json` (máximo 3 iterações).

4. **Instalação Idempotente:**
   ```bash
   node tools/sdd/sdd-setup/scripts/install_roster.mjs
   ```
   Instala `.agent/specialists/<id>/SPECIALIST.md`, `.agent/memory/specialists/<id>.md`, `roster.lock.json` e `SETUP_REPORT.md`.
</step>

<step number="4" name="Configuração Central do SDD">
Gere ou atualize `.agent/sdd.config.json` com as diretrizes do projeto:
```json
{
  "version": "2.0.0",
  "specialists": {
    "enabled": true,
    "minK": 2,
    "maxK": 6,
    "maxLinesScout": 40
  },
  "issues": {
    "enabled": true,
    "provider": "github",
    "mode": "auto"
  },
  "commitPolicy": {
    "requireLint": true,
    "requireEvidence": true,
    "hookMode": "warn"
  }
}
```
</step>

<step number="5" name="Instalação de Hooks Git e Governança">
1. Instale o hook vendorizado `commit-msg` e configure `core.hooksPath`:
   ```bash
   node tools/sdd/sdd-setup/scripts/install_hooks.mjs
   ```

2. Garanta que o cache local do runtime de especialistas permaneça ignorado no Git:
   ```bash
   grep -q "registry.local.json" .gitignore || echo -e "\n# SDD local runtime cache\n.agent/specialists/registry.local.json\nevidence.json\nroster.proposed.json" >> .gitignore
   ```

3. Atualize o bloco gerenciado de governança em `.agent/rules/ia.md`:
   ```markdown
   <!-- sdd:managed:begin id="specialists-governance" -->
   ## Especialistas Persistentes do Roster (SDD v2)
   - Especialistas persistentes descobertos pelo setup são permitidos para pesquisa, scouts e tarefas delimitadas.
   - Concorrência máxima em fan-out: <= 5 especialistas simultâneos.
   - O agente líder detém a autoridade única de integração, build gate global e commits.
   - Especialistas operam em worktrees isoladas ou devolvem deltas; nunca editam memória compartilhada diretamente.
   <!-- sdd:managed:end id="specialists-governance" -->
   ```
</step>

<step number="6" name="Relatório de Conclusão">
Apresente ao usuário o resumo das ações extraído de `.agent/specialists/SETUP_REPORT.md`:
- Especialistas descobertos e seus escopos
- Confidência e integridade dos gates G1..G5
- Status dos hooks instalados
</step>
</steps>
</skill>
