# Proposta Técnica — Hydra: Ajuste Final de Linguagem, WhatsApp e Compreensão

**Versão:** 1.0  
**Data:** 02 de Outubro de 2026  
**Status:** PROPOSTA DE ESPECIFICAÇÃO (SDD Proposal)  
**ID da Spec:** `hydra-language-whatsapp-comprehension`  
**Destinatários:** Agente Principal e os 3 Executores Especialistas Existentes:
- **Executor 1** (`feat/protection-e1-interpretation` / `hydra-query-e1`): Voz, Tom e Interpretação Semântica
- **Executor 2** (`feat/obsidian-e2-vault` / `hydra-query-e2`): Renderização, Formatação e Compositor de Balões
- **Executor 3** (`feat/obsidian-e3-traces` / `hydra-query-e3`): Integração, Transporte, Validação e Suíte de Testes
- **Principal**: Integrador de Workspace, Contratos Tipados, Build Gate e Deploy Controlado

---

## 1. Visão Geral e Motivação

Nos testes recentes após a introdução da proteção pública e do desamordaçamento do prompt, o bot Hydra demonstrou melhora substancial de coerência: não mais alucina pátio quando perguntado sobre o Obsidian, não rejeita mais correções do operador confundindo-as com tickets do Chatwoot e mantém o diário no vault físico.

Entretanto, a experiência conversacional no WhatsApp ainda apresenta arestas de apresentação e clareza executiva:
1. **Linguagem e Tom:** Oscilação entre gírias coloquiais excessivas (*"desenrolar"*, *"tô na escuta"*, *"valeu pelo toque"*, *"meu parceiro"*) e saudações robóticas prolixas com fechamentos automáticos (*"Posso ajudar em mais alguma coisa?"*).
2. **Poluição Visual por Emojis:** Presença de emojis decorativos em saudações, títulos, listas e conclusões, que comprometem a sobriedade de um assistente de gestão corporativa.
3. **Fragilidade de Formatação e Tabelas:** Risco de o modelo gerar tabelas Markdown com barras (`|`), colunas alinhadas por tabulações ou cabeçalhos CommonMark (`#`), que quebram completamente a legibilidade na tela estreita do WhatsApp móvel.
4. **Divisão de Balões Desbalanceada:** Fragmentação em balões curtos vazios de significado (ex.: *"Entendi."* isolado em um balão separado) ou balões com corte inadvertido no meio de cards ou entre identificador de OS e seus respectivos detalhes.
5. **Compreensão de Pedidos Compostos e Continuidade:** Dificuldade em cobrir integralmente solicitações simultâneas (ex.: *"faturamento e OS do mês"* demandando ambos os componentes) e resolver elipses temporais (*"e ontem?"*) mantendo a autoridade de período e escopo.

Esta especificação define o padrão definitivo de voz, formatação, integridade de transporte e modelo semântico do Hydra, estabelecendo uma apresentação direta, executiva, limpa e fundamentada em dados reais.

---

## 2. Diagnóstico e Evidências Técnicas

| ID | Ponto Crítico | Evidência no Código Atual | Impacto Operacional |
|---|---|---|---|
| **E01** | Voz Excessivamente Informal | `agent_dispatcher.ts:494` injeta templates como *"Tô na escuta!"*, *"desenrolar agora"* e respostas com gírias. | Reduz a credibilidade executiva perante gerentes e sócios da rede. |
| **E02** | Emojis Decorativos Não Filtrados | `balloon_composer.ts` e `format_utils.ts` não possuem barreira determinística para expurgar emojis emitidos pelo LLM. | Balões chegam com emojis de foguinho, gráficos ou saudações desnecessárias. |
| **E03** | Risco de Regressão de Tabelas | Sanitizadores apenas limpam asteriscos duplos (`**`), mas não reconstroem tabelas Markdown (`|`) em blocos estruturados. | Se o LLM emitir tabela, os dados ficam desalinhados ou perdem células. |
| **E04** | Fragmentação Inadequada de Balões | Debounce de caracteres quebra por contagem simples (700-900 chars) sem garantir que o rótulo permaneça unido ao valor. | Títulos ficam isolados no balão 1 e os dados no balão 2. |
| **E05** | Respostas de Pedidos Compostos | Em `semantic_prompt.ts`, pedidos com dois componentes (ex: "OS e CMV") dependiam do revisor disparar `CONSULTAR`. | Risco de entregar apenas uma das partes sem declarar a pendência da outra. |
| **E06** | Continuidade de Período | Em `intent_rewriter.ts`, *"e ontem?"* ou *"e mês passado?"* necessita manter a loja e métrica exatas do turno anterior. | Risco de resetar o filtro da loja ou trocar a métrica consultada. |

---

## 3. Contrato de Voz e Padrão de Apresentação

### 3.1 Padrão de Voz
- **Direto, Profissional, Humano e Cordial:** Escrever como um assistente de gestão experiente, seguro e conciso.
- **Resposta na Primeira Frase:** A conclusão ou resposta direta ao operador deve abrir a mensagem. O contexto ou detalhamento vem a seguir.
- **Formalidade Leve:** Utilizar expressões naturais como *"Entendi"*, *"Faltam..."*, *"Encontrei..."*, *"Não consegui consultar..."*.
- **Eliminação de Clichês e Gírias:**
  - Proibido usar: *"meu parceiro"*, *"bora"*, *"tô na escuta"*, *"desenrolar"*, *"valeu pelo toque"*, *"opa, tranquilo"*.
  - Proibido usar introduções automáticas: *"Claro!"*, *"Com certeza!"*, *"Ótima pergunta!"*, *"Como uma IA..."*.
  - Proibido terminar rotineiramente com: *"Posso ajudar em mais alguma coisa?"*. Apenas fazer perguntas quando estritamente necessário para destravar a consulta.
- **Correções Sem Rodeios:** Ao reconhecer um mal-entendido, retificar em uma única frase e entregar imediatamente a resposta correta, sem pedir explicações redundantes ao operador.
- **Não Inventar Ações Humanas:** Nunca dizer *"liguei para a loja"*, *"falei com o mecânico"*, *"estou acompanhando no pátio"*. Descrever apenas consultas executadas e fatos verificados no banco de dados.

### 3.2 Política Rigorosa de Emojis
- **Padrão:** **Zero emojis** no texto de todas as mensagens e balões.
- **Exceção Única:** No máximo **1 emoji** em toda a resposta (somados todos os balões), estritamente se houver um alerta crítico comprovado por regra de negócio (ex.: risco de pátio travado há mais de 30 dias ou saldo expressivo bloqueado).
- **Substituição Preferencial:** Substituir ícones de alerta pelo marcador em negrito `*Atenção:*`.
- **Proibição Total:** Nenhum emoji em saudações, despedidas, títulos, confirmações, listas de OSs, faturamentos ou metas batidas.

### 3.3 Formatação de WhatsApp Nativa
O projeto adota a convenção de blocos limpos:
- **Título de Bloco:** `> *Título curto da unidade ou métrica*`
- **Destaque:** `*texto em negrito simples*` (zero `**`)
- **Linha de Campo / Dado:** `- *Rótulo:* valor formatado`
- **Nota de Atualização:** `_Dados atualizados em [data/hora]._` (somente se houver timestamp real)
- **Espaçamento:** Exatamente uma linha em branco entre blocos lógicos.
- **Listas Numeradas:** Apenas quando houver ordenação cronológica ou prioridade explícita.
- **Proibições:** Sem tabelas Markdown (`|`), sem cabeçalhos `#`, sem tabelas ASCII ou alinhamentos por espaços/tabs, sem caixas de código decorativas.

### 3.4 Divisão Semântica de Balões
- **Unidade de Assunto:** Cada balão deve encerrar um pensamento completo ou um grupo lógico de dados.
- **Extensão:**
  - Pergunta simples / saudação / confirmação: **1 balão curto** (1 a 2 frases).
  - Consulta com conclusão e detalhamento: **2 balões** (Balão 1: Resposta direta e resumo executivo; Balão 2: Detalhamento de itens ou OSs).
  - Consulta com múltiplos componentes ou plano de ação: **até 3 balões**.
  - Relatório extenso: blocos organizados com paginação explícita (máximo 20 itens por página).
- **Integridade de Cards:** Nunca separar o título dos seus campos, nunca separar o identificador da OS de seus dados e nunca enviar balões vazios contendo apenas saudações como *"Entendi."*.
- **Orçamento Textual:** Balões com média de 600 a 900 caracteres quando houver necessidade de quebra.

---

## 4. Compreensão Semântica e Cobertura de Pedidos

A interpretação deve consolidar uma **Decisão Semântica Compacta** no início do turno:
1. **Prevalência da Mensagem Atual:** Mensagens explícitas como *"agora o CMV"* anulam filtros anteriores de métricas (não herdam listagem de OSs do turno anterior).
2. **Continuidade Contextual:** Perguntas como *"e ontem?"*, *"dessa loja"* ou *"dessas ordens"* herdam estritamente a loja autorizada e a métrica do turno anterior, recalculando apenas a janela temporal.
3. **Correção com Aproveitamento de Contexto:** Após uma indagação sobre memória, a frase *"não é do chatwoot, é da nossa conversa"* retoma a intenção de memória funcional, sem cair em erro ou exigir reexplicação.
4. **Cobertura de Pedidos Compostos:** Pedidos como *"faturamento e OS do mês"* exigem a consolidação de ambos os componentes. Se um dos dados estiver indisponível, a resposta deve entregar o componente obtido e declarar expressamente a pendência do segundo.
5. **Rigor nos Períodos:** *"Hoje"*, *"mês atual"*, *"mês passado"* e *"últimos 30 dias"* possuem definições temporais civis distintas (fuso `America/Sao_Paulo`) e não podem ser trocados entre si.

---

## 5. Distribuição das Frentes de Trabalho

| Executor | Responsabilidade Central | Arquivos Sob Sua Tutela |
|---|---|---|
| **Executor 1** | Voz, Tom, Eliminação de Gírias, Decisão Semântica e Pedidos Compostos | `src/hydra-sync/semantic_prompt.ts`<br>`src/hydra-sync/semantic_prompt.md`<br>`src/hydra-sync/system_prompt.md`<br>`src/hydra-sync/intent_rewriter.ts`<br>`src/hydra-sync/agent_dispatcher.ts` (lógica de prompt e templates) |
| **Executor 2** | Renderização, Zero Emoji, Formatação em Blocos e Compositor de Balões | `src/hydra-sync/balloon_composer.ts`<br>`src/hydra-sync/format_utils.ts`<br>`src/hydra-sync/whatsapp_formatter.ts`<br>`src/hydra-sync/operational_adapter.ts` (renderizadores) |
| **Executor 3** | Integração de Transporte, Cancelamento em Voo, Entrega Parcial e Test Harness | `src/hydra-sync/public_response_guard.ts`<br>`src/hydra-sync/dual_worker_router.ts`<br>`src/hydra-sync/tests/test_harness_language_whatsapp.ts` |
| **Principal** | Contratos de Dados, Tipos TypeScript Estritos, Build Gate e Deploy PM2 | `src/hydra-sync/types/language_contract.ts`<br>`tsconfig.hydra.json`<br>Coordenação de patches e deploy sem downtime |

---

## 6. Análise de Riscos e Mitigações

1. **Risco de Perda de Dados na Eliminação de Tabelas:** O LLM pode formatar dados numéricos em tabelas Markdown com colunas vitais (ex: Peça, Valor, Mecânico).
   * *Mitigação:* O conversor anti-tabela no Executor 2 realiza parsing estruturado de células e converte linha por linha em cards com listas nativas (`- *Campo:* valor`), preservando 100% dos dados sem descartar texto.
2. **Risco de Quebra de Palavras na Filtragem de Emojis:** Regex genérica de emojis pode acidentalmente corromper caracteres acentuados da língua portuguesa (`ç`, `ã`, `é`).
   * *Mitigação:* Utilização de ranges Unicode estritos para símbolos gráficos e emojis (`\p{Extended_Pictographic}/u`), garantindo imunidade total para a tabela Latin-1 / UTF-8 do português.
3. **Risco de Cancelamento Concorrente:** O operador envia uma nova mensagem enquanto balões de um relatório longo estão sendo transmitidos.
   * *Mitigação:* O validador de envio checa o `InFlightAbortRegistry` e o `turnId` antes do despacho de cada balão subsequente, abortando a fila imediatamente sem duplicar envios obsoletos.
