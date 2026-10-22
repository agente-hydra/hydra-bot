# SDD Design: Arquitetura da Atualização Horária e Resiliência Matinal Hydra

## 1. Topologia do Pipeline Proposto

```
┌────────────────────────────────────────────────────────────────────────┐
│             CICLO HORÁRIO CONTÍNUO (24/7 - ZERO MENSAGENS)            │
└────────────────────────────────────────────────────────────────────────┘
  Minuto :05 ───► Hourly Finance Worker (Metas & CMV) ──► SQLite WAL
  Minuto :15 ───► Hourly Yard/OS Incremental Worker   ──► SQLite WAL
  Minuto :25 ───► Hourly Contas a Pagar Ingestion     ──► SQLite WAL
       │
       ▼
┌────────────────────────────────────────────────────────────────────────┐
│             ESTEIRA PRÉ-MATINAL (06:30 ÀS 07:35 AM)                   │
└────────────────────────────────────────────────────────────────────────┘
  06:30 AM ───► Deep Crawler Noturno (Mapa de Metas PDF & OS Freshness)
  07:00 AM ───► Playwright Rede Scraper (Headless, Singleton Lock, Retry)
  07:30 AM ───► Pré-Geração de Relatórios Derivados:
                ├── Carros em Patio - DD-MM-AAAA.xlsx
                └── Conciliacao Patio x Rede - DD-MM-AAAA.xlsx
  07:35 AM ───► Pre-Flight Health Gate:
                ├── 5/5 arquivos íntegros e frescos (< 2h)?
                └── Se FALHAR: Alerta imediato ao Dev (+55 11 99624-2812)
       │
       ▼
┌────────────────────────────────────────────────────────────────────────┐
│             DESPACHO MATINAL OFICIAL (07:45 ÀS 08:00 AM)              │
└────────────────────────────────────────────────────────────────────────┘
  07:45 AM ───► Verificação de Integridade (Sem scraping pesado em cima da hora)
  08:00 AM ───► Disparo Pontual via Instância 'hydra' (+55 11 94066-7032)
```

---

## 2. Componentes & Modificações Arquiteturais

### 2.1 Escalonamento Não-Concorrente do Cron na VPS (`crontab -l`)

Para eliminar o colapso por disputa do lock `/tmp/hydra-data-refresh.lock`:

```cron
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# 1. CICLO HORÁRIO CONTÍNUO (Escalonado por minutos - Zero WhatsApp)
# Minuto :05 - Financeiro (Metas + CMV)
5 * * * * /home/operacional/hydra/scripts/run-hydra-hourly-finance.sh

# Minuto :15 - Pátio & OS Incremental (Atualiza timestamps de frescor das 10 lojas)
15 * * * * /home/operacional/hydra/scripts/run-hydra-hourly-patio.sh

# Minuto :25 - Contas a Pagar (Ingestão silenciosa no banco)
25 * * * * /home/operacional/hydra-rede/scripts/run-hourly-contas.sh

# 2. ESTEIRA NOTURNA DE DEEP CRAWLER & RETRIES (Horários de vale sem colisão)
# 23:30, 02:30, 05:30 - Deep Crawler completo (OS granular + PDF Mapa de Metas)
30 23,2,5 * * * /home/operacional/hydra-rede/scripts/run-nightly-prep.sh >> /home/operacional/hydra-data/logs/nightly-prep-cron.log 2>&1

# 3. PRE-FLIGHT MATINAL (Aquecimento antecipado com folga operacional)
# 06:45 AM - Garante Mapa de Metas e Pátio atualizados antes das 07h
45 6 * * 1-5 /home/operacional/hydra-rede/scripts/run-nightly-prep.sh >> /home/operacional/hydra-data/logs/nightly-prep-cron.log 2>&1

# 07:05 AM - Extração Antecipada da Rede (com 40 min de folga até o envio)
5 7 * * 1-5 /home/operacional/hydra-rede/scripts/run-preflight-rede.sh >> /home/operacional/hydra-data/logs/preflight-rede.log 2>&1

# 4. DESPACHO MATINAL OFICIAL (Apenas validação e entrega silenciosa)
45 7 * * 1-5 /home/operacional/hydra-rede/scripts/run-unified-morning.sh >> /home/operacional/hydra-data/logs/matinal-trio.log 2>&1

# 5. GRADE DE BALÕES NO WHATSAPP (Horários preservados)
40 7 * * 1-5 /usr/bin/node /home/operacional/hydra-rede/src/run_group_balloon_dispatch.js --balloon=2 --mode=full --immediate >> /home/operacional/hydra-data/logs/baloes-grupo.log 2>&1
0 9 * * 1-5 /usr/bin/node /home/operacional/hydra-rede/src/run_group_balloon_dispatch.js --balloon=1 --immediate >> /home/operacional/hydra-data/logs/baloes-grupo.log 2>&1
0 14 * * 1-5 /usr/bin/node /home/operacional/hydra-rede/src/run_group_balloon_dispatch.js --balloon=2 --mode=simplified --immediate >> /home/operacional/hydra-data/logs/baloes-grupo.log 2>&1
0 15 * * 1-5 /usr/bin/node /home/operacional/hydra-rede/src/run_group_balloon_dispatch.js --balloon=1 --immediate >> /home/operacional/hydra-data/logs/baloes-grupo.log 2>&1
```

---

### 2.2 Worker Horário de Pátio & OS (`run-hydra-hourly-patio.sh`)

Script leve executado a cada 1 hora para sincronizar o status das OSs abertas de cada uma das 10 lojas:
- Conecta no banco `hydra_ops.db`.
- Atualiza o snapshot JSON em `/home/operacional/hydra-data/crawls/` registrando o `last_sync_timestamp`.
- Garante que a verificação de frescor (`[Adapter] ⛔ BLOQUEIO DE FRESCOR`) nunca estoure o limite de 12 horas durante a manhã, pois a base terá dados de no máximo 60 minutos atrás.

---

### 2.3 Expurgar Totalmente o "Espelhamento Fantasma" de Arquivos Velhos

No arquivo `/home/operacional/hydra-rede/src/run_unified_morning_dispatch.js`:

#### CÓDIGO CORROMPIDO A SER REMOVIDO:
```javascript
// REMOVER COMPLETAMENTE:
if (!fs.existsSync(jurosHojePath)) {
  const outputDir = path.join(BASE_DIR, 'output');
  if (fs.existsSync(outputDir)) {
    const jurosCands = fs.readdirSync(outputDir).filter(f => f.startsWith('Juros Rede - ') && f.endsWith('.xlsx'));
    if (jurosCands.length > 0) {
      jurosCands.sort().reverse();
      const maisRecente = path.join(outputDir, jurosCands[0]);
      fs.copyFileSync(maisRecente, jurosHojePath); // <-- NUNCA MAIS FAZER ISSO!
    }
  }
}
```

#### NOVO COMPORTAMENTO DETERMINÍSTICO:
```javascript
// Se o arquivo da data-alvo não existir ou tiver sido gerado para outra data:
if (!fs.existsSync(jurosHojePath)) {
  log(`⛔ ERRO CRÍTICO: Planilha de Juros da Rede ausente para a data ${dateTagBR}.`);
  log(`PROIBIÇÃO DE FALLBACK: É estritamente proibido espelhar planilhas de datas anteriores.`);
  
  // Registrar bloqueio e emitir alerta técnico imediato para o Dev
  await notificarDevFalhaCritica({
    modulo: 'JUROS_REDE',
    dataAlvo: dateTagBR,
    motivo: 'Arquivo ausente e extração falhou. Despacho retido para evitar dados incorretos.'
  });
  return;
}
```

---

### 2.4 Resolução Estrita de Fim de Semana (Segunda-Feira)

Na segunda-feira, a janela operacional oficial compreende:
- Sexta-feira anterior ($D-3$);
- Sábado ($D-2$);
- Domingo ($D-1$).

O módulo de Juros Rede e Conciliação validará:
1. Se as transações da Rede contêm registros com data de transação dentro de $[D-3, D-1]$.
2. Rejeição explícita se houver contaminação com dados de Quinta-feira ($D-4$) ou datas anteriores.

---

### 2.5 Pre-Flight Rede: Extração com Antecedência (07:05 AM)

O script `/home/operacional/hydra-rede/scripts/run-preflight-rede.sh`:
- Dispara `node src/index.js --build-only --now` às **07:05 AM**.
- Como possui o lock `/tmp/hydra_rede.lock`, roda isolado e sem concorrência.
- Se o portal Rede estiver instável, aciona os retries de login e o auto-healing às 07:10 AM.
- Quando o orquestrador matinal rodar às 07:45 AM, encontrará o arquivo `Juros Rede - DD-MM-AAAA.xlsx` **já gerado, auditado e integro em `output/`**, sem precisar abrir o browser no momento do despacho.
