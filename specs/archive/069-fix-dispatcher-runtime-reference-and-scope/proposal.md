# Proposta Técnica — Spec 069: Correção de ReferenceError e Escopo de Variáveis no Dispatcher em Produção

## 1. Problema Factual e Diagnóstico
Em consulta real no WhatsApp (`[16:27, 04/11/2026] Davi: troca de laampadas traseiras tracker 2023`), o bot retornou:
```
[16:27, 04/11/2026] Hydra Agent: Não consegui consultar os dados agora devido a uma oscilação na conexão com o banco. Pode tentar novamente em instantes?
```

### Causa Raiz Auditada nos Logs da VPS e no Código
1. **Mensagem de Erro Fallback no `webhook-listener.js`:**
   Em `webhook-listener.js:1058-1064`, quando o processo filho CLI (`agent_dispatcher_cli.ts`) falha com saída de erro (código de saída 1), o listener captura o erro e emite a resposta padrão:
   `"Não consegui consultar os dados agora devido a uma oscilação na conexão com o banco. Pode tentar novamente em instantes?"`.
   O banco SQLite WAL nunca oscilou; a falha foi uma exceção fatal não tratada dentro de `agent_dispatcher.ts`.

2. **`ReferenceError: isValidVehicleForPersistence is not defined`:**
   Ao receber a mensagem `troca de laampadas traseiras tracker 2023`, o classificador de intenções reconheceu corretamente o tempário técnico (graças à Spec 068) e encaminhou a requisição para a seção `3.0.4 TEMPÁRIO TÉCNICO HÍBRIDO AUTOMOTIVO` em `src/hydra-sync/agent_dispatcher.ts:1496`.
   Na linha 1514, o código executa:
   ```typescript
   if (!targetVeiculo || !isValidVehicleForPersistence(undefined, targetVeiculo))
   ```
   A função `isValidVehicleForPersistence` (definida em `tempario_graph_repository.ts`) **NUNCA foi importada** em `agent_dispatcher.ts`. O interpretador Node.js lançou `ReferenceError` imediato e abortou o processo.

3. **Temporal Dead Zone (TDZ) de `activeProfile`:**
   Na linha 518 de `agent_dispatcher.ts` (bloco de follow-up conversacional para placas pendentes), o código tenta acessar `activeProfile.persona`, porém a variável `activeProfile` só é declarada 700 linhas depois (na linha 1212). Qualquer mensagem de follow-up que caia nesse ramo causa um segundo `ReferenceError: Cannot access 'activeProfile' before initialization`.

4. **Propriedade Inexistente `veiculoIdentificado`:**
   Nas linhas 547 e 1679, o código tenta ler `queryResp.veiculoIdentificado`, que não existe na interface `TemparioHybridQueryResponse` (o correto é `queryResp.veiculo.modelo` ou `${queryResp.veiculo.marca} ${queryResp.veiculo.modelo}`).

5. **Lacuna no Build Gate:**
   `tsconfig.tempario.json` compilava apenas os módulos isolados do tempário, deixando `agent_dispatcher.ts` de fora da verificação estrita de símbolos.

---

## 2. Solução Proposta

### 2.1 Importação e Resolução de Símbolos em `agent_dispatcher.ts`
- Importar `isValidVehicleForPersistence` explicitamente de `./tempario_graph_repository.js`.

### 2.2 Resolução de Escopo e Eliminação da TDZ de `activeProfile`
- No bloco de vinculação conversacional (linhas 518-519), obter o perfil do usuário localmente via `getUserProfile(db, phone)` ou promover `const activeProfile = userProfile || getUserProfile(db, phone);` para o início do despacho em `dispatchOperationalQuery`.

### 2.3 Normalização de Propriedade de Veículo em `TemparioPendingContext`
- Substituir o acesso inválido `queryResp.veiculoIdentificado` pela resolução tipada:
  ```typescript
  const resolvedVehicleStr = queryResp.veiculo
    ? `${queryResp.veiculo.marca} ${queryResp.veiculo.modelo}`.trim()
    : (targetVeiculo || 'Veículo');
  ```

### 2.4 Teste de Integração E2E com `dispatchMessage`
- Criar a suite `test_harness_spec069_dispatcher_e2e.ts` que executa chamadas completas a `dispatchMessage` simulando a entrada do webhook listener:
  1. `"troca de laampadas traseiras tracker 2023"` -> Resposta com balão de tempário (0,40h / R$ 108,00), zero exceções.
  2. `"EUS5006 \n\ntroca de motor de partida"` -> Estimativa de referência imediata (1,10h / R$ 297,00), zero exceções.
  3. Turno 2 `"Palio 1.0 2012"` -> Vínculo da placa sem erro de inicialização de `activeProfile`.
  4. Seleção `"3"` -> Passo a passo da montagem.

### 2.5 Inclusão no Build Gate
- Garantir que `agent_dispatcher.ts` e seus testes passem pelo `tsc --noEmit`.

---

## 3. Contratos de Dados Afetados
- Sem quebra de contratos de API.
- Saída do dispatcher via CLI retorna JSON estruturado válido com `{ status: 'success', messages: [...] }` em vez de abortar com `{ error: '...' }`.

---

## 4. Riscos e Mitigações
- **Risco:** Regressão em outros comandos de pátio ou financeiro de `agent_dispatcher.ts`.
  - *Mitigação:* Executar testes E2E cobrindo tanto o tempário quanto os fluxos já consolidados de pátio e OS.
