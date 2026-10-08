# Plano de Execução — hydra-context-router-and-audit-sync

- [x] [ROUTER] Criar guardião `isExplicitFinancialQuery` em `agent_dispatcher.ts` para conceder precedência absoluta a perguntas de faturamento, metas e CMV.
- [x] [ROUTER] Blindar Seção 2.5 de `agent_dispatcher.ts`: restringir ativação de `prevPending` estritamente a `deliveryStatus === 'PENDING_CHOICE'`.
- [x] [ANAPHORA] Implementar resolução de anáfora de OS (*"me de detalhes da os"*, *"fale mais dela"*) inspecionando `lastResponseText` para herdar o `osId` sugerido pelo bot.
- [x] [FALLBACK] Blindar o fallback de timeout da LLM (`FALLBACK_API`) em `agent_dispatcher.ts`: ancorar compulsoriamente na OS ou loja em contexto, proibindo dump irrestrito de OSs de outras lojas.
- [x] [CRAWLER] Ajustar validação de CMV em `relatorio_operacao_crawler.ts` para aceitar `cmv_percentual >= 0` e `faturamento_total >= 0` em dias iniciais de mês.
- [x] [CRAWLER] Corrigir import de `os_deep_inspector` em `deep-crawler.ts`.
- [x] [WORKER] Integrar a extração horária de Gestão Periódica (CMV, áreas e mídia) em `hourly_finance_worker.ts` aproveitando a navegação de `Vendas do Dia`.
- [x] [AUDITOR] Implementar slotting (`matutino` vs `vespertino`) em `hydra_auditor_service.ts` para eliminar a supressão indevida do briefing da tarde por idempotência diária.
- [x] [DEPLOY] Sincronizar modificações para staging (`/home/operacional/hydra-staging/`), release ativa (`hydra-deploy/current/`) e rodar typecheck e testes de regressão.
- [x] [VERIFY] Executar auditor de briefing vespertino com `--preview` e `--send-whatsapp` para validar entrega imediata da rodada da tarde a Davi e Marcos.
