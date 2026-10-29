# Proposta: Sistema Universal e Resiliente de Reconexão de WhatsApp (10 Lojas) com Hub Central e Notificação em Grupo

**ID da Spec:** `051-hydra-rede-universal-qr-watchdog-resilience`  
**Data:** 29/10/2026  
**Status:** PROPOSTA / AGUARDANDO APROVAÇÃO (`/vibe-apply 051-hydra-rede-universal-qr-watchdog-resilience`)  
**Target:** VPS Linux Operacional (`100.126.50.101`) / Evolution API v2 (`evo.tork.services`) / Node.js 22 LTS  

---

## 1. Problema Observado e Requisitos

1. **Instabilidade por Ação Humana e Oscilações nas 10 Lojas:**
   - As 10 unidades da rede (Planalto, Piraporinha, Mauá, Kennedy, Rudge Ramos, Jorge Beretta, Dom Pedro, Jabaquara, Santo André e Rei do Módulo) utilizam WhatsApp conectado via Baileys na Evolution API.
   - Freqüentemente, gerentes desconectam o aparelho manualmente (`disconnectionReasonCode: 401 device_removed`) ou ocorrem flaps transitórios de socket (`408` timeout, `515` restart required).
2. **Riscos de Gargalo, Sobrecarga e Banimento (Thundering Herd / Spam):**
   - Se o sistema checar 10 lojas ao mesmo tempo via `Promise.all`, causa picos de CPU, gargalo no Prisma/PostgreSQL da Evolution API e esgotamento de conexões.
   - Se a página web fizer chamadas simultâneas a `/instance/connect/:instance`, o Baileys invalida as chaves criptográficas a cada requisição, tornando o QR Code da tela inválido antes da câmera escanear.
   - Enviar mensagens automáticas a cada 30 segundos no WhatsApp acarreta **banimento sumário do número do robô Hydra pela Meta**.
3. **Visibilidade para a Gestão e Alertas em Grupo:**
   - A diretoria e a TI precisam saber no **Grupo Oficial Mecânica TI** (`120363425738307789@g.us`) imediatamente quando uma loja cai, saber que o link já foi despachado no privado do gerente, e receber confirmação automática assim que ela reconectar.
   - Diariamente às 07:30 da manhã, o grupo deve receber um panorama consolidado da saúde das 10 instâncias.

---

## 2. Arquitetura da Solução

O sistema opera em 4 pilares autônomos e desacoplados:

### Pilar 1: Hub Central e Páginas Web Live Ultra-Leves (`https://bot.tork.services/qr`)
- **Hub Geral (`/qr`):** Dashboard executivo em Dark Mode listando os cards das 10 lojas da rede com badges em tempo real (`Online`, `Conectando`, `Desconectado`). Apenas lojas desconectadas exibem o botão *"Escanear QR Code"*.
- **Página da Loja (`/qr/:slug`):** Página leve (<15KB, zero dependências externas) que busca o QR Code e realiza auto-refresh a cada 12 segundos sem recarregar a tela (sem F5). Assim que o celular lê o código, a tela congela e exibe um banner verde comemorativo: *"🎉 Conectado com Sucesso!"*.
- **Cache Single-Flight:** TTL de 9 segundos em memória para que múltiplos acessos web concorrentes compartilhem a mesma resposta, gerando **zero chamadas redundantes** contra a Evolution API.

### Pilar 2: Watchdog Sequencial com Pacing e Auto-Healing
- **Varredura Suave (Anti-Stampede):** Fila estritamente sequencial com intervalo de **2.500ms ± 500ms de jitter** entre cada loja (ciclo suave de ~25 segundos para as 10 lojas).
- **Tratamento Semântico de Estados:**
  - `open`: Instância saudável. Não gera QR Code, limpa cache.
  - `connecting`: Sincronização em andamento. Não interrompe o handshake (respeita até 45s de zombie timeout).
  - `close (transitório: 408, 428, 515)`: Aciona auto-healing com `POST /instance/restart/:instance` (recupera >80% sem novo QR).
  - `close (permanente: 401 device_removed)`: Aciona o fluxo de reconexão por QR Code.

### Pilar 3: Governança de Mensageria Privada com Gerentes (Anti-Spam)
- **Remetente Obrigatório:** Exclusivamente `hydra` (`5511917837618`) ou fallback `atendimento`. Proibição absoluta de instâncias de gerentes como remetentes.
- **Destinatário:** Apenas o número oficial conectado na instância da respectiva loja.
- **Janela Operacional:** 07:30 às 19:30 (dias úteis e sábados).
- **Cadência Controlada:** Intervalo mínimo de 15 minutos entre lembretes privados, com **teto máximo de 3 disparos por incidente**.

### Pilar 4: Notificações em Grupo e Panorama Diário Matinal
- **Grupo Target:** `120363425738307789@g.us` (*Grupo Oficial Mecanica TI*).
- **Aviso de Queda:** 1 único aviso no momento da queda (com filtro de flap de 30s): informa qual loja caiu, o número e que o link já foi entregue no privado.
- **Aviso de Sucesso:** 1 confirmação comemorativa assim que o status virar `open`, indicando o tempo total de inatividade.
- **Painel Matinal (07:30 BRT):** Card diário consolidando a situação das 10 lojas (`10/10 Conectadas ✅` ou lista de pendências com link direto).

---

## 3. Contratos de Dados e APIs

### 3.1. Endpoints do Serviço Web
- `GET /qr`: Painel Geral da Rede (HTML)
- `GET /qr/api/status`: JSON com status consolidado das 10 lojas
- `GET /qr/:slug`: Tela individual da loja (HTML)
- `GET /qr/api/:slug`: JSON com QR Code base64 e status da loja

### 3.2. Mapeamento Canônico das 10 Lojas
| Slug | Nome da Loja | Instância Evolution | Número Canônico | Gerente |
|---|---|---|---|---|
| `planalto` | Planalto | `Planalto` | `5511984325302` | ROBERTO AQUINO |
| `piraporinha` | Piraporinha | `pira` | `5511983012850` | ANDERSON DA SILVA |
| `maua` | Mauá | `Maua` | `5511984324928` | MARCELO RIBEIRO |
| `kennedy` | Kennedy | `Kennedy` | `5511984926600` | PAULO HENRIQUE |
| `rudge` | Rudge Ramos | `Rudge` | `5511947439443` | LUCAS MORENO |
| `jorgeberetta` | Jorge Beretta | `Jorge Beretta` | `5511998874158` | ERICK MICAEL FERREIRA SILVA |
| `dompedro` | Dom Pedro I | `Dom Pedro` | `5511963717410` | MARCO ANTONIO PERRELLA |
| `jabaquara` | Jabaquara | `Jabaquara` | `5511933733131` | VANESSA FRAVETTO |
| `carijos` | Santo André (Carijós) | `Carijós` | `5511918734422` | ALESSANDRO TADINI NOVELLI |
| `reidomodulo` | Rei do Módulo | `REI DO MODULO` | `5511950614929` | Central Rei do Módulo |

---

## 4. Riscos Principais & Mitigações

| Risco | Impacto | Mitigação Arquitetural |
|---|---|---|
| **Esgotamento de Sockets TCP** | Trava Event Loop do Node.js | Timeout rígido de 5.000ms (`AbortSignal`) e pool `https.Agent` com maxSockets = 10. |
| **Thundering Herd no Baileys** | Chaves invalidadas e QR inválido | Single-Flight Request Locking + Cache TTL 9s por loja. |
| **Banimento por Spam na Meta** | Queda do robô oficial Hydra | Cooldown de 15 min, máx 3 disparos privados por dia, e apenas 1 aviso no grupo. |
| **Oscilação Rápida de Rede (Flapping)** | Mensagens repetitivas no grupo | Flap filter de 30 segundos contínuos antes de emitir qualquer alerta. |
