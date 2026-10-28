# Proposta de Arquitetura — Spec 044: Prevenção contra Duplicação e Contaminação entre Lojas no Hydra Rede

## 1. Contexto e Problema Operacional

No ecossistema multi-loja do portal Meu Rede (10 estabelecimentos / ECs comerciais), falhas intermitentes de concorrência na fila S3 (`/downloads/queue`), lentidão na renderização do modal de troca de loja ou falhas silenciosas de sessão podem resultar na entrega de um relatório de vendas pertencente à Loja A no momento em que o robô está processando a Loja B.

Sem uma barreira multinível de integridade, esse cenário geraria dois desastres operacionais críticos antes das 08:00 AM:
1. **Contaminação Cruzada de Lojas:** O faturamento, taxas e transações de uma loja seriam indevidamente atribuídos a outra na planilha consolidada enviada à diretoria e aos gerentes.
2. **Duplicação Silenciosa de Relatório:** O mesmo arquivo físico ou conjunto idêntico de vendas seria computado duas vezes, gerando distorção contábil e quebra de conciliação com o ERP Pátio.

## 2. Solução Proposta: Três Camadas de Defesa Integradas

Para blindar o sistema de forma determinística contra qualquer falha do portal ou da fila, a arquitetura estabelece **três camadas de defesa estritas e complementares**:

```
[DOWNLOAD DO ARQUIVO DA REDE]
             │
             ▼
┌────────────────────────────────────────────────────────────────────────┐
│ CAMADA 1: Validação Estrita de EC no Conteúdo da Planilha              │
│ (excel_processor.js)                                                   │
│ - Inspeciona linhas internas do Excel (coluna "número do estabelecimento")│
│ - Compara cada linha com o EC esperado da loja ativa                   │
│ - Rejeita sumariamente se pertencer a outra unidade ou se houver mix   │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ Aprovado
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│ CAMADA 2: Controle de Integridade e Deduplicação por Hash SHA-256      │
│ (state_manager.js + intra_extraction_validator.js)                     │
│ - Computa SHA-256 binário e assinatura de transações (NSU+Valor+Data)  │
│ - Trava atômica no checkpoint: se o hash já existir em OUTRA loja,     │
│   rejeita com alerta de colisão e descarta o processamento duplicado   │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ Aprovado
                                     ▼
┌────────────────────────────────────────────────────────────────────────┐
│ CAMADA 3: Dupla Verificação Cruzada (Auditoria Tela vs. Arquivo)       │
│ (double_check_auditor.js - Gate 1 In-Flight & Gate 2 Global)           │
│ - Confronta Bruto, Líquido e Transações da Tela/API vs. Soma do Excel  │
│ - Tolerância estrita de R$ 0,05 para arredondamentos de MDR            │
│ - Bloqueia consolidação e envio se houver divergência de outra loja    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Contratos de Dados e Mudanças de Interface

### 3.1. Camada 1: `processarRelatorioRede` em `excel_processor.js`
- **Assinatura Atualizada:**
  ```javascript
  function processarRelatorioRede(filePath, targetDatesInfo, nomeLoja = '', ecEsperado = null)
  ```
- **Comportamento:**
  - Localiza dinamicamente a coluna de estabelecimento (`número do estabelecimento`, `ec`, etc.).
  - Se `ecEsperado` for fornecido:
    - Valida cada linha de dados antes de somar ou extrair.
    - Se encontrar qualquer linha cujo EC difira de `String(ecEsperado).trim()`, lança imediatamente exceção tipada:
      `throw new Error('[CONTAMINAÇÃO DE EC] Arquivo de ' + nomeLoja + ' (EC esperado: ' + ecEsperado + ') contém linha com EC ' + ecEncontrado + '!');`
    - Se o arquivo contiver linhas de vendas válidas mas nenhuma linha do `ecEsperado`, lança exceção de mismatch de EC.

### 3.2. Camada 2: `recordStoreSuccess` e Deduplicação em `state_manager.js`
- **Trava de Colisão de Hash:**
  - Antes de persistir `status = 'SUCCESS'`, o `state_manager` varre `state.stores`:
    ```javascript
    for (const [otherEc, storeRec] of Object.entries(state.stores)) {
      if (otherEc !== ec && storeRec.status === 'SUCCESS' && storeRec.fileSha256 === fileSha256 && storeRec.transacoesCount > 0) {
        throw new Error(`[COLISÃO SHA-256] Arquivo de ${ec} é idêntico ao já registrado para ${otherEc} (Hash: ${fileSha256}). Processamento duplicado descartado.`);
      }
    }
    ```
  - Registra compulsoriamente os campos: `fileSha256`, `txSignature`, `ecsNoArquivo` no registro persistente do estado.

### 3.3. Camada 3: `double_check_auditor.js`
- **Orquestração Integrada:**
  - **Gate 1 (In-Flight):** Executado imediatamente após o processamento da loja no loop do Playwright. Se reprovar, o arquivo contaminado é removido fisicamente do disco (`unlinkSync`) e a loja é marcada como falha para retry imediato ou contingência.
  - **Gate 2 (Global Pre-Dispatch):** Executado antes de consolidar a planilha final e antes do despacho das 08:00 AM. Se qualquer loja apresentar divergência com o resumo da Rede, o Gatekeeper invalida o checkpoint dos ECs reprovados e bloqueia o envio.

---

## 4. Riscos Principais e Mitigações

| Risco | Probabilidade | Impacto | Mitigação Arquitetural |
|---|---|---|---|
| Falso-positivo em domingos/feriados (lojas sem vendas gerando arquivos vazios semelhantes) | Média | Alto | A checagem de colisão por SHA-256 e de assinatura de vendas só é acionada se `transacoesCount > 0`. Arquivos vazios legítimos de lojas diferentes são aceitos desde que o binário não seja idêntico. |
| Arquivo da Rede sem coluna explícita de EC em relatórios resumidos | Baixa | Médio | Fallback resiliente: se a coluna de EC não for encontrada no header, inspeciona o bloco de cabeçalho (linhas 0 a 15) antes de lançar exceção. |
| Divergência de centavos entre o resumo visual do portal e o Excel | Alta | Alto | Tolerância financeira de até R$ 0,05 (`TOLERANCIA_CENTAVOS = 0.05`) para compensar arredondamento de taxa MDR de adquirente. |
| Travamento do Resume se a loja reprovada continuar marcada como `SUCCESS` | Média | Alto | Invalidação atômica: qualquer rejeição no Gate 1 ou Gate 2 reverte imediatamente o status da loja para `FAILED` no `state.json`. |

---

## 5. Critérios de Aceite (DoD)

1. O `excel_processor.js` deve rejeitar com erro fatal qualquer tentativa de processar arquivo com linhas de outro EC quando `ecEsperado` for informado.
2. O `state_manager.js` deve impedir o registro de sucesso de duas lojas com o mesmo hash SHA-256 (quando há transações > 0), gravando `FAILED` no estado.
3. O `scraper.js` deve passar `loja.ec` para `processarRelatorioRede` em todos os pontos de chamada (loop principal, contingência e consolidação).
4. O `double_check_auditor.js` deve garantir 100% de consistência entre a tela da Rede e o arquivo antes do envio das 08:00 AM.
5. Todos os testes unitários e de integração existentes em `tests/run_all_tests.js` devem continuar passando com 100% de sucesso.
