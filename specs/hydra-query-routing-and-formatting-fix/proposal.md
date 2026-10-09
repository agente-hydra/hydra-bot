# Proposta: Arquitetura 100% LLM-First com Botões Interativos Injetores de Prompt (hydra-query-routing-and-formatting-fix)

**Spec ID:** `hydra-query-routing-and-formatting-fix`  
**Data:** 09/10/2026  
**Status:** Planejamento (Aguardando `/vibe-apply`)  
**Ambiente:** VPS Linux (`operacional@100.126.50.101`) & Repositório Local  

---

## 1. Diretriz Mandatória do Usuário

> *"Não mano, tem que ser TUDO a IA que fazer mano, fds semântico ou krl que for, a IA vai buscar e responder essa porra."*  
> *"Deixa os botões interativos porque é interessante, mas pra injetar prompt como se fosse minha mensagem."*

### O que muda radicalmente:
1. **Fim dos Interceptores Determinísticos:**
   - Eliminação do bloco de 337 linhas de código legado em `agent_dispatcher.ts` que interceptava mensagens antes da IA e cuspia cards estáticos com `FALLBACK_API`.
   - **Toda e qualquer mensagem do usuário** ("OSs do jabaquara", "qual a situação do Linea", "e a OS #445?", "quanto temos no pátio", áudios, etc.) vai **DIRETO PARA A IA** (`AGY_PRIMARY` / AGY CLI com MCP `hydra-ops`).
2. **A IA é o Motor Único de Busca e Resposta:**
   - A IA recebe a pergunta do operador.
   - A IA consulta as ferramentas MCP conectadas ao banco SQLite em tempo real (`searchOS`, `getOSDetails`, `getPatioOverview`, `getStoreDrilldown`, `getChecklistAudit`, `get_os_case_history`, `getMetasConsolidadas`).
   - A IA formula a resposta conversacional executiva com raciocínio contextual no padrão Hermes.
3. **Botões Interativos como Injetores de Prompt Humano:**
   - Os botões interativos nativos da Evolution API (`sendList` / lista suspensa) são mantidos porque trazem excelente experiência móvel.
   - Ao clicar em uma opção de detalhe de OS (ex: `1. Serviços`, `2. Peças`, `3. Pagamentos`):
     - O sistema traduz o clique diretamente em uma **mensagem natural como se o usuário tivesse digitado**:
       - `os_445_servicos` ➔ `"Quais são os serviços discriminados da OS #445?"`
       - `os_445_pecas` ➔ `"Quais são as peças e materiais aplicados na OS #445?"`
       - `os_445_pagamentos` ➔ `"Quais as formas de pagamento e parcelas da OS #445?"`
       - `os_445_documentos` ➔ `"Mostre as vistorias, checklists e documentos da OS #445"`
       - `os_445_historico` ➔ `"Qual o histórico de atendimento e conversas da OS #445?"`
     - Esse prompt entra no fluxo da IA. A IA executa a ferramenta necessária (`getOSDetails` ou `get_os_case_history`) e responde com profundidade e linguagem natural.
4. **Fim Absoluto da URA de Texto:**
   - O corpo da mensagem NUNCA mais conterá textos de robô como `"Selecione uma opção no menu ou digite: SERVICOS 445..."`. Os botões existem apenas nativamente no WhatsApp via `interactiveList`.

---

## 2. Diagnóstico do Incidente Anterior

1. **Por que a IA parecia uma "porta burra":**
   - O dispatcher possuía uma busca SQL fuzzy por substring:
     `SELECT veiculo FROM ordens_servico WHERE UPPER(veiculo) LIKE '%OSs%' LIMIT 1`
   - A palavra `"OSs"` casou com `CROSSFOX` (`CR-OSS-FOX`).
   - O dispatcher assumiu que `"OSs"` era o modelo de um carro, forçou a resolução determinística e respondeu um card fixo estático da OS #445, sem jamais consultar a IA (`llmMs: 0`).
2. **Por que a formatação parecia "um lixo":**
   - O card vinha de concatenação manual de strings em TypeScript com cabeçalhos secos e uma lista de 5 comandos de URA no rodapé, destruindo a elegância executiva do assistente.

---

## 3. Critérios de Aceite

- [ ] Mensagens de listagem ("OSs do jabaquara", "carros no pátio") chegam diretamente ao LLM e são respondidas via ferramentas MCP (`searchOS`, `getPatioOverview`).
- [ ] Mensagens de veículos específicos ("como está o linea", "fale da OS 445") chegam diretamente ao LLM.
- [ ] Clique em qualquer botão da lista interativa injeta um prompt humano ("Quais são os serviços da OS #XXX?") que é processado e respondido pela IA com `getOSDetails`.
- [ ] Zero menus de texto de URA ("SERVICOS 445") no corpo das mensagens do WhatsApp.
- [ ] Botões interativos da Evolution API preservados para navegação rápida mobile.
