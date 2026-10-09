# Documento de Design — OS Interativa Evolution API v2.3.7

**ID da Spec:** `hydra-evo-interactive-os`  
**Data:** 08/10/2026  
**Status:** DESIGN / ARQUITETURA TÉCNICA REVISADA  

---

## 1. Visão Geral da Arquitetura

O sistema implementa o fluxo de 3 etapas no WhatsApp através do desacoplamento estrito entre a recepção de webhook (`webhook-listener.js`), o despachante com resolução de intenção (`agent_dispatcher.ts`) e os novos compositores modulares executivos (`os_situation_composer.ts`).

```
                    ┌──────────────────────────────────────────────┐
                    │          Evolution API v2.3.7                │
                    └───────▲──────────────────────────────┬───────┘
                            │                              │
          POST /message/    │                              │ Webhook POST /webhook
          sendText & sendList│                             │ (messages.upsert)
                            │                              │
┌───────────────────────────┴──────────────────────────────▼───────────────────────────┐
│ webhook-listener.js                                                                   │
│                                                                                       │
│  [Ingress Parser Seguro]                                                              │
│   ├─ listResponseMessage.singleSelectReply.selectedRowId ("os_18503_servicos")       │
│   ├─ buttonsResponseMessage.selectedButtonId                                          │
│   ├─ templateButtonReplyMessage.selectedId                                            │
│   ├─ interactiveResponseMessage.nativeFlowResponseMessage.paramsJson                  │
│   └─ extendedTextMessage / conversation (normalizado)                                 │
│                                                                                       │
│  [Egress Client Seguro]                                                               │
│   ├─ sendWhatsAppMessage(phone, text) ──► POST /message/sendText/${INSTANCE}          │
│   └─ sendWhatsAppList(phone, payload) ──► POST /message/sendList/${INSTANCE}          │
│      (com footerText obrigatório, timeout 12s, whitelist hydra/atendimento)           │
└───────────────────────────▲──────────────────────────────┬───────────────────────────┘
                            │                              │
                DispatcherOutput (com interactiveList)    │ DispatcherInput
                            │                              │
┌───────────────────────────┴──────────────────────────────▼───────────────────────────┐
│ agent_dispatcher.ts                                                                   │
│                                                                                       │
│  [Parser de Comando & Normalização de Fallback]                                       │
│   ├─ Regex Estrita: /^os_(\d{1,8})_(servicos|pecas|pagamentos|documentos|historico)$/ │
│   ├─ Normalizador de Texto: SERVICOS 18503, PECAS, PAGAMENTOS, etc.                   │
│   └─ Resolução de OS Ativa no Turno (Anáfora de Módulo)                               │
└───────────────────────────▲──────────────────────────────┬───────────────────────────┘
                            │                              │
                    Dados Formatados               Consultas ao SQLite
                            │                              │
┌───────────────────────────┴──────────────────────────────▼───────────────────────────┐
│ os_situation_composer.ts (Zero Emojis, Clean, Anti-Slop)                              │
│                                                                                       │
│  [Compositores Específicos]                                                           │
│   ├─ composeExecutiveOSSummary(...)       ──► Resumo Executivo Enxuto (Zero Emojis)   │
│   ├─ composeOSInteractiveListPayload(...) ──► Payload Oficial da Lista Evolution API  │
│   ├─ composeOSServicesCard(...)           ──► Serviços Agrupados por Sistema          │
│   ├─ composeOSPartsCard(...)              ──► Peças e Materiais por Sistema           │
│   ├─ composeOSPaymentsCard(...)           ──► Parcelas (Recebido vs. A Vencer/Saldo)  │
│   ├─ composeOSDocumentsCard(...)          ──► Documentos e Checklists Sem Invenção    │
│   └─ composeOSHistoryCard(...)            ──► Auditoria Real ERP & Histórico Conversas│
└───────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Contratos de Dados TypeScript

### 2.1. Tipos Canônicos da Evolution API v2.3.7

Localização: `src/hydra-sync/types/evo_interactive_contract.ts`:

```typescript
export type AllowedOSModule = 
  | 'servicos' 
  | 'pecas' 
  | 'pagamentos' 
  | 'documentos' 
  | 'historico';

export const ALLOWED_OS_MODULES: readonly AllowedOSModule[] = [
  'servicos',
  'pecas',
  'pagamentos',
  'documentos',
  'historico'
] as const;

export interface EvoListRow {
  /** Título principal visível na linha (ex: "1. Serviços") */
  readonly title: string;
  /** Descrição complementar (ex: "7 itens discriminados · R$ 1.850,90") */
  readonly description?: string;
  /** Identificador único devolvido no webhook (ex: "os_18503_servicos") */
  readonly rowId: string;
}

export interface EvoListSection {
  /** Título do grupo de opções (ex: "Módulos da OS #18503") */
  readonly title: string;
  /** Linhas selecionáveis na seção */
  readonly rows: readonly EvoListRow[];
}

export interface EvoListPayload {
  /** Telefone com DDI e DDD (ex: "5511996242812") */
  readonly number: string;
  /** Título exibido no topo da lista */
  readonly title: string;
  /** Texto descritivo acima do botão */
  readonly description: string;
  /** Texto do botão de abertura da lista nativa */
  readonly buttonText: string;
  /** Texto de rodapé obrigatório na Evolution API v2 */
  readonly footerText: string;
  /** Seções com suas respectivas linhas */
  readonly sections: readonly EvoListSection[];
}
```

### 2.2. Extensão do `DispatcherOutput`

Em `src/hydra-sync/agent_dispatcher.ts`:

```typescript
export interface DispatcherOutput {
  messages: string[];
  replyText: string;
  toolsCalled: string[];
  motor: 'AGY_PRIMARY' | 'AGY_SECONDARY' | 'AGY_CLI' | 'FALLBACK_API';
  latenciaMs: number;
  telemetry: StageTelemetry;
  isFeedback: boolean;
  contract?: TurnContract;
  /** Payload de lista interativa da Evolution API (opcional) */
  interactiveList?: EvoListPayload;
}
```

---

## 3. Detalhamento dos Componentes

### 3.1. `webhook-listener.js`

#### A. Extração Segura de Ingress (Interativo e Texto)
No processamento de `messages.upsert`:
```javascript
function extractIncomingMessageContent(messageObj, payload) {
  // 1. Prioridade: Cliques em listas interativas da Evolution API
  const listReply = messageObj?.listResponseMessage;
  if (listReply?.singleSelectReply?.selectedRowId) {
    return {
      text: String(listReply.singleSelectReply.selectedRowId).trim(),
      title: listReply.title || '',
      isInteractive: true,
      kind: 'list_reply'
    };
  }

  // 2. Cliques em botões interativos
  const buttonReply = messageObj?.buttonsResponseMessage;
  if (buttonReply?.selectedButtonId) {
    return {
      text: String(buttonReply.selectedButtonId).trim(),
      title: buttonReply.selectedDisplayText || '',
      isInteractive: true,
      kind: 'button_reply'
    };
  }

  const templateButtonReply = messageObj?.templateButtonReplyMessage;
  if (templateButtonReply?.selectedId) {
    return {
      text: String(templateButtonReply.selectedId).trim(),
      title: templateButtonReply.selectedDisplayText || '',
      isInteractive: true,
      kind: 'template_button_reply'
    };
  }

  // 3. Native flow / interactive response
  const interactiveReply = messageObj?.interactiveResponseMessage;
  if (interactiveReply?.nativeFlowResponseMessage?.paramsJson) {
    try {
      const p = JSON.parse(interactiveReply.nativeFlowResponseMessage.paramsJson);
      const rowId = p?.id || p?.rowId;
      if (rowId) {
        return {
          text: String(rowId).trim(),
          title: interactiveReply?.body?.text || rowId,
          isInteractive: true,
          kind: 'native_flow_reply'
        };
      }
    } catch {}
  }

  // 4. Texto padrão e legendas de mídia
  const text = (
    messageObj?.conversation ||
    messageObj?.extendedTextMessage?.text ||
    messageObj?.imageMessage?.caption ||
    messageObj?.videoMessage?.caption ||
    messageObj?.documentMessage?.caption ||
    messageObj?.documentWithCaptionMessage?.message?.documentMessage?.caption ||
    payload?.content ||
    ""
  ).trim();

  return { text, isInteractive: false, kind: 'text' };
}
```

#### B. Egress: Função `sendWhatsAppList`
```javascript
async function sendWhatsAppList(phone, listPayload, maxRetries = 2) {
  const cleanPhone = String(phone).replace(/\D/g, "");
  if (!cleanPhone || !listPayload) return { sucesso: false, erro: "Parâmetros inválidos" };

  // Validação estrita de instâncias permitidas
  const ALLOWED_INSTANCES = new Set(["hydra", "atendimento"]);
  if (!ALLOWED_INSTANCES.has(INSTANCE)) {
    console.error(`[Hydra Webhook] 🛑 Violação de Segurança: Instância não autorizada (${INSTANCE}).`);
    return { sucesso: false, erro: "unauthorized_sender_instance" };
  }

  // Revalidação de autorização no egress
  if (db && !revalidateAuthorization(db, cleanPhone)) {
    console.warn(`[AccessGuard] 🛑 Envio bloqueado: usuário ${maskPhone(cleanPhone)} revogado.`);
    return { sucesso: false, erro: "revoked_or_unauthorized" };
  }

  const endpoint = `${EVOLUTION_URL}/message/sendList/${INSTANCE}`;
  const startTotal = Date.now();
  let lastStatus = 0;
  let lastError = null;
  let lastRaw = null;
  let capturedMsgId = null;

  const payloadToSend = {
    ...listPayload,
    number: cleanPhone,
    footerText: listPayload.footerText || "Mecânica Popular · Sistema Hydra"
  };

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "User-Agent": "Hydra-Bot/1.0",
          "Content-Type": "application/json",
          "apikey": EVOLUTION_KEY
        },
        body: JSON.stringify(payloadToSend),
        signal: AbortSignal.timeout(12000)
      });

      lastStatus = response.status;
      lastRaw = await response.text();

      try {
        const parsed = JSON.parse(lastRaw);
        capturedMsgId = parsed?.key?.id || parsed?.data?.key?.id || parsed?.id;
      } catch {}

      if (response.ok) {
        const duracaoMs = Date.now() - startTotal;
        logDelivery(cleanPhone, capturedMsgId, lastStatus, true, attempt, duracaoMs, lastRaw, null);
        console.log(`[WhatsApp API] Lista interativa aceita pela Evolution API: status ${lastStatus}, msgId: ${capturedMsgId}`);
        return { sucesso: true, statusHttp: lastStatus, tentativas: attempt, duracaoMs, messageId: capturedMsgId };
      }

      if (lastStatus >= 400 && lastStatus < 429) {
        lastError = `HTTP ${lastStatus}: ${lastRaw.slice(0, 150)}`;
        break;
      }

      lastError = `HTTP ${lastStatus} Transitório: ${lastRaw.slice(0, 150)}`;
    } catch (err) {
      lastStatus = 0;
      lastError = err?.name === "TimeoutError" ? "Timeout de 12s excedido" : (err?.message || String(err));
    }

    if (attempt < maxRetries) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  const duracaoMs = Date.now() - startTotal;
  logDelivery(cleanPhone, capturedMsgId, lastStatus, false, maxRetries, duracaoMs, lastRaw, lastError);
  console.warn(`[Hydra Webhook] Aviso: Falha ao enviar lista interativa (${lastError}). O texto de resumo permanece como fallback.`);
  return { sucesso: false, statusHttp: lastStatus, erro: lastError };
}
```

---

### 3.2. Regras de Apresentação e Compositores em `os_situation_composer.ts`

#### A. Regra Clara e Contábil de "Pago"
```typescript
function calculatePaymentMetrics(totalAmount: number, saldoDevedor: number, pagamentos: readonly any[]) {
  const total = Number(totalAmount || 0);
  const saldo = Number(saldoDevedor !== undefined ? saldoDevedor : total);
  // Pago = soma das parcelas efetivamente liquidadas/recebidas (ou total - saldo)
  const pago = Math.max(0, total - saldo);

  return { total, saldo, pago };
}
```

#### B. Resumo Executivo Enxuto (`composeExecutiveOSSummary`)
- Totalmente **sem emojis**.
- Layout com títulos, traços e recuos limpos.
- Indica claramente as contagens de módulos e lista de atalhos textuais de fallback.

#### C. Payload da Lista Interativa (`composeOSInteractiveListPayload`)
- Gera as 5 seções canônicas com `rowId` padronizado: `os_{id}_{module}`.
- Contém `footerText: "Mecânica Popular · Sistema Hydra"`.

#### D. Módulos Específicos:
1. `composeOSServicesCard`:
   - Agrupamento em conjuntos mecânicos: `*Elétrica e Ignição*`, `*Arrefecimento*`, `*Suspensão e Rodagem*`, `*Freios*`, `*Revisão e Apoio*`.
   - Title Case limpo, com valores formatados e subtotais.
   - Proibido qualquer placeholder `(Preencher Executor...)`.
2. `composeOSPartsCard`:
   - Peças e materiais agrupados por sistema, com quantidade e valor.
3. `composeOSPaymentsCard`:
   - Lista cada parcela com identificação clara:
     `- Parcela 1: R$ 2.010,00 (PIX, Venc: 02/10/2026) · [Recebido]`
     `- Parcela 2: R$ 1.998,00 (Boleto, Venc: 15/10/2026) · [A Vencer]`
   - Resumo contábil: `Total: R$ X · Pago: R$ Y · Saldo Devedor: R$ Z`.
4. `composeOSDocumentsCard`:
   - **Sem inventar dados.** Se NF não foi emitida/informada, declara exatamente `Nota fiscal: Não informada`.
   - Vistorias: pareia estritamente Inspeção de Entrada sob o Checklist de Entrada, seguido pelo Checklist do Mecânico.
   - Anexos: lista quantidade e descrições dos arquivos reais arquivados.
5. `composeOSHistoryCard`:
   - Auditoria do ERP (usuário de criação, data, usuário de alteração, data, conteúdo das anotações da OS) e registros do grafo/conversas centrais.

---

### 3.3. Roteamento e Normalização em `agent_dispatcher.ts`

```typescript
export function parseOSModuleIntent(
  text: string,
  activeOsId?: string | number
): { osId?: string; module?: AllowedOSModule; isGeneralOS?: boolean } | null {
  const clean = text.trim();

  // 1. Comando exato de rowId vindo de clique em lista
  const rowMatch = clean.match(/^os_(\d{1,8})_(servicos|pecas|pagamentos|documentos|historico)$/i);
  if (rowMatch) {
    const osId = rowMatch[1];
    const mod = rowMatch[2].toLowerCase() as AllowedOSModule;
    if (ALLOWED_OS_MODULES.includes(mod)) {
      return { osId, module: mod };
    }
  }

  // 2. Normalização de comandos de texto (tolerante a acentos e maiúsculas)
  const norm = clean.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const osNumMatch = norm.match(/\b(\d{3,8})\b/);
  const targetOsId = osNumMatch ? osNumMatch[1] : (activeOsId ? String(activeOsId) : undefined);

  if (!targetOsId) return null;

  if (/\b(servico|servicos|mao de obra)\b/.test(norm)) {
    return { osId: targetOsId, module: 'servicos' };
  }
  if (/\b(peca|pecas|material|materiais|insumo|insumos)\b/.test(norm)) {
    return { osId: targetOsId, module: 'pecas' };
  }
  if (/\b(pagamento|pagamentos|parcela|parcelas|financeiro|saldo)\b/.test(norm)) {
    return { osId: targetOsId, module: 'pagamentos' };
  }
  if (/\b(documento|documentos|checklist|checklists|vistoria|vistorias|nf|nota fiscal|anexo|anexos)\b/.test(norm)) {
    return { osId: targetOsId, module: 'documentos' };
  }
  if (/\b(historico|conversa|conversas|atendimento|chat|whatsapp)\b/.test(norm)) {
    return { osId: targetOsId, module: 'historico' };
  }

  return null;
}

---

## 4. Garantia Híbrida: Zero State-Lockout e Conversação Livre

O sistema opera sob uma arquitetura **estritamente híbrida e não-bloqueante**:

1. **Simbiose Botão + Texto Livre:**
   - O menu interativo (`sendList`) e os botões são facilitadores de atalho, **nunca uma gaiola ou URA**.
   - Em nenhum momento o usuário fica preso em um loop de "Opção inválida, por favor selecione 1 a 5".
2. **Interrupção Natural e Mudança de Assunto:**
   - Se o operador estiver no meio da navegação de uma OS (ex: acabou de abrir o módulo de Peças) e repentinamente mandar um áudio ou texto livre como:
     - *"O que o Marcos alinhou com o cliente sobre o alternador?"*
     - *"Quem é o mecânico responsável por esse carro?"*
     - *"Qual o faturamento de Mauá hoje?"*
     - *"Tem mais algum carro travado no pátio?"*
   - O sistema detecta se a pergunta é uma dúvida conversacional contextual sobre a OS ativa ou se é uma mudança total de assunto (ex: métricas financeiras ou outra unidade).
3. **Preservação de Contexto de Turno (`TurnState`):**
   - Se a pergunta for sobre a OS atual, o dispatcher herda `osId = 18503` e aciona o motor de análise/LLM com as ferramentas adequadas (`get_os_details`, `get_os_case_history`), respondendo a dúvida específica sem perder o fio da meada.
   - Se for uma pergunta fora do escopo da OS, o `intent_rewriter` reescreve a intenção canônica e entrega a resposta correspondente com total liberdade.

```
