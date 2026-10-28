# Design Técnico: Roteiro Comercial, Qualificação e Funil — Backstudio (David)

## 1. Fluxo de Decisão do Turno & Máquina de Estados

```mermaid
stateDiagram-v2
    [*] --> LeadFrio: Lead captado + demo gerada
    LeadFrio --> Qualificando: Lead responde à abertura
    note right of Qualificando: SPIN: Situação e Problema\nSalva nome e canais atuais
    
    Qualificando --> Proposta: Contexto mínimo + Demo enviada
    note right of Proposta: Apresenta demo_url\nBriefing enxuto de serviços e logo
    
    Proposta --> Proposta: Lead pergunta preço
    note right of Proposta: Ancoragem R$ 2.500-5.000\nOferta R$ 149/mês vs R$ 998 em 10x
    
    Proposta --> Pagamento: Aceite explícito do plano
    note right of Pagamento: Coleta CPF/CNPJ e e-mail\nChama Gerar_Cobranca_Asaas
    
    Pagamento --> Cliente: Webhook Asaas confirma pagamento
    note right of Cliente: Libera configuração de domínio\nDispara pós-venda
    
    LeadFrio --> Transbordo: Intervenção humana
    Qualificando --> Transbordo: Intervenção humana
    Proposta --> Transbordo: Intervenção humana
    Pagamento --> Transbordo: Intervenção humana
    note right of Transbordo: Label ctrl_humano ativa\nBot silencia imediatamente
```

---

## 2. Contratos de Dados TypeScript

### 2.1. Ficha Completa do Lead (`crm_leads.custom_fields`)
```typescript
export interface BackstudioLeadMetadata {
  // 1. Dados Iniciais de Preparação
  nicho: string;
  cidade: string;
  estado: string;
  endereco?: string;
  avaliacao_google?: number;
  total_avaliacoes?: number;
  origem_captacao: "google_maps" | "inbound" | "indicacao" | "outbound";
  demo_slug?: string;
  demo_url?: string;
  demo_repo?: string;
  demo_enviada: boolean;

  // 2. Qualificação Conversacional (SPIN)
  nome_responsavel?: string;
  decisor?: boolean;
  canais_atuais?: Array<"whatsapp" | "instagram" | "indicacao" | "google" | "nenhum">;
  servico_principal?: string;
  servicos_adicionais?: string[];
  possui_site?: boolean;
  tem_identidade_visual?: boolean;
  dominio_preferido?: string;
  feedback_demo?: string;

  // 3. Proposta & Briefing
  plano_escolhido?: "mensal" | "anual";
  secoes_extras_qtd?: number;
  taxa_adicional_cents?: number;

  // 4. Dados Fiscais e Cobrança
  nome_contratante?: string;
  cpf_cnpj?: string;
  email?: string;
  asaas_payment_id?: string;
  asaas_invoice_url?: string;
  asaas_status?: "PENDING" | "RECEIVED" | "CONFIRMED" | "OVERDUE";

  // 5. Cadência e Controle
  proximo_contato?: string;
  opt_out?: boolean;
}
```

### 2.2. Contrato da Ferramenta `Gerar_Cobranca_Asaas`
```typescript
export interface GerarCobrancaAsaasInput {
  /** Nome completo da pessoa física ou Razão Social */
  nome: string;
  /** Telefone com DDD (formato E.164 ou nacional) */
  telefone: string;
  /** E-mail válido para envio da fatura */
  email: string;
  /** CPF (11 dígitos) ou CNPJ (14 dígitos) limpo ou formatado */
  cpf_cnpj: string;
  /** Plano contratado: mensal (R$ 149) ou anual (R$ 998 em até 10x) */
  plano: "mensal" | "anual";
  /** Quantidade de seções/páginas extras contratadas a R$ 50 cada (opcional) */
  secoes_extras?: number;
}

export interface GerarCobrancaAsaasOutput {
  success: boolean;
  invoice_url?: string;
  payment_id?: string;
  due_date?: string;
  value_cents?: number;
  error?: string;
}
```

### 2.3. Mapeamento de Funil e Labels do CRM
```typescript
export const BACKSTUDIO_PIPELINE_ID = "400441ad-7611-47f0-93e7-c7f581bfb468";

export const BACKSTUDIO_STAGES = {
  LEAD_FRIO: "cc5688d0-d09b-49c8-bfd2-75569fecedc0",
  JA_RESPONDI: "d48d8884-de66-4c15-a7e1-428a20e2cfb4",
  ENTENDENDO_O_QUE_PROCURA: "ab6e6bb1-7f3d-4eb0-a290-93158b724951",
  SEI_O_QUE_OFERECER: "d02ed5cb-dfdc-41b4-af82-fc90589c7da3",
  ORCAMENTO_E_FECHAMENTO: "90fa4816-ac2c-451f-832b-ebd401209762",
  FECHOU_NEGOCIO: "bae8e583-7cbc-4c6e-86bd-b624b4354087",
  DESISTIU: "467e0d7c-0161-4c37-a8b0-fbd134568abe",
} as const;

export const BACKSTUDIO_LABELS = {
  FUNIL_LEAD_FRIO: "funil_lead_frio",
  FUNIL_QUALIFICANDO: "funil_qualificando",
  FUNIL_PROPOSTA: "funil_proposta",
  FUNIL_PAGAMENTO: "funil_pagamento",
  FUNIL_CLIENTE: "funil_cliente",
  CTX_DEMO_PRONTO: "ctx_site_demo_pronto",
  ORIGEM_MAPS: "origem_maps",
  TIPO_PROSPECCAO: "tipo_prospeccao",
  PGTO_PENDENTE: "pgto_pendente",
  PGTO_PAGO: "pgto_pago",
  CTRL_HUMANO: "ctrl_humano",
} as const;
```

---

## 3. Especificação do System Prompt da Versão 7

O system prompt da Versão 7 incorpora a íntegra da calibração do Argon:
- **Identidade:** David, consultor comercial da Backstudio.
- **Divisão em Balões:** `|` separando 2 a 3 balões curtos.
- **1 Pergunta por Turno:** Apenas uma pergunta clara no final.
- **Travas Anti-Slop:** Proibição de muletas de IA.
- **State Guardrails:** Demo pronta ≠ em negociação. Sem CPF/CNPJ antes do aceite.
- **SPIN Selling:** Situação, Problema, Implicação e Solução.
- **Ancoragem:** R$ 2.500 a R$ 5.000 em agência vs R$ 149/mês e R$ 998 anual em até 10x sem juros (sem falar de 2 meses grátis) + R$ 50 seções adicionais.
- **Fechamento:** Dupla Alternativa (*Assumptive Close*).
- **Few-Shot:** 3 diálogos completos com chamadas de tools e respostas.

---

## 4. Implementação da Tool `Gerar_Cobranca_Asaas`
Para atender ao contrato do prompt, a ferramenta `Gerar_Cobranca_Asaas` será registrada no catálogo MCP do CRM (`lib/mcp/tools/catalogo/comercio.ts`), chamando o gateway Asaas via API Key já configurada na VPS (`ASAAS_API_KEY`) para emitir faturas de assinatura ou cobrança parcelada em até 10x com link oficial.
