# SDD Design: Arquitetura de Remediação e Contenção do Pipeline Rede

## 1. Visão Geral da Arquitetura

O incidente ocorrido em 21/10/2026 evidenciou que a quebra operacional não foi fruto de uma falha irreversível no portal Rede, mas sim de uma sequência de:
1. Um timeout isolado de login matinal às 07:45;
2. Concorrência não tratada de processos Playwright;
3. Execução bem-sucedida (10/10 lojas às 08:55) que passou despercebida por rodar com `--skip-wa`;
4. Edição precipitada do código em produção por outro agente, introduzindo `headless: false` e seletores quebrados.

A arquitetura proposta restaura a estabilidade canônica do scraper e adiciona camadas defensivas determinísticas.

```
┌────────────────────────────────────────────────────────────────────────┐
│                   PIPELINE DE CONTENÇÃO HYDRA REDE                    │
└────────────────────────────────────────────────────────────────────────┘
                                 │
                     1. Verificação de Idempotência
                                 │
             ┌───────────────────┴───────────────────┐
             ▼                                       ▼
    [10/10 Já Auditado Hoje?]              [Extração Necessária]
             │                                       │
     SIM     │                                       │ NÃO
             ▼                                       ▼
  Pular Browser Playwright               2. Trava de Singleton (/tmp/hydra_rede.lock)
  Reutilizar Excel Canônico                          │
             │                           3. Launch Playwright (headless: true)
             │                           4. Login com Retry Exponencial
             │                           5. Loop Canônico de Lojas (Home -> Perfil -> Change)
             │                           6. Auditoria Matemática (374 Fórmulas, R$ 0,00 Dif)
             │                                       │
             └───────────────────┬───────────────────┘
                                 │
                     7. Despacho Seguro WhatsApp
                                 │
             ┌───────────────────┴───────────────────┐
             ▼                                       ▼
      [Ambiente de Teste]                     [Ambiente de Produção]
      Destino: DEV_NUMBER (11996242812)       Destino: Grupo / Financeiro
      Remetente: 'hydra'                      Remetente: 'hydra'
```

---

## 2. Componentes & Modificações Detalhadas

### 2.1 Restauração Canônica de `scraper.js`
O arquivo `/home/operacional/hydra-rede/src/scraper.js` será restaurado a partir do snapshot canônico `/home/operacional/hydra-rede/src/scraper.js.bak_sdd_oct21` (que provou sucesso 10/10 lojas entre 08:46 e 08:55 hoje), incorporando melhorias pontuais de resiliência:

1. **Garantia Inviolável de Headless:**
   ```javascript
   const isHeadless = process.env.HEADLESS !== 'false'; // Padrão SEMPRE true em Linux
   const browser = await chromium.launch({
     headless: isHeadless,
     args: [
       '--disable-blink-features=AutomationControlled',
       '--no-sandbox',
       '--disable-setuid-sandbox',
       '--disable-dev-shm-usage',
       '--disable-gpu'
     ]
   });
   ```

2. **Login com Retry Defensivo:**
   Em vez de abortar na primeira tentativa se `a.icon_usuario_perfil` demorar mais de 45s:
   - Timeout do primeiro waitFor: 30s;
   - Se falhar, checa se há mensagem de erro de credenciais ou overlay de manutenção;
   - Se não houver erro fatal, recarrega a página (`page.reload()`) e re-tenta o preenchimento de login uma 2ª vez;
   - Se ainda assim falhar, salva screenshot em `logs/login_error_YYYY-MM-DD.png` antes de lançar a exceção.

3. **Seletor de Estabelecimentos Estável:**
   Manter a rota canônica e comprovada:
   ```javascript
   if (!page.url().includes('/home')) {
     await page.goto('https://meu.userede.com.br/home', { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {});
     await page.waitForTimeout(3000);
   }
   await limparOverlays(page);

   // Dropdown de perfil
   const perfilLocator = page.locator('a.icon_usuario_perfil, a.dropdown-toggle.icon_usuario_perfil, [class*="icon_usuario_perfil"]').first();
   await perfilLocator.waitFor({ state: 'visible', timeout: 20000 });
   await perfilLocator.click({ force: true });
   await page.waitForTimeout(1500);

   // Link trocar estabelecimento
   const changeLocator = page.locator('a.changebrand, a[class*="changebrand"]').first();
   await changeLocator.waitFor({ state: 'visible', timeout: 20000 });
   await changeLocator.click({ force: true });
   await page.waitForTimeout(3500);

   // Seleção do radio da loja via ID #child-${ec}
   // Confirmação via button.changeApplyButton
   ```

---

### 2.2 Mecanismo de Lockfile Anti-Concorrência (`/tmp/hydra_rede.lock`)

Para impedir que processos simultâneos concorram pela mesma sessão do Playwright ou encerrem o contexto uns dos outros (`Target page closed`):

```javascript
import fs from 'fs';

const LOCK_FILE = '/tmp/hydra_rede.lock';

export function acquireRedeLock() {
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf-8').trim(), 10);
      // Checa se o processo ainda está rodando
      process.kill(pid, 0);
      throw new Error(`[Lock] Processo Playwright Rede já em execução (PID ${pid}). Abortando concorrência.`);
    } catch (e) {
      if (e.code === 'ESRCH') {
        // PID morreu, lock é órfão (stale)
        fs.unlinkSync(LOCK_FILE);
      } else {
        throw e;
      }
    }
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  
  const cleanup = () => {
    try { if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE); } catch (_) {}
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(1); });
  process.on('SIGTERM', () => { cleanup(); process.exit(1); });
}
```

---

### 2.3 Idempotência e Aproveitamento de Extração

No `index.js` e no orquestrador `run_unified_morning_dispatch.js`:
- Antes de subir o Playwright, o sistema inspeciona se para a data alvo já existe `/home/operacional/hydra-rede/output/Juros Rede - DD-MM-YYYY.xlsx` e `/home/operacional/hydra-rede/logs/audit_YYYY-MM-DD.json` com `status: "OK"` e `10/10` lojas válidas.
- Se já existir e o usuário não passou `--force-reextract`, reaproveita imediatamente o arquivo auditado, eliminando atrasos e riscos de re-scrape desnecessário.

---

### 2.4 Resiliência de Sincronização do Quinteto Matinal

O `run_unified_morning_dispatch.js` é executado às 07:45. Hoje, o `Mapa de Metas` só ficou pronto às 08:47 porque o job anterior atrasou.
- Implementação de um loop de polling defensivo: entre 07:45 e 08:05, se faltar 1 dos 5 relatórios, o orquestrador aguarda até 3 ciclos de 120s antes de decretar bloqueio definitivo.
- Caso persista faltando após as 08:05, emite alerta detalhado para o Dev especificando exatamente qual job faltou.

---

### 2.5 Limpeza e Higienização do Diretório

Todos os arquivos ad-hoc criados no calor do incidente serão expurgados da VPS:
- `src/patch_definitivo.js`
- `src/patch_scraper.js`
- `src/patch_v2.js`
- `src/reset_maua_down.js`
- `src/test_direct_switch_vendas.js`
- `src/test_home_return.js`
- `src/test_modal_trigger.js`
- `src/test_multi_switch.js`
- `src/test_search_modal.js`
- `src/test_vendas_header.js`
- `src/inspect_juros_debug.js`
- `src/inspect_modal_html.js`
- `src/inspect_rede_modal.js`

Isso restaura o estado limpo e auditável do repositório `/home/operacional/hydra-rede`.

---

## 3. Matriz de Segurança e Riscos

| Risco | Probabilidade | Severidade | Mitigação |
|---|---|---|---|
| Envio indevido para gerentes ou grupos durante teste | Média | Extrema | Trava no código: ambiente de teste envia única e exclusivamente para `5511996242812`. Instâncias permitidas: estritamente `hydra`. |
| Nova quebra na interface da Rede durante a troca de lojas | Baixa | Alta | Scraper volta à versão comprovada de 10/10 lojas, com navegação explícita via `/home` e `a.changebrand`. |
| Travamento de processos em background | Média | Média | Trava de lockfile `/tmp/hydra_rede.lock` com verificação de PID vivo/morto. |
| Inconsistência nos cálculos da planilha de Juros | Muito Baixa | Alta | A auditoria matemática cruzada com 374 fórmulas e tolerância R$ 0,00 continua obrigatória antes do despacho. |
