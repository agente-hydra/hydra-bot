# Proposta: Watchdog Autônomo de Reconexão de Instâncias Evolution e Despacho de QR Code

**ID da Spec:** `050-hydra-evolution-instance-reconnect-watchdog`  
**Data:** 29/10/2026  
**Status:** PROPOSTA / AGUARDANDO APROVAÇÃO (`/vibe-apply 050-hydra-evolution-instance-reconnect-watchdog`)  
**Target:** VPS Linux Operacional (`100.126.50.101`) / Evolution API v2 (`evo.tork.services`) / Node.js 22 LTS  

---

## 1. Problema Observado

1. **Instância Instável por Ação Humana:** A instância `REI DO MODULO` (número `5511950614929`) desconecta repetidamente por ação manual no celular (`disconnectionReasonCode: 401`, payload Baileys `conflict: device_removed`).
2. **Ciclo de Inatividade e Falta de Visibilidade:** Quando a instância cai, os alertas de CMV, relatórios matinais de pátio e despachos operacionais ficam retidos ou falham em silêncio até que alguém perceba no painel da Evolution.
3. **Desafio Operacional do QR Code em Tela Única:** 
   - Um QR Code de WhatsApp expira a cada ~25 a 35 segundos.
   - Enviar a imagem do QR Code exclusivamente para o WhatsApp do celular do próprio gerente inviabiliza o escaneamento caso ele não tenha um segundo aparelho ou computador por perto para mirar a câmera.
   - Ficar enviando imagens continuamente em polling rápido (ex: a cada 30 segundos) causa **banimento imediato do robô Hydra por spam de mídia** perante as políticas anti-flood do WhatsApp e da Meta.

---

## 2. Solução Proposta: Tríplice Automação Resiliente

Para resolver sem erro, sem risco de banimento e com usabilidade real:

1. **Watchdog Daemon no PM2 da VPS (`hydra-reconnect-watchdog`):**
   - Roda em background na VPS como serviço gerenciado pelo PM2.
   - Monitora o estado de conexão das 10 instâncias operacionais da rede via endpoint oficial `GET /instance/fetchInstances` a cada 60 segundos.
   - Detecta transição de `open` para `close` ou `connecting` travado.

2. **Disparo Controlado via Instância Emissora Oficial (`hydra`):**
   - Remetente exclusivo: Instância `hydra` (`5511917837618`). **Proibição absoluta de envio por instâncias de gerentes.**
   - Destinatário: O número do responsável cadastrado (`5511950614929`) e/ou central de suporte.
   - **Regra Anti-Spam (Circuit Breaker):**
     - Ao cair: envia o 1º alerta com a imagem do QR Code atualizado e um link web live.
     - Próximos envios automáticos: cadência espaçada com backoff inteligente (intervalo de 3 a 5 minutos, máximo de 3 tentativas automáticas por incidente).
     - Assim que o estado mudar para `open`, cancela o loop imediatamente e envia notificação de sucesso: *"✅ Instância REI DO MODULO reconectada com sucesso!"*.

3. **Página Web Live de Auto-Refresh (`/qr/:instance`):**
   - Endpoint HTTP ultra-leve na VPS que serve uma página HTML limpa para o gerente abrir no computador da loja.
   - A página consulta a Evolution API e atualiza o QR Code via JavaScript a cada 15 segundos enquanto a instância estiver em `close`.
   - Quando o gerente mira o celular na tela do PC e conecta, a página exibe um selo verde de sucesso em tempo real e para o polling.

4. **Comando Sob Demanda no WhatsApp (`/qr reidomodulo` ou `/reconectar`):**
   - Permite que o gerente ou sócio solicite um QR Code fresco no chat com o robô Hydra a qualquer instante, sem precisar esperar o ciclo do cron.

---

## 3. Contratos de Dados e APIs

### 3.1. Consulta de Estado e QR Code na Evolution API
- **Checagem de Estado:** `GET https://evo.tork.services/instance/connectionState/:instance`
- **Geração do QR Code Fresco:** `GET https://evo.tork.services/instance/connect/:instance`
  - Resposta: `{ base64: "data:image/png;base64,...", code: "...", count: N }`

### 3.2. Envio de Mídia via Hydra
- **Endpoint:** `POST https://evo.tork.services/message/sendMedia/hydra`
  - Payload:
    ```json
    {
      "number": "5511950614929",
      "mediaMessage": {
        "mediatype": "image",
        "fileName": "qrcode-reidomodulo.png",
        "caption": "⚠️ *REI DO MÓDULO | RECONEXÃO DE WHATSAPP*\n\nA sessão foi desconectada.\n1. Abra este QR Code no computador ou aponte a câmera do WhatsApp.\n2. Link ao vivo que atualiza sozinho: https://tork.services/qr/reidomodulo\n\n_Válido por 30 segundos. Se expirar, clique no link acima ou digite /qr._",
        "media": "data:image/png;base64,..."
      }
    }
    ```

---

## 4. Riscos Principais & Mitigações

| Risco | Impacto | Mitigação Arquitetural |
|---|---|---|
| **Flood de Imagens no WhatsApp** | Banimento da instância `hydra` pela Meta | Cooldown estrito: máx. 1 imagem automática a cada 3 minutos, com teto de 3 disparos por incidente. |
| **QR Code Expirado no Celular** | Gerente tenta ler imagem de 2 min atrás e falha | Acompanha link web live com auto-refresh a cada 15s e comando `/qr` sob demanda. |
| **Loop Infinito se Loja Estiver Fechada** | Disparos à noite ou fim de semana | Horário comercial restrito (07:30 às 19:30 em dias úteis). |
| **Envio com Remetente Indevido** | Violação de diretriz de mensageria | Trava rígida: apenas `hydra` como emissora, validada antes de qualquer chamada HTTP. |
