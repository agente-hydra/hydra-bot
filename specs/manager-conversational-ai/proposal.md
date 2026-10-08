# Proposta: Hydra Conversacional por Perfil com Uso Efetivo da IA e Continuidade

**ID da Spec:** `manager-conversational-ai`  
**Data:** 30/09/2026  
**Status:** PROPOSTA / AGUARDANDO APROVAÇÃO (`/vibe-apply manager-conversational-ai`)  
**Papel do Agente Principal:** Orquestrador e Integrador das 3 Frentes Especializadas  
**Base de Código:** Branch de Staging `/home/operacional/hydra-staging/` / Produção `/opt/bots/` e `/home/operacional/hydra/` na VPS Operacional (`100.126.50.101`)

---

## 1. Problema Observado e Evidências Reais

Durante os testes em homologação e produção com a persona de gerente ativada para a unidade **Jorge Beretta** (`/jorgeberetta`):

1. **Perda de Compreensão Conversacional em Pedidos Naturais:**
   - *“Como estamos?”* recebeu uma recusa genérica (*"No perfil de gerente, só posso consultar dados da sua loja..."*).
   - *“Consegue me falar do fatuamento?”* (com erro de digitação comum) recebeu recusa estática.
   - *“Quero o faturemnto da minha loja”* só funcionou após explicitar a frase fixa exata.
2. **Falso Bloqueio de Escopo por Regex Rígido:**
   - Pedidos legítimos como *“Todos os carros da minha loja”* eram sumariamente recusados porque a palavra isolada `"todos"` disparava o gatilho de rede em `isOutsideManagerStore`.
3. **Ausência da IA no Caminho do Gerente:**
   - Em `agent_dispatcher.ts`, assim que `activeProfile.persona === 'gerente'` era detectado, o fluxo desviava para `executeManagerStoreQuery` e retornava **antes** de qualquer contato com o `DualWorkerRouter` ou workers de IA (`gemini-3.8-flash-low`). O gerente estava condenado a um bot de comandos e templates fixos sem flexibilidade semântica.
4. **Ficha de OS Incompleta e Perda de Continuidade:**
   - *“Detalhes da 1128”* apenas repetiu a linha resumida da listagem de OS (placa e valor total), sem exibir serviços, peças, pagamentos ou status de checklist.
   - A pergunta de seguimento imediata *“Quero os detalhes”* ou *“E o que falta nela?”* perdeu a referência da OS e recebeu recusa por falta de contexto.
5. **Cálculo Distorcido de Metas Financeiras:**
   - Com faturamento de R$ 84.613,61 e meta de R$ 124.900,00, o sistema apresentou atingimento de `-32,0%` (confundindo o desvio percentual da fonte com percentual de atingimento). O atingimento matemático real é de **67,75%** e o saldo faltante para a meta é de **R$ 40.286,39**.

---

## 2. Solução Proposta: IA Revisora Operacional com Governança por Código

Implementar uma arquitetura de **Execução Inicial Determinística com Revisão Crítica por IA (AI Reviewer Pattern)** antes do envio da resposta:

```text
Mensagem do Usuário
       │
       ▼
1. Identidade & Perfil Efetivo (Sócio vs Gerente de Loja X)
       │
       ▼
2. Contexto de Sessão Ativo (osId, placa, filtros válidos da geração)
       │
       ▼
3. Interpretação Inicial pelo Código & Consulta a Dados Autorizados
       │
       ├─► Não entendeu a mensagem? ──► Encaminha diretamente à IA (sem inventar dados nem recusa falsa)
       │
       ▼
4. Elaboração de Resposta Candidata & Empacotamento de Dados Consultados (período e fonte)
       │
       ▼
5. Revisão Crítica pela IA (DualWorkerRouter - gemini-3.8-flash-low)
   Recebe: mensagem original, perfil/loja, contexto de sessão, resposta candidata e dados consultados
       │
       ├─► [APROVAR] ──► Candidata atende plenamente ao pedido (revisão curta, reutiliza candidata)
       ├─► [AJUSTAR] ──► Dados suficientes, mas formulação precisa de correção ou explicação
       ├─► [CONSULTAR] ► Faltam dados ou houve falha de intenção ──► Executa ferramenta permitida e conclui
       └─► [ESCLARECER]► Ambiguidade real não resolvida por contexto/dados ──► Pergunta pontual ao usuário
       │
       ▼
6. Validação de Escopo & Governança Numérica por Código (Boundary Enforcement)
       │
       ├─► Tentativa de acessar outra loja / rede? ──► Recusa Educada + Sugestão /socio
       │
       ▼
7. Compositor Semântico de Balões WhatsApp (700-900 chars, anti-slop) ──► Egress
```

### Princípios Inegociáveis da Solução
- **O Código Interpreta, Consulta e Limita; a IA Revisa e Refina:** O código processa o caminho rápido, aplica filtros da loja autorizada e gera uma resposta candidata. Antes do envio, a IA compara o pedido original com o que será entregue e toma uma de 4 decisões (`APROVAR`, `AJUSTAR`, `CONSULTAR`, `ESCLARECER`).
- **Encaminhamento Limpo se Roteador Falhar:** Se o roteador inicial não entender a mensagem, ela é encaminhada à IA sem inventar uma candidata arbitrária e sem emitir recusa genérica prematura.
- **Tratamento Específico de Casos Insuficientes e Regra de Ouro AJUSTAR vs CONSULTAR:**
  - `AJUSTAR` só pode usar dados já consultados presentes em `dadosConsultados`. Proibido completar respostas por suposição ou inventar dados não fornecidos.
  - Em *“OS e CMV”*, se apenas o CMV foi consultado pelo fast-path, a decisão obrigatória é `CONSULTAR` para buscar as OSs. Não supor lista ou totais de OS.
  - Em *“Detalhes da 1128”*: Não pode receber apenas a linha resumida. A revisão identifica insuficiência de dados de serviços/peças e aciona `CONSULTAR` com `get_os_details` para retornar ficha completa.
- **Zero Expansão de Permissões (Zero Trust no Revisor):** A IA **não** pode ampliar permissões, executar SQL livre nem inventar dados para completar uma resposta. Ferramentas adicionais (`CONSULTAR`) são executadas estritamente com `lojaSlug` injetado pelo backend.
- **Anti-Loop e Calibração do Orçamento Global de 50s com Evidências Reais:**
  - Evidência na VPS: chamada de revisão curta consome entre 5,4s e 16,1s. Duas chamadas pesadas poderiam exceder 50s se não orçadas.
  - Calibração de timeouts:
    * Chamada de Revisão: timeout calibrado em **20.000 ms (20s)**.
    * Se `APROVAR` ou `AJUSTAR`: encerramento imediato em ~5–16s (apenas 1 chamada LLM).
    * Se `CONSULTAR`: execução da ferramenta em SQLite (<50ms). Segunda chamada LLM para síntese só é disparada se o saldo restante do turno for `>= 15.000 ms`. Se o saldo for inferior a 15s, sintetiza diretamente por compositor factual determinístico com os dados consultados, garantindo entrega antes de 50s sem risco de timeout.
  - Falha simultânea dos workers ou timeout encerra de forma limpa com código amigável `H-IA-02` (ou a resposta candidata se viável), sem espera indefinida nem resposta aleatória.
- **Comandos Determinísticos Intocados:** `/menu`, `/perfil`, `/reset`, `/socio` e `/{loja}` continuam determinísticos no ingress sem passar pelo revisor de IA.
- **Telemetria de Consumo e Latência:** Registro obrigatório por turno de chamadas LLM realizadas, latência, motor/modelo, decisão de revisão (`reviewDecision`) e tokens/consumo quando fornecidos pelo runtime.

---

## 3. Divisão de Frentes pelos Três Subagentes

Para garantir paralelismo sem conflito e foco de responsabilidade:

### Agente 1 — Roteamento, Governança e Ciclo do Revisor de IA
- **Propriedade dos Módulos:** `agent_dispatcher.ts`, `semantic_prompt.ts`, `dual_worker_router.ts`, `manager_store_access.ts`.
- **Missão:**
  - Carregar perfil, loja autorizada e geração da sessão **antes** da interpretação.
  - Implementar o ciclo de **Revisão Operacional de IA** em `agent_dispatcher.ts`:
    - Envio do payload de revisão (`mensagem`, `perfil/loja`, `contexto`, `candidata`, `dadosConsultados`).
    - Avaliação das 4 decisões: `APROVAR`, `AJUSTAR`, `CONSULTAR`, `ESCLARECER`.
    - Se o roteador inicial não entender: encaminhar à IA sem candidata inventada e sem recusa falsa.
    - Se a decisão for `CONSULTAR`: solicitar ferramenta autorizada (com validação estrita de escopo).
  - Limitar replanejamento a 1 tentativa e respeitar orçamento global de 50s.
  - Telemetria de turno: registrar decisão do revisor, chamadas LLM, latência e consumo quando disponível.
  - Bloqueio de outras lojas com recusa educada e indicação de `/socio`.

### Agente 2 — Continuidade, Ficha Completa e Repositórios Autorizados
- **Propriedade dos Módulos:** `turn_context_repository.ts`, `operational_adapter.ts`, `db_repository.ts`, `finance_snapshot_repository.ts`.
- **Missão:**
  - Gerar a **resposta candidata** com dados autorizados e empacotar metadados/dados consultados (`ConsultedDataRecord`: período, fonte, valores).
  - Preservação de entidades de continuidade (`osId`, `placa`, `lojaSlug`, `periodo`, `filters`).
  - Implementar consulta completa de OS (`getOSDetailComplete`), trazendo situação, datas, itens/serviços, peças, valores pagos, saldo devedor e checklists.
  - Atendimento à decisão `CONSULTAR` da IA: executar ferramentas autorizadas solicitadas pela revisão com o `loja_slug` obrigatório injetado pelo backend.
  - Integração com repositórios oficiais (`faturamento_diario_horario`, `metas_horarias`, `cmv_lojas`).
  - Isolamento de cache entre perfis: dados obtidos como Sócio são expurgados ao alternar para Gerente.

### Agente 3 — Matemática, Balões e Test Harness de Evidências
- **Propriedade dos Módulos:** `format_utils.ts`, `balloon_composer.ts`, `tests/test_manager_ai_continuity.ts`.
- **Missão:**
  - Correção das fórmulas matemáticas: Atingimento (`faturamento / meta * 100`) e Faltante (`meta - faturamento`).
  - Formatação WhatsApp sem tabelas Markdown, com quebras de balão elegantes entre 700 e 900 caracteres.
  - Implementar a suíte integrada do Test Harness contendo evidências obrigatórias dos 6 caminhos de revisão e continuidade:
    1. Candidata correta aprovada por chamada real à IA (`APROVAR`);
    2. Resposta incompleta corrigida (`AJUSTAR`);
    3. Interpretação errada ou falta de dados corrigida com nova consulta autorizada (`CONSULTAR`);
    4. Continuidade de OS preservada (`1128` -> detalhes completos);
    5. Ausência de acesso a outras lojas em todos os caminhos;
    6. Falha dos workers encerrada sem resposta aleatória nem espera indefinida (código `H-IA-02`).

---

## 4. Contratos de Dados Compartilhados

### 4.1. Perfil do Usuário (`UserProfile`)
```typescript
export interface UserProfile {
  phone: string;
  persona: 'socio' | 'gerente';
  lojaSlug?: string;              // Ex: 'MPJorgeBeretta'
  lojaNome?: string;              // Ex: 'Jorge Beretta'
  defaultScope: 'network' | 'store';
  memoryGeneration: number;       // Incrementado a cada /reset ou troca de perfil
  dailyMemoryResetAt?: string;
  updatedAt: string;
}
```

### 4.2. Estado do Turno e Continuidade (`TurnState`)
```typescript
export interface TurnState {
  phone: string;
  lastTurnId: string;
  lastIntent: string;
  lojaSlug?: string;              // Loja ativa herdada
  placa?: string;                 // Placa ativa em foco
  osId?: string;                  // Número da OS em foco para continuação
  filters: Record<string, any>;
  lastContract?: any;
  lastResponseText?: string;
  memoryGeneration?: number;      // Proteção anti-vazamento de sessões antigas
  updatedAt: string;
}
```

### 4.3. Ficha Detalhada de OS (`OSDetailRecord`)
```typescript
export interface OSDetailRecord {
  osId: string;
  lojaSlug: string;
  lojaNome: string;
  placa?: string;
  veiculo?: string;
  cliente?: string;
  isAberta: boolean;
  statusGrid?: string;
  diasNoPatio: number;
  dataAbertura?: string;
  totalOS: number;
  valorPago: number;
  valorRestante: number;
  servicos: Array<{ descricao: string; valor: number; mecanico?: string }>;
  pecas: Array<{ descricao: string; quantidade: number; valorUnitario: number; valorTotal: number }>;
  checklists: {
    entrada: { preenchido: boolean; pendencias?: string[] };
    mecanico: { preenchido: boolean; pendencias?: string[] };
  };
}
```

### 4.4. Ciclo de Revisão Crítica da IA (`AIReviewContract`)
```typescript
export type ReviewDecisionType = 'APROVAR' | 'AJUSTAR' | 'CONSULTAR' | 'ESCLARECER';

export interface ConsultedDataRecord {
  fonte: 'faturamento_diario_horario' | 'metas_horarias' | 'cmv_lojas' | 'ordens_servico' | 'nenhuma';
  periodo: string;                 // Ex: '30/09/2026' ou '01/09/2026 a 30/09/2026'
  lojaSlug: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface AIReviewRequest {
  mensagemOriginal: string;
  perfil: UserProfile;
  contextoConversa: TurnState;
  respostaCandidata: string;
  dadosConsultados: ConsultedDataRecord[];
}

export interface AIReviewResult {
  decisao: ReviewDecisionType;
  justificativaCurta: string;
  respostaFinal?: string;          // Usada em AJUSTAR ou APROVAR
  ferramentaSolicitada?: {         // Usada em CONSULTAR
    nome: 'get_os_details' | 'get_cmv_loja' | 'get_vendas_hoje' | 'get_metas_mes';
    parametros: Record<string, string | number>;
  };
  perguntaEsclarecimento?: string; // Usada em ESCLARECER
}
```

---

## 5. Riscos Mapeados e Mitigações

1. **Risco de Alucinação Numérica ou Vazamento por Injeção de Prompt:**
   - *Mitigação:* O worker de IA nunca executa queries dinâmicas livres no SQLite nem recebe dados de lojas não autorizadas. As ferramentas são funções TypeScript rígidas parametrizadas com o `loja_slug` da sessão.
2. **Risco de Loops de Replanejamento ou Latência Excessiva:**
   - *Mitigação:* Teto máximo de 1 re-consulta (`CONSULTAR`) por turno (máx 2 chamadas LLM no total). Orçamento global de turno estrito de 50.000 ms compartilhado. Se a candidata for correta, a revisão é ultracurta (`APROVAR`). Falha dos workers encerra via fallback determinístico com código `H-IA-02` sem espera indefinida.
3. **Risco de Contaminação Cruzada após Alternância de Perfil:**
   - *Mitigação:* `memoryGeneration` atrelada a cada turno. Ao emitir `/socio` ou `/{loja}`, todo contexto anterior é invalidado e novas respostas rejeitam jobs iniciados na geração anterior.

---

## 6. Critérios de Aceite para Produção

- [ ] Todas as situações da matriz de testes do harness aprovadas com 100% de sucesso.
- [ ] O código prepara a resposta candidata inicial e a IA atua como revisora pré-envio decidindo entre `APROVAR`, `AJUSTAR`, `CONSULTAR` e `ESCLARECER`.
- [ ] Caso o roteador não entenda a mensagem, ela é encaminhada à IA sem inventar candidata e sem recusa falsa.
- [ ] Evidência de candidata correta aprovada por chamada real à IA (`APROVAR`).
- [ ] Evidência de resposta incompleta corrigida (`AJUSTAR`), como no caso de *"OS e CMV"* atendendo a ambas as partes.
- [ ] Evidência de interpretação inicial insuficiente corrigida com nova consulta autorizada (`CONSULTAR`), como em *"Detalhes da 1128"* trazendo a ficha completa.
- [ ] Evidência de continuidade de OS preservada entre turnos sucessivos.
- [ ] Ausência de acesso a dados de outras lojas em todos os caminhos (inclusive durante `CONSULTAR`), emitindo recusa educada sugerindo `/socio`.
- [ ] Em caso de falha de todos os workers, encerramento rápido e calmo com código padronizado (`H-IA-02`) sem espera indefinida nem resposta aleatória.
- [ ] Atingimento percentual de metas calculado e exibido com fórmula correta (`67,75%`, saldo faltante de `R$ 40.286,39`).
- [ ] Registro de telemetria por turno: chamadas ao LLM, decisão do revisor, latência e modelo.
- [ ] Build gate sem erros (`tsc --noEmit`) e PM2 online.
