# Proposta: Resolução da OS #1132 (Checklist de Entrada), Eliminação de "Amebas" com Pipes e Formatação Elegante de Cards no WhatsApp

**Spec ID:** `hydra-os-checklist-and-clean-cards`  
**Data:** 07/10/2026  
**Status:** PROPOSTA / EM REVISÃO (SDD Hard Stop)  
**Autor:** Antigravity Pair-Programming com Davi / Hydra Ops  

---

## 1. Evidências Forenses do Diagnóstico Real

Inspecionamos o banco de dados operacional em produção (`hydra_ops.db`), os logs de interação (`agent_interaction_logs`) e o código do crawler e do formatador:

### Evidência A: OS #1132 (Kicks `TAR4I55` em `MPJorgeBeretta`) — Causa Raiz do Checklist Não Encontrado
1. **Consulta direta no SQLite `ordens_servico` para a OS #1132:**
   ```json
   {
     "id": "1132",
     "tipo": "OS",
     "data_inicio": "06/10/26 09:56",
     "veiculo": "KICKS",
     "placa": "TAR4I55",
     "cliente_nome": "MARCOS HENRIQUE VERISSI...",
     "status_grid": "NECESSITA SUPORTE ESPECIALIZADO",
     "extracao_completa": false,
     "erro": "locator.click: Timeout 15000ms exceeded.\nCall log:\n  - waiting for locator('#ctl00_cph_btnBuscar')\n"
   }
   ```
2. **Causa real identificada:**
   * Enquanto todas as outras OSs da loja (1129, 1130, 1131) tiveram `extracao_completa: true` e capturaram serviços e checklists, a **OS #1132 sofreu um timeout de 15 segundos** ao clicar no botão `#ctl00_cph_btnBuscar` durante o crawl diário de hoje às 13:04.
   * Não existe no sistema um mecanismo de **retry para OSs com `extracao_completa: false`**.
   * Quando o operador perguntou pelo WhatsApp *"fala da os 1132"* e *"mas tem o checklist de inspecao?"*, o bot leu o `raw_payload` incompleto e assumiu cegamente que a OS não possuía nenhum checklist cadastrado (*"Checklists: Nenhum checklist registrado para esta OS"*).

### Evidência B: Formatação "Ameba Indecifrável" com Pipes `|` (Captura `143508.png`)
1. Ao perguntar *"quais os tem na jorge berreta"*, a IA gerou linhas densas agrupando múltiplos atributos com barras verticais:
   ```text
   • Corsa Wind (CYG2B02) | OS #1129 | Guilherme Fabiano
   Status: Em Diagnóstico | Pátio: 6 dias | Valor: R$ 905,00 (resta R$ 905,00)
   ```
   No WhatsApp em tela de celular, isso quebra em linhas assimétricas ilegíveis.
2. Além disso, a IA listou 8 ordens antigas sob *"Pendências de Baixa no ERP (8 ordens já pagas e liberadas)"*, poluindo o chat com dados que não pertencem ao pátio físico operacional.

### Evidência C: Visual Monótono e Rígido de OS (Captura `143543.png`)
1. O resolvedor determinístico de veículo gerou quatro blocos consecutivos com barra lateral de citação (`| `) e bullets (`• `):
   ```text
   | Situação Operacional: KICKS (TAR4I55)
   • OS: #1132 (MPJorgeBeretta)
   • Status: ...
   | Serviços Discriminados:
   • Nenhum serviço...
   | Formas de Pagamento:
   • Total da OS...
   | Documentos e Checklists:
   • Checklists: Nenhum checklist...
   ```
2. Essa estrutura gera poluição visual, monotonia e sensação mecânica/feia.

---

## 2. Escopo da Solução

### 1. Resolução Imediata e Robusta da OS #1132 e Checklists
* **Re-extração sob demanda / Retry:** Script dedicado para forçar a re-extração imediata da OS #1132 na unidade `MPJorgeBeretta`, populando o `raw_payload` com a vistoria de entrada e checklists reais.
* **Resiliência do Crawler:** Corrigir a navegação em `os_deep_inspector.ts` evitando postback colidido em `btnLimpar` e garantindo espera adequada do formulário antes de clicar em `#ctl00_cph_btnBuscar`.
* **Transparência Operacional:** Se uma OS tiver `extracao_completa: false`, o bot deve indicar explicitamente que os detalhes estão em processo de sincronização com o ERP, em vez de afirmar falsamente que a OS não possui checklist.

### 2. Formatação Limpa de Listagem de Pátio e OSs (Fim dos Pipes)
* Substituição imediata dos separadores inline ` | ` por cartões verticais legíveis:
  ```text
  *Corsa Wind* (CYG2B02)
  - *OS:* #1129 (Guilherme Fabiano)
  - *Status:* Em Diagnóstico
  - *Pátio:* 6 dias
  - *Valor:* R$ 905,00 (resta R$ 905,00)
  ```
* **Expurgo Total de "Pendências de Baixa no ERP"** nas consultas de pátio comum. O operador de loja só verá os veículos fisicamente presentes no pátio ativo.

### 3. Redesenho dos Cards de Detalhes da OS (Anti-Monotonia)
* Eliminação das barras repetitivas (`| `) em cada subtítulo.
* Cabeçalho forte com dados essenciais do veículo e cliente.
* Blocos limpos com espaçamento de 1 linha:
  - *Veículo e Status*
  - *Serviços e Peças* (quando houver)
  - *Financeiro e Pagamentos*
  - *Checklists e Documentos* (destacando Vistoria de Entrada e Checklist do Mecânico)

---

## 3. Critérios de Aceite
1. OS #1132 re-extraída com sucesso no banco de produção contendo o checklist de inspeção de ontem (06/10).
2. Pergunta *"fala da os 1132"* ou *"mas tem o checklist de inspecao?"* responde confirmando o checklist registrado com executor, data e status.
3. Listagem de ordens de qualquer unidade (ex: *"quais os tem na jorge beretta"*) é exibida em formato de card vertical limpo, sem nenhum caractere pipe `|` e sem listar pendências contábeis de ERP.
4. Consulta detalhada da OS formatada com design premium Hermes-style, sem repetição de blockquotes cinzas e sem layout monótono.
