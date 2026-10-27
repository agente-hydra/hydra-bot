# Proposta Técnica: Correção do Envio Matinal da Rede, Lojas Zeradas (Santo André) e Expurgo de PIX (27/10/2026)

## 1. Sumário Executivo

Na manhã do dia 27/10/2026, a rotina de envio matinal unificado dos relatórios da Rede e Pátio apresentou três anomalias críticas reportadas pela operação:
1. **Falha na Entrega Matinal (08:00 AM):** Os relatórios oficiais não foram entregues via WhatsApp para o Financeiro (`5511940667032`) nem para a Diretoria (`5511996242812`).
2. **Lojas Zeradas no Relatório da Rede (Exemplo Santo André):** O relatório `Juros Rede - 26-10-2026.xlsx` indicou faturamento zerado (R$ 0,00) para a loja Santo André, quando na realidade a unidade teve movimentação normal com múltiplas ordens de serviço faturadas em cartão na tarde do dia 26/10.
3. **Poluição do Relatório de Juros com PIX:** O arquivo de Juros e Taxas da Rede incluiu transações de PIX realizadas na maquininha física (POS) com taxa de 0% e 0 parcelas, distorcendo o cálculo de MDR, taxa média retida e taxa de repasse de juros de cartão de crédito.

A auditoria forense detalhada em código, logs da VPS (`operacional@100.126.50.101`) e arquivos brutos confirmou que os três problemas decorrem de causas raízes distintas e acopladas, detalhadas a seguir.

---

## 2. Diagnóstico Técnico Forense (Causas Raízes)

### Causa Raiz 1: Queda da Instância WhatsApp `hydra` e Bug de Escopo Léxico no Orquestrador

- **Localização dos Logs:** `/home/operacional/hydra-data/logs/matinal-trio.log`
- **Registro do Evento às 08:00:00 AM (27/10/2026):**
  ```text
  [08:00:00] ETAPA 6A: Disparando Quinteto Oficial silencioso para o Financeiro (5511940667032)...
  [Unified Dispatcher] Despachando 5 arquivos em sequência silenciosa para: 5511940667032...
    ↳ Enviando Juros Rede - 26-10-2026.xlsx (sem legenda)...
  [WhatsApp Patio] Erro ao enviar documento para 5511940667032: 500 - {"status":500,"error":"Internal Server Error","response":{"message":["Error: Connection Closed"]}}
  [WhatsApp Patio] Disparando alerta de contingência para o desenvolvedor (5511996242812)...
  [WhatsApp Patio] Erro ao enviar texto para 5511996242812: 400 - {"status":400,"error":"Bad Request","response":{"message":["Error: Connection Closed"]}}
  ...
  [08:00:08] ❌ ERRO CRÍTICO NO ORQUESTRADOR MATINAL: dispatchRes is not defined
  ```

- **Mecanismo da Falha:**
  1. **Queda de Socket Baileys:** A sonda na Evolution API (`GET https://evo.tork.services/instance/connectionState/hydra`) retornou `{"instance":{"instanceName":"hydra","state":"connecting"}}`. A instância perdeu a conexão com os servidores do WhatsApp, mantendo o socket em loop de reconexão (`connecting`), o que causou o retorno imediato de `500 Connection Closed`.
  2. **Bug de Escopo Léxico (`ReferenceError: dispatchRes is not defined`):**
     Em `/home/operacional/hydra-rede/src/run_unified_morning_dispatch.js` (linha 592):
     ```javascript
     if (!isDryRun) {
       const dispatchRes = await dispararRelatoriosMatinaisSilenciosos({ ... });
       dispatchFinanceiroOk = dispatchRes && dispatchRes.ok;
     ```
     A variável `dispatchRes` foi declarada com `const` **dentro** do bloco `if (!isDryRun)`.
     Quando o envio falhou (`dispatchFinanceiroOk = false`), a execução avançou para a linha 733:
     ```javascript
     if (dispatchFinanceiroOk || isDryRun) {
       ...
     } else {
       const msgErroEnvio = `Falha no envio de relatórios via Evolution API: ${JSON.stringify(dispatchRes.logs)}`;
       log(`⚠️ ${msgErroEnvio}`);
       await enviarAlertaDev(msgErroEnvio, logFile);
       throw new Error(msgErroEnvio);
     }
     ```
     Como `dispatchRes` não existe no escopo externo, o JavaScript lançou `ReferenceError: dispatchRes is not defined`, impedindo o log limpo e abortando o processo com `exit(1)`.

---

### Causa Raiz 2: Snapshot Intradiário Prematuro Travando o Cache Noturno (Lojas Zeradas)

- **Localização dos Arquivos:**
  `/home/operacional/hydra-rede/downloads/Santo André_2026-10-26_Rede_Rel_Vendas_19_10_2026-26_10_2026.xlsx`
  Timestamp: `2026-10-26 14:40:03`
  Cabeçalho emitido pela Rede:
  ```text
  EXTRATO PARA SIMPLES CONFERÊNCIA
  PERÍODO: 19-10-2026 A 26-10-2026
  DATA DE EMISSÃO: 26-10-2026 14:40:01
  Observações: Este documento pode sofrer alterações durante o dia.
  ```

- **Mecanismo da Falha:**
  1. Às 14:40 do dia 26/10/2026, um crawl intradiário foi disparado (ou executado em teste). Nesse momento, a loja Santo André ainda não possuía faturamento fechado na maquininha da Rede (o faturamento da unidade ocorreu na segunda metade da tarde: OS 2507 faturada às 14:47 [R$ 1.448], OS 2498 faturada às 14:54 [R$ 1.820] e OS 2512 às 17:00 [R$ 2.041]).
  2. O arquivo baixado às 14:40 continha transações apenas até o dia 25/10 (domingo) e **zero linhas para o dia 26/10**.
  3. No entanto, `state_manager.js` possui a função `findExistingDownload(loja, dateTag)`:
     ```javascript
     const prefix = `${loja.nomePlanilha}_${dateTag}_`;
     const match = files.find(f => f.startsWith(prefix) && f.endsWith('.xlsx'));
     ```
     Como o arquivo `Santo André_2026-10-26_...xlsx` existia e tinha cabeçalho válido, o status da loja foi cravado como `SUCCESS`.
  4. Às 19:15 do dia 26/10, o script `index.js` gerou a planilha `Juros Rede - 26-10-2026.xlsx` com Santo André zerada.
  5. Na Esteira Noturna das 23:00 (`run_nightly_prep.js`) e nos retries da madrugada (01h, 03h, 05h, 07h), o auditor de arquivos checou o disco:
     ```javascript
     if (status.pendentes.length === 0 && !isForce) {
       log(`🎉 SUCESSO TOTAL: Todos os 5/5 relatórios oficiais já estão prontos e íntegros.`);
       return;
     }
     ```
     Como `Juros Rede - 26-10-2026.xlsx` já existia no disco com 17 KB (> 1KB), a rotina considerou tudo pronto e **pulou a reextração noturna**!
  6. Resultado: As vendas legítimas da tarde do dia 26/10 nunca foram baixadas do portal Meu Rede, deixando a loja Santo André com R$ 0,00 no fechamento oficial.

---

### Causa Raiz 3: Injeção Indevida de Modalidade PIX na Planilha de Juros e Taxas

- **Localização do Código:** `/home/operacional/hydra-rede/src/excel_processor.js` (linhas 226-285)
- **Trecho Problemático:**
  ```javascript
  const isPix = tipo.includes('pix') || modalidade.includes('pix');
  if (isPix) {
    pixCount++;
    totalPix += bruto;
  }
  ...
  let tipoLabel = modalidade;
  if (isPix) {
    tipoLabel = 'pix';
  }
  ...
  const calcJuros = isPix 
    ? { parcelas: 1, taxaRepasse: 0, taxaRepasseLabel: '0,0%', divisor: 1, valorOriginal: bruto, vendaJuros: 0 }
    : calcularVendaJuros(bruto, parcelas);

  const item = {
    tipo: tipoLabel,
    bandeira: isPix ? (bandeira || 'PIX') : bandeira,
    bruto: Math.round(bruto * 100) / 100,
    liquido: Math.round(liquido * 100) / 100,
    parcelas: isPix ? 1 : parcelas,
    ...
  };

  transacoesIndividuais.push(item);
  totalBruto += bruto;
  totalLiquido += liquido;
  ```

- **Mecanismo da Falha:**
  1. A adquirente Rede suporta transações de PIX iniciadas no QR Code do terminal POS.
  2. O `excel_processor.js` não filtra essas linhas e as adiciona diretamente no array `transacoesIndividuais` e na aba `Relatório de Juros`.
  3. No entanto, o `Relatório de Juros e Taxas da Rede` é um documento de auditoria contábil **estritamente voltado a cartões de crédito e débito** (com análise de antecipação, retenção de MDR e repasse de parcelamento ao cliente).
  4. Transações de PIX possuem custo de antecipação zero e repasse de juros zero (`0,0%`). Ao serem misturadas com cartões de crédito/débito, elas:
     - Poluem a grade de linhas da loja com registros que não sofrem retenção nem taxa;
     - Inflam artificialmente a quantidade de transações de cartão e o volume bruto;
     - Distorcem para baixo a taxa média ponderada de cartão da unidade;
     - Geram ruído e desconfiança na conferência da equipe financeira.

---

## 3. Solução Proposta

### Eixo A: Restauração da Conectividade WhatsApp e Correção do Orquestrador
1. **Reconexão da Instância `hydra`:**
   Acionar o endpoint `/instance/restart/hydra` ou `/instance/connect/hydra` na Evolution API (`https://evo.tork.services`) com a API Key oficial para restabelecer o socket Baileys com status `"open"`.
   *Nota de Segurança Inegociável:* É estritamente proibido utilizar instâncias de gerentes (`Maua`, `Jorge Beretta`, etc.). Apenas a instância `hydra` será recuperada.
2. **Correção de Escopo em `run_unified_morning_dispatch.js`:**
   Mover a declaração de `dispatchRes` para o escopo da função antes do bloco `try`, garantindo que no bloco `else` de falha os logs de envio sejam capturados sem lançar `ReferenceError`.

### Eixo B: Stale Intraday Snapshot Gate (Proteção Contra Downloads Prematuros)
1. **Diferenciação Entre Extração Intradiária e Fechamento Noturno:**
   Para extrações noturnas (executadas a partir das 20:00 ou na esteira das 23:00 / matinal do dia seguinte), qualquer download existente na pasta `downloads/` que possua timestamp de modificação anterior às **19:00 do dia faturado** deve ser considerado **obsoleto / parcial**.
2. **Invalidação no `state_manager.js` e `run_nightly_prep.js`:**
   Na função `findExistingDownload`, verificar o `mtime` do arquivo. Se a data de referência for D-1 (ontem) e o arquivo tiver sido gerado durante o horário comercial de ontem (antes das 19:00), o arquivo não será considerado `SUCCESS` para o fechamento noturno, forçando o Playwright a baixar o relatório final consolidado da noite.

### Eixo C: Expurgo Estrito de PIX do Relatório de Juros de Cartão
1. **Filtro em `excel_processor.js`:**
   Ao iterar as linhas do extrato da Rede:
   - Se `isPix === true`, a transação é **descartada** da planilha `Relatório de Juros` e dos totais consolidados de cartão (`totalBruto`, `totalLiquido`, `totalVendaJuros`, `totalTransacoes`).
   - O volume e contagem de PIX são mantidos exclusivamente em `stats.totalPix` e `stats.pixCount` para fins de log e rastreabilidade interna, sem poluir a grade visual nem o Resumo Executivo da diretoria.

### Eixo D: Reprocessamento do Dia 26/10 e Reenvio Matinal Corrigido
1. Purgar os downloads intradiários obsoletos de 26/10/2026.
2. Executar o scraper da Rede para baixar o fechamento completo (10/10 lojas) do dia 26/10/2026.
3. Reconstruir a planilha `Juros Rede - 26-10-2026.xlsx` sem PIX e com o faturamento real completo de Santo André.
4. Regenerar a `Conciliacao Patio x Rede - 27-10-2026.xlsx` cruzando os dados reais.
5. Reenviar o Quinteto Oficial via WhatsApp para o Financeiro (`5511940667032`) e para o Davi (`5511996242812`).

---

## 4. Análise de Riscos e Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Instância `hydra` exigir leitura de novo QR Code | Atraso no envio automático | Verificar se a sessão é restaurada com `/instance/restart/hydra`; se exigir QR Code, alertar imediatamente o usuário com o código para escaneamento. |
| Expurgo de PIX alterar total da Conciliação Pátio x Rede | Inconsistência entre relatórios | O algoritmo da Conciliação (`reconciliation_patio_rede_engine.js`) já possui canal próprio para PIX; a segregação garante que na planilha de Juros fiquem apenas cartões, harmonizando com a conferência manual do Financeiro. |
| Scraping da Rede falhar por bloqueio de sessão | 0/10 lojas baixadas | O scraper possui mecanismo de resume por loja com reciclagem de aba Playwright e backoff exponencial. |
