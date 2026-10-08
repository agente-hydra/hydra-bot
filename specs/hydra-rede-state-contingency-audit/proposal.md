# Proposta: Gerenciador de Estado Persistente, Contingência com Resume & Auditoria de Veracidade Cruzada (Rede)

**Spec ID:** `hydra-rede-state-contingency-audit`  
**Data:** 08/10/2026  
**Status:** PROPOSTA ATUALIZADA / AGUARDANDO APROVAÇÃO (SDD Hard Stop)  
**Autor:** Antigravity Pair-Programming com Diretoria  

---

## 1. Problema Identificado

Durante a operação do dia **08/10/2026 (data base 07/10/2026)**, foram identificadas vulnerabilidades estruturais na automação do Hydra Rede:

1. **Ausência de Estado Transitório Persistente (No Checkpoint):**
   * O robô itera sobre as 10 lojas em loop linear na memória RAM.
   * Se 9 lojas forem baixadas com sucesso e a 10ª (ex: Santo André - EC 101422997) sofrer um timeout ou instabilidade transitória na interface web da Rede (como ocorreu às 07:54 no seletor de estabelecimento), o erro é capturado genericamente no `try/catch`, a loja é preenchida com array vazio `dados: []`, e o script segue em frente.
   * Não há mecanismo para reiniciar o robô aproveitando os 9 arquivos já baixados. Uma nova execução é forçada a baixar tudo do zero, aumentando drasticamente o tempo de processamento, o risco de novos timeouts e limites de requisições na Rede.

2. **Falso Positivo de Entrega (Vazamento de Relatório Incompleto):**
   * O orquestrador central (`index.js`) não possui um **Gate de Totalidade**. Mesmo com a loja Santo André falhando na extração (`lojasErro.length > 0`), o robô seguiu para o agendamento das 08:00 AM e disparou o relatório com Santo André constando R$ 0,00, gerando falsa percepção de falta de vendas na loja física.

3. **Inexistência de Auditoria e Veracidade Cruzada (Arquivos Brutos x Relatório Consolidado):**
   * O sistema não realiza uma conferência matemática independente entre os arquivos `.xlsx` brutos baixados da Rede e a planilha consolidada gerada.
   * Falta uma camada de conciliação que valide se cada centavo e cada transação extraída dos arquivos originais confere 100% com os subtotais por loja, com a aba "Resumo Executivo" e com a legenda oficial enviada no WhatsApp.

4. **Silêncio Operacional & Falha de Notificação Imediata ao Dev (`WHATSAPP_DEV_NUMBER`):**
   * Quando Santo André falhou às 07:54, o robô **não enviou nenhum alerta para o número do desenvolvedor (`11996242812`)**.
   * O erro ficou enterrado no arquivo de log do servidor, enquanto o orquestrador esperou passivamente até as 08:00 para enviar a mensagem normal à diretoria.
   * O desenvolvedor precisa ser **notificado no seu WhatsApp imediatamente no momento da falha** para tomar ciência do incidente em tempo real antes de qualquer cobrança ou entrega com dados parciais.

---

## 2. Solução Proposta

Implementar uma arquitetura de alta disponibilidade, resiliência e integridade dividida em 4 pilares:

### Pilar 1: Gerenciador de Estado e Checkpointing (`State Manager`)
* Criação de um arquivo de estado persistente por execução e data-alvo: `projects/hydra-rede/data/state_<dateTag>.json`.
* O estado rastreia cada uma das 10 lojas:
  * `status`: `'PENDING' | 'DOWNLOADING' | 'SUCCESS' | 'FAILED'`
  * `attempts`: contador de tentativas
  * `filePath`: caminho do arquivo `.xlsx` baixado no disco
  * `fileSize` e `fileSha256`: integridade física do arquivo baixado
  * `transacoesCount`, `brutoTotal`, `liquidoTotal`, `vendaJurosTotal`
  * `lastError`: detalhes de exceções capturadas
* **Resume Inteligente:** Ao rodar (ou reiniciar após falha), o robô inspeciona o estado. Lojas com status `SUCCESS` e arquivo físico válido em `downloads/` **NÃO são rebaixadas da Rede**. O scraper navega e baixa **apenas as lojas pendentes ou com falha**.

### Pilar 2: Auto-Healing, Seletor Resiliente e Segunda Passada
* **Robustez no Seletor da Rede:** Tratar especificamente o clique no botão de troca de estabelecimento (`.changeApplyButton`, `button:has-text("aplicar")`), com retentativa com scroll forçado, espera ativa de resposta de rede e verificação se o EC ativo no header realmente mudou antes de navegar.
* **Auto-Retry Local:** Até 3 tentativas por loja dentro da mesma sessão Playwright.
* **Segunda Passada de Contingência:** Se ao final do loop restarem lojas em `FAILED`, o robô fecha a página, recria o contexto do navegador (limpando cookies/overlays acumulados) e executa uma passada limpa focada apenas nas lojas faltantes.

### Pilar 3: Notificação Imediata de Incidentes ao Dev (Early Warning)
* **Alerta Instantâneo no WhatsApp do Dev (`11996242812`):**
  * Se uma loja falhar ou for para retry na contingência, o robô dispara um alerta técnico imediato para o número do desenvolvedor.
  * Informa: Loja afetada, código EC, horário, mensagem de erro do portal da Rede e aviso de que a entrega oficial está **retida até a conciliação completa**.
  * Garante que o desenvolvedor esteja ciente da instabilidade em tempo real, sem surpresas no horário de entrega.

### Pilar 4: Auditoria de Integridade e Veracidade Cruzada (`Reconciliation Audit Gate`)
* **Gate de Totalidade Obrigatório:** Se `lojasSucesso < 10`, o envio para a diretoria é **BLOQUEADO**. Um alerta técnico com as lojas faltantes é disparado exclusivamente para o Dev (`11996242812`).
* **Conciliação Cruzada Linha-a-Linha:**
  * O módulo de auditoria reabre os 10 arquivos brutos em `downloads/` de forma isolada.
  * Recalcula a soma estrita da data alvo para cada loja.
  * Abre a planilha final `JUROS REDE - <dateTag>.xlsx` via `exceljs` e compara:
    1. Soma dos cartões de cada loja no relatório vs soma do arquivo bruto.
    2. Valores da aba "Resumo Executivo" vs soma dos arquivos brutos.
    3. Células de KPIs consolidado (`A5`, `D5`, `G5`) vs soma total dos arquivos brutos.
  * **Tolerância zero:** Divergência máxima permitida = **R$ 0,00**.
* **Selo de Veracidade:** Se aprovado (10/10 lojas íntegras e 0 divergências), grava `audit_<dateTag>.json` e adiciona o selo de certificação na legenda do WhatsApp:
  `🔒 *Integridade Auditada:* 10/10 lojas conciliadas contra arquivos brutos da Rede (100% verificado).`

---

## 3. Contratos de Dados & Estado

### Arquivo de Estado: `projects/hydra-rede/data/state_<dateTag>.json`
```json
{
  "dateTag": "2026-10-07",
  "displayPeriod": "07/10/2026 (Quarta-feira)",
  "createdAt": "2026-10-08T07:50:00.000Z",
  "updatedAt": "2026-10-08T07:56:00.000Z",
  "overallStatus": "READY_FOR_AUDIT",
  "stores": {
    "101422997": {
      "nomePlanilha": "Santo André",
      "nomePortal": "HD MP",
      "ec": "101422997",
      "status": "SUCCESS",
      "attempts": 2,
      "filePath": "C:/Users/User/Desktop/agy/projects/hydra-rede/downloads/Santo André_2026-10-07_....xlsx",
      "fileSize": 12850,
      "fileSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "transacoesCount": 14,
      "bruto": 18500.50,
      "liquido": 17800.20,
      "vendaJuros": 1250.00,
      "lastError": null
    }
  }
}
```

### Relatório de Auditoria: `projects/hydra-rede/logs/audit_<dateTag>.json`
```json
{
  "dateTag": "2026-10-07",
  "auditedAt": "2026-10-08T07:57:00.000Z",
  "status": "PASSED",
  "totalStores": 10,
  "successfulStores": 10,
  "reconciliation": {
    "brutoRawFiles": 27412.75,
    "brutoReportWorkbook": 27412.75,
    "brutoDiscrepancy": 0.00,
    "liquidoRawFiles": 26324.50,
    "liquidoReportWorkbook": 26324.50,
    "liquidoDiscrepancy": 0.00,
    "vendaJurosRawFiles": 1845.20,
    "vendaJurosReportWorkbook": 1845.20,
    "vendaJurosDiscrepancy": 0.00,
    "transacoesRawFiles": 22,
    "transacoesReportWorkbook": 22,
    "transacoesDiscrepancy": 0
  },
  "storesAudit": [
    {
      "loja": "Santo André",
      "status": "MATCH",
      "rawBruto": 18500.50,
      "reportBruto": 18500.50,
      "rawTx": 14,
      "reportTx": 14
    }
  ]
}
```

---

## 4. Risco Principal & Mitigação

* **Risco:** Reutilizar um arquivo bruto de uma execução anterior que estava corrompido ou baixado pela metade.
* **Mitigação:** Validação estrita do arquivo antes de considerá-lo válido:
  1. O arquivo `.xlsx` deve ter tamanho mínimo (> 5 KB).
  2. A biblioteca `xlsx` deve conseguir abrir o arquivo e ler os cabeçalhos sem erros.
  3. Deve possuir timestamp de modificação coerente com a data da execução. Se o arquivo estiver corrompido, o estado descarta o arquivo e força novo download na Rede.
