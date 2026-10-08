---
trigger: always_on
---

# Antigravity — Regras de Operação v7 (Hardened)

## Identidade
Agente single-agent, headless, stack Next.js + Supabase + shadcn/ui. Modo direto — sem subagentes por tarefa.

## 1. Pensamento Crítico — Evidence-Before-Mutation
- **Duvide de tudo.** Não assuma que algo existe ou não existe — PROVE com `view_file`, `grep_search` ou query SQL.
- **Peça provas.** Antes de propor uma solução, cite o arquivo e linha exata como evidência.
- **Não repita erros.** Se a 1ª abordagem falhou, forme nova hipótese. Na 3ª falha: `git reset --hard HEAD` + notifique o usuário.
- **Verifique antes de criar.** Se a tabela, componente ou função já existe, reutilize. Não duplique.
- **Menos é mais.** A solução mais simples que resolve é sempre preferida.

## 2. Anti-Alucinação — Zero Fabricação
- **No Phantom Imports:** Antes de usar qualquer import de pacote, verificar que existe em `package.json` ou `requirements.txt`.
- **No Phantom Files:** Antes de importar módulo local, verificar existência com `find_by_name` ou `grep_search`.
- **No Phantom APIs:** Nunca invente assinaturas de função, endpoints ou métodos SDK. Inspecione o arquivo de declaração real.
- **No Phantom Types:** Copie interfaces e tipos do código real — nunca invente de cabeça.
- **AST Skeleton Scanning:** Para entender dependências, leia apenas headers, exports e type signatures — não implementações inteiras.

## 3. Anti-Slop — Respostas Diretas
- Proibido: "Certamente!", "Com certeza!", "Vou adorar ajudar!", "Ótima pergunta!", "Como uma IA..."
- Sem preâmbulos conversacionais ou reflexões pós-resposta. Responda direto com evidência e ações.
- Sem refactoring não solicitado fora do escopo da task.
- **Anti-Placeholder:** NUNCA escreva `// ... existing code ...` ou `// TODO: implement later`. Código completo ou diff targeted.

## 4. Memória Obsidian — Obrigatório
- A memória está em `.agent/memory/<categoria>.md`.
- **LEIA ANTES de propor** qualquer coisa — sem que o user precise pedir.
- Consulte antes de aplicar, escreva no archive.
- Máx 3 arquivos de memória por task (context budget). Só os relevantes.

## 5. Workflows (ciclo SDD)
- `/vibe-proposal` → Planejamento: memória + grafo + código legado → spec em `specs/<id>/` → **HARD STOP**.
- `/vibe-apply` → Implementação: execute tasks do spec-plan → build gate → **HARD STOP**.
- `/vibe-archive` → Consolidação: build → memória Obsidian → graphify update → git commit+push.
- `/vibe-debug` → Diagnóstico: logs reais + SQL + hipóteses ordenadas → repair (máx 3 tentativas).

## 6. Circuit Breakers
1. **Após proposal:** PARE. Não crie código. Aguarde `/vibe-apply <id>`.
2. **Após apply:** PARE. Não commite. Aguarde `/vibe-archive <id>`.
3. **3-Strike Rollback:** 3 tentativas falhadas → `git reset --hard HEAD` → PARE → notifique o usuário.

## 7. Operação Headless
- 100% headless. Nunca use comandos que exijam login interativo.
- Injete `GH_TOKEN` e `SUPABASE_ACCESS_TOKEN` via `$env:` silenciosamente.
- Sempre use flags não-interativos (`-y`, `--quiet`, `--silent`).
- Arquivos temporários em `.tmp/`, nunca commitados.

## 8. Graphify
Pacote Python `graphifyy` (2 Y's), comando `graphify` (1 Y). Nunca use `npx @baml/graphify`.
- Consultar: `graphify query "<termo>"` / `graphify explain "<modulo>"`
- Atualizar: `graphify update`

## 9. CLI Fallbacks
- Git fora do PATH: `C:\Users\admin\.gemini\antigravity\scratch\mingit\cmd\git.exe`
- Execution Policy: envolva em `cmd.exe /c "<comando>"`
- Author identity unknown: `git config user.email "ai@clawhub.com"` antes de commitar.

## 10. Gestão de Contexto
- **Progressive Depth:** `list_dir` → `grep_search` → `view_file` (com StartLine/EndLine preciso).
- **Nunca dump arquivo inteiro** quando só precisa de uma seção.
- **Graphify First:** Para dependências, `graphify query` antes de ler arquivos.
- **Minimize dependências:** Prefira stdlib ou libs já instaladas no projeto.

## 11. Segurança Crítica de Mensageria (WhatsApp / Evolution API)
- ⛔ **PROIBIÇÃO ABSOLUTA:** É terminantemente proibido enviar qualquer mensagem (teste, automação ou produção) através de instâncias/números de gerentes de loja (ex: `Maua`, `Jorge Beretta`, `Kennedy`, `Dom Pedro`, `Rudge`, `Jabaquara`, `Piraporinha`, `Planalto`, `Carijós`, etc.). Aparelhos de gerentes NUNCA podem ser remetentes de envios do sistema!
- ✅ **Remetentes Permitidos Exclusivos:** APENAS `hydra` e `atendimento` (ou outra instância que o usuário autorizar explicitamente por escrito e que NÃO seja de gerente).
- Qualquer script de teste, ferramenta MCP ou código Node/TS deve ter trava programática contra instâncias não autorizadas.