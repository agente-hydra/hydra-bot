# Proposal: Raio-X e Detalhes 360° da OS com Peças e Grafo de Atendimento Integrados

Spec ID: `hydra-os-360-full-details`  
Data: 08/10/2026  
Status: Proposta  

---

## 1. Problema Identificado no Uso Real

Em conversas reais de produção no WhatsApp, quando o usuário solicita o "raio-x", "detalhes" ou a "situação" de uma ordem de serviço específica (ex: *"nao, taio x da os 1916 por facor"*, *"detalhes da os 1916"*), o Hydra Agent apresenta duas falhas graves de experiência e consistência:

### Falha A: Omissão Total de Peças e Componentes Aplicados
- Na OS #1916 (HB20 - ReiDoModulo), o valor total da ordem é de **R$ 1.600,00**.
- O agente exibiu apenas o bloco de serviços: `REPROGRAMAÇAO MODULO: R$ 130,00 (RAPHAEL)`.
- Os outros **R$ 1.470,00** da ordem (referentes a peças, componentes eletrônicos ou reparo de bancada) **desapareceram completamente da resposta**.
- **Causa Raiz:** O bloco de formatação de detalhes em `agent_dispatcher.ts` (linhas 908-960) contempla apenas `servicos`, `pagamentos` e `documentos/checklists`. O array `osDetail.pecas` (já extraído por `parseOSDetailRow` no `db_repository.ts`) **não possui nenhum bloco de renderização**, deixando o usuário sem entender a composição financeira da OS.

### Falha B: Bloqueio e Desconexão do Grafo de Atendimento no "Raio-X" e nos "Detalhes"
- Quando o usuário pede *"taio x da os 1916"* (typo de *raio x*), o sistema cai em `VEHICLE_SITUATION` e invoca `formatVehicleSituation(resolution, caseCtx, opType)` em `hybrid_os_coordinator.ts`.
- Essa função trata `caseContext` **exclusivamente** quando `operation === 'DELAY_REASON'`. Para `VEHICLE_SITUATION`, ela cospe apenas 6 linhas estáticas do ERP, ignorando o Grafo, o histórico de conversas e os fatos do caso.
- Quando o usuário pede *"detalhes da os 1916"*, o sistema entra no branch `wantsAll`, mas esse branch formata apenas o ERP básico e **ignora completamente** o `caseCtx`, não dizendo o que foi conversado com o cliente (Eric Ferreira de Barros), se há aprovação, recusa, previsão combinada ou retenção em bancada.

---

## 2. Solução Proposta

Implementar o padrão **Raio-X 360° Unificado da Ordem de Serviço**, garantindo que qualquer pedido de "raio-x", "detalhes", "situação completa" ou "o que está acontecendo" de uma OS apresente uma resposta completa, consistente e sem sumiço de valores:

1. **Reconhecimento Robusto de Intenção e Typos no Dispatcher:**
   - Detectar pedidos de Raio-X / Detalhes / Ficha Completa, incluindo typos comuns no WhatsApp (`taio x`, `raiox`, `raio-x`, `detalhes`, `tudo`, `completo`, `situacao completa`).
   - Ativar o modo de detalhamento 360° (`isOSDeepDiveRequest = true`).

2. **Renderização Completa da Composição de Valores (Serviços + Peças):**
   - Bloco discriminado de **Peças e Componentes Aplicados** (`> *Peças e Materiais Aplicados*`), exibindo quantidade, descrição e valor unitário/total.
   - Caso a OS possua saldo de materiais/peças sem itens individualizados cadastrados no ERP, exibir a linha de conciliação: `- Peças / Reparo de Bancada: R$ X,XX (Saldo de componentes aplicados na OS)`.
   - Garantir que `Soma(Serviços) + Soma(Peças) == Total da OS`.

3. **Integração Mandatória do Grafo e Histórico de Conversas (`caseCtx`):**
   - Incorporar o bloco `> *Situação e Atendimento ao Cliente*` em todo relatório de detalhamento 360°:
     - Motivo documentado de espera ou retenção.
     - Próximo passo prometido ao cliente e data da última interação.
     - Posicionamento de aprovação/recusa do cliente (conforme registrado pelo analisador de conversas).
     - Se não houver conversa vinculada ou análise: declarar a limitação factual honesta (*"Sem pendência de atraso ou peças registrada no histórico de mensagens"*).

4. **Enriquecimento de `formatVehicleSituation` em `hybrid_os_coordinator.ts`:**
   - Nunca mais entregar apenas 6 linhas vazias quando houver dados de contexto ou detalhamento disponíveis.
   - Exibir a situação consolidada da ordem (status, permanência no pátio, motivo operacional e status financeiro).

---

## 3. Contratos de Dados e Interfaces

### Interface do Raio-X 360° (`OSDetail360Payload`)
```typescript
export interface OSDetail360Payload {
  readonly osId: string | number;
  readonly lojaSlug: string;
  readonly veiculo: string;
  readonly placa: string;
  readonly clienteNome: string;
  readonly statusGrid: string;
  readonly isAberta: boolean;
  readonly diasNoPatio: number;
  readonly financeiro: {
    readonly valorTotal: number;
    readonly valorPago: number;
    readonly saldoDevedor: number;
    readonly totalServicos: number;
    readonly totalPecas: number;
    readonly parcelas?: readonly {
      readonly parcela: number;
      readonly valor: number;
      readonly modalidade: string;
      readonly vencimento?: string;
    }[];
  };
  readonly servicos: readonly {
    readonly descricao: string;
    readonly valor: number;
    readonly executor?: string;
  }[];
  readonly pecas: readonly {
    readonly descricao: string;
    readonly quantidade: number;
    readonly valorTotal: number;
    readonly codigo?: string;
  }[];
  readonly atendimento: {
    readonly documentedDelayReason?: string;
    readonly nextPromisedStep?: string;
    readonly lastInteractionDate?: string;
    readonly approvalStatus?: 'APPROVED' | 'REFUSED' | 'AMBIGUOUS' | 'NOT_RECORDED';
    readonly evidenceOrigin?: string;
    readonly isLimitationDeclared: boolean;
  };
  readonly vistorias: {
    readonly temChecklistEntrada: boolean;
    readonly temChecklistMecanico: boolean;
    readonly temNf: boolean;
  };
}
```

---

## 4. Riscos e Mitigações

1. **Risco:** Balões de WhatsApp ficarem excessivamente longos (> 1.200 caracteres) em OSs com dezenas de peças e serviços.  
   **Mitigação:** Aplicar compactação inteligente: listar os 5 principais itens e agrupar o excedente em `... e outros X itens (R$ Y,YY)`.
2. **Risco:** Erros de concordância quando a OS não possui peças (apenas mão de obra).  
   **Mitigação:** Se `pecas.length === 0` e `totalPecas === 0`, omitir o bloco de peças sem poluir a mensagem.
3. **Risco:** Quebra de contratos existentes em `get_os_details` ou regressão nos 23 gates do Incidente Linea.  
   **Mitigação:** Suíte de regressão automatizada cobrindo tanto os gates do Linea quanto os novos gates da OS 1916 e OSs multivariadas.
