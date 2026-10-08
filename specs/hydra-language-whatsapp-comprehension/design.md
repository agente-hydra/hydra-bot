# Documento de Design — Hydra: Linguagem, WhatsApp e Compreensão

**Versão:** 1.0  
**Data:** 02 de Outubro de 2026  
**Status:** DESIGN TÉCNICO (SDD Design)  
**ID da Spec:** `hydra-language-whatsapp-comprehension`  

---

## 1. Fluxo de Dados e Ciclo de Vida do Turno

O processamento de mensagens no Hydra é estruturado em **6 estágios sequenciais com barreira estrita**, garantindo que as regras de tom, formatação de blocos, zero emojis e proteção pública sejam aplicadas deterministicamente:

```
[Operador no WhatsApp]
         │
         ▼
[ESTÁGIO 1: Ingress & Decisão Semântica Compacta]
├── Resolução canônica de identidade (PN / LID) e escopo de loja
├── Invalidação de turnos em voo via InFlightAbortRegistry (se nova mensagem recebida)
└── Decisão semântica: intenção, escopo, período, componentes requeridos
         │
         ▼
[ESTÁGIO 2: Execução Determinística & Multi-Componente]
├── Execução de consultas rápidas para os componentes (faturamento, metas, OSs, CMV)
└── Consolidação de dados estruturados com indicação de componentes atendidos vs pendentes
         │
         ▼
[ESTÁGIO 3: Síntese Conversacional & Revisor Crítico (Voz Executiva)]
├── Prompt calibrado: formalidade leve, resposta na 1ª frase, sem gírias, sem clichês
└── Verificação factual: aprovação direta de candidatas corretas sem reescrita desnecessária
         │
         ▼
[ESTÁGIO 4: Transformação Estruturada Anti-Tabela & Purga de Emojis]
├── Parser e conversão estruturada de tabelas Markdown (|) para blocos nativos
└── Purga determinística de emojis decorativos (preserva no máx. 1 se alerta crítico)
         │
         ▼
[ESTÁGIO 5: Compositor Semântico de Balões por Unidade de Assunto]
├── Agrupamento em blocos coesos (faixa 600-900 chars)
├── Card-Aware Chunking: integridade absoluta de cartões operacionais e pares chave-valor
└── Proibição de balões vazios contendo apenas saudações ou palavras isoladas
         │
         ▼
[ESTÁGIO 6: Barreira Pública Anti-Vazamento & Despacho Controlado]
├── Sanitização de caminhos de disco, arquivos de código e schemas SQL
├── Checagem em voo de cancelamento antes de cada balão da fila
└── Envio sequencial ao WhatsApp com idempotência comprovada
```

---

## 2. Contratos Tipados e Interfaces TypeScript Estritas

Os tipos compartilhados serão definidos em `src/hydra-sync/types/language_contract.ts`:

```typescript
/**
 * src/hydra-sync/types/language_contract.ts
 * Contratos tipados estritos para Linguagem, WhatsApp Nativo e Decisão Semântica.
 */

export type SemanticTone = 'executive_direct' | 'conversational_light' | 'clarification' | 'correction_ack';

export type RequiredComponentType = 
  | 'REVENUE_DAY'
  | 'REVENUE_MONTH'
  | 'METAS_SUMMARY'
  | 'STORE_CMV'
  | 'OS_LIST'
  | 'OS_DETAIL'
  | 'YARD_AGING'
  | 'RUNTIME_DIAGNOSTICS'
  | 'CONVERSATION_HISTORY'
  | 'MEMORY_PREFERENCE';

export interface ComponentExecutionStatus {
  component: RequiredComponentType;
  status: 'AVAILABLE' | 'EMPTY' | 'UNAVAILABLE' | 'DENIED_SCOPE';
  sourceTable?: string;
  itemCount?: number;
  unavailabilityReason?: string;
}

export interface CompactSemanticDecision {
  turnId: string;
  canonicalIntent: string;
  topic: string;
  effectivePersona: 'socio' | 'gerente';
  allowedLojaSlug: string | null;
  period: 'hoje' | 'ontem' | 'mes_atual' | 'mes_passado' | 'ultimos_30_dias' | 'custom';
  periodDates?: { startDate: string; endDate: string };
  selectedEntityId?: string; // osId, placa, etc.
  requestedComponents: RequiredComponentType[];
  componentStatuses: ComponentExecutionStatus[];
  isCompoundQuery: boolean;
  hasAmbiguity: boolean;
  clarificationPrompt?: string;
}

export interface PublicFormattingPolicy {
  allowEmojis: boolean;
  maxCriticalAlertEmojis: number; // Teto: 1
  enforceBlockQuotes: boolean;     // > *Título*
  enforceKeyValueLists: boolean;   // - *Campo:* Valor
  enforceItalicFooter: boolean;    // _Dados atualizados em..._
  convertMarkdownTables: boolean;  // Reconstruir tabelas em cards
  forbidDoubleAsterisks: boolean;  // Zero **
  forbidCommonMarkHeaders: boolean;// Zero #
  forbidExcessiveInformality: boolean; // Barrar gírias na saída
}

export interface TableParsedCell {
  header: string;
  value: string;
}

export interface TableParsedRow {
  rowIndex: number;
  cells: TableParsedCell[];
}

export interface TableToBlockResult {
  hasTable: boolean;
  originalTableText: string;
  convertedBlocksText: string;
  rowsProcessed: number;
  dataPreserved: boolean;
}

export interface BalloonBlockUnit {
  index: number;
  subjectTitle?: string;
  content: string;
  charCount: number;
  isTerminal: boolean;
  hasCriticalAlert: boolean;
}

export interface ComposedBalloonsResult {
  balloons: string[];
  totalChars: number;
  balloonCount: number;
  emojisCount: number;
  isStructuredCard: boolean;
  sanitized: boolean;
}
```

---

## 3. Módulos e Responsabilidades Detalhadas

### 3.1 Executor 1 — Voz, Tom e Interpretação Semântica
- **Arquivos:**
  - `src/hydra-sync/semantic_prompt.ts`
  - `src/hydra-sync/semantic_prompt.md`
  - `src/hydra-sync/system_prompt.md`
  - `src/hydra-sync/intent_rewriter.ts`
  - `src/hydra-sync/agent_dispatcher.ts` (lógica de templates e prompt de síntese)
- **Implementações Específicas:**
  1. **Guia de Voz e Tom Executivo:**
     - Inserir no prompt base as diretrizes de **formalidade leve**, **resposta na 1ª frase** e brevidade profissional.
     - Proibir estritamente respostas com gírias (*"bora"*, *"desenrolar"*, *"tô na escuta"*, *"meu parceiro"*) e clichês robóticos (*"Posso ajudar em mais alguma coisa?"*).
  2. **Tratamento Ágil de Correção de Rumo:**
     - Quando o operador retificar um mal-entendido (`intent = 'conversation_correction'`), responder em 1 frase elegante (*"Entendido, peço desculpas pela confusão anterior."*) e entregar imediatamente a resposta correta à solicitação retificada.
  3. **Decisão Semântica Compacta e Pedidos Compostos:**
     - Implementar em `intent_rewriter.ts` a geração da `CompactSemanticDecision`.
     - Identificar pedidos com múltiplos componentes (ex: *"faturamento e OS do mês"* -> `['REVENUE_MONTH', 'OS_LIST']`).
     - Para cada componente, indicar se foi atendido ou pendente. Na ausência de um deles, declarar expressamente a parte faltante.
  4. **Continuidade de Período e Escopo:**
     - Resolver continuidades (*"e ontem?"*, *"e mês passado?"*) preservando o `lojaSlug` e a métrica do turno anterior.
     - Em caso de ambiguidade real (duas lojas plausíveis), gerar pergunta de esclarecimento específica, sem suposições.

### 3.2 Executor 2 — Renderização, Zero Emoji, Formatação e Compositor de Balões
- **Arquivos:**
  - `src/hydra-sync/balloon_composer.ts`
  - `src/hydra-sync/format_utils.ts`
  - `src/hydra-sync/whatsapp_formatter.ts`
  - `src/hydra-sync/operational_adapter.ts` (funções de renderização)
- **Implementações Específicas:**
  1. **Política de Zero Emoji:**
     - Criar `purgeDecorativeEmojis(text: string, options?: { allowOneCriticalAlert?: boolean }): string` em `format_utils.ts`.
     - Utilizar regex Unicode estrita `/\p{Extended_Pictographic}/gu`, filtrando emojis decorativos em saudações, despedidas, títulos e itens.
     - Permitir no máximo 1 emoji em caso de alerta operacional comprovado (ex.: carro parado há mais de 30 dias com `diasNoPatio > 30`), convertendo alertas padrão para `*Atenção:*`.
  2. **Conversor Estruturado Anti-Tabela:**
     - Criar `convertMarkdownTableToNativeBlocks(text: string): TableToBlockResult` em `format_utils.ts`.
     - Realizar parsing de cabeçalhos e linhas delimitadas por `|`.
     - Converter cada linha em um card nativo com recuo e marcadores:
       ```text
       *Item 1*
       - *Coluna A:* Valor A
       - *Coluna B:* Valor B
       ```
     - Garantir que zero dados ou células sejam perdidos na conversão.
  3. **Compositor de Balões por Unidade de Assunto:**
     - Aprimorar `composeSemanticBalloons` em `balloon_composer.ts`.
     - Respostas curtas (<600 chars): sempre 1 balão.
     - Respostas médias/longas: quebra semântica estrita por bloco (`> *Título*`), com faixa alvo de 600–900 caracteres.
     - Proibição absoluta de quebrar dentro de pares chave-valor (`- *Rótulo:* valor`) ou no meio de listas de itens.
     - Proibição de gerar balões isolados com saudações vazias como *"Entendi."*.

### 3.3 Executor 3 — Integração de Transporte, Cancelamento em Voo e Suíte de Testes
- **Arquivos:**
  - `src/hydra-sync/public_response_guard.ts`
  - `src/hydra-sync/dual_worker_router.ts`
  - `src/hydra-sync/tests/test_harness_language_whatsapp.ts`
- **Implementações Específicas:**
  1. **Validação Final de Payloads de Saída:**
     - Integrar a sanitização de linguagem e formatação na barreira `PublicResponseGuard`, assegurando que a resposta final expedida cumpra:
       * Zero caminhos de disco e zero schemas.
       * Zero tabelas Markdown.
       * Zero asteriscos duplos (`**`).
       * Emojis compatíveis com a política restrita.
  2. **Cancelamento Concorrente e Entrega Parcial:**
     - Validar que novos turnos do mesmo telefone cancelem o envio de balões pendentes da resposta anterior.
     - Garantir rastreabilidade de entrega parcial sem duplicação de balões já enviados.
  3. **Construção do Test Harness L01 a L25:**
     - Criar a suíte integrada `test_harness_language_whatsapp.ts` cobrindo rigorosamente todos os 25 cenários da Matriz de Aceitação.

---

## 4. Matriz de Aceitação e Cenários de Teste (L01 a L25)

| ID | Cenário / Entrada de Teste | Comportamento Obrigatório Esperado |
|---|---|---|
| **L01** | Saudação simples: `"Bom dia!"` | 1 único balão curto, formalidade leve, sem emoji, sem reapresentação robótica e sem pergunta forçada. |
| **L02** | Confirmação de recebimento: `"Beleza, obrigado"` | 1 balão cordial e breve (*"À disposição."* ou *"Qualquer dúvida, estou por aqui."*), sem gírias. |
| **L03** | Pergunta sobre meta: `"Falta muito para bater a meta?"` | Resposta direta na 1ª frase (*"Faltam R$ X para a meta de [período]. O atingimento está em Y%."*), seguida de bloco `> *[Loja] — meta do mês*`. |
| **L04** | Pedido composto: `"Faturamento e OS do mês da minha loja"` | Responde ambos os componentes em blocos organizados (ou balão 1 com faturamento/resumo e balão 2 com lista de OSs). |
| **L05** | Pedido composto com falha parcial: `"Faturamento e CMV de hoje"` (se CMV não tiver snapshot) | Entrega faturamento de hoje com sucesso e declara expressamente que o CMV de hoje ainda não está disponível. |
| **L06** | Continuação temporal elíptica: `"E ontem?"` após consulta de faturamento | Mantém a mesma loja e métrica (faturamento), alterando apenas a data para o dia civil de ontem. |
| **L07** | Continuação de entidade: `"Dessa loja"` ou `"Dessas OS"` | Herda estritamente a loja e as ordens do turno imediatamente anterior. |
| **L08** | Correção de contexto: `"Não é do Chatwoot, é da nossa conversa"` | Retoma a consulta de memória funcional sem desculpas prolixas ou pedidos redundantes de explicação. |
| **L09** | Ambiguidade real: Pedido sem loja por operador com visão de rede | Faz uma única pergunta direta e objetiva solicitando a unidade desejada, sem adivinhar. |
| **L10** | Tabela emitida pelo LLM contendo OSs e valores | Conversor anti-tabela transforma em blocos nativos com `- *Campo:* Valor`, preservando 100% dos dados. |
| **L11** | Emojis decorativos emitidos pelo LLM (foguinho, gráfico, robô) | Expurgados sumariamente no payload final (0 emojis). |
| **L12** | Alerta crítico com veículo retido há 180 dias | Permite no máximo 1 emoji de alerta (ou `*Atenção:*`), mantendo sobriedade executiva. |
| **L13** | Comparativo entre lojas | Blocos equivalentes com os mesmos campos para cada loja comparada, seguidos de conclusão factual. |
| **L14** | Lista extensa com mais de 20 OSs | Paginação determinística clara informando cobertura e total de registros, sem truncamento silencioso. |
| **L15** | Pedido de tabela explícito: `"Me mande em forma de tabela"` | Responde que no WhatsApp a visualização é formatada em blocos limpos para facilitar a leitura no celular. |
| **L16** | Período `"Últimos 30 dias"` na virada do mês | Respeita o intervalo móvel [D-29, D] e não substitui pelo mês civil corrente. |
| **L17** | Período `"Mês passado"` | Respeita o intervalo civil completo do mês anterior [01 do mês passado ao último dia do mês passado]. |
| **L18** | Tentativa de acesso a outra loja por Gerente | Restrição de escopo educada orientando o uso de `/perfil`, sem vazamento de dados. |
| **L19** | Tentativa de extração de system prompt | Recusa pública limpa padrão (*"Detalhes técnicos internos não são disponibilizados por aqui..."*). |
| **L20** | Envio de credenciais ou senhas na conversa | Máscara automática `[DADO_PROTEGIDO]` antes de persistir no diário e sem ecoar dados na resposta. |
| **L21** | Divisão de resposta longa em 2 balões | Balão 1 termina no fechamento de um bloco lógico; balão 2 inicia com novo título de bloco; zero quebras em campos. |
| **L22** | Checagem de balão vazio | Impossibilidade de despachar balão contendo apenas palavras soltas como *"Entendi."*. |
| **L23** | Cancelamento de turno em voo por nova mensagem | Balões não enviados do turno anterior são imediatamente abortados pelo `InFlightAbortRegistry`. |
| **L24** | Preservação de acentuação e moeda brasileira | R$ 1.234,56, acentos (`ç`, `ã`, `é`) preservados 100% sem corrupção UTF-8. |
| **L25** | Formatação WhatsApp sem `**` e sem `#` | Zero asteriscos duplos e zero hashes de título em todos os balões finais expedidos. |
