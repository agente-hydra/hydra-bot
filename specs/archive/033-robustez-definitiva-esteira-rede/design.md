# Design Técnico: Blindagem Sistêmica da Esteira Noturna, Sonda das 06:00 AM e Resiliência Operacional

## 1. Topologia da Solução e Linha do Tempo de Execução

```
[23:00 PM] ───► Esteira Noturna Primária (Crawl Rede 10 Lojas com Cutoff Gate 19:30 BRT)
[01:00 AM] ───► Checkpoint de Retry 1 (Apenas se faltar algum dos 5 arquivos)
[03:00 AM] ───► Checkpoint de Retry 2 (Apenas se faltar algum dos 5 arquivos)
[05:00 AM] ───► Checkpoint de Retry 3 (Apenas se faltar algum dos 5 arquivos)
[06:00 AM] ───► ⭐ GOLDEN GATE DAS 06:00 AM (run_morning_watchdog_0600.js)
                 ├── 1. Validação de Integridade Física dos 5 Arquivos Oficiais
                 ├── 2. Sanity Gate Pátio x Rede (Auto-healing de lojas zeradas)
                 ├── 3. Sonda de Socket WhatsApp na Evolution API (Auto-restart se != open)
                 └── 4. Alerta Dev Imediato às 06:05 AM se houver qualquer bloqueio
[07:45 AM] ───► Orquestrador Matinal Silencioso (Carga em memória e timer guard)
[07:58 AM] ───► Reconfirmação final rápida de socket WhatsApp
[08:00 AM] ───► DISPARO OFICIAL SILENCIOSO (Zero texto, 5 arquivos entregues)
```

---

## 2. Detalhamento dos Módulos

### 2.1 Novo Módulo: `src/run_morning_watchdog_0600.js`

- **Arquivo:** `/home/operacional/hydra-rede/src/run_morning_watchdog_0600.js`
- **Agendamento no Cron:**
  ```bash
  0 6 * * 1-5 /usr/bin/node /home/operacional/hydra-rede/src/run_morning_watchdog_0600.js >> /home/operacional/hydra-data/logs/watchdog-0600.log 2>&1
  ```
- **Fluxo de Execução:**
  1. **Auditoria de Arquivos:** Invoca `checarArquivos()` para a data do dia (D). Se qualquer um dos 5 relatórios estiver ausente ou `<= 1024 bytes`:
     - Aciona a esteira correspondente via `execSync`.
  2. **Sanity Gate Pátio x Rede:**
     - Carrega os pagamentos de cartão de crédito e débito das OSs do Pátio finalizadas em D-1.
     - Lê a planilha `Juros Rede - DD-MM-AAAA.xlsx`.
     - Para cada loja: se `patioCartao > R$ 500` e `redeCartao === 0`:
       - Dispara reextração cirúrgica Playwright apenas da loja pendente (`node src/index.js --loja=<nome> --now --skip-wa`).
       - Recompila a planilha consolidada.
  3. **Sonda da Instância WhatsApp (`hydra`):**
     - Consulta `GET https://evo.tork.services/instance/connectionState/hydra`.
     - Se `state !== "open"`:
       - Aciona `POST https://evo.tork.services/instance/restart/hydra`.
       - Aguarda 6 segundos.
       - Reavalia. Se persistir fechado, aciona `POST /instance/connect/hydra`.
  4. **Emissão de Alerta Antecipado:**
     - Se o watchdog encontrar qualquer falha irrecuperável, envia notificação técnica ao Dev às **06:05 AM**, garantindo 1h55m para correção antes das 08:00 AM.

---

### 2.2 Módulo `state_manager.js` (Cutoff Gate 19:30 BRT)

- **Arquivo:** `/home/operacional/hydra-rede/src/state_manager.js`
- **Função:** `isDownloadFinalClosing(filePath, targetDateISO)`
- **Regra:**
  - Se o arquivo foi baixado no mesmo dia da venda (`datePart === targetDateISO`), seu `mtime` deve ser maior ou igual a **19:30:00 BRT** (após o fechamento de todas as unidades).
  - Se o `mtime` for anterior a 19:30, a função `findExistingDownload` retorna `null`, tratando o arquivo como parcial/intradiário e forçando a coleta noturna.

---

### 2.3 Módulo `excel_processor.js` (Expurgo Estrito e Permanente de PIX)

- **Arquivo:** `/home/operacional/hydra-rede/src/excel_processor.js`
- **Regra:**
  ```javascript
  const isPix = tipo.includes('pix') || modalidade.includes('pix');
  if (isPix) {
    pixCount++;
    totalPix += bruto;
    continue; // DIRETRIZ PÉTREA: Expurgo total de PIX do relatório de cartões de crédito e débito
  }
  ```
- O PIX é registrado apenas em `stats.totalPix` e `stats.pixCount` para auditorias internas, ficando 100% ausente da grade visual, dos totais contábeis e das taxas médias do `Relatório de Juros`.

---

### 2.4 Módulo `run_unified_morning_dispatch.js` (Resiliência do Disparo das 08:00)

- **Arquivo:** `/home/operacional/hydra-rede/src/run_unified_morning_dispatch.js`
- **Correções:**
  1. Declaração no escopo superior: `let dispatchRes = null;` e `let dispatchFinanceiroOk = false;`.
  2. Bloco `else` na linha 734 protegido contra `undefined`:
     ```javascript
     const logsEnvio = dispatchRes && dispatchRes.logs ? JSON.stringify(dispatchRes.logs) : 'Sem resposta detalhada';
     const msgErroEnvio = `Falha no envio de relatórios via Evolution API: ${logsEnvio}`;
     ```
  3. Pre-flight check rápido às **07:58 AM** antes de submeter os arquivos, garantindo que o socket permaneça `open`.
