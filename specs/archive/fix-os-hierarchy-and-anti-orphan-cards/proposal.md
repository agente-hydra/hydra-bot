# Proposta: Hierarquia Visual Hermes 2.0 & Blindagem Anti-Orphan Card

## 1. Contexto & Problema
O operador do WhatsApp recebeu listagens operacionais de Ordens de Serviço (OSs) com formatação precária, quebra indevida de dados e fragmentação de mensagens:

1. **Hierarquia Quebrada e Visual Legado:**
   - Cards emitidos com blockquote solto `> OS #XXXX — MODELO (PLACA)` em vez do cabeçalho oficial limpo em negrito `*OS #XXXX — MODELO (PLACA)*`.
   - Subitens exibidos como bullets simples colados (`- Status: Finalizada / Entregue • Pátio: 0 dias`, `- Cliente: ...`, `- Valor: ...`) em vez da estrutura hierárquica em árvore com joelho (`  └ `) solicitada pelo usuário.
   - Ausência de respiro visual (parágrafo duplo `\n\n`) entre ordens consecutivas, resultando em uma massa corrida de texto compacta e confusa.
2. **Divisão Órfã de Balão (Orphan Title Balloon Split):**
   - O Balão 1 do WhatsApp encerrou abruptamente com a linha do título `> OS #466 — PEUGEOT 207 (ERB6H96)`, enquanto o Balão 2 começou imediatamente com os atributos `- Status: Finalizada / Entregue • Pátio: 0 dias`.
   - Um cabeçalho de veículo ficou isolado no rodapé de uma mensagem, separado de suas propriedades operacionais e financeiras.
3. **Falta de Discriminação de Pátio Ativo vs Faturadas/Finalizadas:**
   - Ao consultar a posição da unidade, foram despejadas 6 ordens finalizadas com "Pátio: 0 dias" e "Saldo: R$ 0,00", obscurecendo a visão operacional real do pátio físico da loja.
4. **Causa Raiz Técnica Identificada:**
   - `reformatPipedLinesToHermesCards` (em `src/hydra-sync/format_utils.ts`) ainda continha templates legados injetando `> *OS #${osId}*` e `- *Status:* ${status}`.
   - `splitIntoAtomicItems` (em `balloon_composer.ts`) não reconhecia linhas com joelho `  └ ` como filhos de um card atômico (`hasFieldBullets` verificava apenas `- `), provocando quebra indevida no fatiamento.
   - `webhook-listener.js` (linha 1116) rejuntava os balões pré-validados do dispatcher em uma string crua e os submetia novamente a `composeSemanticBalloons`, destruindo o chunking seguro do `splitIntoWhatsAppBlocks`.

---

## 2. Solução Proposta

### 2.1. Padrão Visual Canônico Obrigatório (Hermes 2.0 Hierárquico)
Toda e qualquer listagem de ordens de serviço (seja via SQL nativo, RAG ou síntese da LLM) deve respeitar compulsoriamente a seguinte anatomia:

```text
*OS #465 — FORD KA SE (BXD6F52)*
  └ Status: *NA FILA PARA EXECUÇÃO* · *4 dias* no pátio
  └ Financeiro: Total *R$ 2.600,00* · Saldo: *R$ 2.600,00*
  └ Operação: Resp: Vanessa · Cliente: Francisco Carlos Alves

*OS #468 — RENEGADE (QNX1G46)*
  └ Status: *Finalizada / Entregue* · *0 dias* no pátio
  └ Financeiro: Total *R$ 980,00* · Saldo: *Quitado*
  └ Operação: Cliente: Joaquim Antonio da Silva
```

- **Cabeçalho:** `*OS #XXXX — MODELO (PLACA)*` — negrito puro, isolado, SEM marcador `- `, SEM bullet `• ` e SEM citação `>`.
- **Propriedades:** Iniciadas compulsoriamente pelo caractere de joelho `  └ ` com 2 espaços de recuo.
- **Espaçamento:** Linha em branco (parágrafo duplo `\n\n`) separando cada bloco de veículo.

### 2.2. Guardrails Determinísticos em `format_utils.ts`
1. **Atualização de `reformatPipedLinesToHermesCards`:**
   - Transformar linhas agrupadas com pipes diretamente na sintaxe em árvore `*OS...*` + `  └ Status:` + `  └ Financeiro:` + `  └ Operação:`.
2. **Normalizador Defensivo em `sanitizeWhatsAppMarkdown`:**
   - Capturar qualquer ocorrência de `> *OS #...*` ou `> OS #...` e remover o `>`, assegurando negrito puro `*OS #...*`.
   - Se um bloco de OS contiver linhas iniciadas por `- Status:`, `- Cliente:`, `- Valor:`, converter deterministicamente para `  └ Status:`, etc.
   - Garantir respiro `\n\n` antes de cada `*OS #`.

### 2.3. Blindagem Anti-Orphan Card no Fatiador de Balões
1. **Reconhecimento de Árvore em `splitIntoAtomicItems` (`balloon_composer.ts`):**
   - Atualizar a detecção de filhos de card para reconhecer `\s*└\s+` além de `\s*-\s+`.
   - Tratar cada OS com seus joelhos como um bloco 100% atômico e indivisível.
2. **Respeito a Blocos de OS em `splitIntoWhatsAppBlocks` (`format_utils.ts`):**
   - Uma ordem de serviço completa (cabeçalho + joelhos) nunca pode ser partida ao meio.
   - Se o bloco da OS não couber no orçamento restante do balão atual, o balão atual é encerrado e o bloco da OS se inicia integralmente no novo balão.
3. **Deduplicação de Chunking em `webhook-listener.js`:**
   - Se o dispatcher já devolver um array de balões em `parsed.messages`, utilizá-lo diretamente sem refatiar destrutivamente por uma segunda rotina.

### 2.4. Foco Operacional em Pátio Ativo
- No `agent_dispatcher.ts` e `operational_adapter.ts`:
  - Consultas sobre veículos de uma loja devem listar primariamente as OSs físicas ativas no pátio (`is_aberta = 1`).
  - Ordens finalizadas (`0 dias no pátio`, quitadas) não devem ser listadas individualmente em massa quando o objetivo for pátio/gargalo operacional, sendo apresentadas apenas sob demanda explícita ou agrupadas no indicador de faturamento.

---

## 3. Contratos de Dados & Interfaces

### Contrato de Card Atômico Hierárquico
```typescript
export interface HierarchicalOSCard {
  osId: number | string;
  vehicleModel: string;
  plate: string;
  statusGrid: string;
  diasNoPatio: number;
  totalOS: number;
  valorRestante: number;
  responsavel?: string;
  clienteNome?: string;
}
```

### Contrato de Chunking Card-Aware
```typescript
export interface ChunkingOptions {
  maxBalloonChars: number; // Teto WhatsApp (padrão: 900)
  minBalloonChars: number; // Mínimo saudável (padrão: 600)
  atomicCardPatterns: RegExp[]; // Padrões de blocos indivisíveis
}
```

---

## 4. Riscos Principais & Mitigações
1. **Risco:** Algum relatório da IA exceder 900 caracteres em um único card de veículo muito longo.
   - **Mitigação:** Cada card de OS possui em média ~220 caracteres. Mesmo com 3 joelhos, cabe folgadamente no teto de 900 chars, permitindo até 3 ou 4 OSs por balão antes de abrir o próximo balão limpo.
2. **Risco:** Regressão no teste de sanitização existente.
   - **Mitigação:** Expandir a suíte de testes em `test_query_routing_and_formatting.ts` cobrindo o caso exato colado pelo usuário (mensagem de 12:13 com `> OS #468` e `- Status: Finalizada`).
