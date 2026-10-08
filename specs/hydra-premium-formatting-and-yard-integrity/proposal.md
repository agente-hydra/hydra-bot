# Proposta: Restauração da Formatação Premium Hermes-Style, Integridade de Contagem de OSs e Fim da Destruição de Balões

**Spec ID:** `hydra-premium-formatting-and-yard-integrity`  
**Data:** 07/10/2026  
**Status:** PROPOSTA / EM REVISÃO (SDD Hard Stop)  
**Autor:** Antigravity Pair-Programming com Davi / Hydra Ops  

---

## 1. O Problema Diagnosticado nos Logs Reais e no Screenshot

A análise forense cruzando os logs do PM2 (`hydra-bot-out.log`), as mensagens salvas em `conversation_messages` (IDs 2427 e 2429) e o screenshot do WhatsApp revelou **3 causas raízes críticas**:

### A. O `webhook-listener.js` Destruiu os Balões Prontos
* **O que aconteceu:**
  1. O `agent_dispatcher.ts` gerou a resposta e chamou `splitIntoWhatsAppBlocks`, que produziu **4 balões limpos e perfeitos**, respeitando os delimitadores `---BLOCK---`.
  2. O `agent_dispatcher_cli.ts` retornou `{ messages: [b1, b2, b3, b4] }`.
  3. No entanto, no arquivo `/home/operacional/hydra/webhook-listener.js` (linhas 1032-1040):
     ```javascript
     const rawText = (Array.isArray(parsed.messages) && parsed.messages.length > 0)
       ? parsed.messages.join("\n\n")
       : (parsed.replyText || "");
     if (rawText) {
       const composed = composeSemanticBalloons(rawText);
       return resolve(composed);
     }
     ```
  4. O listener **juntou os 4 balões de volta em um único texto** (`join("\n\n")`) e chamou `composeSemanticBalloons(rawText)`.
  5. A função `composeSemanticBalloons` (feita para fallback tabular simples com teto fixo de 3 balões):
     - Substituiu os delimitadores `---BLOCK---` por bullets de texto comum (`- --BLOCK---`).
     - Converteu os títulos em bullets com asterisco quebrado (`• 2. Risco Financeiro...*`).
     - Enforçou o limite de 3 balões, **cortando a seção 3 no meio** (4 lojas no Balão 2 e 3 lojas no Balão 3) e empurrando a seção 4 para o rodapé.

### B. A IA Alucinou um "Gargalo Administrativo: Pendências de Baixa no ERP"
* **O que aconteceu:**
  1. Ao expor o campo `pendencias_baixa_erp` na ferramenta MCP e no prompt, a IA assumiu que uma pendência de baixa contábil no sistema é um "gargalo operacional da oficina".
  2. A IA gerou uma seção inteira (*3. Gargalo Administrativo: Pendências de Baixa no ERP*) dizendo que Santo André tem "22 OSs pendentes de baixa (apenas 1 carro físico)".
  3. Isso poluiu a resposta com ruído de TI/auditoria interna em vez de entregar dados de operação de oficina (veículos travados, exposição financeira e checklists).

### C. A Ferramenta `get_checklist_audit` Continuava Auditando as 179 Ordens Brutas
* **O que aconteceu:**
  1. Enquanto `getPatioOverview` e `getStoreDrilldown` foram filtradas, a função `getChecklistAudit` (linha 1715 de `db_repository.ts`) continuava fazendo:
     ```sql
     SELECT os_id, loja_slug, veiculo, placa, dias_no_patio, raw_payload
     FROM ordens_servico
     WHERE is_aberta = 1 AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE'
     ```
  2. Como as ~140 ordens fantasmas de agosto/setembro têm `is_aberta = 1`, elas entravam no cálculo de checklists!
  3. Resultado: A IA afirmou que *"Checklist do Mecânico: 169 de 179 OSs em sistema estão sem preenchimento (gargalo crítico em Santo André com 23 e Rudge Ramos com 29)"*.
  4. Santo André possui **apenas 1 carro real no pátio físico**, mas a auditoria acusou 23 OSs sem checklist porque verificou ordens de carros que saíram da oficina há mais de um mês.

---

## 2. A Solução Proposta

### Pilar 1: Despacho Direto de Balões no Webhook Listener (Fim do Re-Packing Destrutivo)
1. No `webhook-listener.js`:
   * Se `parsed.messages` for um array não-vazio, o listener deve despachar **diretamente `parsed.messages`**, sem fazer `join("\n\n")` e sem passar por `composeSemanticBalloons`.
   * A chamada a `composeSemanticBalloons` fica restrita estritamente a fluxos determinísticos legados de fallback financeiro tabular que não usam o dispatcher LLM.
2. Garantir preservação estrita da formatação:
   * Títulos com blockquote nativo: `> *1. Gargalo de Retenção de Pátio (Aging > 5 dias)*`
   * Bullets nativos: `- *Loja:* Dados com valores em *R$ 0,00*`
   * Eliminar o marcador `• ` desformatado.

### Pilar 2: Blindagem de Pátio na Auditoria de Checklists (`getChecklistAudit`)
1. Refatorar a query de `getChecklistAudit` em `db_repository.ts` para auditar **exclusivamente os veículos fisicamente presentes no pátio**:
   ```sql
   WHERE is_aberta = 1 AND (
     COALESCE(dias_no_patio, 0) > 0
     OR (
       (data_inicio LIKE '%/10/26%' OR data_inicio LIKE '%/10/2026%')
       AND UPPER(TRIM(COALESCE(status_grid, ''))) NOT IN ('AGUARDANDO RETIRADA', 'ENCERRADA', 'FINALIZADA')
       AND UPPER(TRIM(COALESCE(estado_operacional, ''))) != 'TRANSICAO_PENDENTE'
     )
   )
   ```
2. Com isso:
   * A rede audita os ~32 veículos físicos reais.
   * Santo André audita no máximo 1 veículo (e não 23).
   * Rudge Ramos audita 6 veículos (e não 30).

### Pilar 3: Expurgo de "Pendências de Baixa" das Respostas Operacionais
1. Remover o campo `pendencias_baixa_erp` do retorno público das ferramentas de pátio e drilldown ou marcá-lo como auditoria estrita de sistema.
2. Adicionar diretriz rígida no prompt:
   * *"NUNCA relate 'pendências de baixa no ERP' ou 'divergência de sistema' como um gargalo operacional da oficina. Os gestores querem ver veículos retidos, faturamento/exposição de caixa e vistorias de atendimento."*
3. Restabelecer a estrutura clássica premium:
   * **Balão 1:** Diagnóstico Executivo de Gargalos (Posição e síntese)
   * **Balão 2:** `> *1. Gargalo de Retenção de Pátio (Aging > 5 dias)*` (veículos travados)
   * **Balão 3:** `> *2. Gargalo de Exposição Financeira (Saldo sem Sinal)*` (risco de caixa)
   * **Balão 4:** `> *3. Gargalo de Processo e Compliance (Checklists)*` (vistorias dos carros do pátio) + Fechamento

---

## 3. Contratos de Dados e Exemplo Visual Esperado

### Balão 1 (Abertura Executiva):
```text
> *Diagnóstico de Gargalos Operacionais e Financeiros por Loja*
*Posição:* 07/10/2026 às 12:48

Cruzando ocupação real de pátio, tempo de retenção e exposição financeira, identificamos os seguintes gargalos críticos hoje:
```

### Balão 2 (Gargalo 1 - Retenção de Pátio):
```text
> *1. Gargalo de Retenção de Pátio (Aging > 5 dias)*
- *Rudge Ramos:* Focus (LLX5E81) há 6 dias (R$ 12.206) e Tucson (GDZ7I78) há 5 dias (R$ 2.100).
- *Rei do Óleo Mauá:* Fox (EBX8211) e Sonic (FQK6B71) retidos há 6 dias (R$ 24.254 em serviços).
- *Kennedy:* BMW 218i (RKS1A10) parada há 6 dias (R$ 2.829).
- *Jorge Beretta:* Corsa Wind (CYG2B02) parado há 6 dias (R$ 905).
- *Planalto:* Voyage LS (LZQ0669) retido há 5 dias (R$ 6.731).
- *Jabaquara:* C3 (FHK2C07) retido há 5 dias (R$ 4.300).
- *Dom Pedro I:* Peugeot 408 (FRI8G91) travado há 29 dias (sem saldo em aberto).
```

### Balão 3 (Gargalo 2 - Exposição Financeira):
```text
> *2. Gargalo de Exposição Financeira (Saldo em Aberto sem Sinal)*
- *Santo André:* OS #2470 (BMW 320i - Daniel Antoneli) com *R$ 7.000,00* em aberto e R$ 0,00 pago.
- *Rei do Módulo:* OS #1856 (Fusca Novo - Lutum Motors) com *R$ 4.000,00* e OS #1918 (UP - Laura Ramos) com *R$ 3.750,00*, ambas sem entrada registrada.
- *Jabaquara:* OS #465 (Ka SE - Francisco Alves) com *R$ 2.600,00* sem sinal registrado.
```

### Balão 4 (Gargalo 3 - Compliance de Checklists):
```text
> *3. Gargalo de Processo e Conformidade (Checklists Pendentes)*
- Dos 32 veículos em atendimento físico no pátio da rede:
- *Checklist do Mecânico:* 28 veículos sem preenchimento registrado (gargalos em Rudge Ramos com 6 e Rei do Óleo Mauá com 4).
- *Checklist de Entrada:* Rudge Ramos e Rei do Módulo operam com 100% dos veículos em atendimento sem a vistoria inicial gravada.

Quer que eu aprofunde em alguma unidade específica ou detalhe alguma dessas ordens?
```

---

## 4. Riscos e Mitigação
* **Risco:** Re-introdução de cortes acidentais em outras consultas.
* **Mitigação:** Como `parsed.messages` já vem testado e validado de `splitIntoWhatsAppBlocks`, remover a recombinação destrutiva no listener garante fidelidade 1:1 entre o output da IA e as mensagens recebidas no WhatsApp.
