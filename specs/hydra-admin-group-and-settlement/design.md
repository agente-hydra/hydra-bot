# Design Técnico: Admin Joacir, Broadcast Blindado Grupo Mecânica TI & Liquidação D+1

**Spec ID:** `hydra-admin-group-and-settlement`  
**Data:** 08/10/2026  

---

## 1. Arquitetura e Fluxo de Dados

```text
                                MENSAGEM RECEBIDA (INGRESS)
                                            │
                                            ▼
                           ┌──────────────────────────────────┐
                           │   identity_access_guard.ts       │
                           │   (Ingress Security Gate)        │
                           └──────────────────────────────────┘
                                            │
               ┌────────────────────────────┴────────────────────────────┐
               ▼                                                         ▼
     [É Grupo: remoteJid.endsWith('@g.us')]                     [É Chat Privado]
               │                                                         │
               ▼                                                         ▼
    ┌─────────────────────────┐                               ┌─────────────────────────┐
    │ HTTP 200                │                               │ Consulta                │
    │ {"status":"ignored_grp"}│                               │ hydra_authorized_users  │
    │ Zero LLM / Zero Reação  │                               └─────────────────────────┘
    └─────────────────────────┘                                          │
                                                   ┌─────────────────────┴─────────────────────┐
                                                   ▼                                           ▼
                                            [Joacir / Davi / Marcos]                 [Não Cadastrado / Outro]
                                                   │                                           │
                                                   ▼                                           ▼
                                            Autorizado (Sócio)                       HTTP 200 {"status":"ignored"}
                                            Livre acesso ao Hydra                    Zero LLM / Zero Reação
```

---

```text
                            NOTIFICAÇÕES & DISPAROS MATINAIS (EGRESS)
                                            │
           ┌────────────────────────────────┼────────────────────────────────┐
           ▼                                ▼                                ▼
┌──────────────────────────┐   ┌──────────────────────────┐   ┌──────────────────────────┐
│   Watchdog Supervisor    │   │   Hydra Pátio Matinal    │   │   Hydra Rede Juros       │
│   (Alertas de Gerentes)  │   │   (Conciliação D-1/D+1)  │   │   (Taxas de Cartão)      │
└──────────────────────────┘   └──────────────────────────┘   └──────────────────────────┘
           │                                │                                │
           ├────────────────────────────────┼────────────────────────────────┤
           ▼                                ▼                                ▼
  [Destinatários Oficiais: Diretoria + Grupo Exclusivo Mecânica TI (120363425738307789@g.us)]
```

---

## 2. Contratos e Interfaces TypeScript

### 2.1. Ingress Gate: Bloqueio Estrito de Grupos (`identity_access_guard.ts`)

```typescript
export interface GroupFilterResult {
  isGroup: boolean;
  groupId?: string;
  action: 'DROP_SILENTLY' | 'PROCESS';
}

/**
 * Avalia se o JID recebido pertence a um grupo do WhatsApp.
 * Todo tráfego de grupo (@g.us) é sumariamente descartado para impedir conversas públicas.
 */
export function evaluateGroupIngress(rawRemoteJid: string): GroupFilterResult {
  const isGroup = rawRemoteJid.trim().endsWith('@g.us');
  return {
    isGroup,
    groupId: isGroup ? rawRemoteJid.trim() : undefined,
    action: isGroup ? 'DROP_SILENTLY' : 'PROCESS'
  };
}
```

### 2.2. Previsão de Liquidação D+1 Matinal (`patio_ledger_engine.ts` / `.js`)

```typescript
export interface SettlementForecast {
  /** Total recebido em D-1 via Débito que liquida na conta hoje D pela manhã */
  debitoCaindoHojeD1: number;
  /** Total recebido em D-1 via Pix já disponível em conta */
  pixDisponivel: number;
  /** Total recebido em D-1 em Dinheiro em espécie já na loja */
  dinheiroDisponivel: number;
  /** Total recebido em D-1 via Crédito (sujeito a prazo de operadora ou antecipação) */
  creditoRegistrado: number;
  /** Total imediato disponível/liquidando hoje pela manhã (Débito D+1 + Pix + Dinheiro) */
  totalDisponivelManha: number;
}

export interface ConsolidatedExecutiveSummaryWithSettlement {
  mesReferencia: string;
  diaExecucaoD: string;
  diaReferenciaD1: string;
  totalOSsAbertas: number;
  totalSaldoPendente: number;
  totalOSsFechadasOntem: number;
  totalRecebidoOntem: number;
  recebimentosPorForma: {
    Credito: number;
    PIX: number;
    Debito: number;
    Dinheiro: number;
    Outros: number;
    total: number;
  };
  liquidacaoPrevistaHoje: SettlementForecast;
  lojas: Array<{
    storeKey: string;
    nomeDisplay: string;
    abertas: number;
    saldoPendente: number;
    fechadasOntem: number;
    recebidoOntem: number;
    liquidandoHojeManha: number;
  }>;
}
```

### 2.3. Configuração de Destinatários de Broadcast

```typescript
export interface BroadcastRecipientConfig {
  /** Telefones individuais de administradores/diretoria */
  adminPhones: string[];
  /** Grupo de TI / Auditoria (Read-Only) */
  broadcastGroupJid: string;
  /** Instância autorizada na Evolution API */
  allowedEvoInstance: 'hydra' | 'atendimento';
}

export const OFFICIAL_BROADCAST_CONFIG: BroadcastRecipientConfig = {
  adminPhones: [
    '5511940667032', // Diretoria / Financeiro Oficial
    '5511947645967', // Joacir Barros (Novo Admin)
    '5511996242812', // Davi (Sócio)
    '5511970671717'  // Marcos (Sócio)
  ],
  broadcastGroupJid: '120363425738307789@g.us', // Grupo "Mecanica TI"
  allowedEvoInstance: 'hydra'
};
```

---

## 3. Módulos a Modificar e Implementar

1. **Banco de Dados Operacional (`hydra_ops.db` em `/home/operacional/hydra-data/`):**
   - Executar `INSERT INTO hydra_authorized_users` cadastrando `5511947645967` com nome `'Joacir Barros'`, role `'socio'`, `allowed_stores = '["*"]'`, `is_active = 1`, `can_simulate_persona = 1`.

2. **Ingress Security Gate (`src/hydra-sync/identity_access_guard.ts` e `webhook-listener.js`):**
   - Adicionar checagem antecipada: se `rawRemoteJid.endsWith('@g.us')`, retornar imediatamente `HTTP 200 {"status": "ignored_group"}` sem registrar presença, reação ou passar ao roteador de intenções.

3. **Supervisor de Atendimento (`/home/operacional/watchdog/worker.js` e `daily-health.js`):**
   - Atualizar a função `sendWhatsAppAlert`:
     - Disparar o alerta via Evolution API (`/message/sendText/hydra`) diretamente para o grupo `120363425738307789@g.us`.
     - Garantir que o admin Joacir Barros receba os alertas operacionais.

4. **Motor de Pátio & Liquidação D+1 (`projects/hydra-rede/src/patio_ledger_engine.js`):**
   - Adicionar cálculo de `liquidacaoPrevistaHoje` dentro de `getConsolidatedExecutiveSummary`.
   - Mapear pagamentos de Débito como `D+1 Matinal` e Pix/Dinheiro como `Disponível Ontem`.

5. **Formatador e Despachante do WhatsApp (`projects/hydra-rede/src/whatsapp_patio_dispatcher.js`):**
   - Adicionar seção visual `💵 PREVISÃO DE ENTRADA HOJE (MANHÃ)` no card do WhatsApp.
   - Enviar tanto para a lista de números autorizados (`5511940667032`, `5511947645967`) quanto para o grupo `120363425738307789@g.us`.

6. **Hydra Rede Notifier (`projects/hydra-rede/src/whatsapp_notifier.js`):**
   - Adicionar envio do relatório diário de juros e taxas para `5511947645967` e para o grupo `120363425738307789@g.us`.
