# Design Técnico: Restauração da Formatação Premium Hermes-Style, Integridade de Contagem de OSs e Fim da Destruição de Balões

**Spec ID:** `hydra-premium-formatting-and-yard-integrity`  
**Data:** 07/10/2026  
**Status:** DESIGN / EM REVISÃO (SDD Hard Stop)  

---

## 1. Diagrama de Fluxo e Arquitetura

```mermaid
flowchart TD
    subgraph LLM & Dispatcher [agent_dispatcher.ts]
        LLM[Gemini 3.8 Flash via AGY Router]
        Prompt[Diretrizes Executivas Hermes-Style]
        Blocks[splitIntoWhatsAppBlocks: 4 Balões Perfeitos]
        LLM --> Blocks
    end

    subgraph Dispatcher Output [agent_dispatcher_cli.ts]
        CLI[JSON Output: { messages: [b1, b2, b3, b4] }]
        Blocks --> CLI
    end

    subgraph Webhook Ingress & Egress [webhook-listener.js]
        Extract[extractDispatcherOutput]
        OldPath[BUG: messages.join + composeSemanticBalloons]
        NewPath[CORREÇÃO: return resolve(parsed.messages)]
        CLI --> Extract
        Extract --> NewPath
        NewPath --> Queue[AsyncQueue / Evolution API]
    end

    subgraph Database Layer [db_repository.ts]
        DB[ordens_servico]
        ChecklistQuery[getChecklistAudit: Filtro de Pátio Físico Real]
        DB --> ChecklistQuery
    end

    ChecklistQuery --> LLM
```

---

## 2. Modificações Detalhadas por Módulo

### 2.1 Webhook Listener (`/home/operacional/hydra/webhook-listener.js`)

**Problema:**
```javascript
// CÓDIGO PROBLEMÁTICO ATUAL:
const parsed = extractDispatcherOutput(stdout);
const rawText = (Array.isArray(parsed.messages) && parsed.messages.length > 0)
  ? parsed.messages.join("\n\n")
  : (parsed.replyText || "");
if (rawText) {
  const composed = composeSemanticBalloons(rawText);
  return resolve(composed);
}
```

**Correção:**
```javascript
// CÓDIGO CORRIGIDO:
const parsed = extractDispatcherOutput(stdout);
if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
  // Despacha diretamente os balões já fatiados e sanitizados pelo dispatcher
  return resolve(parsed.messages);
}

if (parsed.replyText && parsed.replyText.trim()) {
  const messages = splitIntoWhatsAppBlocks(parsed.replyText);
  return resolve(messages);
}

return resolve(["Não foi possível formular uma resposta."]);
```

### 2.2 Auditoria de Checklists (`src/hydra-sync/db_repository.ts`)

**Problema:** `getChecklistAudit` consultava todas as ordens abertas brutas (`is_aberta = 1`), incluindo as 140 ordens fantasmas de agosto/setembro, acusando erroneamente que Santo André tinha 23 ordens sem vistoria e a rede tinha 169 ordens sem checklist.

**Correção:** Restringir a consulta para os veículos fisicamente em atendimento no pátio:

```sql
SELECT os_id, loja_slug, veiculo, placa, dias_no_patio, raw_payload
FROM ordens_servico
WHERE is_aberta = 1 AND (
  COALESCE(dias_no_patio, 0) > 0
  OR (
    (data_inicio LIKE '%/10/26%' OR data_inicio LIKE '%/10/2026%')
    AND UPPER(TRIM(COALESCE(status_grid, ''))) NOT IN ('AGUARDANDO RETIRADA', 'ENCERRADA', 'FINALIZADA')
    AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE'
  )
)
```

### 2.3 Calibração de Prompt e Expurgo de Ruído de Baixa (`system_prompt.md` e `agent_dispatcher.ts`)

1. **Remoção de Alucinação Administrativa:**
   Adicionar instrução explícita:
   > "NUNCA reporte 'Pendências de Baixa no ERP' ou 'Divergência entre sistema e pátio' como gargalo operacional da oficina. Os gargalos do negócio são estritamente: (1) Veículos retidos no pátio há mais de 5 dias, (2) Exposição financeira de OSs abertas sem sinal/pagamento, (3) Checklists de entrada e do mecânico pendentes nos veículos em atendimento."

2. **Formatação Visual Premium Obrigatória:**
   > "Para tópicos e gargalos, use SEMPRE cabeçalhos nativos de citação: `> *1. Nome do Gargalo*` e linhas com `- *Loja:* Detalhes com valores em *R$ 0,00*`. Separe cada grande gargalo com `---BLOCK---`."

---

## 3. Plano de Testes

1. **`test_webhook_listener_balloon_passthrough.ts`:**
   - Simular output de `extractDispatcherOutput` com 4 balões.
   - Garantir que o resultado final despacha exatamente 4 balões sem recombinação destrutiva e sem conversão de bullets para `• `.
2. **`test_real_checklist_audit.ts`:**
   - Validar contra base real que Santo André audita 1 veículo (e não 23).
   - Validar que o total de ordens auditadas na rede é ~32 (e não 179).
