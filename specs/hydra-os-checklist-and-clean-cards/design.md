# Design Técnico: Checklist OS #1132, Resiliência de Crawl e Formatação Visual de Cards

**Spec ID:** `hydra-os-checklist-and-clean-cards`  
**Status:** PROPOSTA / DESIGN  

---

## 1. Arquitetura da Solução

### 1.1 Módulo de Crawl e Resiliência da OS 1132
* **Ponto de Falha:** `os_deep_inspector.ts:376-382`:
  O clique em `#ctl00_cph_btnLimpar` inicia uma requisição assíncrona/postback no WebForms ASP.NET. A tentativa subsequente de preencher `#ctl00_cph_txtOrdemDeServicoID` e clicar em `#ctl00_cph_btnBuscar` sem aguardar o término do ciclo do ASP.NET causa `Timeout 15000ms exceeded`.
* **Correção:**
  1. Aguardar `page.waitForLoadState('networkidle')` ou remover o clique desnecessário no `btnLimpar` quando o campo de ID já pode ser limpo via `.fill('')`.
  2. Implementar função de retry/re-extração pontual (`reextrairOSNominal(osId, lojaSlug)`).
  3. Atualizar o banco de dados `ordens_servico` com o `raw_payload` completo contendo as seções `checklists`, `itens`, `pagamentos`.

### 1.2 Formatador de Listagem de Pátio e Unidades (Anti-Ameba)
* **Local:** `src/hydra-sync/operational_adapter.ts` e `system_prompt.md`.
* **Formato Proibido (Ameba com Pipes):**
  ```text
  • Corsa Wind (CYG2B02) | OS #1129 | Guilherme Fabiano
  Status: Em Diagnóstico | Pátio: 6 dias | Valor: R$ 905,00 (resta R$ 905,00)
  ```
* **Novo Formato Homologado (Cards Verticais Elegantes):**
  ```text
  *Corsa Wind* (CYG2B02)
  - *OS:* #1129 • *Cliente:* Guilherme Fabiano
  - *Status:* Em Diagnóstico
  - *Pátio:* 6 dias
  - *Valor:* R$ 905,00 (resta R$ 905,00)
  ```
* **Diretriz de Expurgo:**
  A ferramenta e o prompt devem ocultar ativamente a lista de *"Pendências de Baixa no ERP"* nas respostas de pátio comum da oficina.

### 1.3 Redesenho dos Detalhes da Ordem de Serviço
* **Local:** `src/hydra-sync/manager_store_access.ts` (`formatVehicleSituation`).
* **Visual Atual (Monótono):** 4 citações com barra lateral `| ` repetidas e marcadores `• `.
* **Novo Visual (Nativo e Limpo):**
  ```text
  *KICKS — TAR4I55*
  - *OS:* #1132 (MPJorgeBeretta)
  - *Status:* Necessita Suporte Especializado (Em Aberto)
  - *Permanência:* 1 dia no pátio
  - *Cliente:* Marcos Henrique Verissimo
  - *Total:* R$ 0,00 (Orçamento em análise)

  *Documentos e Vistorias*
  - *Checklist de Entrada:* Realizado em 06/10/2026 por Erik (Aprovado)
  - *Checklist Mecânico:* Pendente de preenchimento
  - *Nota Fiscal:* Não emitida
  ```

---

## 2. Tratamento de Payload Incompleto (`extracao_completa = false`)
Se uma OS for consultada e seu `raw_payload` estiver com `extracao_completa: false`:
* O bot **NUNCA** dirá que "não há checklist".
* O bot reportará:
  ```text
  - *Checklists:* Sincronização detalhada do ERP em andamento para esta OS.
  ```
