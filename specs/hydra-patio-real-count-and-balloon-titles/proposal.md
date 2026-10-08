# Proposta: Pátio Físico Operacional Real & Divisão Inteligente de Balões por Título

**Spec ID:** `hydra-patio-real-count-and-balloon-titles`  
**Data:** 07/10/2026  
**Status:** PROPOSTA / EM REVISÃO (SDD Hard Stop)  
**Autor:** Antigravity Pair-Programming com Davi / Hydra Ops  

---

## 1. O Problema Real Diagnosticado

Dois problemas críticos de experiência e precisão operacional foram identificados nas consultas do WhatsApp do Hydra:

### Problema 1: Contagem de Pátio Inflada (178 carros vs ~35 carros reais na oficina)
* **O que o bot reportou:** 178 veículos no pátio da rede (ex: Santo André com 23, Rudge com 30, Mauá com 21, Piraporinha com 20).
* **O que o ERP Oficina Inteligente mostra:** No contador oficial da home (`#ctl00_cph_lkbOSEmAberto`), a rede tem entre **35 e 40 veículos físicos em atendimento** (Santo André tem apenas 1, Jabaquara 3, Beretta 4, Piraporinha 3, Planalto 3, Rudge 6, Mauá 4, etc.).
* **Causa Raiz Técnica no SQLite (`hydra_ops.db`):**
  1. A consulta SQL `getPatioOverview` em `src/hydra-sync/db_repository.ts` faz contagem cega com `COUNT(CASE WHEN is_aberta = 1)`.
  2. No banco existem **62 ordens com status `AGUARDANDO RETIRADA`**, 100% quitadas (`valor_restante <= 0`), criadas em agosto e setembro (há mais de 30 dias), sem permanência de pátio (`dias_no_patio = 0`), cujos clientes já retiraram o veículo da oficina há semanas, mas a loja nunca clicou no botão "Finalizar" no ERP.
  3. Em Santo André, das 23 ordens no banco, 22 são dessa pendência antiga de agosto/setembro; apenas 1 veículo é real no pátio (BMW 320i, OS #2470).
  4. Tratar "falha de baixa administrativa no ERP" como "veículo físico ocupando vaga de oficina" distorce completamente o diagnóstico de capacidade e gargalo das lojas.

### Problema 2: Divisão de Balões Fragmentada e Títulos Órfãos no WhatsApp
* **O que aconteceu:** Ao gerar mensagens longas com múltiplos tópicos (ex: Diagnóstico de Gargalos 1, 2 e 3):
  1. O título `> 2. Gargalo de Exposição Financeira (Saldo em Aberto sem Sinal/Entrada)` foi anexado como última linha do Balão 1.
  2. O conteúdo e os veículos correspondentes (`- Santo André: OS #2470...`) foram enviados no Balão 2.
  3. O bloco de introdução/diagnóstico geral apareceu descontextualizado ou encavalado entre seções.
* **Causa Raiz Técnica no Chunker (`format_utils.ts`):**
  1. A função `splitIntoWhatsAppBlocks` divide o texto por parágrafos genéricos (`\n\s*\n`) e agrupa até 900 caracteres.
  2. Ela não tem consciência de **limites de títulos de seção** (linhas que iniciam com `> `, `> *`, `*1.*`, `> 1.`).
  3. Se o título couber no acumulador do balão atual, ele é colocado ali, mesmo que seus itens e dados excedam o limite de 900 caracteres, deixando o cabeçalho "órfão" no rodapé de um balão e o texto no balão seguinte.
  4. O corte não aproveita os títulos de destaque como pontos naturais e elegantes de quebra de mensagem para leitura executiva no smartphone.

---

## 2. A Solução Proposta

### Pilar A: Pátio Físico Operacional Real (Filtro por Status de Oficina Ativa)
1. **Definição de Pátio Operacional Físico (`veiculos_patio_fisico`):**
   * Uma OS representa um veículo fisicamente na oficina se estiver em status de atendimento ativo:
     * `VEICULO EM EXECUÇÃO`, `EM DIAGNOSTICO`, `EM TESTE`, `AGUARDANDO PEÇA`, `SERVIÇO TERCEIRIZADO`, `NA FILA PARA EXECUÇÃO`, `AGUARDANDO DIAGNOSTICO AVANÇADO`, `NECESSITA SUPORTE ESPECIALIZADO`, `ABERTO` recente (do mês corrente ou com dias no pátio ativo).
   * **Regra Anti-Fantasma para `AGUARDANDO RETIRADA`:**
     * Uma ordem em `AGUARDANDO RETIRADA` só conta como presença física no pátio se atender a pelo menos um critério de legitimidade:
       a) Possuir saldo pendente relevante (`valor_restante > 0`); E
       b) For recente (entrada ou conclusão nos últimos 5 dias).
     * Ordens com saldo zerado (`valor_restante <= 0`) criadas há mais de 5 dias ou do mês anterior são categorizadas como **Pendência Administrativa de Baixa**, NUNCA como carro físico no pátio.
2. **Separação Transparente nos Contratos do Banco e MCP:**
   * A função `getPatioOverview` e a tool MCP passam a retornar:
     * `veiculos_patio_fisico` (ex: ~35 a 40 na rede — métrica primária de ocupação).
     * `pendencias_baixa_erp` (ex: ~140 ordens administrativas esquecidas abertas no sistema).
     * `total_valor_patio` e `saldo_a_receber_patio` calculados sobre os veículos físicos ativos.
3. **Instrução Direta para o Modelo:**
   * O prompt da IA é calibrado para sempre relatar o pátio físico de atendimento primário ("Temos 35 veículos em atendimento nas oficinas") e, se relevante, mencionar ordens pendentes de baixa como auditoria administrativa secundária.

### Pilar B: Divisão Inteligente de Balões por Título (Title-Aware Chunking)
1. **Regra Anti-Orphan-Title no `splitIntoWhatsAppBlocks`:**
   * Um parágrafo identificado como título de seção (`> Título`, `> *Título*`, `> 1. Título`, `*Título:*`, `1. Título`) NUNCA pode ser o último parágrafo de um balão sem pelo menos o primeiro bloco de itens ou conteúdo subordinado.
   * Se o conteúdo que segue o título não couber no balão atual, a quebra de balão DEVE ocorrer **imediatamente antes do título**, abrindo o novo balão com o título no topo.
2. **Quebra Natural por Seção Temática (Natural Section Split):**
   * Quando uma mensagem tiver múltiplos tópicos estruturados encabeçados por títulos de destaque:
     * Se o balão atual já possui conteúdo substantivo (ex: >= 250 a 350 caracteres) e o próximo bloco é um novo título de seção principal (ex: `> Diagnóstico...`, `> 2. Gargalo...`, `> 3. Gargalo...`), **forçar a quebra no título**.
     * Cada balão no WhatsApp passa a conter 1 grande tema/gargalo coerente com título no topo, itens no centro e conclusão/próximo passo na base.
3. **Prompt Hint com `---BLOCK---` Automático:**
   * Atualizar diretrizes no `system_prompt.md` instruindo a IA a separar blocos analíticos complexos por `---BLOCK---` sempre que apresentar diagnósticos multiponto, reforçando a divisão determinística do chunker.

---

## 3. Contratos de Dados e Exemplo Prático

### Consulta de Pátio da Rede (Antes vs. Depois)

| Métrica | Antes (Bug / Bruto) | Depois (Corrigido / Físico Real) |
| :--- | :---: | :---: |
| **Total de Veículos no Pátio (Rede)** | 178 veículos | **~35 a 40 veículos** |
| **Santo André** | 23 veículos | **1 veículo** (BMW 320i) |
| **Jabaquara** | 15 veículos | **3 veículos** |
| **Jorge Beretta** | 12 veículos | **4 veículos** |
| **Piraporinha** | 20 veículos | **3 veículos** |
| **Rudge Ramos** | 30 veículos | **6 veículos** |
| **Rei do Módulo** | 18 veículos | **4 veículos** |
| **Rei do Óleo Mauá** | 21 veículos | **4 veículos** |
| **Auditoria Administrativa (ERP)** | Oculto / Misturado | **140 OSs quitadas pendentes de baixa no ERP** |

### Exemplo de Divisão de Balões no WhatsApp

#### Balão 1 (Introdução e Gargalo 1):
```text
> Diagnóstico de Gargalos Operacionais e Financeiros por Loja
- Posição: 07/10/2026 às 12:13
Cruzando ocupação real de pátio, tempo de retenção e exposição financeira:

> 1. Gargalo de Volume de Pátio e Retenção Operacional
- Rudge Ramos: 6 veículos em atendimento físico (R$ 45.282 em serviço). Possui veículos retidos há 6 dias (Focus LLX5E81) e há 5 dias (Tucson GDZ7I78).
- Dom Pedro I: Peugeot 408 (FRI8G91, OS #578) retido há 29 dias.
- Rei do Óleo Mauá: Fox EBX8211 e Sonic FQK6B71 aguardando liberação.
```

#### Balão 2 (Gargalo 2 com Título no Topo):
```text
> 2. Gargalo de Exposição Financeira (Saldo em Aberto sem Sinal/Entrada)
- Santo André: OS #2470 (BMW 320I GGR0E01) com R$ 7.000,00 em aberto e R$ 0,00 recebido/sinal registrado. A loja acumula R$ 7.339 a receber.
- Rei do Módulo: R$ 14.150,90 de saldo restante a receber no pátio, com destaque para Fusca Novo (R$ 4.000 zerada de pagamento) e Up ELR9G20 (R$ 3.750).
- Jabaquara: OS #465 (Ka SE BXD6F52) com R$ 2.600 em aberto sem entrada.
```

#### Balão 3 (Gargalo 3 e Ação):
```text
> 3. Gargalo de Processo e Compliance (Checklists Pendentes)
- Da rede como um todo, 112 OSs estão sem checklist de entrada e 169 sem checklist mecânico.
- Rudge Ramos e Rei do Módulo são as mais críticas em conformidade.

Quer que eu aprofunde em alguma unidade específica ou liste os detalhes de alguma dessas OSs retidas?
```

---

## 4. Risco Principal e Mitigação

* **Risco:** O financeiro ou gestor querer saber o saldo total de ordens abertas no ERP para conciliação contábil e achar que ordens foram apagadas.
* **Mitigação:** Nenhuma ordem é deletada do banco de dados. Os dados continuam 100% íntegros. Apenas separamos conceitualmente o que é **Pátio Físico Operacional** (ocupação de mecânicos e vagas de oficina) de **Ordens em Aberto no ERP** (faturamento/baixa contábil pendente).
