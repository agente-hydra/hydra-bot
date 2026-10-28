# Proposta de Arquitetura — Spec 046: Fix de Interceptação de Modal de Lojas e Eliminação de Falso-Positivo In-Flight no Hydra Rede

## 1. Contexto e Diagnóstico com Evidências Reais

Na execução de 28/10/2026 (visando o fechamento matinal de D-1 = 27/10/2026), a esteira foi impedida de concluir a extração por dois gargalos críticos registrados em `logs/scraper_2026-10-28.log`:

### Gargalo 1: Interceptação de Ponteiro no Seletor de Estabelecimentos
- **Evidência (Linhas 64–72 do log da VPS):**
  ```text
  locator('.c-header__button').or(locator('.c-header__wrapper-establishment')).or(locator('#nav-config')).or(locator('a.icon_usuario_perfil')).first()
    - locator resolved to <div class="c-header__wrapper-establishment">…</div>
  - attempting click action
    - <div role="none" tabindex="-1" aria-hidden="false" class="modal-default modal fade in ng-star-inserted">…</div> from <modal-default modalid="pv-lightbox-change-side-header-bar" class="modal-pv-lightbox modalchangebrand">…</div> subtree intercepts pointer events
  ```
- **Causa Raiz:** O modal Angular `<modal-default modalid="pv-lightbox-change-side-header-bar">` já se encontrava aberto na tela com classe `.fade.in`. O Playwright tentava clicar no botão do cabeçalho que estava fisicamente encoberto pelo backdrop/modal, gerando 53 retentativas e timeout de 30s para 9 das 10 lojas.

### Gargalo 2: Falso-Positivo em Mauá no `validarLojaContraRede`
- **Evidência (Linhas 2518 e 2525 do log da VPS):**
  ```text
  📊 [Mauá] Resumo na Rede (DOM_REDE): Bruto=2025.4 | Líquido=7005.93 | Transações=11
  ✅ Download concluído e validado in-flight: Mauá_2026-10-27_Rede_Rel_Vendas_21_10_2026-28_10_2026.xlsx
  ❌ [Contingência] Falha definitiva para Mauá: Falha na Dupla Verificação In-Flight:
     [BRUTO X REDE] Divergência em Mauá: Excel=R$ 905.00 vs Rede=R$ 2025.40 (Diff: R$ 1120.40) |
     [LÍQUIDO X REDE] Divergência em Mauá: Excel=R$ 867.37 vs Rede=R$ 7005.93 (Diff: R$ 6138.56) |
     [QTD TRANSAÇÕES] Divergência em Mauá: Excel=2 transações vs Rede=11 transações.
  ```
- **Causa Raiz:** 
  1. A captura do DOM buscou `div, span` soltos na tela e capturou um valor de Líquido (`R$ 7.005,93`) maior que o Bruto (`R$ 2.025,40`), indicando contaminação por card financeiro de saldo bancário/antecipação.
  2. A tela da Rede estava no período semanal padrão (`21/10 a 28/10`), enquanto o processador do Excel filtrou com precisão cirúrgica as 2 transações do dia alvo (`27/10/2026`, Bruto R$ 905,00).
  3. A validação in-flight reprovou o arquivo legítimo e executou `fs.unlinkSync`, descartando o relatório válido da loja Mauá.

---

## 2. Solução Proposta

### 2.1. Bypass Inteligente e Auto-Recuperação do Modal de Estabelecimentos
1. **Detecção DOM em Profundidade:**
   Criar a rotina `isModalEstabelecimentosAberto(page)` que avalia via `page.evaluate()` se `.modal-default`, `.modal-pv-lightbox`, `.modalchangebrand` ou `.modal.fade.in` possui altura visível (`rect.height > 50`) e visibilidade ativa.
2. **Bypass do Cabeçalho:**
   Se o modal já estiver aberto, pular imediatamente o clique no cabeçalho e ir direto para o passo de seleção do radio button (`#child-${loja.ec}`).
3. **Auto-Recuperação de Modal Travado:**
   Se o seletor da loja não for encontrado após scroll e o modal estiver vazio/travado, fechá-lo via botão de fechar (`.close`) ou tecla `Escape` antes de tentar reabrir pelo cabeçalho.
4. **Desmonte pós-Aplicação:**
   Após clicar em `btnAplicar`, aguardar explicitamente que o modal `.modalchangebrand` saia do DOM ou perca a classe `.in` antes de navegar para a tela de vendas.

### 2.2. Robustez e Sanitização do `validarLojaContraRede`
1. **Sanitização de Coerência Contábil:**
   Se no resumo do DOM o `Líquido > Bruto`, o resumo é automaticamente descartado como inválido (`DOM_INCOERENTE`), impedindo falso-positivo originado de saldos bancários.
2. **Filtro de Escopo do DOM:**
   Restringir a busca de resumo a seletores específicos de vendas (`.sales-summary`, `app-sales-summary`, `[data-testid*="sales"]`), evitando varredura irrestrita em `div, span`.
3. **Validação Temporalmente Consciente:**
   Se o resumo da tela refletir o período acumulado do arquivo (`Rel_Vendas_21_10_2026-28_10_2026.xlsx`), o auditor valida a paridade contra `stats.totalBrutoArquivo` e `stats.totalLiquidoArquivo`, aprovando a integridade da extração.
4. **Proteção Anti-Deleção:**
   Arquivos com linhas íntegras do EC correto nunca são deletados por divergência de DOM frágil; são preservados e auditados pelo corte de data.

### 2.3. Regra Inviolável Anti-Fallback de Planilha Legada
- Se a esteira falhar ou reter o disparo de 27/10/2026, **NUNCA** copiar ou renomear arquivos de datas anteriores da pasta `output/`. Reportar falha explícita com diagnóstico técnico.

---

## 3. Contratos de Dados e Interfaces

### Interface: `ResumoOficialRede`
```typescript
interface ResumoOficialRede {
  ec: string;
  loja: string;
  brutoEsperado: number | null;
  liquidoEsperado: number | null;
  transacoesEsperadas: number | null;
  fonte: 'API_REDE' | 'DOM_REDE' | 'DOM_INCOERENTE' | 'NAO_DETECTADO';
  periodoRotulo?: string;
  capturadoEm: string;
}
```

### Interface: `ResultadoValidacaoInFlight`
```typescript
interface ResultadoValidacaoInFlight {
  ok: boolean;
  erros: string[];
  fileHash: string;
  txSignature: string;
  ecsNoArquivo: string[];
  motivoReprovacao?: 'EC_INCORRETO' | 'ARQUIVO_INEXISTENTE' | 'CORRUPCAO_DADOS' | 'DIVERGENCIA_TOTAL';
}
```

---

## 4. Risco Principal e Mitigação

- **Risco:** O portal da Rede sofrer mutação de seletores no modal durante a madrugada.
- **Mitigação:** Estratégia de fallback triplo (detecção profunda no DOM, auto-scroll virtual em 12 passos, busca textual por EC no input de pesquisa) e timeout delimitado com screenshots e tracing chunk gravados por loja.
