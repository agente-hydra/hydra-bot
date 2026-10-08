# Proposal — Relatório Diário de Carros em Pátio por Loja & Ciclo de Quitação de OS

**Spec:** `hydra-patio-os-reconciliation`  
**Data:** 06/10/2026  
**Repositório:** `agy` / `hydra-bot`  
**Autor:** Antigravity AI Engine  
**Destino:** Módulo de Conciliação Diária de Pátio / WhatsApp Notifier  
**Estado:** Proposta formalizada; nenhum código operacional implementado nesta etapa (**HARD STOP**).

---

## 1. Contexto e Motivação do Negócio

A rede automotiva opera atualmente com 10 lojas físicas ativas. Diariamente, a diretoria e a equipe financeira necessitam auditar os veículos e ordens de serviço (OS) em pátio, acompanhando tanto as pendências financeiras em aberto quanto as amortizações parciais e quitações ocorridas ao longo do ciclo contábil mensal.

Hoje, esse processo possui duas fricções críticas:
1. **Trabalho Manual Extensivo:** O operador financeiro precisa acessar o ERP Oficina Inteligente para cada uma das 10 lojas, exportar os relatórios individuais de conferência (`ConferenciaOSxFinanceiro.xls`), abrir a planilha mestre do mês (ex: `C:\Users\User\Desktop\conciliacao\08-26\CONCILIAÇÃO 2608.xlsx`), copiar os valores de OS, saldos e formas de pagamento para a aba `OS`, e enviar resumos para a diretoria.
2. **Perda de Rastreabilidade de Amortizações:** Se um relatório diário considerar estritamente as OSs com saldo em aberto no momento da consulta, ordens que foram quitadas ou tiveram pagamentos parciais no dia anterior desaparecem subitamente da visualização diária, impedindo a diretoria de identificar **qual pagamento fechou a OS** e **quais veículos foram baixados no dia**.

A proposta consiste em unificar o **crawler multi-loja do Oficina Inteligente** com um **motor de reconciliação de ciclo de vida de OS (Monthly Reconciliation Ledger)** e o **gerador de Excel do ecossistema Hydra**, enviando a planilha formatada e o resumo executivo pontualmente às **08:00 AM** via WhatsApp para o número corporativo (`+55 11 94066-7032`), com canal de contingência e logs para o desenvolvedor (`+55 11 99624-2812`).

---

## 2. Regra Fundamental: Ciclo de Vida da OS no Mês (Ledger State Machine)

Conforme estabelecido pela gestão, a planilha diária segue a convenção estabelecida na aba `OS` do arquivo de referência `CONCILIAÇÃO 2608.xlsx`. O ciclo contábil de cada OS é governado pelas seguintes regras:

### Cenário 1: Entrada de OS no Pátio (Novo Saldo Devedor)
- A OS surge no ERP em estado `Aberta` com `Restante na OS > 0` (ex: Jabaquara, OS `#396`, Saldo a pagar de `R$ 5.000,00`).
- Na planilha do dia:
  - **OS:** `396`
  - **Data:** `20/08/2026`
  - **Valor:** `R$ 5.000,00`
  - **PAGAMENTOS:** Vazio ou anotação inicial de entrada.

### Cenário 2: Amortização Parcial / Novo Lançamento
- No dia seguinte, o cliente efetua um pagamento de `R$ 2.000,00` no PIX (ou cartão), mas ainda resta saldo devedor.
- O saldo restante no ERP cai para `R$ 3.000,00`.
- O motor de reconciliação compara o snapshot anterior com o atual, detecta a amortização de `R$ 2.000,00` e identifica o método registrado no ERP.
- Na planilha do dia:
  - **OS:** `396`
  - **Data:** `20/08/2026`
  - **Valor:** `R$ 3.000,00` (reflete o novo saldo devedor atualizado)
  - **PAGAMENTOS:** `PIX: 2000.00;` (reflete apenas o pagamento novo/atualizado do ciclo).

### Cenário 3: Quitação / Fechamento da OS (Saldo Zerado)
- No dia subsequente, o cliente efetua o pagamento restante de `R$ 3.000,00` no Crédito. O saldo restante da OS atinge `R$ 0,00` (ou status muda para `Finalizada`).
- **A OS NÃO PODE SUMIR NO DIA DA QUITAÇÃO!**
- Na planilha do dia da quitação:
  - **OS:** `396`
  - **Data:** `20/08/2026`
  - **Valor:** `0` (ou `R$ 0,00`)
  - **PAGAMENTOS:** `Credito: 3000.00;` (mostra explicitamente a forma de pagamento que encerrou a dívida).

### Cenário 4: Manutenção de OS Zerada até a Virada do Mês
- Nos dias posteriores dentro do mesmo mês civil (ex: dias 22 a 31 de agosto):
  - A OS `#396` permanece listada na seção de Jabaquara com **Valor = 0**, garantindo que não some à soma total de pátio em aberto da loja, mas continue visível como auditada e liquidada no mês.
- **Virada do Mês (1º dia do mês seguinte):**
  - O Ledger é arquivado e rotacionado.
  - A planilha do novo mês inicia limpa, carregando **exclusivamente as OSs que continuam com saldo em aberto** (`Restante na OS > 0`) e incorporando os novos veículos do mês subsequente.

---

## 3. Mapeamento das 10 Lojas Oficiais da Rede

O relatório contempla rigorosamente as 10 unidades físicas elegíveis da rede (expurgando a unidade Master administrativa, conforme governança em `.agent/memory/domain.md`):

| Ordem na Planilha | Nome no Excel (`CONCILIAÇÃO 2608.xlsx`) | Slug Interno | ID Empresa no Oficina Inteligente (`id_empresa_oi`) |
| :---: | :--- | :--- | :---: |
| 1 | **Planalto** | `brasicar_planalto` | `203` |
| 2 | **Piraporinha** | `emporio_piraporinha` | `205` |
| 3 | **Mauá** | `mhe_maua` | `146` |
| 4 | **Kennedy** | `mp_kennedy` | `351` |
| 5 | **Rudge Ramos** | `cap_rudge_ramos` | `748` |
| 6 | **Santo André** | `hd_santo_andre` | `2112` |
| 7 | **Rei do Modulo** | `mp_rei_modulo` | `2190` (ou `4220`) |
| 8 | **Jorge Beretta** | `dhjv_jorge_beretta` | `2602` |
| 9 | **Dom Pedro I** | `dp_dom_pedro` | `4045` |
| 10 | **Jabaquara** | `jab_jabaquara` | `4469` |

---

## 4. De-Para dos Dados Brutos do ERP para a Planilha

Os arquivos de conferência exportados pelo ERP (`[ID]_ConferenciaOSxFinanceiro.xls`) fornecem as colunas que alimentam a reconciliação:

| Campo do ERP (`ConferenciaOSxFinanceiro.xls`) | Coluna na Planilha Mestre (`OS`) | Tratamento e Regra de Negócio |
| :--- | :--- | :--- |
| `OS` (Coluna A) | **OS:** (Coluna B) | Número identificador numérico da OS. |
| `Data` (Coluna B) | **Data:** (Coluna C) | Data de abertura da OS no pátio, formatada como `DD/MM/YYYY`. |
| `Restante na OS` (Coluna M) | **Valor:** (Coluna D) | Saldo devedor líquido em aberto. Se a OS quitou no ciclo, recebe `0`. Formatado como moeda `R$ #,##0.00`. |
| `Forma(s) de Pagamento` (Coluna O) | **PAGAMENTOS:** (Coluna E) | Meio de pagamento capturado no ERP (ex: `Credito: 220.00;`, `PIX 2000`). Se quitou hoje, exibe o método de fechamento. |
| N/A (Linha de Fechamento da Loja) | **Totalizador** (Coluna D) | Fórmula nativa do Excel `=SUM(D[inicio]:D[fim])` totalizando o saldo em aberto da loja. |

---

## 5. Arquitetura da Solução & Pipeline de Execução

```
[07:30 AM] Agendador Windows Task Scheduler
   │
   ▼
[Crawler Playwright Headless]
   ├── Autentica no Oficina Inteligente via credenciais .env
   ├── Itera pelas 10 lojas selecionando via `ensureCompany(idEmpresaOI)`
   └── Baixa os 10 arquivos `[ID]_ConferenciaOSxFinanceiro.xls` em `output/conferencia/<YYYY-MM-DD>/`
   │
   ▼
[Monthly Ledger & State Engine]
   ├── Lê o snapshot histórico do mês (`data/patio_ledger_<YYYY-MM>.json`)
   ├── Processa as 10 lojas: calcula deltas de saldo, novos pagamentos e OSs quitadas
   └── Persiste o novo snapshot do dia no Ledger
   │
   ▼
[ExcelJS Generator Engine]
   ├── Monta a aba `OS` estritamente idêntica à referência `CONCILIAÇÃO 2608.xlsx`
   ├── Gera fórmulas dinâmicas `=SUM(...)` sem `#DIV/0!` nem erros de referência
   ├── Configura página A4 Paisagem com gridlines e fitToWidth
   └── Salva o arquivo em `output/relatorios/CONCILIACAO_PATIO_<DDMM>.xlsx`
   │
   ▼
[Timer Guard: 08:00:00 AM]
   │
   ▼
[WhatsApp Dispatcher (Evolution API)]
   ├── Envia a planilha e o Resumo Executivo Hydra para o Cliente: +55 11 94066-7032
   └── Se ocorrer qualquer falha durante a execução:
       Roteia alerta com stack trace completo para o Dev: +55 11 99624-2812
```

---

## 6. Análise de Riscos e Mitigações

1. **Risco de Sessão / Concorrência no ERP Oficina Inteligente:**
   - *Risco:* O ERP pode deslogar ou exigir troca de empresa com postback lento.
   - *Mitigação:* Reutilização do mecanismo `withRetry(..., 3)` e confirmação de postback com `waitForTimeout` e verificação do dropdown após `ensureCompany`.
2. **Risco de Flutuação de Formato na Coluna de Formas de Pagamento:**
   - *Risco:* Algumas OSs trazem formatos como `"Credito: 1139.80;"` e outras trazem `"c 2.363,40"` ou `"pix 2000"`.
   - *Mitigação:* Parser tolerante a regex que extrai tanto as formas estruturadas quanto os textos literais preenchidos no ERP sem truncamento.
3. **Risco de Quebra na Soma Total das Lojas:**
   - *Risco:* Subtotais com fórmulas quebradas ou limites fixos de linhas.
   - *Mitigação:* Motor elástico: a linha de subtotal de cada loja é calculada dinamicamente com base no número exato de OSs presentes no bloco (`D[startRow]:D[endRow]`).
4. **Risco de Spam no WhatsApp do Cliente:**
   - *Risco:* Notificações de erro ou falhas de scraping sendo enviadas para a diretoria.
   - *Mitigação:* Roteamento estrito em 2 canais: canal do cliente recebe apenas documento gerado com sucesso; canal do desenvolvedor recebe alertas de contingência.

---

## 7. Critérios de Aceite

1. O relatório reproduz com 100% de fidelidade visual, estrutural e matemática a aba `OS` de `CONCILIAÇÃO 2608.xlsx`.
2. As 10 lojas estão dispostas verticalmente na ordem exata oficial.
3. OSs com pagamento parcial exibem o novo saldo restante e o pagamento atualizado.
4. OSs que quitam no dia exibem Saldo 0 e a forma de quitação, permanecendo com Saldo 0 até o encerramento do mês civil.
5. As fórmulas `=SUM(...)` nos subtotais somam apenas a respectiva loja e recalculam instantaneamente no Excel.
6. A planilha está configurada para impressão em folha A4 Paisagem sem colunas cortadas.
7. O envio ocorre pontualmente às 08:00 AM no WhatsApp `+55 11 94066-7032`, e erros vão para `+55 11 99624-2812`.
