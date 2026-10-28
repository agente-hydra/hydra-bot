# Design Técnico — Spec 044: Prevenção contra Duplicação e Contaminação entre Lojas

## 1. Fluxo de Dados e Pipeline de Segurança

```
               [Playwright / S3 Download]
                           │
                           ▼
                 Arquivo XLSX em disco
                           │
   ┌───────────────────────┴───────────────────────┐
   │ CAMADA 1: Inspeção de Linhas (excel_processor)│
   │                                               │
   │ 1. Lê XLSX via SheetJS                        │
   │ 2. Localiza coluna "número do estabelecimento"│
   │ 3. Itera linhas: row[colEC] === ecEsperado?   │
   │    ├─ NÃO ──► throw [CONTAMINAÇÃO DE EC]      │
   │    └─ SIM  ──► Prossegue extração             │
   └───────────────────────┬───────────────────────┘
                           │ Extração OK ({ dados, stats })
                           ▼
   ┌───────────────────────────────────────────────┐
   │ CAMADA 2: Deduplicação e SHA-256 (state_mgr)  │
   │                                               │
   │ 1. Calcula SHA-256 do arquivo baixado         │
   │ 2. Varre stores em state.json:                │
   │    Existe store com mesmo SHA e tx > 0?       │
   │    ├─ SIM ──► throw [COLISÃO SHA-256]         │
   │    └─ NÃO ──► Persiste hash + status SUCCESS   │
   └───────────────────────┬───────────────────────┘
                           │ Checkpoint OK
                           ▼
   ┌───────────────────────────────────────────────┐
   │ CAMADA 3: Dupla Verificação (auditor)         │
   │                                               │
   │ Gate 1 (In-Flight):                           │
   │  - |Bruto_Excel - Bruto_Rede| <= 0.05?        │
   │  - |Liq_Excel - Liq_Rede| <= 0.05?            │
   │  - Qtd Transações bate?                       │
   │                                               │
   │ Gate 2 (Global Pre-Dispatch):                 │
   │  - 10/10 lojas presentes e aprovadas?         │
   │  - Hashes 100% exclusivos entre lojas?        │
   │  - Assinaturas de vendas exclusivas?          │
   │    ├─ REPROVADO ──► recordStoreFailure        │
   │    │                + Bloqueia consolidação   │
   │    └─ APROVADO  ──► Libera Planilha Final     │
   └───────────────────────────────────────────────┘
```

---

## 2. Interfaces TypeScript e Tipagens Estritas

```typescript
// Contratos de Domínio do Hydra Rede

export interface LojaConfig {
  nomePortal: string;
  ec: string;
  nomePlanilha: string;
  tipoCol: number;
  dataStartRow: number;
  clearRows: number;
  totalCell: string;
}

export interface TargetDatesInfo {
  targetDatesISO: string[];
  targetDatesBR: string[];
  displayPeriod: string;
}

export interface ResumoRedeCapturado {
  fonte: 'API_REDE' | 'DOM_REDE' | 'NAO_DETECTADO';
  brutoEsperado: number | null;
  liquidoEsperado: number | null;
  transacoesEsperadas: number | null;
  ecRetornado: string;
}

export interface TransacaoRede {
  data: string;
  nsu: string;
  autorizacao: string;
  tipo: string;
  modalidade: string;
  bandeira: string;
  bruto: number;
  liquido: number;
  parcelas: number;
  taxaPercentual: number;
  vendaJuros: number;
  valorOriginal: number;
}

export interface StatsProcessamento {
  totalBruto: number;
  totalLiquido: number;
  totalVendaJuros: number;
  totalOriginal: number;
  totalPix: number;
  pixCount: number;
  transacoesCount: number;
  totalBrutoArquivo: number;
  totalLiquidoArquivo: number;
  transacoesArquivo: number;
  linhasLidas: number;
  linhasDescartadasData: number;
}

export interface StoreStateRecord {
  ec: string;
  status: 'PENDING' | 'DOWNLOADING' | 'SUCCESS' | 'FAILED';
  attempts: number;
  filePath: string | null;
  fileSize: number;
  fileSha256: string | null;
  txSignature?: string | null;
  transacoesCount: number;
  bruto: number;
  liquido: number;
  vendaJuros: number;
  resumoRede: ResumoRedeCapturado | null;
  lastError: string | null;
  updatedAt: string;
}

export interface ExecutionState {
  dateTag: string;
  periodo: string;
  stores: Record<string, StoreStateRecord>;
  updatedAt: string;
}

export interface ValidacaoLojaResult {
  ok: boolean;
  erros: string[];
  fileHash?: string;
  txSignature?: string;
  ecsNoArquivo?: string[];
}

export interface DuplaVerificacaoGlobalResult {
  aprovado: boolean;
  totalLojasEsperadas: number;
  totalLojasAprovadas: number;
  lojasReprovadasECs: string[];
  falhasCriticas: string[];
}
```

---

## 3. Especificação Detalhada por Camada

### 3.1. Camada 1: `excel_processor.js` (Validação Estrita de EC Interno)
- **Localização:** `projects/hydra-rede/src/excel_processor.js`
- **Assinatura:** `processarRelatorioRede(filePath, targetDatesInfo, nomeLoja = '', ecEsperado = null)`
- **Algoritmo de Identificação de EC:**
  ```javascript
  const colEC = headers.findIndex(h => 
    /(n[º°o\u00FAú]?|n[º°o\u00FAú]mero\s*)?(do\s*)?estabelecimento|c[óo]digo\s*ec|^ec$/i.test(h) &&
    !/nome/i.test(h)
  );
  ```
- **Regra de Validação:**
  - Se `ecEsperado` for fornecido:
    - Para cada linha `row` na iteração pós-header:
      - Se a linha contiver células preenchidas:
        - Se `colEC >= 0`:
          - `const ecLinha = String(row[colEC] || '').replace(/\D/g, '').trim();`
          - Se `ecLinha.length >= 7`:
            - Se `ecLinha !== String(ecEsperado).trim()`:
              - **Ação:** Lança imediatamente erro:
                `throw new Error(`[CONTAMINAÇÃO DE EC] Arquivo de ${nomeLoja} (EC esperado ${ecEsperado}) contém linha com EC divergente ${ecLinha} na linha ${i + 1}!`);`
  - Se nenhuma linha de EC for encontrada em arquivo com vendas e `ecEsperado` foi exigido, verifica se o cabeçalho superior (linhas 0 a 15) contém o `ecEsperado`. Se não contiver, lança exceção.

---

### 3.2. Camada 2: `state_manager.js` (Deduplicação e Controle SHA-256)
- **Localização:** `projects/hydra-rede/src/state_manager.js`
- **Função:** `recordStoreSuccess(state, ec, { filePath, stats, dados, resumoRede, txSignature })`
- **Regras de Integridade:**
  1. Computa `fileSha256 = computeFileSha256(filePath)`.
  2. Varre todas as lojas em `state.stores`:
     ```javascript
     const txCount = dados ? dados.length : (stats ? stats.transacoesCount : 0);
     if (txCount > 0 && fileSha256) {
       for (const [otherEc, rec] of Object.entries(state.stores)) {
         if (String(otherEc) !== String(ec) && rec.status === 'SUCCESS' && rec.fileSha256 === fileSha256 && rec.transacoesCount > 0) {
           throw new Error(`[COLISÃO SHA-256] Arquivo de EC ${ec} é idêntico ao já registrado para EC ${otherEc} (Hash: ${fileSha256}). Processamento duplicado descartado.`);
         }
       }
     }
     ```
  3. Registra `state.stores[ec].fileSha256 = fileSha256`.
  4. Registra `state.stores[ec].txSignature = txSignature || gerarAssinaturaTransacoes(dados)`.
  5. Salva atomicamente via `saveState(state)`.

---

### 3.3. Camada 3: `double_check_auditor.js` (Dupla Verificação Cruzada)
- **Localização:** `projects/hydra-rede/src/double_check_auditor.js`
- **Gate 1 (In-Flight):**
  - Chamado em `scraper.js` após cada loja extraída (loop principal e contingência).
  - Compara `stats.totalBruto` e `stats.totalLiquido` com `resumoRede.brutoEsperado` e `resumoRede.liquidoEsperado` com tolerância de R$ 0,05.
  - Compara quantidade de transações.
  - Se reprovar:
    - Remove o arquivo baixado com `fs.unlinkSync(filePath)` para evitar lixo em disco.
    - Lança erro para acionar retry ou contingência.
- **Gate 2 (Global Pre-Dispatch):**
  - Chamado em `scraper.js` antes de iniciar a gravação da planilha final consolidada.
  - Verifica:
    - 10 lojas esperadas presentes com `status === 'SUCCESS'`.
    - Unicidade estrita de `fileSha256` entre todas as lojas com vendas.
    - Unicidade estrita de `txSignature` entre todas as lojas com vendas.
    - Validação de EC interno de cada arquivo em disco.
  - Se houver qualquer falha:
    - Grava `recordStoreFailure` para cada EC reprovado.
    - Bloqueia a consolidação disparando `throw new Error(...)`.

---

## 4. Atualizações Necessárias nos Chamadores (`scraper.js`)

Todos os pontos de invocação de `processarRelatorioRede` em `scraper.js` devem passar compulsoriamente o parâmetro `loja.ec`:
1. **Loop Principal (Linha ~761):**
   ```javascript
   const { dados, stats } = processarRelatorioRede(filePath, targetDatesInfo, loja.nomePlanilha, loja.ec);
   ```
2. **Loop de Contingência (Linha ~826):**
   ```javascript
   const { dados, stats } = processarRelatorioRede(filePath, targetDatesInfo, loja.nomePlanilha, loja.ec);
   ```
3. **Consolidação Final (Linha ~876):**
   ```javascript
   const { dados, stats } = processarRelatorioRede(rec.filePath, targetDatesInfo, loja.nomePlanilha, loja.ec);
   ```

---

## 5. Suíte de Testes Automatizados para a Spec 044

Um novo arquivo de teste `projects/hydra-rede/tests/test_duplication_and_contamination.js` será criado para validar exaustivamente as três camadas:
1. **Teste Camada 1 (EC Mismatch no Excel):**
   - Cria arquivo com cabeçalho de EC `47712201` e insere 1 linha com EC `63304449`. Passa `ecEsperado: '47712201'`.
   - Confirma que `processarRelatorioRede` lança `[CONTAMINAÇÃO DE EC]`.
2. **Teste Camada 2 (Colisão SHA-256 no Estado):**
   - Registra loja A com um arquivo mock de 5 vendas.
   - Tenta registrar loja B com exatamente o mesmo arquivo físico.
   - Confirma que `recordStoreSuccess` lança `[COLISÃO SHA-256]`.
3. **Teste Camada 3 (Divergência Tela vs. Arquivo):**
   - Simula loja A com vendas do arquivo divergentes da tela da Rede em R$ 10,00.
   - Confirma que `validarLojaContraRede` e `executarDuplaVerificacaoGlobal` reprovam e invalidam o estado.
