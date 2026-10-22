# Proposta: Expurgo de Botões Interativos e Restauração da Formatação Executiva Hermes

**Spec ID:** `revert-buttons-restore-hermes-format`  
**Data:** 09/10/2026  
**Status:** Proposta  

---

## 1. Problema e Diagnóstico

Nas últimas iterações, foram introduzidos botões interativos (`sendList` da Evolution API) e resumos parciais ("Módulos Disponíveis") para ordens de serviço. Isso gerou três problemas críticos no WhatsApp:

1. **Quebra Técnica de Mensagens Interativas na API:**  
   A versão da Evolution API em produção (v2.3.7) possui um bug upstream documentado no `Baileys/protobufjs` (`TypeError: this.isZero is not a function`), fazendo com que o envio nativo de listas falhe com `HTTP 400 Bad Request`.
2. **Poluição Visual de "URA Burra":**  
   O resumo da OS passou a omitir os dados detalhados da ordem e a cuspir um bloco estático de menu ("MÓDULOS DISPONÍVEIS ... Selecione uma opção no menu ou digite: SERVICOS 445, PECAS 445..."). Isso transformou um agente inteligente executivo em uma URA de comandos textuais fragmentados e deselegantes.
3. **Desconfiguração de Consultas de Loja ("OSs do jabaquara"):**  
   Quando o operador pergunta "OSs do jabaquara", ele espera uma visão rápida, executiva e clara das ordens em andamento daquela loja. Em vez disso, o sistema ou cascateava diagnósticos verbosos não solicitados ou confundia a palavra "OSs" com um veículo individual (ex: Crossfox), exibindo dados fora de contexto e mal formatados.

---

## 2. Solução Proposta

### 2.1. Expurgo Completo de Botões e Listas Interativas
- Remover todo o payload `interactiveList`, chamadas a `sendList` e `sendWhatsAppList` no `webhook-listener.js` e no `agent_dispatcher.ts`.
- Zero menus interativos, zero listas nativas no WhatsApp e zero textos de URA ("Selecione uma opção no menu...").

### 2.2. Restauração da Listagem Executiva de OSs por Loja (Hierarquia com "Joelho" `└` e Espaçamento)
Para perguntas como `"OSs do jabaquara"`, `"ordens de jabaquara"`, `"quais as OSs abertas do jabaquara"` ou `"carros no pátio de jabaquara"`, o sistema deve retornar **uma listagem hierárquica bem definida, sem dados aglomerados em linha única ou estilo tabela**, utilizando a estrutura visual de ramos ("joelho" `└`) e quebras de linha entre cada OS:

```text
> *Ordens de Serviço Abertas: Jabaquara*
- *Veículos no pátio:* 2 veículos
- *Saldo a receber:* R$ 2.738,90

*OS #465 — FORD KA SE (BXD6F52)*
  └ Status: *Na Fila para Execução* · *4 dias* no pátio
  └ Financeiro: Total *R$ 2.600,00* · Saldo: *R$ 2.600,00*
  └ Responsável: Vanessa · Cliente: Francisco Carlos Alves

*OS #445 — CROSSFOX (DTT2E56)*
  └ Status: *Em Teste* · *0 dias* no pátio
  └ Financeiro: Total *R$ 138,90* · Saldo: *Quitado*
  └ Responsável: Vanessa · Cliente: Mauro Cogo
```

### 2.3. Restauração do Card Completo Hermes 360 para OSs e Veículos
Quando o operador perguntar sobre um veículo ou ordem de serviço específica (ex: `"como tá o Ka?"`, `"detalhes da OS 465"`, `"placa BXD6F52"`), o robô deve entregar diretamente o **Card Hermes 360 Completo** via balões nativos (`---BLOCK---`), sem precisar de botões:
- **Balão 1:** Cabeçalho Executivo + Atendimento (Loja, Veículo, Placa, Cliente, Responsável, Status, Pátio, Total e Saldo).
- **Balão 2:** Serviços Discriminados (Itens, mecânico executor e valores).
- **Balão 3:** Peças e Materiais Aplicados (Itens aplicados, componentes e conciliação).
- **Balão 4:** Pagamentos e Vistorias (Parcelas cadastradas, checklists pareados, notas fiscais e anexos).

---

## 3. Contratos de Dados Afetados

1. **`DispatcherOutput` (`agent_dispatcher.ts`):**
   - Remover a propriedade `interactiveList?: EvoListPayload`.
   - Manter apenas `messages`, `replyText`, `toolsCalled`, `motor`, `latenciaMs`, `telemetry`.
2. **`webhook-listener.js`:**
   - Remover a chamada condicional `sendWhatsAppList` após o despacho dos balões.
3. **`os_situation_composer.ts`:**
   - Desativar `composeExecutiveOSSummary` (resumo fragmentado de URA).
   - Reativar `composeFullOS360Card` como gerador padrão do detalhamento da OS.

---

## 4. Riscos e Mitigações

- **Risco:** Quebra de testes legados que dependiam do contrato `EvoListPayload`.
  - **Mitigação:** Atualizar e sanear a suíte de testes automatizados para validar a integridade dos balões Hermes e a listagem de OSs.
- **Risco:** Volume de texto no WhatsApp.
  - **Mitigação:** Manter o particionamento inteligente com `splitIntoWhatsAppBlocks` e `---BLOCK---`, garantindo que cada balão seja leve e sem truncamento mobile ("... Ler mais").

---

## 5. Hard Stop
Após aprovação desta proposta, o plano será executado via `/vibe-apply revert-buttons-restore-hermes-format`.
