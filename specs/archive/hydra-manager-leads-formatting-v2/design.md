# Design Técnico: Formatação Nativa Hydra para Notificações de Gerentes (v2)

## 1. Arquitetura de Formatação

Integração com `format_utils.ts` para composição de cards com tipografia WhatsApp:

```
[Parâmetros da Tool MCP]
           │
           ▼
[composeHydraLeadCard / composeHydraCancelCard]
           │
           ├─► Formatação de Telefone (11988887777 -> (11) 98888-7777)
           ├─► Sanitização Anti-Asterisco Duplo (sanitizeWhatsAppMarkdown)
           ├─► Aplicação de Banner de Teste Minimalista (se isTestOverride)
           ├─► Rodapé Temporal Oficial (_Central Mecânica Popular • DD/MM HH:mm_)
           │
           ▼
[Texto Formatado NATIVO WhatsApp]
           │
           ▼
[WhatsAppClient.sendText via Instância "atendimento"]
```

## 2. Layouts Comparativos

### Lead Agendado (Scheduled)
```text
[TESTE] Alvo real: Jorge Beretta (5511998874158)

NOVO AGENDAMENTO • JORGE BERETTA
Quarta-feira, 07/10 às 10:00

Cliente: Marcos Vinicius
WhatsApp: (11) 97777-8888
Veículo: Jeep Compass 2.0 Diesel • BRA2E19
Serviço: Troca de pastilhas de freio e óleo 5W30
Origem: Central / WhatsApp

Observações:
Lead originado no bot de conversão WhatsApp

_Central Mecânica Popular • 06/10 14:50_
```

### Agendamento Cancelado (Cancelled)
```text
[TESTE] Alvo real: Jorge Beretta (5511998874158)

CANCELAMENTO DE AGENDAMENTO • JORGE BERETTA
Quarta-feira, 07/10 às 10:00

Cliente: Marcos Vinicius
WhatsApp: (11) 97777-8888
Veículo: Jeep Compass 2.0 Diesel • BRA2E19
Motivo: Imprevisto no trabalho
Pretende reagendar: Sim

Observações:
Cliente pediu para entrar em contato na próxima semana

_Central Mecânica Popular • 06/10 14:50_
```

## 3. Regras de Composição de Balões
1. **Zero Emojis Poluídos:** Sem sirenes (`🚨`), sem relógios ou ícones soltos em cada linha.
2. **Separação por Blocos Visuais:** Quebras de linha duplas entre o cabeçalho do agendamento, o bloco de dados do cliente e as observações.
3. **Múltiplos Campos em Linha Compacta:** Se modelo e placa existirem, unificar com separador elegante (`Veículo: Modelo • PLACA`).
4. **Sanitização Automatizada:** Passar por `sanitizeWhatsAppMarkdown(texto)` antes do envio.
