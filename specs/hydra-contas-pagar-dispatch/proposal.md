# Proposta Técnica — Automação e Despacho de Contas a Pagar (hydra-contas-pagar-dispatch)

**Spec ID:** `hydra-contas-pagar-dispatch`  
**Data:** 09/10/2026  
**Status:** Proposta (Aguardando Aprovação)  
**Ambiente:** 100% VPS Linux (`operacional@100.126.50.101`)  

---

## 1. Problema e Justificativa

Atualmente, o pipeline matinal na VPS Linux gera e despacha 3 documentos oficiais (Juros Rede, Carros em Pátio e Mapa de Metas). Contudo, a conferência de despesas e desembolsos operacionais exige que a gestão consulte manualmente o ERP Oficina Inteligente na tela de busca de Contas a Pagar (`https://sistemaoficinainteligente.com.br/wfContaBuscaPagar.aspx`), filtre os pagamentos do dia anterior (ou de sexta e sábado nas segundas-feiras), exporte o PDF e envie para conferência.

O objetivo desta especificação é **automatizar integralmente a geração desse PDF oficial de Contas a Pagar** logo após o término da exportação do Mapa de Metas no crawler da madrugada e incluí-lo no despacho limpo de WhatsApp, compondo o quarteto oficial diário de relatórios entregues pontualmente às 08:00 AM para o número autorizado.

---

## 2. Requisitos do Usuário & Comportamento Esperado

1. **Momento da Execução:**
   - Acionado imediatamente após o término da exportação do Mapa de Metas (`wfMapaDeMeta.aspx`), aproveitando a sessão já autenticada do crawler Playwright.
2. **Navegação & Seleção:**
   - Acessar `https://sistemaoficinainteligente.com.br/wfContaBuscaPagar.aspx`.
   - Clicar no checkbox de seleção de todas as empresas (`#chkEmpresaSelecao`), acionando a função nativa `fncEmpresaSelecao()`.
3. **Filtro de Data:**
   - No campo `ctl00_cph_rblFiltroData` (atualmente com padrão `"2"` = Data de Vencimento), selecionar compulsoriamente a opção `"3"` (**Data de Pagamento**).
4. **Regra Temporal das Datas:**
   - **Terça a Domingo:**
     - Data Inicial: Ontem ($D-1$)
     - Data Final: Ontem ($D-1$)
   - **Segunda-feira:**
     - Conforme regra expressa do usuário: *"caso seja segunda puxar de sexta e sabado"*.
     - Data Inicial: Sexta-feira passada ($D-3$).
     - Data Final: Ontem / Domingo ($D-1$), cobrindo todos os pagamentos efetivados no fim de semana (sexta, sábado e domingo).
5. **Busca e Impressão:**
   - Clicar em "Buscar" (`#ctl00_cph_btnBuscar`) e aguardar a renderização dos resultados no PostBack ASP.NET.
   - Clicar em "Imprimir" (`#ctl00_cph_btnRelatorio`, situado no painel `ctl00_cph_pnlImprimir` / `//*[@id="ctl00_cph_pnlImprimir"]/fieldset/table/tbody/tr/td`).
   - Capturar o download nativo do arquivo `BuscaContasAPagar.pdf`.
6. **Armazenamento Canônico na VPS:**
   - Salvar o arquivo no diretório padrão `/home/operacional/hydra-data/crawls/Contas a Pagar - DD-MM-AAAA.pdf`.
7. **Despacho Unificado no WhatsApp:**
   - Incluir o PDF de Contas a Pagar no despacho matinal das 08:00 AM.
   - Entregar **EXCLUSIVAMENTE para o número `5511996242812`** (Zero envio ao financeiro).
   - **ZERO mensagens de texto** no chat e **ZERO legendas** (`caption: ""`).

---

## 3. Evidências Coletadas do Sistema Real (Anti-Alucinação)

Através de inspeção direta no DOM autenticado do ERP na VPS (`operacional@100.126.50.101`):
- **Título da Página:** `Financeiro | Consulta de Contas a Pagar`
- **URL Alvo:** `https://sistemaoficinainteligente.com.br/wfContaBuscaPagar.aspx`
- **Checkbox Selecionar Todas as Empresas:** `#chkEmpresaSelecao` (`onclick="fncEmpresaSelecao();"`)
- **Seletor de Tipo de Data:** `<select id="ctl00_cph_rblFiltroData">`
  - Opção `"2"`: `Data de Vencimento` (Default da tela)
  - Opção `"3"`: `Data de Pagamento` (Opção requerida)
  - Opção `"1"`: `Data de Previsão`
  - Opção `"4"`: `Data de Emissão`
- **Campos de Data:**
  - Data Inicial: `<input id="ctl00_cph_txtDataInicial" type="text">`
  - Data Final: `<input id="ctl00_cph_txtDataFinal" type="text">`
- **Botão Buscar:** `<input id="ctl00_cph_btnBuscar" type="submit" value="Buscar">`
- **Painel e Botão de Imprimir:**
  - Painel: `<div id="ctl00_cph_pnlImprimir">`
  - Botão: `<input id="ctl00_cph_btnRelatorio" type="submit" value="Imprimir">`
- **Mecanismo de Geração do Arquivo:**
  - Dispara evento nativo de download: `page.waitForEvent('download')`.
  - Nome original gerado pelo ERP: `BuscaContasAPagar.pdf`.

---

## 4. Análise de Riscos e Mitigações

| Risco Identificado | Impacto | Mitigação |
|---|---|---|
| **Ausência de Pagamentos no Dia** (ex: feriados) | O ERP pode retornar grid vazia ou modal de aviso ao clicar em Imprimir | O crawler verificará se houve download; caso não haja contas ou ocorra aviso, gera arquivo em branco ou log informativo sem derrubar o crawler. |
| **Timeout de Download ASP.NET** | Falha ao receber o arquivo em conexões lentas | Timeout de 45 segundos no `waitForEvent('download')` com re-tentativa (máximo 3 tentativas). |
| **Sessão Expirada entre Mapa de Metas e Contas** | Redirecionamento para a tela de login | O módulo checa a URL atual; se for `/login`, re-autentica de forma transparente antes de prosseguir. |
| **Envio para Destinatário Indesejado** | Envio de dados sensíveis para grupos | Trava programática rígida: despacho exclusivo para `5511996242812`. |
