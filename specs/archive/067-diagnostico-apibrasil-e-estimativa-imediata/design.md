# Design Técnico — Spec 067: Diagnóstico da API de Placas (APIBrasil) e Estimativa Imediata de Tempário

## 1. Fluxo de Dados e Interceptação

```mermaid
flowchart TD
    A[Mensagem WhatsApp: 'EUS5006 \n\ntroca de motor de partida'] --> B[Intent Rewriter: Extrai Placa='EUS5006' e Servicos=['troca de motor de partida']]
    B --> C{Veículo informado na frase?}
    C -->|Sim: ex 'Corsa 2010'| D[Consulta Tempário Direta]
    C -->|Não| E[Busca Placa em L1 Cache SQLite]
    E -->|Encontrada| D
    E -->|Não Encontrada| F[Busca Placa em L2 ERP ordens_servico]
    F -->|Encontrada| D
    F -->|Não Encontrada| G[Busca Placa em L3 APIBrasil Gateway]
    G -->|Sucesso 200| H[Grava Cache L1 SQLite e Prossegue com Modelo Real]
    G -->|Falha 402/404: Sem Saldo/Plano| I[Coleta Diagnóstico Específico da API]
    I --> J[Gera Tempário de Referência Imediato Linha Passeio Padrão]
    J --> K[Emite Balão Executivo com Preço R$ 297,00 + Diagnóstico da API + Opções 1/2/3/4]
    K --> L[Salva Contexto Pendente TEMPARIO_DISCLOSURE + Placa Pendente]
    L --> M{Usuário Responde no Próximo Turno}
    M -->|Opção 1, 2, 3 ou 4| N[Entrega Detalhamento Técnico Imediato]
    M -->|Modelo do Carro: 'Palio 1.0 2012'| O[Grava EUS5006->Fiat Palio no Cache L1 e Reemite Tempário Refinado]
```

---

## 2. Diagnóstico Estruturado na APIBrasil

### Extensão do Contrato de Consulta Veicular (`src/hydra-sync/types/plate_lookup_contract.ts`)

```typescript
export type PlateApiDiagnosticStatus =
  | 'CACHE_HIT'
  | 'ERP_HIT'
  | 'APIBRASIL_OK'
  | 'APIBRASIL_NO_ACTIVE_PLAN'
  | 'APIBRASIL_INSUFFICIENT_BALANCE'
  | 'APIBRASIL_NOT_FOUND'
  | 'APIBRASIL_TIMEOUT_OR_ERROR'
  | 'MANUAL_OVERRIDE';

export interface PlateResolutionAudit {
  readonly placa: string;
  readonly status: PlateApiDiagnosticStatus;
  readonly mensagemDiagnostico?: string;
  readonly saldoDisponivel?: string;
  readonly contaEmail?: string;
}
```

### Captura Detalhada em `src/hydra-sync/apibrasil_plate_client.ts`
- Detectar HTTP 404 com corpo `{"error":true,"message":"Plano ativo não encontrado."}` -> status `APIBRASIL_NO_ACTIVE_PLAN`.
- Detectar HTTP 402 com corpo `{"error":true,"message":"...recarrregue seu saldo.","balance":"R$ 0,00"}` -> status `APIBRASIL_INSUFFICIENT_BALANCE`.
- Expor função `getLastPlateDiagnostic(placa: string): PlateResolutionAudit | null`.

---

## 3. Estimativa de Referência Imediata (Non-Blocking)

Quando a placa for desconhecida e o usuário não disser o carro na frase:
- Em vez de acionar `aguardando_veiculo_placa_tempario` e enviar apenas texto com perguntas, o sistema executa `coordinator.coordinateQuery` com:
  - `veiculoMarcaModelo: 'Linha Passeio (Referência Padrão)'`
  - `servicosSolicitados: serviceTerms`
  - `placa: targetPlaca`
- O `TemparioHybridCoordinator` sintetiza ou recupera o benchmark de engenharia do serviço solicitado para veículos leves de passeio (ex: Motor de Partida Passeio: `1,10h = R$ 297,00`).
- O balão executivo exibe:
  - Cabeçalho: `> Placa EUS5006 · Motor de Partida (Estimativa de Referência)`
  - Subtítulo com o aviso transparente da APIBrasil se aplicável.
  - O resumo de mão de obra a **R$ 270,00/h**.
  - As opções `1️⃣ Peças`, `2️⃣ Ferramentas`, `3️⃣ Passo a Passo`, `4️⃣ Completo`.
  - Chamada para refinar o modelo: `💡 Responda o modelo e ano caso queira refinar o tempo exato e salvar a placa EUS5006 no banco.`
- O contexto salvo é `TEMPARIO_DISCLOSURE`, preservando `placa: targetPlaca`.

---

## 4. Resposta de Próximo Turno Bifurcada e Resiliente

Em `agent_dispatcher.ts`:
1. Se o usuário digitar `1`, `2`, `3` ou `4`:
   - `detectTemparioDetailChoice` intercepta e retorna as peças, ferramentas ou passo a passo da estimativa de referência imediatamente!
2. Se o usuário digitar o carro (ex: `"Palio 1.0 2012"`, `"Corsa"`):
   - O detector de follow-up de veículo grava `placa_lookup_cache` (`origem_dados = 'MANUAL'`) e reexecuta o tempário refinado para aquele modelo.
