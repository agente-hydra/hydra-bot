# Proposta: Higienização de Relatórios Noturnos, Padronização "HYDRA | Operação" e Balão Dedicado de Faturamento & CMV

**Spec ID:** `hydra-daily-report-sanitization-and-branding`  
**Data:** 09/10/2026  
**Status:** Planejamento  

---

## 1. Problema e Diagnóstico

### 1.1. Incidente 1: Disparo Noturno de Métricas de Infraestrutura no Grupo WhatsApp da Mecânica
- **Evidência no Código:** `/home/operacional/watchdog/daily-health.js` (linhas 34-49 e 180-184):
  ```javascript
  // Envio direto para o Grupo Mecanica TI e Joacir Barros via Evolution API
  for (const evoTarget of ['120363425738307789@g.us', '5511947645967']) { ... }
  cron.schedule('50 23 * * *', () => { generateHealthReport(); });
  ```
- **Evidência no Log da VPS:** `pm2 logs watchdog-health`:
  `5|watchdog | ✅ Relatório diário de saúde enviado para 120363425738307789@g.us via Evolution API!` (disparado às 23:50).
- **Diagnóstico:** O processo de background `watchdog-health` despacha às 23:50 o relatório `📊 RELATÓRIO DIÁRIO — WATCHDOG & SERVIDOR 📊` com Uptime, RAM, Disco, Docker e cota agy diretamente no grupo operacional `120363425738307789@g.us`.
- **Impacto:** Poluição do grupo operacional com relatórios de infraestrutura durante a noite.

### 1.2. Incidente 2: Desalinhamento do Cabeçalho e Conteúdo do Relatório Diário de Operação
- **Evidência no Código:** `projects/hydra-rede/src/whatsapp_patio_dispatcher.js` e `src/hydra-sync/whatsapp_formatter.ts`:
  - Cabeçalho legado: `🚗 *RELATÓRIO DIÁRIO — CONCILIAÇÃO DE PÁTIO & OS*`.
  - Seção *"O que fazer agora"*: atualmente exibida de forma genérica mesmo em disparos direcionados para grupos.
- **Diagnóstico:**
  - O usuário determinou explicitamente que o cabeçalho deve ser `*HYDRA | Operação*`.
  - A seção *"O que fazer agora"* deve ser suprimida na mensagem enviada para o grupo (deixando a mensagem focada em fatos e métricas operacionais limpas).
  - Ausência de um balão dedicado e limpo apresentando o Faturamento e o CMV (%) de cada unidade da rede.

---

## 2. Solução Proposta

### 2.1. Sanitização do Watchdog (`daily-health.js`)
1. **Remoção de Grupos de Broadcast de Infraestrutura:**
   - Remover categoricamente `120363425738307789@g.us` de `daily-health.js`.
   - Adicionar trava no código: mensagens de saúde de servidor NUNCA disparam para JIDs `@g.us`.
   - Manter envio apenas para canais internos (Chatwoot) e admin técnico.

### 2.2. Padronização do Relatório Matinal: `*HYDRA | Operação*`
1. **Cabeçalho Canônico:**
   ```text
   *HYDRA | Operação*

   ${refDateBR} · Pátio & OS
   ```
2. **Supressão de "O que fazer agora" no Grupo:**
   - Quando o envio for destinado a grupo (`isGroup: true` ou JID `@g.us`), o bloco `*O que fazer agora*` é omitido da mensagem.

### 2.3. Novo Balão Dedicado: Faturamento & CMV por Unidade
1. **Formato Institucional:**
   Um segundo balão é gerado de forma autônoma e limpa:
   ```text
   *HYDRA | Faturamento & CMV por Unidade*

   ${refDateBR} · Posição Mês

   1. *Dom Pedro:* R$ 42.150,00 · CMV: 12,4%
   2. *Jabaquara:* R$ 38.920,00 · CMV: 15,1%
   ...
   *Consolidado da rede:*
   - Faturamento total: *R$ 260.878,19*
   - CMV médio da rede: *14,2%*
   ```
2. **Fonte dos Dados:**
   - Faturamento: Mapa de Metas consolidado (`metas_rede.json` ou tabela `metas_diarias` no SQLite WAL).
   - CMV: Dados apurados da tabela `cmv_lojas` (`queryAllStoresCMV(db)` / `extracao_mes_*.json`).

### 2.4. Validação e Teste Exclusivo para o Desenvolvedor (`11996242812`)
1. **Script de Teste Cirúrgico:**
   - Criar rotina de disparo de validação que envia os dois balões formatados exclusivamente para o número `5511996242812`.
   - Zero mensagens enviadas para o grupo ou para clientes durante os testes.
   - O desenvolvedor recebe os balões no próprio celular para validar visualmente o resultado antes da rotina entrar em produção.

---

## 3. Riscos e Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Disparo acidental no grupo durante o teste | Ruído no canal de clientes | Trava explícita no script de teste fixando o alvo estritamente em `5511996242812` |
| Loja sem dado recente de CMV no SQLite | Exibição de N/A ou zero | Fallback inteligente lendo o último snapshot JSON de extração da loja |
| Formatação quebrando limites visuais no WhatsApp | Poluição na tela | Uso de listas nativas `- ` e negritos inline sem emojis decorativos |
