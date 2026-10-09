# Proposta de Arquitetura — OS Interativa Evolution API v2.3.7 (Resumo Executivo + Menu Nativo sendList + Drilldown Modular)

**ID da Spec:** `hydra-evo-interactive-os`  
**Data:** 08/10/2026  
**Status:** PROPOSTA CALIBRADA E REVISADA  
**Contexto:** Feedback direto da Diretoria definindo a experiência executiva da Ordem de Serviço (OS 360°) no WhatsApp. O bot opera com a **Evolution API v2.3.7** (`evo.tork.services`), que suporta nativamente mensagens de lista (`POST /message/sendList/{instance}`) e captura de resposta via webhook `listResponseMessage`. Em vez de disparar múltiplos balões sucessivos amontoados, o fluxo estabelecido é:
1. `sendText` → Resumo executivo da OS (cliente, veículo, operação, financeiro e módulos disponíveis).
2. `sendList` → Menu interativo nativo do WhatsApp com seções e linhas de acesso direto.
3. `sendText` → Detalhamento específico e focado acionado sob demanda ao clicar na lista ou digitar o comando.

---

## 1. Diretrizes de Design e Formatação Estrita

1. **Zero Emojis (Anti-Slop):**
   - Proibido o uso de emojis (`⚡`, `🌡️`, `🔩`, `🛑`, `📦`, `💡`, `🔵`, etc.).
   - Formatação sóbria, executiva e mobile-first, utilizando estritamente títulos em caixa alta/negrito, separadores de linha (`-`), bullets limpos e recuos de texto.
2. **Dados Reais sem Alucinação em Documentos e Vistorias:**
   - Renderizar estritamente o que constar no ERP físico:
     ```text
     DOCUMENTOS E VISTORIAS
     - Nota Fiscal: Não informada
     - Checklist de Entrada: Concluído
       └ Inspeção de Entrada: Finalizado (Roberto Aquino, 02/10/26)
     - Checklist do Mecânico: Não realizado
     - Anexos: 2 arquivos arquivados
     ```
   - Nunca presumir emissão de NF, realização de checklists ou ausência de arquivos a partir de campos nulos.
3. **Regra Contábil Clara para "Pago":**
   - `Pago = soma das parcelas efetivamente recebidas/liquidadas` (ou seja, `Total - Saldo Devedor`), e **não** a soma cega de todas as parcelas cadastradas.
   - Parcelas a vencer ou pendentes de liquidação são classificadas como "A Vencer / Pendente" e não compõem o valor pago. Se `saldoDevedor == totalAmount`, `Pago = R$ 0,00`.

---

## 2. Solução Arquitetural — Fluxo de 3 Etapas

```
[ Usuário ]  ── "detalhes da os 18503" ──►  [ Hydra Webhook / Dispatcher ]
                                                     │
             ◄── 1. sendText (Resumo Executivo) ─────┤
             ◄── 2. sendList (Menu Interativo)  ─────┘
                                                     │
[ Usuário ]  ── Clica em "1. Serviços"  ────────────►│ (listResponseMessage: rowId "os_18503_servicos")
                                                     │
             ◄── 3. sendText (Card Focado de Serviços)
```

### Etapa 1: Resumo Executivo Enxuto (`sendText`)
Enviado imediatamente via `sendText`, limpo, direto e sem emojis:
```text
*ORDEM DE SERVIÇO #18503*

*CLIENTE*
Nome: MAURO LUIZ RODRIGUES BUENO
Telefone: (11) 97444-3375

*VEÍCULO*
Modelo: VOYAGE LS
Placa: LZQ0669

*OPERAÇÃO*
Loja: MPplanalto
Status: ABERTO (Em Aberto)
Responsável: Rick / Marcos
Permanência: 6 dia(s) no pátio

*FINANCEIRO*
Total: R$ 6.731,10
Pago: R$ 4.008,00
Saldo: R$ 2.723,10

*MÓDULOS DISPONÍVEIS*
- Serviços: 7 itens (R$ 1.850,90)
- Peças e materiais: 14 itens (R$ 4.880,20)
- Pagamentos: 2 parcelas cadastradas
- Vistorias e documentos: 2 checklists · 2 anexos
- Histórico: Auditoria ERP e tratativas

Selecione uma opção no menu ou digite:
SERVICOS 18503
PECAS 18503
PAGAMENTOS 18503
DOCUMENTOS 18503
HISTORICO 18503
```

### Etapa 2: Menu Interativo Nativo (`sendList`)
Disparado via `POST /message/sendList/${INSTANCE}` na Evolution API v2.3.7.  
Contrato obrigatório validado (`number`, `title`, `description`, `buttonText`, `footerText`, `sections`):
```json
{
  "number": "5511999999999",
  "title": "OS #18503 — VOYAGE LS",
  "description": "Selecione o módulo para consultar em detalhe:",
  "buttonText": "Abrir detalhes",
  "footerText": "Mecânica Popular · Sistema Hydra",
  "sections": [
    {
      "title": "Módulos da OS #18503",
      "rows": [
        {
          "title": "1. Serviços",
          "description": "7 itens discriminados (R$ 1.850,90)",
          "rowId": "os_18503_servicos"
        },
        {
          "title": "2. Peças e materiais",
          "description": "14 itens e insumos (R$ 4.880,20)",
          "rowId": "os_18503_pecas"
        },
        {
          "title": "3. Pagamentos",
          "description": "2 parcelas e saldo restante",
          "rowId": "os_18503_pagamentos"
        },
        {
          "title": "4. Vistorias e Documentos",
          "description": "Checklists de entrada/mecânico e NF",
          "rowId": "os_18503_documentos"
        },
        {
          "title": "5. Histórico e Conversas",
          "description": "Auditoria do ERP, tratativas e WhatsApp",
          "rowId": "os_18503_historico"
        }
      ]
    }
  ]
}
```

### Etapa 3: Drilldown Focado sob Demanda (`sendText`)
Quando o operador clica em uma das opções ou digita o comando textual normalizado:
- O sistema valida rigorosamente o `osId` numérico e o módulo contra a whitelist permitida.
- Emite unicamente o balão focado solicitado:
  1. `os_{id}_servicos`: Serviços agrupados por sistema (Elétrica e Ignição, Arrefecimento, Suspensão e Rodagem, Freios, Revisão e Apoio) com subtotais, sem placeholders `(Preencher Executor...)` e sem códigos internos irrelevantes.
  2. `os_{id}_pecas`: Peças e insumos aplicados agrupados por sistema, com quantidades e valores.
  3. `os_{id}_pagamentos`: Parcelas discriminadas, modalidade (PIX, Cartão, Dinheiro), status real de liquidação (Recebido vs. A Vencer/Pendente), total pago e saldo devedor.
  4. `os_{id}_documentos`: Pareamento hierárquico estrito (inspeção subordinada à entrada, checklist mecânico, nota fiscal e anexos).
  5. `os_{id}_historico`: Auditoria factual do ERP (quem criou a OS, quem editou pela última vez, campo de anotações textual, anexos) e alinhamento de conversas de atendimento.

---

## 3. Segurança e Whitelist Estrita

1. **Validação de IDs e Módulos (Anti-Injection / Anti-Crash):**
   - Regex de comando: `/^os_(\d{1,8})_(servicos|pecas|pagamentos|documentos|historico)$/i`.
   - Whitelist estrita: `const ALLOWED_MODULES = new Set(['servicos', 'pecas', 'pagamentos', 'documentos', 'historico']);`.
   - Rejeição imediata de IDs malformados ou módulos desconhecidos.
2. **Trava de Instâncias Emissoras Permitidas (Regra Cardinal):**
   - Whitelist: `ALLOWED_SENDER_INSTANCES = new Set(['hydra', 'atendimento'])`.
   - Proibição absoluta de envio por instâncias de gerentes (`Maua`, `Jorge Beretta`, `Kennedy`, `Dom Pedro`, etc.).
3. **Revalidação de Usuário no Egress:**
   - Antes de qualquer envio de texto ou lista, o sistema verifica a autorização do telefone no SQLite.
