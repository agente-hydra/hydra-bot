# Proposta: Implantação Isolada do DeskcommCRM na VPS (Multi-Domínio & Zero Conflito)

**Spec ID:** `deploy-deskcomm-crm-isolated-vps`  
**Data:** 22/10/2026  
**Status:** Planejamento (SDD Proposal)  
**Autor:** Antigravity AI  

---

## 1. Contexto & Diagnóstico da VPS

O usuário solicitou análise de viabilidade para hospedar o **DeskcommCRM** ([https://www.deskcomm.com.br/](https://www.deskcomm.com.br/) e [melgarafael/DeskcommCRM](https://github.com/melgarafael/DeskcommCRM)) na VPS de produção (`100.126.50.101`), respondendo às seguintes perguntas centrais:
1. *Dá para rodar no nosso servidor sem conflito com nada?*
2. *Em um ambiente isolado certinho?*
3. *Às vezes até em outro domínio?*

### Diagnóstico Factual do Ambiente Atual da VPS

A inspeção determinística do servidor revelou a seguinte infraestrutura:
- **Recursos de Hardware:**
  - **RAM Total:** 7,2 GiB | **Usada:** 2,3 GiB | **Livre/Disponível:** **4,8 GiB livres** (muito folgado).
  - **Disco Total:** 440 GB | **Usado:** 117 GB (28%) | **Livre:** **301 GB livres**.
- **Serviços em Execução na VPS:**
  - **Docker Compose Stack (`/opt/tork-stack/`):**
    - `traefik` (v3.7.9) na porta `80:80` conectado à bridge `tork-stack_internal`.
    - `cloudflared` (Cloudflare Tunnel Zero Trust) conectado à rede `tork-stack_internal`.
    - `chatwoot-rails` e `chatwoot-sidekiq` na porta interna `3000`.
    - `conciliamec-bot` na porta host `3001:3001`.
    - `evolution` (Evolution API v2.3.7) na porta interna `8080` (roteado via `evo.tork.services`).
    - `postgres` (`pgvector/pgvector:pg15`) na porta interna `5432`.
    - `redis` (Redis 7) na porta interna `6379`.
    - `minio` na porta interna `9001` (`minio.tork.services`).
  - **Processos Node do Host:**
    - `hydra-bot` (`webhook-listener.js` na porta 3333).
    - `watchdog-gateway` na porta 4100.
    - `sentinel` na porta 4200.

---

## 2. Respostas Diretas de Viabilidade

### 1. Dá para rodar sem conflito com nada?
**SIM, 100% VIÁVEL.**
- **Conflito de Portas 80/443:** O DeskcommCRM por padrão tenta subir um Caddy que publica `80:80` e `443:443`. Na nossa VPS, a porta 80 já é do Traefik. **Mitigação nativa:** O repositório do Deskcomm possui o arquivo oficial `docker-compose.traefik.yml` (e `docker-compose.cloudflared.yml`) que desativa o Caddy via perfil (`caddy-nao-usado-com-proxy-externo`) e delega o roteamento diretamente ao Traefik ou Cloudflare Tunnel.
- **Conflito da Porta 3000:** O Chatwoot já roda na porta interna 3000. O Deskcomm rodará em sua própria rede Docker interna (`deskcomm_internal`), expondo seu `app:3000` apenas para o Traefik/Cloudflared, **sem bind em 0.0.0.0 no host**.
- **Conflito de WhatsApp:** A Evolution API (instâncias `hydra` e `atendimento`) permanece 100% intocada. O Deskcomm utiliza o container WAHA (WhatsApp HTTP API via Baileys) em sua própria rede privada e volumes independentes.
- **Conflito de Banco:** O Deskcomm utiliza Supabase (PostgreSQL + pgvector + RLS). Utilizaremos um projeto Supabase Cloud gratuito (ou banco isolado dedicado), garantindo isolamento total de dados e schema em relação ao Postgres existente.

### 2. Em um ambiente isolado certinho?
**SIM, ISOLAMENTO HERMÉTICO.**
- Diretório raiz dedicado: `/opt/deskcomm/` (proprietário `operacional:operacional`).
- Rede Docker própria: `deskcomm_internal` (comunicação entre Next.js, WAHA, Redis e Workers sem contato com a rede host).
- Volumes de dados exclusivos: `/opt/deskcomm/data/waha-sessions`, `/opt/deskcomm/data/redis`, etc.
- Limite de memória via Docker cgroups: `mem_limit: 768m` no `app`, `512m` no `worker` e `1280m` no `waha` (consumo total médio de ~400-600 MB de RAM, perfeitamente comportado nos 4,8 GB livres da VPS).

### 3. Às vezes até em outro domínio?
**SIM, SUPORTE TOTAL A MÚLTIPLOS DOMÍNIOS INDEPENDENTES.**
- O Deskcomm pode ser configurado tanto sob o domínio principal (ex: `crm.tork.services`) quanto sob **qualquer outro domínio de cliente ou projeto** (ex: `atendimento.minhaempresa.com.br`, `app.deskcomm.com.br`, etc.).
- **Roteamento de Domínio Alternativo:**
  - **Via Cloudflare Tunnel (Recomendado):** Adiciona-se o domínio no Cloudflare Zero Trust e cria-se uma rota pública apontando para `http://traefik:80` com o Host correspondente. O SSL é emitido instantaneamente na borda da Cloudflare com proteção anti-DDoS e WAF.
  - **Via Traefik:** O Traefik inspeciona o cabeçalho `Host("crm.outrodominio.com.br")` e encaminha diretamente ao container do Deskcomm, gerenciando certificados Let's Encrypt automaticamente se o DNS apontar para o servidor.

---

## 3. Topologia de Arquitetura Proposta

```
                     [ Internet / Usuários / WhatsApp ]
                                      │
                                      ▼
               [ Cloudflare Edge / SSL / WAF / DDoS Protection ]
                                      │
                       (Cloudflare Tunnel Remoto)
                                      │
                                      ▼
             [ Traefik Ingress (v3.7.9) na VPS - Porta 80 ]
                  Host: crm.tork.services ou crm.outrodominio.com.br
                                      │
                                      ▼ (Rede Docker tork-stack_internal)
               ┌──────────────────────────────────────────────┐
               │         DESKCOMM CRM (Next.js 14)            │
               │   Container: deskcomm-app (Porta 3000)       │
               └──────────────┬────────────────┬──────────────┘
                              │ (Rede Privada) │ (Rede Privada)
                              ▼                ▼
                     ┌────────────────┐ ┌────────────────┐
                     │  WAHA Engine   │ │  Deskcomm IA   │
                     │  (WhatsApp)    │ │ Worker Engine  │
                     └────────────────┘ └────────────────┘
                              │                │
                              ▼                ▼
                     ┌────────────────┐ ┌────────────────┐
                     │ Sessões Locais │ │ Supabase Cloud │
                     │  (Volume Isol) │ │ (DB + Vector)  │
                     └────────────────┘ └────────────────┘
```

---

## 4. Contratos de Ambiente & Variáveis Críticas

Para garantir o funcionamento sem colisão, o arquivo `/opt/deskcomm/.env` será configurado com:
- `DOMAIN`: Domínio público desejado (ex: `crm.tork.services` ou customizado).
- `REVERSE_PROXY=traefik`: Desativa o Caddy interno para não colidir na porta 80.
- `TRAEFIK_NETWORK=tork-stack_internal`: Conecta o `app` à rede do Traefik da VPS.
- `TRAEFIK_ENTRYPOINT=web`: Utiliza a entrada HTTP/HTTPS gerenciada pelo Cloudflare Tunnel.
- `NEXT_PUBLIC_SUPABASE_URL` & `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Credenciais do projeto Supabase.
- `SUPABASE_SERVICE_ROLE_KEY`: Chave de administração de backend do Supabase.
- `WAHA_API_KEY`: Token seguro de comunicação interna entre Next.js e WAHA.
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`: Chaves de LLM para os agentes de atendimento.

---

## 5. Matriz de Riscos & Contenção

| Risco Identificado | Nível | Ação de Mitigação |
| :--- | :---: | :--- |
| **Colisão na porta 80 do Traefik** | Alto | Uso estrito de `docker-compose.traefik.yml` desativando o Caddy com `profiles: ["caddy-nao-usado-com-proxy-externo"]`. |
| **Colisão de portas internas (3000/3001)** | Médio | Zero publicação de portas no host (`ports:` omitido). Acesso exclusivo via Traefik por nome DNS interno. |
| **Colisão com Evolution API de lojas** | Alto | O WAHA roda em container isolado. A regra de segurança proíbe uso de números de gerentes; conexões feitas via QR code dedicado do Deskcomm. |
| **Estouro de Memória (OOM)** | Baixo | `mem_limit` estrito em todos os containers do Deskcomm (teto total de 2,5 GB, contra 4,8 GB disponíveis). |
| **Poluição do banco Postgres local** | Médio | Uso de Supabase Cloud para o Deskcomm, mantendo o Postgres da VPS isolado para Chatwoot e Evolution. |
