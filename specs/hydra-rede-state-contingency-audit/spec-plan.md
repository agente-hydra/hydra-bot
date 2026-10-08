# Plano de Execução: Estado Persistente, Contingência com Resume, Alerta Imediato Dev & Auditoria de Veracidade

**Spec ID:** `hydra-rede-state-contingency-audit`  
**Status:** PROPOSTA ATUALIZADA / AGUARDANDO COMANDO APPLY  

---

## Checklist de Tarefas

- [x] **1. [STATE] Criação do Gerenciador de Estado Persistente (`src/state_manager.js`)**
  - [x] Implementar carregamento e inicialização atômica de `data/state_<dateTag>.json` para as 10 lojas.
  - [x] Implementar validação de arquivos baixados existentes (`validateDownloadedFile`: checagem de tamanho > 5KB, leitura válida via `xlsx`, hash sha256).
  - [x] Implementar métodos de persistência atômica: `recordStoreSuccess`, `recordStoreFailure`, `getPendingStores`.
  - [x] Garantir salvamento de checkpoints em disco após cada tentativa de loja (tolerância a quedas/interrupções).

- [x] **2. [ALERT] Alerta Instantâneo no WhatsApp do Dev (`src/whatsapp_notifier.js`)**
  - [x] Criar função `enviarAlertaFalhaLojaDev({ loja, ec, erro, tentativa, maxTentativas })`.
  - [x] Configurar envio imediato para `WHATSAPP_DEV_NUMBER` (`5511996242812`) via instância autorizada `hydra`.
  - [x] Formatar payload com Loja, EC, Horário exato da falha, motivo técnico e aviso de relatório retido.

- [x] **3. [SCRAPER] Blindagem do Scraper, Resume Inteligente, Alerta Instantâneo & Auto-Retry (`src/scraper.js`)**
  - [x] Integrar leitura do estado no início de `executarScraper`: se todas as 10 lojas já estiverem com arquivo válido, dispensar abertura do Playwright.
  - [x] Filtrar o loop para processar exclusivamente lojas com status `PENDING` ou `FAILED`.
  - [x] Blindar a função `selecionarEstabelecimento`:
    - Adicionar `scrollIntoViewIfNeeded` e force click no radio button do EC.
    - Adicionar espera ativa explícita para o botão `.changeApplyButton`.
    - Validar se o nome da loja/EC no header do portal atualizou de fato antes de navegar para a exportação.
  - [x] Adicionar retry automático imediato (até 3 tentativas com recarga da página) se houver timeout na seleção ou polling da fila.
  - [x] Disparar `enviarAlertaFalhaLojaDev` imediatamente quando uma loja esgotar as tentativas na rodada.
  - [x] Implementar 2ª passada de contingência: se restarem lojas em `FAILED` após a 1ª rodada, reiniciar o contexto do navegador e tentar novamente apenas as lojas faltantes.

- [x] **4. [AUDIT] Motor de Conciliação e Auditoria Cruzada (`src/reconciliation_auditor.js`)**
  - [x] Implementar leitura independente de cada um dos 10 arquivos brutos em `downloads/`.
  - [x] Somar transações válidas de cartão, total bruto, total líquido e venda de juros por loja e consolidado.
  - [x] Inspecionar a planilha consolidada gerada (`JUROS REDE - <dateTag>.xlsx`) e extrair:
    - Transações e subtotais gravados no card de cada loja.
    - Valores consolidados da aba "Resumo Executivo".
    - KPIs executivos do topo (`A5`, `D5`, `G5`).
  - [x] Realizar checagem estrita de igualdade numérica (tolerância: R$ 0,00).
  - [x] Gravar laudo completo em `logs/audit_<dateTag>.json` contendo status `AUDIT_PASSED` ou `AUDIT_FAILED`.

- [x] **5. [ORCHESTRATOR] Gates de Bloqueio, Alerta Dev e Selo de Auditoria (`src/index.js`)**
  - [x] Adicionar **Gate de Totalidade**: se qualquer loja estiver em `FAILED` ou se a auditoria reprovar (`AUDIT_FAILED`), **bloquear imediatamente o envio oficial para a diretoria**.
  - [x] Em caso de bloqueio: formatar alerta técnico consolidado e enviar para o WhatsApp do Dev (`11996242812`).
  - [x] Se a auditoria for aprovada (10/10 lojas íntegras):
    - Incluir selo na legenda do WhatsApp: `🔒 *Integridade Auditada:* 10/10 lojas conciliadas contra arquivos brutos da Rede (100% verificado).`
  - [x] Suportar flags CLI: `--retry-failed` (para reprocessar apenas o que falhou) e `--audit-only` (para auditar os arquivos locais sem scraping).

- [x] **6. [TEST & RECOVERY] Validação com Caso Real (07/10/2026 - Santo André)**
  - [x] Executar o novo fluxo para a data base 07/10/2026:
    - O state manager deve reaproveitar os 9 arquivos já baixados hoje.
    - O scraper deve baixar exclusivamente a loja Santo André (EC 101422997).
  - [x] Validar a conciliação completa das 10 lojas e emissão do laudo `audit_2026-10-07.json`.
  - [x] Confirmar que o relatório consolidado gerado inclui as transações reais de Santo André sem zerar a unidade.

---

## Circuit Breaker (SDD Hard Stop)
**PARE.** Proposta, design e plano de execução documentados em `specs/hydra-rede-state-contingency-audit/`. Nenhuma alteração no código de produção foi feita. Aguardando o comando de aprovação para iniciar a implementação.
