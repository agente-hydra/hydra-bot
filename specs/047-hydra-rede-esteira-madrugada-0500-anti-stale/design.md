# Design Técnico — Spec 047: Hydra Rede Esteira Pós-Compensação das 05:00 AM, Eliminação de Stale Files Vespertinos e Proteção contra Taxas Arbitrárias

## 1. Fluxo de Dados e Linha do Tempo

```mermaid
flowchart TD
    subgraph Dia D [Dia D — Encerramento das Lojas]
        A["19:00 — Fechamento Físico das 10 Lojas"] --> B["19:15 — run_evening_heartbeat.js"]
        B -->|Probe de Sessão| C{"Sessão Rede Ativa?"}
        C -->|Não / reCAPTCHA| D["Alerta Dev no WhatsApp às 19:20<br/>(Janela de 5h para resolver)"]
        C -->|Sim| E["Registra Sessão OK<br/>(NUNCA gera Juros Rede oficial)"]
    end

    subgraph Noite / Madrugada [00:00 às 03:30 — Câmara Itaú / Rede]
        F["00:00 às 03:30 — Liquidação Noturna da Rede"] --> G["Geração dos Líquidos e MDRs Reais na Base do Itaú"]
    end

    subgraph Dia D+1 [Dia D+1 — Extração e Despacho]
        G --> H["05:00 AM — Âncora Principal da Esteira Noturna (run_nightly_prep.js)"]
        H --> I["Scraper baixa relatórios consolidados pós-clearing"]
        I --> J["excel_processor.js extrai taxas reais centavo a centavo (sem '-' e sem fallback)"]
        J --> K["Gravação de output/Juros Rede - DD-MM-AAAA.xlsx (mtime > 05:00 AM)"]
        K --> L["06:00 AM — Golden Gate Watchdog (run_morning_watchdog_0600.js)"]
        L -->|Auditoria dos 5 arquivos| M["07:45 AM — run_unified_morning_dispatch.js"]
        M --> N{"mtime do Juros Rede >= 00:00:00 de hoje?"}
        N -->|Sim (Frescura pós-clearing)| O["Aprovado para Despacho das 08:00 AM"]
        N -->|Não (Arquivo vespertino)| P["REJEITA STALE FILE e força re-extração imediata"]
    end
```

---

## 2. Módulos a Modificar

### 2.1 `projects/hydra-rede/src/run_evening_heartbeat.js`
- **Comportamento atual:** Executa o scraper completo às 19:15 gerando `output/Juros Rede - DD-MM-AAAA.xlsx`.
- **Novo comportamento:**
  - O heartbeat passa a rodar em modo probe por padrão (`isProbeOnly = true`), validando apenas que os cookies do Meu Rede e o cabeçalho estão ativos.
  - Se explicitamente solicitado a gerar prévia intradiária via flag `--salvar-previa`, grava exclusivamente em `output/previa_intradiaria/Juros Rede - ${dateTagBR}_previa_1915.xlsx`.
  - **PROIBIÇÃO:** Sob nenhuma circunstância tocar ou criar `output/Juros Rede - ${dateTagBR}.xlsx`.

### 2.2 `projects/hydra-rede/src/run_unified_morning_dispatch.js`
- **Comportamento atual:** Checa apenas se o arquivo existe e tem tamanho > 1024 bytes.
- **Novo comportamento:**
  - Implementação do `validarFrescuraArquivoJuros(jurosRedePath)`:
    ```javascript
    function validarFrescuraArquivoJuros(filePath) {
      if (!fs.existsSync(filePath)) return false;
      const stat = fs.statSync(filePath);
      if (stat.size <= 1024) return false;
      
      const hojeMeiaNoite = new Date();
      hojeMeiaNoite.setHours(0, 0, 0, 0);
      
      // Se o arquivo foi gerado antes da meia-noite do dia do despacho, é STALE INTRADAY
      if (stat.mtimeMs < hojeMeiaNoite.getTime()) {
        log(`⚠️ Arquivo de Juros Rede (${path.basename(filePath)}) é anterior à meia-noite (mtime: ${stat.mtime.toLocaleString('pt-BR')}). Classificado como STALE_INTRADAY.`);
        return false;
      }
      return true;
    }
    ```
  - Se `validarFrescuraArquivoJuros` retornar `false`, a reconstrução da planilha e re-extração das lojas é compulsoriamente acionada, mesmo que não seja passado `--force`.

### 2.3 `projects/hydra-rede/src/excel_processor.js`
- **Comportamento atual:** Quando `liquido === 0 || rawLiqStr === '-'`, aplica alíquotas estáticas fixas:
  - Débito: `1 - 0.012` (1,2%)
  - Crédito à vista: `1 - 0.025` (2,5%)
  - Crédito parcelado: `1 - 0.047` (4,7%)
- **Novo comportamento:**
  - Em extrações pós-meia-noite (D+1), se uma transação de cartão vier com `-` no líquido, emitir alerta nos `stats.avisos` e registrar a pendência de liquidação na adquirente.
  - Caso haja transações com `pré-autorizado === 'sim'` ou `status === 'em processamento'`, identificar explicitamente no registro do objeto para que o consolidador possa discriminar transações pré-autorizadas pendentes de OSs abertas (caso Mauá).

### 2.4 `projects/hydra-rede/src/run_nightly_prep.js` e Cron VPS
- Reforçar o checkpoint das **05:00 AM** como o horário mestre oficial de re-sync e geração de contingência pós-clearing da Rede.
- No crontab da VPS:
  - Manter o probe das 19:15 com `--probe-only`.
  - Garantir o disparo das 05:00 AM com logs detalhados em `/home/operacional/hydra-data/logs/nightly-prep-0500.log`.

---

## 3. Interfaces e Contratos de Dados

```typescript
export interface JurosRedeFrescuraCheck {
  valido: boolean;
  motivo?: 'INEXISTENTE' | 'TAMANHO_INSUFICIENTE' | 'STALE_PRE_MEIANOITE' | 'FRESCO_POS_MEIANOITE';
  mtime: Date;
  tamanhoBytes: number;
}

export interface TransacaoRedeProcessada {
  dataVenda: string;
  horaVenda: string;
  modalidade: 'débito' | 'crédito' | 'pix';
  parcelas: number;
  bruto: number;
  taxaMdrReal: number | null; // Null se não liquidado pela Rede
  liquido: number;
  isLiquidada: boolean;       // false se líquido veio '-' na Rede
  isPreAutorizada: boolean;   // true se veio como pré-autorização de link
  statusTransacao: string;
}
```

---

## 4. Testes e Validação Obrigatória
1. **Teste Unitário de Frescura Temporal:**
   - Simular arquivo criado às 19:24 de D-1 e verificar que `validarFrescuraArquivoJuros` rejeita com `STALE_PRE_MEIANOITE`.
   - Simular arquivo criado às 05:15 de D0 e verificar que é aceito como `FRESCO_POS_MEIANOITE`.
2. **Teste de Proteção contra Fallback Arbitrário:**
   - Passar mock com `rawLiqStr === '-'` e verificar que não injeta taxa fixa fictícia de 4,7%.
3. **Teste de Regressão da Suíte Completa:**
   - Executar `projects/hydra-rede/tests/run_all_tests.js` garantindo 100% de aprovação.
