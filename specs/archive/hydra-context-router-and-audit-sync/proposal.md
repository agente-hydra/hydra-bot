# Proposta de Arquitetura — hydra-context-router-and-audit-sync

## 1. Problema & Diagnóstico Factual

Durante testes operacionais reais conduzidos pela diretoria no WhatsApp, foram identificadas três falhas sistêmicas críticas:

### Falha 1: Sequestro de Contexto pelo Resolvedor de Veículos & Vazamento Semântico
- **Cenário A (Anáfora de OS pós-pergunta do bot):** O bot perguntou: *"Na unidade MPJabaquara, temos apenas 1 OS sem checklist de entrada: OS 456 - Fiat Strada... Quer que eu puxe os detalhes completos dessa OS?"*. Ao responder *"me de detalhes da oS por favor"*, o rewriter não extraiu o número `456` do texto atual nem da resposta anterior (`lastResponseText`), classificando como `intent: 'other'`.
- **Cenário B (Timeout da LLM e vazamento no Fallback):** A chamada ao motor primário (`AGY_PRIMARY`) atingiu timeout de 60s (`latencia_ms: 62443`). Ao cair no `catch` determinístico (`FALLBACK_API`), a função `executeOperationalQuery` executou `retrieveOperationalData` sem filtros, vazando 5 OSs abertas de outras lojas da rede (`MPkennedy`, `ReiDoModulo`, `ReiDoOleoMaua`).
- **Cenário C (Sequestro de Faturamento por `prevPending` persistido):** Na consulta seguinte (*"perfeiot, qua faturamento da kennedy?"*), o estado anterior mantinha `pendingRequest` com `deliveryStatus: 'DELIVERED'`. A Seção 2.5 de `agent_dispatcher.ts` verificou `prevPending && (currentStoreSlug || norm.includes('por favor'))`. Como `"kennedy"` casou com `currentStoreSlug`, o despachador sequestrou a pergunta financeira, tentou resolver a OS `#456` na unidade Kennedy e respondeu: *"> Veículo não localizado. Nenhuma ordem de serviço localizada com o número #456"*.
- **Cenário D (Loop de ancoragem):** Ao enviar *"da rede por favor"*, a presença de `"por favor"` reativou o gatilho da Seção 2.5, emitindo novamente o card da Strada `#456`.

### Falha 2: Ausência de Coleta Horária de CMV (`cmv_lojas`)
- O cron horário (`0 * * * * run-hydra-hourly-finance.sh`) executa apenas `hourly_finance_worker.ts`, que raspa `Mapa de Metas` e `Vendas do Dia`. Ele **não** coleta CMV (`relatorio_operacao_crawler.ts`).
- A coleta de CMV estava confinada ao `deep-crawler.ts`, agendado apenas para as 03:00 da madrugada.
- O `relatorio_operacao_crawler.ts` continha uma validação que rejeitava `cmv_percentual <= 0`, travando lojas no início do mês antes do lançamento de notas de custo de peças.
- O `deep-crawler.ts` possuía um erro de importação (`extrairDetalhe` não exportado) que quebrou a execução diária.

### Falha 3: Supressão por Idempotência do Briefing Executivo Vespertino
- O script `/opt/bots/scripts/run-hydra-auditor.sh` está configurado no cron para rodar às 06:00 e às 14:00.
- Às 14:00 de hoje (06/10/2026), a rotina disparou, mas a tabela `hydra_briefing_dispatches` verificou apenas `(data_referencia, destinatario, tipo_relatorio)`.
- Como o disparo matinal já havia gravado `('06/10/2026', phone, 'briefing_executivo')`, a rodada vespertina considerou o briefing duplicado e suprimiu o envio para Davi e Marcos:
  `[Hydra Service] ⏭️ IDEMPOTÊNCIA: 5511996242812 já recebeu o relatório briefing_executivo referente a 06/10/2026. Envio suprimido.`

---

## 2. Solução Proposta

1. **Desacoplamento e Blindagem do Seletor de Veículos (Seção 2.5):**
   - **Gatilho de Status Pendente:** A condição `prevPending` só é válida para captura de resposta quando `prevPending.deliveryStatus === 'PENDING_CHOICE'`. Registros com `DELIVERED` jamais interceptam mensagens futuras.
   - **Precedência Absoluta de Métricas e Faturamento:** Consultas que contenham palavras-chave financeiras (`faturamento`, `faturou`, `vendas`, `meta`, `metas`, `cmv`, `ranking`, `ticket médio`, `setor`, `área`) têm precedência total e **nunca** são interceptadas pela Seção 2.5, mesmo que citem nomes de lojas ou expressões de cortesia (`por favor`).
   - **Resolução de Anáfora de OS:** Quando o operador pedir detalhes de OS sem número explícito (*"me de detalhes da os"*, *"fale mais dela"*), o rewriter e o despachador extraem o número da OS do contexto anterior imediato (`previousState.osId` ou regex de `OS #?(\d+)` no `lastResponseText`).
   - **Isolamento de Loja no Fallback de Timeout:** Caso a LLM atinja timeout (60s), o fallback determinístico deve respeitar a OS em contexto ou a loja do gerente, proibindo busca aberta irrestrita na rede.

2. **Ingestão Horária de CMV em `hourly_finance_worker.ts`:**
   - Como `hourly_finance_worker.ts` já navega por todas as 10 lojas na tela `wfRelatorioOperacao.aspx`, adicionar a extração da grid `#ctl00_cph_btnGestaoPeriodica` logo após `Vendas do Dia`.
   - Ajustar a validação matemática de `validarIntegridadeRelatorioOperacao` para aceitar `cmv_percentual >= 0` e `faturamento_total >= 0` em dias iniciais de mês.
   - Corrigir os imports em `deep-crawler.ts`.

3. **Slotting de Idempotência no Briefing Executivo (`hydra_auditor_service.ts`):**
   - Introduzir o conceito de slot no despacho de briefings: `matutino` (para execuções antes das 12:00) e `vespertino` (para execuções a partir das 12:00).
   - O discriminador na tabela `hydra_briefing_dispatches` passará a ser `tipo_relatorio: 'briefing_executivo_matutino'` e `'briefing_executivo_vespertino'` (ou sufixo de slot), garantindo que a edição da tarde seja disparada com os números atualizados das 14:00/17:00 sem colidir com a manhã.

---

## 3. Riscos & Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Aumento do tempo do worker financeiro horário ao incluir CMV | Médio | Como a página `wfRelatorioOperacao.aspx` já está aberta e a empresa já está selecionada, o clique em Gestão Periódica adiciona apenas ~2s por loja (~20s no total da rodada de 10 lojas), bem abaixo do teto de 20 minutos do script. |
| Quebra de anáforas legítimas de veículos | Baixo | A anáfora de veículo só é desativada quando o usuário mudar explicitamente de assunto (métrica/faturamento) ou quando não houver escolha pendente. |
| Disparo duplicado de briefing da tarde se reexecutado | Baixo | Idempotência mantida de forma estrita dentro do próprio slot vespertino. |
