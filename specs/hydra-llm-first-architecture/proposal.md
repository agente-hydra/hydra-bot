# Proposal — Arquitetura LLM-First (AGY CLI em 1º Lugar com Fallback Determinístico)

**Spec:** `hydra-llm-first-architecture`  
**Data:** 06/10/2026  
**Repositório:** `hydra-bot`  
**Objetivo:** Inverter o fluxo de processamento para que o LLM (`agy cli` com servidor MCP `hydra-ops`) seja a autoridade primária de interpretação semântica, consulta contextual a banco/vetor e resposta natural ao operador no WhatsApp. O reescritor determinístico rígido (`intent_rewriter.ts`) e o motor determinístico (`operational_adapter.ts`) passam a atuar exclusivamente como **Fallback de Último Caso** para contingência de infraestrutura (queda de rede, timeout ou exaustão de cota 429).

---

## 1. Problema Diagnosticado

1. **Inversão Antinatural de Controle:**
   - O fluxo atual força a passagem obrigatória da mensagem do usuário por um parser estático (`intent_rewriter.ts` de >4.300 linhas com dicionários fixos de modelos e regras if/else manuais).
   - O reescritor adultera a intenção antes do LLM e injeta no prompt:
     `# SOLICITAÇÃO CANÔNICA DO OPERADOR (RESOLVIDA DETERMINISTICAMENTE): ...`
     com a diretiva coerciva: `# REGRA DE ISOLAMENTO DE TURNO: Responda EXCLUSIVAMENTE à solicitação canônica acima.`
   - Se o parser errar (ex: "esse ideia qq ta acontecendo?" virar busca genérica ou "em aberto" perder o Jabaquara), o LLM é impedido de usar sua capacidade nativa de raciocínio.

2. **Fragilidade Lexical contra Linguagem Real:**
   - O operador escreve de formas variadas no WhatsApp: "esse ideia", "e as abertas", "qq ta acontecendo", "do jabaquara", gírias, erros de digitação e mensagens fragmentadas.
   - Qualquer variação não prevista no dicionário cai em regras `default` ou produz intenções erradas (`store_overview` quando se perguntou sobre um veículo, ou busca na Rede inteira quando se estava em Jabaquara).

3. **Subutilização do MCP e Ferramentas Nativas:**
   - O AGY CLI possui o servidor MCP `hydra-ops` ativo e configurado com ferramentas ricas (`getPatioOverview`, `getChecklistAudit`, `getStoreDrilldown`, `searchOS`, `semanticSearchOS`, etc.).
   - Quando chamado diretamente com a pergunta real, o AGY CLI consulta os registros, analisa os detalhes das OSs (incluindo serviços e peças no `raw_payload`) e responde com precisão e naturalidade em segundos.

4. **Degradação e Latência por Cascata de Timeout:**
   - O `dual_worker_router.ts` mantinha timeouts longos (40s primário + fallback), acumulando entre 50s e 90s antes de chavear para o motor secundário determinístico.

---

## 2. Solução Proposta: Fluxo LLM-First

```
Mensagem do Usuário (WhatsApp)
           │
           ▼
    MessageBatcher (Agrupa fragmentos < 700ms)
           │
           ▼
┌────────────────────────────────────────────────────────┐
│                   NÍVEL 1: LLM-FIRST                   │
│                                                        │
│  1. Injeta histórico recente do chat (últimos turnos)  │
│  2. Injeta contexto operacional ativo (loja em foco)   │
│  3. Invoca AGY CLI com MCP hydra-ops ativo             │
│  4. LLM seleciona e executa ferramentas necessárias   │
│     (searchOS, getChecklistAudit, semanticSearch, etc)│
│  5. LLM formula resposta conversacional completa       │
└────────────────────────────────────────────────────────┘
           │
     Sucesso? ──► SIM ──► Formata WhatsApp ──► Envio Imediato
           │
          NÃO (Timeout > 15s / Cota 429 / Erro de Rede)
           │
           ▼
┌────────────────────────────────────────────────────────┐
│            NÍVEL 2: FALLBACK DETERMINÍSTICO            │
│                 (ÚLTIMO RECURSO APENAS)                │
│                                                        │
│  1. Executa rewriteIntent(texto, previousState)        │
│  2. Executa executeOperationalQuery(db, canonical)     │
│  3. Retorna card operacional de contingência           │
└────────────────────────────────────────────────────────┘
```

---

## 3. Contratos de Dados & Interfaces

### 3.1. Contexto Fornecido ao LLM
O prompt enviado ao AGY CLI deve ser enriquecido com:
- **Perfil do Operador:** Sócio / Gerente / Loja vinculada.
- **Contexto Ativo do Diálogo:** Loja atualmente em foco (`MPJabaquara`), última OS referenciada (`#454`), placa em foco.
- **Histórico Recente:** Últimos 4 a 6 turnos com pergunta original e resposta.
- **Diretriz de Ferramentas:** Orientação para usar as ferramentas MCP do `hydra-ops` para buscar fatos e nunca inventar dados.

### 3.2. Chaveamento de Contingência
O chaveamento para o Fallback Determinístico ocorre sob condições estritas:
- `isTimeout`: Execução do AGY CLI excedeu 15 segundos.
- `isQuotaExhausted`: Retorno 429 (Resource Exhausted).
- `isBinaryUnavailable`: Binário `agy` não encontrado ou erro de processo.

---

## 4. Riscos e Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Alucinação em perguntas fora do escopo | Alto | System prompt rigoroso obrigando consulta via MCP antes de afirmar fatos numéricos ou operacionais |
| Latência na chamada do AGY CLI | Médio | Calibrar timeout do worker para 15s; manter conexões MCP quentes |
| Degradação em picos de cota | Baixo | Fallback determinístico preservado intacto como rede de segurança |
