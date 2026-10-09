# Plano de Execução: Sinal Crítico (< 60% pago e Pendência ≥ R$ 2.600) & Layout Limpo WhatsApp

**Spec ID:** `hydra-patio-signal-policy-60pct-and-readable-layout`  
**Data:** 09/10/2026  
**Status:** Planejamento Atualizado (SDD Proposal)  

---

## Tarefas de Implementação

- [x] [QUERY-2600] **Implementar Motor SQLite com Piso de R$ 2.600 e Meta de 60% de Sinal**
  - Em `projects/hydra-rede/src/whatsapp_patio_dispatcher.js`:
  - Implementar `carregarCarrosCriticosSinal(pisoPendente = 2600, metaSinalPct = 0.60)`.
  - Executar query:
    `WHERE is_aberta = 1 AND total_os > 0 AND valor_pago < (total_os * 0.60) AND valor_restante >= 2600`.
  - Agrupar os 6 veículos por loja, ordenando lojas pelo maior saldo pendente acumulado.

- [x] [LAYOUT-CLEAN] **Atualizar Formatador Visual do Balão 1 (`HYDRA | Operação`)**
  - Em `projects/hydra-rede/src/whatsapp_patio_dispatcher.js`:
  - Substituir o bloco de carros pelo novo layout limpo de alto contraste:
    - Cabeçalho da seção: `*Carros críticos sem sinal de 60%*`.
    - Resumo da pendência ≥ R$ 2.600: `R$ 26.130,20 (6 ordens em 5 lojas)`.
    - Lojas com numeração em negrito (`1. *Loja*`).
    - Cada veículo em linha única com marcador `- `: `- VEÍCULO (OS #...): *R$ ...* pendente (X% pago)`.
    - Espaçamento duplo entre lojas.
    - Zero caracteres de tabela `|`.

- [x] [TYPESCRIPT-SYNC] **Sincronizar Tipos em `src/hydra-sync/whatsapp_formatter.ts`**
  - Exportar interfaces `VeiculoSinalCritico`, `LojaSinalCritico`, `DadosBlocoSinalCritico`.
  - Checar tipagem com `npx tsc src/hydra-sync/whatsapp_formatter.ts --noEmit`.

- [x] [TESTS-AND-DEPLOY] **Testes Unitários e Sincronização na VPS Linux**
  - Atualizar `test_whatsapp_patio.js` com os dados dos 6 carros críticos.
  - Executar testes locais e na VPS.
  - Sincronizar via SCP em `/home/operacional/hydra-rede/src/` e `/opt/bots/src/hydra-sync/`.

- [x] [VALIDATION-DISPATCH] **Disparo Exclusivo de Validação para `11996242812`**
  - Rodar `test_dispatch_validation_phone.js` na VPS.
  - Confirmar entrega do novo Balão 1 com os 6 veículos críticos para o desenvolvedor.
