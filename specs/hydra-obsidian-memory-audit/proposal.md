# Proposal — Hydra: Auditoria e Implantação do Obsidian por Número, Memória Persistente e Interpretação Semântica

**Data:** 02 de Outubro de 2026  
**Status:** PROPOSTA / PLANEJAMENTO (SDD Proposal)  
**ID da Spec:** `hydra-obsidian-memory-audit`  
**Destinatários:** Agente Principal e os 3 Executores Especialistas:
- **Executor 1 (Interpretação, Diagnóstico e Prompt):** Sessão `Hydra Operational Context Handoff` (`de5452f5-ae9d-4de2-af64-0b12f075f5ea`)
- **Executor 2 (Vault por Identidade, Armazenamento e Memória):** Sessão `Hydra Ecosystem Context Transfer` (`7b9923e9-f4d2-46ff-8a6b-ea932132e04d`)
- **Executor 3 (Traces Reais, Histórico e Harness M01-M18):** Sessão `Hydra Ecosystem Operational Handover` (`5dffcfaf-5e84-438e-81f0-88558655f4c0`)

---

## 1. Contexto, Problema e Diagnóstico Comprovado

Durante a auditoria realizada no runtime, banco e código da VPS operacional (`operacional@100.126.50.101`), foi detectada uma divergência estrutural severa no fluxo conversacional do Hydra quando submetido a perguntas sobre o seu próprio funcionamento, memória e ferramentas. Especificamente, o incidente registrado no log `agent_interaction_logs` (ID 835) evidenciou que a pergunta real do operador:
> *"o seu obsidian ta funcionando? como tsua memoria"*

foi respondida com uma listagem de veículos retidos no pátio da oficina.

A análise aprofundada dos arquivos da aplicação identificou **dez causas raízes comprovadas (A01 a A10)** que inviabilizam o funcionamento correto da memória persistente e degradam a fidelidade interpretativa do bot:

### A01 — Roteamento Determinístico Espúrio por Substring (`dia`)
Em `/opt/bots/src/hydra-sync/intent_rewriter.ts:2498` (e replicações em branches de staging):
```typescript
if (norm.includes('patio') || norm.includes('parado') ||
    norm.includes('travado') ||
    (norm.includes('dia') && !norm.includes('bom dia'))) {
```
A substring `"dia"` está contida no lexema `"obsidian"` (`obsi` + `dia` + `n`), bem como em `"diagnostico"` e `"diario"`. Como consequência matemática, qualquer menção ao termo *Obsidian* ativa a cláusula e reescreve a pergunta para `"Listar veículos retidos no pátio..."`. O módulo `agent_dispatcher.ts` injeta essa solicitação canônica como mandamento exclusivo para o modelo, forçando uma alucinação funcional induzida pelo próprio pré-processamento.

### A02 — Ausência de Conexão com Vault Real por Número
Nenhuma integração de leitura ou escrita com diretórios de vault Obsidian por identidade de usuário foi encontrada no runtime. Em `agent_dispatcher.ts:84`, há apenas uma tentativa legada de ler `.agent/memory/domain.md` relativo ao diretório atual (`/opt/bots`), truncada em 1.500 caracteres, inexistente no container e puramente global (sem qualquer isolamento por operador). O arquivo de configuração MCP primário (`/home/operacional/.gemini/config/mcp_config.json`) expõe unicamente `hydra-ops`, sem adapters para filesystem de vault.

### A03 — Memória Persistente Vazia no SQLite
No banco operacional `/home/operacional/hydra-data/hydra_ops.db`, as tabelas `hydra_memories`, `hydra_daily_memories` e `hydra_memory_consolidation_checkpoints` contêm **0 registros**. A tabela `hydra_user_memory` possui apenas 2 registros com seções diária e semanal vazias, embora a tabela `conversation_messages` contenha 1.637 registros. Há histórico de mensagens gravado, mas nenhuma memória estruturada consolidada.

### A04 — Assimetria entre Perfis (Sócio lê, mas não grava)
Em `agent_dispatcher.ts:571`, o fluxo de Sócio consulta `retrieveActiveMemories`, mas **nunca executa `validateAndPersistMemoryCandidates`**. Esse método de persistência só é acionado na linha 986, dentro da rotina do Revisor Crítico de Gerente. Como os usuários executivos operam frequentemente como sócios, nenhuma preferência declarada por eles é gravada.

### A05 — Histórico Curto Induzindo Falsas Afirmações Temporais
Nos logs 833 e 834, quando o operador questiona *"qual foi a minha primeira pergunta?"*, o bot emite respostas contraditórias deduzidas de uma janela recente de apenas 4 mensagens (`convHistory.slice(0, -1)`). A aplicação não dispõe de uma consulta estruturada ao histórico de sessão/geração, confundindo o início do buffer de contexto com o início real da conversa.

### A06 — Falsa Telemetria de Ferramentas (`mcp:hydra-ops`)
Em `agent_dispatcher.ts:602`, a etiqueta `'mcp:hydra-ops'` é inserida em `toolsCalled` sempre que o worker primário retorna uma resposta válida, sem verificar se houve execução efetiva de alguma ferramenta do MCP. Respostas conceituais (como no log 838 sobre o harness) recebem a tag de MCP indevidamente.

### A07 — Autodescrição e Alucinação sobre o Estado do Servidor
O modelo responde a perguntas de diagnóstico baseando-se em autodescrições genéricas e instruções de prompt contraditórias, em vez de dados auditáveis do servidor. Status de conectores, memória e vault devem originar-se de telemetria determinística (`runtime_diagnostics`), e nunca de raciocínio livre do LLM.

### A08 — Fragilidade nas Evidências de Testes
A suíte unificada legada compara contadores locais que não interceptam fronteiras reais de rede ou subprocessos, validando stubs estáticos em vez de fluxos operacionais completos. Não havia nenhum teste cobrindo a pergunta real sobre Obsidian.

### A09 — Lacunas na Recuperação Vetorial e Substituição de Memória
A busca em `vec_user_memory` (`memory_retriever.ts:202`) executa apenas `JOIN` e `LIMIT` sem cálculo de similaridade de cosseno ou embeddings reais. Ademais, em `memory_repository.ts:393`, a substituição de memórias por correções busca por `(phone, generation_id, topic_key)` sem filtrar por loja/escopo, correndo o risco de uma correção feita em uma loja invalidar preferências legítimas do mesmo tópico em outra loja do mesmo usuário.

### A10 — Ausência de Agendamento Observável de Consolidação
Embora as rotinas `runDailyConsolidation` e `runWeeklyConsolidation` existam no código, não há chamadores em produção, crontabs ativos ou checkpoints gravados no SQLite, caracterizando uma capacidade latente sem execução real.

---

## 2. Objetivos e Escopo da Proposta

Esta especificação define a arquitetura, contratos e plano de implementação para sanar definitivamente as 10 causas raízes, estabelecendo o ecossistema de memória real do Hydra.

### Objetivos Principais:
1. **Eliminar Gatilhos por Substring:** Reformular completamente a classificação de intenções em `intent_rewriter.ts`, exigindo gramática contextual estrita (objeto operacional + estado/tempo + verbo) e extinguindo o casamento isolado de `"dia"`.
2. **Implantar o Vault Obsidian por Número:** Criar e conectar a estrutura de notas Markdown do Obsidian em `/home/operacional/hydra-data/vault/usuarios/<identidade_canonica>/`, tornando-a a fonte durável de preferências e correções do usuário, com sincronização bidirecional e indexação no SQLite.
3. **Unificar o Pipeline de Memória para Sócio e Gerente:** Implementar extração, validação factual de evidências e gravação transacional tanto no fluxo de Sócio quanto no de Gerente, respeitando o isolamento estrito de loja e escopo efetivo.
4. **Substituição Cirúrgica com Escopo Quíntuplo:** Restringir substituições de correção estritamente ao grupo quíntuplo `(phone, generation_id, scope_type, loja_slug, topic_key)`.
5. **Consulta de Histórico da Sessão/Geração:** Criar ferramenta e rota de consulta para responder com exatidão a pedidos sobre o histórico (ex: *"qual foi a primeira pergunta?"*), sem inferir a partir do buffer curto de 4 mensagens.
6. **Telemetria e Traces Verificáveis de Ferramentas:** Rastrear chamadas reais de ferramentas através de instrumentação na fronteira MCP/worker, eliminando a etiquetagem sintética em `toolsCalled`.
7. **Diagnóstico Factual de Runtime (`runtime_diagnostics`):** Expor estado real de conexão do vault, elegibilidade de memórias, geração ativa e ferramentas disponíveis para consumo do bot em perguntas meta-operacionais.
8. **Validação Rigorosa M01 a M18 e Replay 833-838:** Construir suíte de testes com fixtures isoladas, banco em memória e validação pontual de cada evidência exigida na auditoria.

### Fora de Escopo:
- Instalação de interface gráfica do Obsidian na VPS (o vault opera 100% headless via sistema de arquivos e notas Markdown padrão).
- Alteração no modelo primário de linguagem ou troca de provedores LLM.
- Alteração nos parâmetros de debounce (1.500ms / 5.000ms) ou TTL de OS (120min) já calibrados.
- Comandos destrutivos (`DELETE`) sobre dados históricos de ordens de serviço.

---

## 3. Contratos de Dados e Arquitetura do Vault

### 3.1 Identidade Canônica e Estrutura de Diretórios
A raiz oficial do vault fica configurada em:
```text
/home/operacional/hydra-data/vault/
```
Cada operador autenticado possui um namespace próprio baseado em sua identidade canônica resolvida (`phone_canonical`, ex: `5511999990001`):

```text
/home/operacional/hydra-data/vault/usuarios/<phone_canonical>/
├── perfil.md
├── preferencias/
│   ├── mem_5511999990001_gen1_pref_fat_primeiro.md
│   └── mem_5511999990001_gen1_pref_cmv_percent.md
├── correcoes/
│   └── mem_5511999990001_gen1_corr_retidos_dias.md
└── diario/
    └── 2026-10-02.md
```

### 3.2 Contrato da Nota de Memória (Frontmatter YAML Tipado)
Cada arquivo `.md` de preferência ou correção contém metadados formais que vinculam a nota à autoridade do sistema:

```markdown
---
id: "mem_5511999990001_gen1_1727870400_a1b2"
owner: "5511999990001"
generation_id: 1
scope_type: "loja"
loja_slug: "MPJorgeBeretta"
topic_key: "ordem_apresentacao"
memory_type: "explicit_preference"
status: "active"
version: 1
confidence: 1.0
evidence_text: "Prefiro ver faturamento antes de OS"
source_turn_ids: ["turn-1727870390"]
created_at: "2026-10-02T10:00:00-03:00"
confirmed_at: "2026-10-02T10:00:00-03:00"
expires_at: null
superseded_by: null
---

# Regra de Apresentação
O operador determinou explicitamente que consultas gerais devem apresentar os indicadores de faturamento bruto antes da listagem de ordens de serviço.
```

### 3.3 Garantias de Integridade e Segurança
1. **Contenção Estrita de Diretório (Anti-Path-Traversal):** A resolução de caminhos dentro do vault valida deterministicamente que o caminho final reside estritamente sob `/home/operacional/hydra-data/vault/usuarios/<phone_canonical>/`. Tentativas de injeção (`../`, `/etc/`, links simbólicos) geram erro imediato de segurança.
2. **Autoridade do Sistema sobre Privilégios:** O arquivo `perfil.md` e as notas de preferências registram exclusivamente preferências de apresentação e interpretação. Direitos de acesso (`allowedStores`), persona autorizada e permissão de simulação (`can_simulate_persona`) residem estritamente na tabela SQLite `hydra_authorized_users`. Nenhuma nota Markdown pode conceder privilégios ou burlar barreiras de loja.
3. **Gravação Transacional Two-Phase:** A escrita no vault grava primeiro em arquivo temporário atômico (`.tmp_<id>.md`) e executa `rename` atômico sobre o arquivo final, seguido de upsert correspondente no índice SQLite `hydra_vault_index`. Se o processo for interrompido, a recuperação por checkpoint sincroniza o estado pendente.

---

## 4. Distribuição das Frentes de Trabalho entre os Executores

Em estrita consonância com a solicitação do usuário (*"pros 3 novamente"*), as responsabilidades são divididas de forma disjunta entre o Principal e os três Executores:

```
┌────────────────────────────────────────────────────────────────────────┐
│                          AGENTE PRINCIPAL                              │
│ - Coordenação, contratos compartilhados (types/vault_contract.ts)      │
│ - Auditoria de integridade, merge de patches e build gate estrito     │
└──────────────────┬─────────────────┬───────────────────┬───────────────┘
                   │                 │                   │
                   ▼                 ▼                   ▼
       ┌──────────────────────┐ ┌───────────────┐ ┌──────────────────────┐
       │     EXECUTOR 1       │ │  EXECUTOR 2   │ │     EXECUTOR 3       │
       │   Interpretação,     │ │   Vault por   │ │   Traces Reais,      │
       │  Diagnóstico Runtime │ │ Identidade &  │ │    Histórico &       │
       │   & Prompt Seguro    │ │ Memória SQLite│ │  Harness M01-M18     │
       └──────────────────────┘ └───────────────┘ └──────────────────────┘
```

### Frente 1 (Executor 1 — Sessão `de5452f5`):
- **Arquivos:** `src/hydra-sync/intent_rewriter.ts`, `src/hydra-sync/semantic_prompt.ts`, `src/hydra-sync/runtime_diagnostics.ts`, `src/hydra-sync/agent_dispatcher.ts` (camada de intenção e prompt).
- **Entregáveis:**
  1. Correção imediata de `intent_rewriter.ts`: remoção do teste espúrio `dia`, substituição por gramática contextual para pátio e classificação precisa de intenções meta-operacionais (`RUNTIME_DIAGNOSTICS`, `MEMORY_QUERY`, `CONVERSATION_HISTORY`).
  2. Implementação de `runtime_diagnostics.ts`: provedor de estado factual (status do vault, total de notas elegíveis, geração, motor ativo) para consumo pelo revisor e dispatcher.
  3. Atualização de `semantic_prompt.ts` e `system_prompt.md`: eliminação de instruções contraditórias e garantia de que o modelo reporte o estado real do sistema sem inventar diagnósticos.

### Frente 2 (Executor 2 — Sessão `7b9923e9`):
- **Arquivos:** `src/hydra-sync/vault_manager.ts`, `src/hydra-sync/memory_repository.ts`, `src/hydra-sync/memory_retriever.ts`, `src/hydra-sync/memory_consolidator.ts`.
- **Entregáveis:**
  1. Criação de `vault_manager.ts`: driver de leitura e escrita do vault em `/home/operacional/hydra-data/vault/usuarios/<phone>/` com gravação atômica, validação de frontmatter e isolamento de path.
  2. Unificação da persistência em `memory_repository.ts`: suporte a Sócio e Gerente com validação obrigatória de evidência textual e agrupamento quíntuplo nas substituições por correção.
  3. Aperfeiçoamento de `memory_retriever.ts`: leitura direta das notas indexadas com respeito estrito a dono, geração e escopo de loja, saneando a comparação de expiração e desabilitando o JOIN vetorial cego enquanto não houver cálculo de similaridade real.
  4. Agendamento e checkpoints de consolidação em `memory_consolidator.ts`.

### Frente 3 (Executor 3 — Sessão `5dffcfaf`):
- **Arquivos:** `src/hydra-sync/tool_execution_tracker.ts`, `src/hydra-sync/conversation_history_service.ts`, `src/hydra-sync/tests/test_harness_obsidian_memory.ts`.
- **Entregáveis:**
  1. Criação de `conversation_history_service.ts`: consulta autorizada ao histórico de mensagens no SQLite para perguntas estruturadas de histórico (*"qual foi minha primeira pergunta?"*), com escopo de sessão, dia ou geração.
  2. Implementação de `tool_execution_tracker.ts`: interceptação e auditoria real de ferramentas MCP e adapters de banco, eliminando tags sintéticas de `toolsCalled`.
  3. Construção do Test Harness Unificado M01 a M18 em `test_harness_obsidian_memory.ts`, cobrindo 100% das asserções da auditoria e o replay determinístico dos turnos 833 a 838 com dados sanitizados.

---

## 5. Matriz de Aceitação e Testes de Validação (M01 a M18)

| ID | Cenário | Responsáveis | Critério de Aprovação Inegociável |
|:---|:---|:---:|:---|
| **M01** | Pergunta real sobre Obsidian | E1, E3 | Pergunta `"o seu obsidian ta funcionando? como tsua memoria"` não aciona pátio; consulta o status real do vault via `runtime_diagnostics`. |
| **M02** | Palavras `"diagnóstico"`, `"diário"` e pedido real de retenção | E1 | Nenhuma classificação por substring isolada; períodos ou termos contendo "dia" não viram pátio sozinhos. |
| **M03** | Sócio pede preferência, reinicia processo e consulta depois | E1, E2, E3 | Nota durável criada em `usuarios/<phone>/preferencias/`, indexada no SQLite, recuperada e aplicada no escopo de rede após reinício. |
| **M04** | Mesmo fluxo com Gerente | E1, E2, E3 | Mesma persistência durável no vault, porém estritamente confinada à loja autorizada do gerente. |
| **M05** | Dois números e mesma preferência com valores distintos | E2, E3 | Vaults segregados em diretórios físicos diferentes; zero contaminação de contexto no prompt ou nas consultas. |
| **M06** | Identidade PN/LID e número citado no corpo do texto | E1, E2 | Vault selecionado estritamente pela identidade canônica autenticada; número citado na mensagem não seleciona vault de terceiros. |
| **M07** | Admin vê rede, simula gerente e retorna a sócio | E1, E2, E3 | Histórico, memórias elegíveis, cache e balões respeitam o perfil ativo do turno e a geração de memória. |
| **M08** | Correção do mesmo tópico em duas lojas distintas | E2 | Correção na loja A substitui apenas a memória da loja A; preferência da loja B permanece intacta. |
| **M09** | *"Qual foi a primeira pergunta?"* | E1, E3 | Consulta o histórico estruturado da sessão/geração; não deduz a partir da janela recente de 4 mensagens. |
| **M10** | Comando `/reset` durante escrita ou consolidação | E1, E2 | Barreira de geração bloqueia commits atrasados; memórias da geração anterior não reaparecem na nova sessão. |
| **M11** | Falha de energia/processo após gravar arquivo e antes do índice | E2, E3 | Checkpoint idempotente detecta arquivo sem índice no próximo ciclo e reindexa sem duplicar nem corromper. |
| **M12** | Vault desativado, sem permissão ou vazio | E1, E2 | `runtime_diagnostics` reporta status factual transparente; bot não afirma falsamente que salvou. |
| **M13** | Nota Markdown externa tenta injetar permissões | E2 | Dados da nota tratados como texto puro; privilégios e permissões de loja mantidos estritamente no SQLite do servidor. |
| **M14** | Memória expirada com caminho vetorial ativado | E2 | Filtro temporal `expires_at > datetime('now')` aplicado uniformemente em todos os métodos de busca. |
| **M15** | Worker responde sem ferramentas vs com ferramenta real | E3 | Telemetria distingue claramente execução de tool MCP de inferência puramente textual. |
| **M16** | Reexecução repetida de jobs de consolidação | E2, E3 | Zero duplicação de memórias; zero chamadas a APIs de LLM; zero disparos ao WhatsApp. |
| **M17** | Handler real recebe evento com transporte simulado | E1, E3 | Exercita o código de produção sem mocks internos redundantes. |
| **M18** | Candidato a memória fabricado, contraditório ou sem evidência | E1, E2 | Validador determinístico rejeita candidato se o trecho de evidência não constar na mensagem do operador. |

---

## 6. Análise de Riscos e Mitigações

1. **Risco de Desincronização entre Sistema de Arquivos e SQLite:**
   * *Mitigação:* O driver `vault_manager.ts` implementa reconciliação bidirecional baseada em hash SHA-256 e versão. Ao iniciar, o sistema escaneia o diretório de notas e reconcilia o índice SQLite de forma idempotente.
2. **Risco de Falsas Afirmações de Salvamento de Memória:**
   * *Mitigação:* A resposta do bot só pode declarar confirmação de gravação após o retorno positivo do `writeVaultNote` e commit no banco. Falhas geram aviso honesto de contingência.
3. **Risco de Concorrência em Escritas Simultâneas do Mesmo Operador:**
   * *Mitigação:* Locks de arquivo por identidade baseados em Promises seriais em memória no Node.js (`chatQueues` já existentes) e transactions imediatas no SQLite WAL.
4. **Risco de Quebra dos Fluxos Já Aprovados da Release Anterior:**
   * *Mitigação:* Manter a suíte integrada T01 a T28 como teste de regressão obrigatório em todos os passos da integração.

---

## 7. Critérios de Sucesso e Conclusão

A feature será considerada concluída somente quando:
1. `npx tsc --project tsconfig.hydra.json --noEmit` retornar código 0.
2. A suíte M01 a M18 estiver com 100% de aprovação comprovada na VPS.
3. O replay dos turnos 833 a 838 demonstrar:
   - Turno 835: resposta sobre o estado real do Obsidian e da memória (sem listagem de pátio).
   - Turnos 833/834: consulta exata da primeira pergunta no histórico autorizado.
   - Turno 838: telemetria factual sem falsa inclusão de `mcp:hydra-ops`.
4. Uma preferência real criada por um Sócio persistir no vault `/home/operacional/hydra-data/vault/usuarios/<phone>/`, ser reindexada no SQLite e recuperada com sucesso após reinício do processo.
