# Proposal — Detalhamento Profundo de OS (Serviços, Peças e Formas de Pagamento) e Isolamento Estrito de Loja

**Spec:** `hydra-deep-os-and-store-isolation`  
**Data:** 06/10/2026  
**Repositório:** `hydra-bot`  
**Objetivo:** Permitir que o Hydra entregue a profundidade completa dos dados que o crawler já extrai e armazena em `ordens_servico.raw_payload` (serviços discriminados, peças, executores, formas e parcelas de pagamento, documentos e checklists), eliminar respostas rasas e repetitivas, e garantir que a persona Gerente nunca receba nem veja dados de outras unidades da rede.

---

## 1. Problemas Diagnosticados

### 1.1. Profundidade Rasa dos Dados (O dado existe no banco, mas não chega à IA)
- O crawler do Oficina Inteligente extrai a ficha completa da OS e armazena em `ordens_servico.raw_payload` (JSON estruturado contendo `itens`, `pagamentos`, `documentos_anexos`, `checklists`, `cliente_telefone_sms`, etc.).
- Na OS **#439 (Linea de Jabaquara)**, por exemplo, o banco contém:
  * 10 parcelas no Cartão de Crédito de R$ 881,85 cada (total R$ 8.818,50 pago);
  * 4 serviços discriminados executados por João (Remoção do câmbio R$ 1.800, Diagnóstico Premium R$ 520, Reprogramação Módulo R$ 490, Robótica R$ 890);
  * Histórico criado por Vanessa.
- Porém, o `hybrid_retrieval.ts` faz `SELECT` apenas nas colunas de cabeçalho (`total_os`, `valor_pago`, `valor_restante`), **descartando o `raw_payload`**.
- Consequentemente, quando o operador pede "formas de pagamento", "documentos" ou "serviços", a IA ou o adaptador respondem que o detalhamento "não consta nos registros retornados".

### 1.2. Vazamento de Lojas para a Persona Gerente
- Quando o operador está com `/perfil` definido como **Gerente de Loja** (ex: Jabaquara) e pergunta `"fale sobre o linea"`, a busca executa em escopo de rede e lista veículos de Santo André (`EUO4H07` - OS #2461).
- O perfil de gerente tem permissão estrita apenas para a sua unidade (`MPJabaquara`). O sistema deve ancorar automaticamente qualquer busca na loja do gerente.

### 1.3. Respostas "Chapadas" e Repetitivas no Roteador de Veículo
- O roteador de veículo estático (`formatVehicleSituation`) responde sempre o mesmo card cadastral de 5 linhas fixas, ignorando perguntas investigativas específicas como:
  * "quais os serviços?"
  * "formas de pagamento"
  * "quais as peças?"
  * "o que tá acontecendo?"

---

## 2. Solução Proposta

### 2.1. Nova Ferramenta MCP: `get_os_details`
Adicionar ao servidor MCP `hydra-ops` a ferramenta especializada `get_os_details` com input `{ os_id: string, loja_slug?: string }`:
- Faz a leitura direta e o parse do `raw_payload`.
- Retorna objeto estruturado com:
  * **Serviços:** código, descrição, quantidade, valor unitário, total, executor.
  * **Peças/Produtos:** código, descrição, quantidade, valor unitário, total.
  * **Formas de Pagamento:** lista de parcelas, data de vencimento, forma (Crédito, Débito, PIX, Dinheiro, Boleto), valor e status financeiro.
  * **Documentos e Checklists:** comprovantes, notas fiscais, checklists anexados com percentual de conclusão.
  * **Contatos:** telefone, CPF e observações.

### 2.2. Inclusão de `raw_payload` no `hybrid_retrieval.ts`
- Quando a busca for por uma OS específica ou por veículo único, enriquecer o resultado do `hybrid_retrieval.ts` com os dados parseados de `raw_payload`.

### 2.3. Blindagem Estrita de Loja para Gerente (Zero Vazamento)
- No `agent_dispatcher.ts` e no `mcp_server.ts`: se `activeProfile.persona === 'gerente'`, qualquer chamada a ferramentas de busca (`search_os`, `semantic_search_os`, `get_os_details`, etc.) é forçada a filtrar `loja_slug = activeProfile.lojaSlug`.
- Se o gerente buscar um modelo de carro, o sistema procura **exclusivamente na sua loja**, sem consultar ou listar unidades de terceiros.

---

## 3. Contratos de Dados & Interfaces

```typescript
export interface OSFullDetail {
  osId: string;
  lojaSlug: string;
  veiculo: string;
  placa: string;
  clienteNome: string;
  clienteTelefone?: string;
  clienteCpf?: string;
  responsavel?: string;
  statusGrid: string;
  isAberta: boolean;
  diasNoPatio: number;
  totalOS: number;
  valorPago: number;
  valorRestante: number;
  servicos: Array<{
    codigo: string;
    descricao: string;
    qtd: number;
    valorTotal: number;
    executor?: string;
  }>;
  pecas: Array<{
    codigo: string;
    descricao: string;
    qtd: number;
    valorTotal: number;
  }>;
  pagamentos: Array<{
    parcela: string;
    vencimento: string;
    forma: string;
    valor: number;
    enviadoFinanceiro?: string;
  }>;
  documentosAnexos: string[];
  notasFiscais: string[];
  checklists: Array<{
    numero?: string;
    tipo?: string;
    status?: string;
    concluidoPercentual?: number;
  }>;
}
```

---

## 4. Riscos e Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| `raw_payload` corrompido ou string vazia | Médio | Tratamento com `try/catch` seguro retornando os dados cadastrais básicos como fallback |
| Payload muito extenso para o prompt da IA | Médio | Formatar o JSON retornado pelo MCP de forma compacta e sem chaves nulas desnecessárias |
