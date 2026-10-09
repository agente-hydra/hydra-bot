# Plano de Execução: Higienização de Relatórios Noturnos, Padronização Institucional e Balão Dedicado de Faturamento & CMV

**Spec ID:** `hydra-daily-report-sanitization-and-branding`  
**Data:** 09/10/2026  
**Status:** Planejamento  

---

## Tarefas de Implementação

- [x] [VPS-WATCHDOG] **Higienização do Script `daily-health.js` na VPS Linux**
  - Editar `/home/operacional/watchdog/daily-health.js`.
  - Remover definitivamente o JID do grupo `120363425738307789@g.us`.
  - Adicionar trava de segurança programática contra envios para qualquer JID terminado em `@g.us`.
  - Reiniciar o processo PM2 `watchdog-health` para aplicar a versão saneada.

- [x] [PATIO-DISPATCHER] **Padronização do Balão 1 para `*HYDRA | Operação*` & Supressão de Ações no Grupo**
  - Atualizar `projects/hydra-rede/src/whatsapp_patio_dispatcher.js` e `/home/operacional/hydra-rede/src/whatsapp_patio_dispatcher.js`.
  - Substituir cabeçalho por `*HYDRA | Operação*\n\n${refDateBR} · Pátio & OS (D-1)`.
  - Implementar supressão estrita da seção `*O que fazer agora*` quando `isGroup === true` ou destinatário for `@g.us`.
  - Sincronizar em `src/hydra-sync/whatsapp_formatter.ts`.

- [x] [BALLOON-CMV] **Implementação do Balão 2: Faturamento & CMV por Unidade**
  - Implementar a função `formatarBalaoFaturamentoECmv` com a lista ordenada das 10 lojas comerciais, faturamento e CMV % apurado.
  - Adicionar o bloco de consolidado da rede (faturamento total e CMV médio da rede).
  - Integrar ao fluxo de despacho diário como mensagem separada (balão subsequente).

- [x] [TEST-DISPATCH] **Script de Disparo de Teste e Validação Exclusivo para `11996242812`**
  - Criar `src/hydra-sync/tests/test_dispatch_validation_phone.ts`.
  - Configurar consulta ao banco SQLite WAL e despacho dos dois balões via Evolution API (`hydra`).
  - Trava rígida: envio direcionado **estritamente e exclusivamente para `5511996242812`**, sem nenhum envio para o grupo.
  - Executar o script e validar entrega dos balões para o desenvolvedor.

- [x] [BUILD-GATE] **Build Gate e Validação Final**
  - Rodar testes unitários em `projects/hydra-rede/src/test_whatsapp_patio.js`.
  - Rodar `npx tsc --noEmit` garantindo ausência de erros de tipagem.
  - Verificar status dos processos PM2 na VPS.
