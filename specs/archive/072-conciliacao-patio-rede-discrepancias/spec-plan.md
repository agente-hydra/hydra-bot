# Plano de Execução — Spec 072: Resolução de Discrepâncias de Pátio x Rede

## Estratégia de Execução
- **Especialistas Ativados:**
  - `specialist-crawler-rede`: Engenharia do livro-razão multiconjunto em `patio_ledger_engine.js` e algoritmo estimador de datas de parcelas de cartão de crédito.
  - `[LEAD]`: Ajuste do motor de conciliação em `reconciliation_patio_rede_engine.js`, alinhamento visual em `excel_patio_builder.js`, supressão de candidatos abertos e batimento automatizado contra as planilhas de 04/11 e 05/11.
- Cada tarefa só é marcada como `[x]` com comando de validação determinístico registrado em `evidence/t<n>.md`.

---

## Tasks

- [x] [SPECIALIST:specialist-crawler-rede] **T1 — Deduplicação Ponderada do Multiconjunto no Ledger de Pátio**
  - Modificar `extractPaymentsForReferenceDay` em `projects/hydra-rede/src/patio_ledger_engine.js`.
  - Implementar verificação de consumo de ocorrências: comparar quantas vezes a assinatura `${storeKey}|${rec.osNumber}|${formaNorm}|${valor}` já foi registrada em `seenRegistry.transacoes[sig]` contra a contagem na OS atual.
  - Se `seenCount >= totalOcorrenciasNaOS`, a transação é marcada como já processada em dias anteriores e não entra em `matchedPayments` de D-1.
  - **Aceite:** Pagamentos de 04/11 (Kennedy OS #4461 R$ 5.131,10 e OS #4460 R$ 2.159,70) não são duplicados no ledger de 05/11.

- [x] [SPECIALIST:specialist-crawler-rede] **T2 — Calibração do Estimador de Data Comercial (`estimateTransactionDateBR`)**
  - Refatorar `estimateTransactionDateBR` em `projects/hydra-rede/src/patio_ledger_engine.js`.
  - Restringir a Âncora 3 de tolerância (28-34 dias): nunca associar automaticamente à data corrente se a OS estiver em aberto há mais de 3 dias sem comprovante ou alteração no saldo devedor (`restanteERP`).
  - Garantir que a OS Piraporinha #40465 (Crédito R$ 2.842,00 liquidado em 04/11) seja corretamente capturada e identificada como quitada em D-1.
  - **Aceite:** OS #18537 (Planalto) não recebe falso pagamento de R$ 3.030,00 e OS #40465 (Piraporinha) exibe quitação de R$ 2.842,00.

- [x] [LEAD] **T3 — Supressão de Falso-Candidato Aberto na Conciliação (`reconciliation_patio_rede_engine.js`)**
  - Remover a cláusula incondicional `ehCandidatoAberto = true` nas linhas 559-562 e 585-588 de `projects/hydra-rede/src/reconciliation_patio_rede_engine.js`.
  - Exigir que pagamentos de OSs em aberto possuam data de vencimento/transação estritamente compatível com `targetDatesList`.
  - Assegurar que OSs finalizadas em D-2 (Santo André OS #2520 e OS #2522) sejam purgadas e não ressurjam como saídas de ontem na conciliação de D-1.
  - **Aceite:** Jabaquara OS #489 e Planalto OS #18537 não fornecem transações fantasmas para o conciliador da Rede.

- [x] [LEAD] **T4 — Tratamento de Venda com Juros da Rede & Formatação do Pátio**
  - Ajustar a integração de transações categorizadas como `Venda c/ Juros Rede (OS s/ juros)` para que a aba de Pátio (OS) exiba o valor nominal contratado da OS sem resíduo artificial de pátio.
  - Demonstrar os juros repassados de forma limpa na conciliação, alinhado com a rubrica "Venda de Juros" da contabilidade (Mauá OS #22660 e Rudge Ramos OS #8881).
  - **Aceite:** Mauá OS #22660 e Rudge OS #8881 são exibidas no pátio com saldo zerado e conciliação perfeita contra as vendas de R$ 4.886,22 e R$ 1.206,46 da Rede.

- [x] [LEAD] **T5 — Suíte de Regressão e Validação Integral contra `CONCILIAÇÃO 0511.xlsx`**
  - Criar script de teste automatizado `projects/hydra-rede/src/test_conciliacao_0511_discrepancies.js` que executa a geração da planilha para 05/11/2026 e compara célula por célula os totais de pátio, status das OSs e transações conciliadas com `C:\Users\User\Downloads\CONCILIAÇÃO 0511.xlsx`.
  - Executar teste de regressão para o dia 04/11/2026 para assegurar zero impacto adverso nos relatórios passados.
  - Gravar logs e evidências em `specs/072-conciliacao-patio-rede-discrepancias/evidence/`.
  - **Aceite:** Teste roda com exit code 0; 100% dos saldos e pagamentos de pátio conferem com a auditoria manual.
