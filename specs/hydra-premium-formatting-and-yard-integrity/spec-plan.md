# Plano de Implementação: Restauração da Formatação Premium Hermes-Style, Integridade de Contagem de OSs e Fim da Destruição de Balões

**Spec ID:** `hydra-premium-formatting-and-yard-integrity`  
**Status:** PLANO / EM REVISÃO (SDD Hard Stop)  

---

## Tasks Atômicas de Implementação

### Fase 1: Listener Ingress/Egress & Preservação Estrita de Balões
- [x] **[LISTENER] Pass-through Direto de Balões no Webhook Listener**
  - Arquivo: `/home/operacional/hydra/webhook-listener.js` (e `/home/operacional/hydra-staging/webhook-listener.js`)
  - Se `parsed.messages` for array não-vazio vindo do dispatcher, despachar diretamente `parsed.messages` sem recombinação destrutiva via `join("\n\n")` e sem passar por `composeSemanticBalloons`.
  - Isolar `composeSemanticBalloons` exclusivamente para fallbacks determinísticos sem LLM.
  - Preservar a formatação Hermes-Style com blockquotes nativos (`> *Título*`) e bullets (`- *Loja:*`), eliminando substituição por `• ` ou asteriscos soltos.

---

### Fase 2: Integridade de Dados e Pátio Físico na Auditoria de Checklists
- [x] **[DB] Filtrar Veículos Fisicamente em Atendimento em `getChecklistAudit`**
  - Arquivo: `src/hydra-sync/db_repository.ts`
  - Aplicar o filtro de pátio real na query de `getChecklistAudit`:
    ```sql
    WHERE is_aberta = 1 AND (
      COALESCE(dias_no_patio, 0) > 0
      OR (
        (data_inicio LIKE '%/10/26%' OR data_inicio LIKE '%/10/2026%')
        AND UPPER(TRIM(COALESCE(status_grid, ''))) NOT IN ('AGUARDANDO RETIRADA', 'ENCERRADA', 'FINALIZADA')
        AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE'
      )
    )
    ```
  - Garantir que ordens de agosto/setembro que já saíram da oficina não entrem no cômputo de checklists.
  - Limpar qualquer exposição de `pendencias_baixa_erp` das métricas operacionais públicas.

---

### Fase 3: Diretrizes de Formatação Hermes-Style e Eliminação de Ruído Administrativo
- [x] **[PROMPT] Banir Ruído de Baixa no ERP e Padronizar Formatação Nativa WhatsApp**
  - Arquivos: `src/hydra-sync/system_prompt.md` e `src/hydra-sync/agent_dispatcher.ts`
  - Proibir expressamente relatar "Pendências de Baixa no ERP" como gargalo operacional da oficina (gargalos são estritamente: retenção de pátio > 5 dias, exposição financeira sem sinal e checklists pendentes).
  - Fixar regras visuais Hermes-Style: Títulos sempre em blockquote `> *1. Gargalo...*`, bullets `- *Loja:* Detalhes com valores em *R$ 0,00*`, sem conversão para marcadores genéricos.
  - Dividir diagnósticos complexos em balões temáticos autocontidos via `---BLOCK---`.

---

### Fase 4: Validação, Testes e Build Gate
- [x] **[TESTS] Teste de Pass-Through do Listener (`test_balloon_passthrough.ts`)**
  - Validar que arrays de balões do dispatcher são preservados na íntegra sem cortes no meio de listas e sem alteração de marcadores.
- [x] **[TESTS] Teste de Auditoria de Checklists Real (`test_real_checklist_audit.ts`)**
  - Validar contra o banco SQLite que Santo André audita 1 veículo (e não 23), e que o total auditado na rede reflete os ~32 veículos físicos reais.
- [x] **[GATE] Build Gate TypeScript e Deploy no Staging**
  - Executar `npm run typecheck:hydra` com zero erros.
  - Reiniciar e testar no PM2 de staging.
