# Plano de Execução: OS #1132 Checklist & Clean Cards

**Spec ID:** `hydra-os-checklist-and-clean-cards`  
**Status:** PROPOSTA / AGUARDANDO APROVAÇÃO (`/sdd-apply`)  

---

## Tarefas do Plano

- [x] **Task 1: Correção do Crawler & Re-Extração Completa da OS #1132** (Completed)
  - Ajustar o método de busca em `os_deep_inspector.ts` para evitar conflito de postback no `btnLimpar` e assegurar que `#ctl00_cph_btnBuscar` não sofra timeout.
  - Executar a extração nominal da OS #1132 na loja `MPJorgeBeretta` gravando o `raw_payload` completo com a tabela de checklists de ontem.
  - Validar via query SQLite que `raw_payload.checklists` contém a vistoria de entrada e que `extracao_completa = true`.

- [x] **Task 1: Correção do Crawler & Re-Extração Completa da OS #1132** (Completed)
  - Ajustar o método de busca em `os_deep_inspector.ts` para evitar conflito de postback no `btnLimpar` e assegurar que `#ctl00_cph_btnBuscar` não sofra timeout.
  - Executar a extração nominal da OS #1132 na loja `MPJorgeBeretta` gravando o `raw_payload` completo com a tabela de checklists de ontem.
  - Validar via query SQLite que `raw_payload.checklists` contém a vistoria de entrada e que `extracao_completa = true`.

- [x] **Task 2: Blindagem no Formatador de OS para Payloads Incompletos** (Completed)
  - Em `manager_store_access.ts` e `agent_dispatcher.ts`, se `extracao_completa === false`, informar com clareza que o detalhamento está sincronizando, em vez de assumir que o checklist não existe.

- [x] **Task 3: Redesenho dos Cards de Detalhe da OS (Fim da Monotonia)** (Completed)
  - Refatorar `formatVehicleSituation` em `manager_store_access.ts`:
    - Eliminar prefixos repetitivos de barra cinza (`| `).
    - Exibir título limpo em destaque: `*VEÍCULO — PLACA*`.
    - Formatar seções (`Documentos e Vistorias`, `Serviços`, `Financeiro`) de modo legível e dinâmico, ocultando seções irrelevantes ou vazias.

- [x] **Task 4: Eliminação de Pipes `|` e Expurgo de Pendências de Baixa na Listagem de Pátio** (Completed)
  - Ajustar `system_prompt.md` e o adaptador de pátio em `operational_adapter.ts` para:
    - Banir linhas com separador ` | `.
    - Estruturar cada veículo em formato de card vertical com quebras de linha (`*Veículo*\n- *OS:* #...\n- *Status:* ...\n- *Valor:* ...`).
    - Omitir completamente a listagem de ordens de baixa contábil de meses anteriores em consultas operacionais de pátio.

- [x] **Task 5: Validação com Testes End-to-End no Servidor Staging** (Completed)
  - Rodar typecheck no staging (`npm run typecheck:hydra` -> 0 erros).
  - Simular as consultas reais do WhatsApp:
    1. `"quais os tem na jorge beretta"` -> Verificado cards verticais limpos sem pipes e sem pendências de ERP.
    2. `"fala da os 1132"` e `"mas tem o checklist de inspecao?"` -> Vistoria de entrada realizada por Erik em 06/10 confirmada e formatada com checkmark verde.
  - Reiniciar `hydra-bot` no PM2 com zero downtime.
