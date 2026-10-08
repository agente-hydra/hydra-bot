# Spec Plan — Hydra: Linguagem, WhatsApp e Compreensão

**Versão:** 1.0  
**Data:** 02 de Outubro de 2026  
**Status:** IMPLEMENTAÇÃO CONCLUÍDA E HOMOLOGADA (SDD Apply Concluído)  
**ID da Spec:** `hydra-language-whatsapp-comprehension`  
**Destinatários:** Agente Principal e os 3 Executores Especialistas Existentes

---

## 1. Atribuição de Arquivos e Dono Único

Para assegurar isolamento completo e evitar conflitos de merge ou regressões entre os agentes, a titularidade de cada arquivo foi rigorosamente segregada:

| Executor | Worktree e Branch de Trabalho | Arquivos Sob Sua Responsabilidade | Status |
|---|---|---|---|
| **Executor 1** | `/home/operacional/hydra-query-e1`<br>`feat/protection-e1-interpretation` | `src/hydra-sync/semantic_prompt.ts`<br>`src/hydra-sync/semantic_prompt.md`<br>`src/hydra-sync/system_prompt.md`<br>`src/hydra-sync/intent_rewriter.ts`<br>`src/hydra-sync/agent_dispatcher.ts` (lógica de prompt e templates) | **100% Concluído**<br>(16/16 Testes PASS) |
| **Executor 2** | `/home/operacional/hydra-query-e2`<br>`feat/obsidian-e2-vault` | `src/hydra-sync/balloon_composer.ts`<br>`src/hydra-sync/format_utils.ts`<br>`src/hydra-sync/whatsapp_formatter.ts`<br>`src/hydra-sync/operational_adapter.ts` (renderizadores de relatórios) | **100% Concluído**<br>(207/207 Testes PASS) |
| **Executor 3** | `/home/operacional/hydra-query-e3`<br>`feat/obsidian-e3-traces` | `src/hydra-sync/public_response_guard.ts`<br>`src/hydra-sync/dual_worker_router.ts`<br>`src/hydra-sync/tests/test_harness_language_whatsapp.ts` | **100% Concluído**<br>(104/104 Testes PASS) |
| **Principal** | Integrador do Workspace e Produção (`/opt/bots/`) | `src/hydra-sync/types/language_contract.ts`<br>Build Gate TypeScript estrito (`tsconfig.hydra.json`)<br>Consolidação de patches, deploy em produção e reload PM2 | **100% Homologado**<br>(276/276 Testes PASS) |

---

## 2. Tarefas Atômicas de Implementação

### Frente 1: Executor 1 — Voz, Tom e Interpretação Semântica
- [x] **[E1-01]** Criar diretrizes de tom executivo em `semantic_prompt.ts`, `semantic_prompt.md` e `system_prompt.md`: formalidade leve, resposta obrigatória na 1ª frase, sem gírias (*"bora"*, *"desenrolar"*, *"tô na escuta"*, *"meu parceiro"*) e sem saudações repetitivas.
- [x] **[E1-02]** Eliminar perguntas de encerramento automáticas (*"Posso ajudar em mais alguma coisa?"*), permitindo indagações somente quando necessárias para destravar a consulta.
- [x] **[E1-03]** Implementar reconhecimento ágil de correções de contexto em `intent_rewriter.ts`: responder com reconhecimento direto em 1 frase e entregar imediatamente os dados solicitados, sem pedir reexplicações redundantes.
- [x] **[E1-04]** Implementar geração da `CompactSemanticDecision` em `intent_rewriter.ts`: identificar intenção, entidade, loja, período e lista de componentes requeridos.
- [x] **[E1-05]** Implementar suporte a pedidos compostos (ex.: *"faturamento e OS do mês"*): verificar o status de cada componente e, em caso de indisponibilidade parcial, entregar o dado obtido e declarar com precisão a pendência do segundo.
- [x] **[E1-06]** Ajustar continuidade contextual elíptica (*"e ontem?"*, *"dessa loja"*): herdar estritamente a loja e métrica do turno anterior com recálculo determinístico do período civil.
- [x] **[E1-07]** Executar testes unitários de intenção e voz na worktree `hydra-query-e1` (16/16 PASS) e gerar patch `patch-executor1-language.diff`.

---

### Frente 2: Executor 2 — Renderização, Zero Emoji, Formatação e Compositor de Balões
- [x] **[E2-01]** Implementar `purgeDecorativeEmojis` em `format_utils.ts`: regex Unicode estrita (`/\p{Extended_Pictographic}/gu`) para eliminar emojis em saudações, despedidas, títulos e itens, tolerando no máximo 1 emoji em caso de alerta crítico comprovado por regra de negócio.
- [x] **[E2-02]** Implementar conversor estruturado anti-tabela `convertMarkdownTableToNativeBlocks` em `format_utils.ts`: analisar tabelas Markdown com barras (`|`) e convertê-las deterministicamente em cards nativos (`- *Campo:* valor`), preservando 100% dos dados sem perda de células ou rótulos.
- [x] **[E2-03]** Padronizar renderizadores de relatórios em `whatsapp_formatter.ts` e `operational_adapter.ts`: aplicar a convenção de blocos (`> *Título*`, `- *Campo:* valor`, `_Atualizado em..._`) a todos os produtores de relatórios do sistema.
- [x] **[E2-04]** Aprimorar `composeSemanticBalloons` em `balloon_composer.ts`: quebra semântica estrita por bloco lógico (faixa de 600–900 chars), proibindo corte no meio de cartões ou pares chave-valor.
- [x] **[E2-05]** Implementar barreira contra balões vazios: proibir o despacho de balões contendo apenas palavras isoladas (ex.: *"Entendi."* separado da resposta principal).
- [x] **[E2-06]** Executar testes unitários de formatação e balões na worktree `hydra-query-e2` (207/207 PASS) e gerar patch `patch-executor2-formatting.diff`.

---

### Frente 3: Executor 3 — Integração, Transporte, Validação e Matriz L01–L25
- [x] **[E3-01]** Integrar as políticas de formatação, purga de emojis e conversão anti-tabela na barreira `PublicResponseGuard` (`public_response_guard.ts`), garantindo conformidade nos payloads finais enviados.
- [x] **[E3-02]** Assegurar cancelamento atômico em voo: se o operador enviar nova mensagem ou reset, os balões pendentes da resposta anterior na fila são sumariamente descartados via `InFlightAbortRegistry`.
- [x] **[E3-03]** Garantir tratamento idempotente de entrega parcial: em falha transitória do segundo balão, registrar status parcial sem reenviar o primeiro balão.
- [x] **[E3-04]** Construir a suíte de testes integrados `src/hydra-sync/tests/test_harness_language_whatsapp.ts` cobrindo rigorosamente os 25 cenários da **Matriz de Aceitação L01 a L25**.
- [x] **[E3-05]** Executar testes de regressão (C01–C30, M01–M18, T01–T28) comprovando zero impacto nas regras de governança, banco e vault.
- [x] **[E3-06]** Homologar 100% de aprovação na worktree `hydra-query-e3` (104/104 PASS) e gerar patch `patch-executor3-integration.diff`.

---

### Frente Principal: Contratos, Build Gate e Promoção Segura
- [x] **[P-01]** Criar `src/hydra-sync/types/language_contract.ts` contendo as interfaces tipadas compartilhadas.
- [x] **[P-02]** Despachar e acompanhar a execução atômica nos 3 executores existentes via `send_message`.
- [x] **[P-03]** Coleta e aplicação sequencial dos 3 patches na worktree `hydra-staging` (Branch `feat/hydra-language-consolidated` commit `3caf05b`).
- [x] **[P-04]** Build gate estrito: `npx tsc --project tsconfig.hydra.json --noEmit` (0 erros tolerados — 100% aprovado).
- [x] **[P-05]** Execução da suíte completa de testes (L01 a L25 + suítes de regressão) em staging (276/276 testes aprovados).
- [x] **[P-06]** Backup preventivo de `/opt/bots/src/hydra-sync/` em `/opt/bots/src/hydra-sync_backup_20261002_170300`.
- [x] **[P-07]** Promoção controlada dos arquivos para produção em `/opt/bots/src/hydra-sync/` e recarregamento PM2 (`pm2 reload hydra-bot` PID 742036).
- [x] **[P-08]** Validação ao vivo via CLI nos cenários reais de linguagem, WhatsApp, pedidos compostos e zero emojis.

---

## 3. Circuit Breaker & Hard Stop

> **[HARD STOP OBRIGATÓRIO — SDD APPLY CONCLUÍDO]**  
> A implementação foi integralmente concluída pelos 3 Executores Especialistas, consolidada no staging, validada com 0 erros no compilador TypeScript, homologada com 276/276 testes aprovados e promovida com sucesso para o ambiente de produção PM2.  
> Conforme o protocolo do ciclo SDD, **nenhum commit na main é realizado**.  
> Para consolidar a memória Obsidian, atualizar o grafo e finalizar o ciclo, utilize o comando:  
> `/vibe-archive hydra-language-whatsapp-comprehension`
