# Proposta de Arquitetura — Spec 067: Diagnóstico da API de Placas (APIBrasil) e Estimativa Imediata de Tempário para Placas Não Cadastradas

## 1. Diagnóstico Forense da "Permanência do Erro"

No teste realizado em **04/11/2026 às 11:18**, o usuário enviou:
```text
EUS5006 

troca de motor de partida
```
O agente respondeu com a mensagem de esclarecimento em 2 turnos:
```text
*HYDRA | Tempário Técnico & Mão de Obra*

> *Identificação de Placa Pendente — EUS5006*
- *Serviço solicitado:* motor de partida
- *Status no sistema:* Placa sem Ordem de Serviço anterior na rede e não localizada na base externa

Qual é o *modelo e ano* desse veículo (ex: *Corsa 1.4 2010*, *Palio 1.0 2012*, *Onix 1.0*)?
_Responda apenas o carro/ano que já vinculo à placa *EUS5006* e calculo a mão de obra exata (R$ 270,00/h)._
```

### Por que o usuário considerou isso um erro persistente?
1. **Falha Silenciosa de Autenticação/Cota da APIBrasil:**
   - O usuário havia fornecido o link e o token JWT da APIBrasil (`eyJ0eXAi...`) esperando que consultas de placas avulsas fossem resolvidas 100% no primeiro turno.
   - A investigação comprovou via requisições reais aos endpoints da APIBrasil que a conta do usuário (`mktfunil1@gmail.com` / `sub: 63058`):
     - `POST /api/v2/vehicles/dados` retorna **HTTP 404**: `{"error":true,"message":"Plano ativo não encontrado."}`.
     - `POST /api/v2/consulta/veiculos/credits` retorna **HTTP 402**: `{"error":true,"message":"Você não possui saldo suficiente para realizar essa consulta, por favor, recarregue seu saldo.","balance":"R$ 0,00"}`.
     - `GET /api/v2/devices` retorna `{"error":false,"message":"Você não possui um plano ativo...","data":[]}`.
   - O blog externo lido pelo usuário prometia "limite grátis", mas a APIBrasil exige contratação/ativação de plano ou recarga prévia de saldo. A chamada externa falha e retorna `null`.

2. **Bloqueio Operacional do Usuário (Orçamento no Vácuo):**
   - Ao receber `EUS5006 \n\ntroca de motor de partida`, como o veículo não foi localizado na base externa nem no ERP, o fluxo anterior da Spec 066 bloqueou a geração do tempário e **não entregou nenhum tempo ou valor de mão de obra**, exigindo que o operador da oficina responda o modelo do carro primeiro.
   - Na rotina real da oficina, o operador quer o preço e tempo de imediato: ele não quer um bate-e-volta de mensagens se o bot já sabe qual é o serviço (`troca de motor de partida`).

---

## 2. Solução Proposta

### Pilar 1: Estimativa Operacional de Referência Imediata (Non-Blocking Quote)
Quando uma placa válida for informada mas não constar no ERP nem na API externa (ou a API externa estiver sem saldo/plano):
- O bot **NÃO deixa o operador no vácuo**.
- O bot calcula e entrega **imediatamente no primeiro balão** a **Estimativa Operacional de Linha Passeio Padrão** para o serviço solicitado (`1,10h = R$ 297,00` a R$ 270,00/h para motor de partida).
- O balão já oferece os botões interativos do Progressive Disclosure (`1️⃣ Peças`, `2️⃣ Ferramentas e Torques`, `3️⃣ Passo a Passo`, `4️⃣ Completo`), permitindo navegação técnica instantânea.
- No mesmo card, convida o operador a refinar o carro (opcionalmente) para cravar o tempo exato e gravar o vínculo no cache.

### Pilar 2: Diagnóstico Transparente da API Externa
Em vez de dizer genericamente `"não localizada na base externa"`, o sistema inspeciona o código de retorno da APIBrasil:
- Se HTTP 402 ou mensagem de "saldo/plano":
  - Sinaliza no cabeçalho ou nota de auditoria: `(APIBrasil: conta sem plano ativo/saldo recarregado — app.apibrasil.io)`.
- Assim o administrador/sócio sabe exatamente a ação necessária para ativar a busca 100% automática, sem achar que o bot sofreu um bug de software.

### Pilar 3: Vínculo Conversacional Contínuo e Cache L1
- Se o operador responder o modelo no segundo turno (ex: `"Palio 1.0 2012"` ou `"Corsa 2010"`), o sistema grava `EUS5006 -> Fiat Palio` em `placa_lookup_cache` (`origem_dados = 'MANUAL'`) e reemite o card refinado.
- Consultas futuras da mesma placa respondem em < 2ms via SQLite WAL.

---

## 3. Contratos de Dados & Comportamento

### Balão Executivo Entregue no 1º Turno (Exemplo: `EUS5006 \n\ntroca de motor de partida`)
```text
*HYDRA | Tempário Técnico & Mão de Obra*

> *Placa EUS5006 · Motor de Partida (Estimativa de Referência)*
- *Serviços:* Substituição do Motor de Partida (Arranque)
- *Identificação veicular:* Placa não cadastrada no ERP (APIBrasil: conta sem plano ativo ou saldo). Aplicada referência padrão para veículos de passeio.

*Resumo de Mão de Obra (Taxa da Rede: R$ 270,00/h)*
- *Tempo líquido sugerido:* *1,10h (1h 6 min)* (Faixa típica: 0,90h a 1,40h)
- *Total Mão de Obra a Cobrar:* *R$ 297,00* (R$ 243,00 a R$ 378,00)
- *Complexidade técnica:* Média (4 etapas no grafo de acesso)

💡 _Deseja refinar para o modelo exato e salvar a placa EUS5006 no sistema? Responda o carro e ano (ex: Palio 1.0 2012, Corsa 1.4)._

*Deseja ver o detalhamento técnico?*
1️⃣ *Peças necessárias* (2 itens)
2️⃣ *Ferramentas de bancada e torques* (4 itens)
3️⃣ *Passo a passo da montagem* (sequência otimizada)
4️⃣ *Tudo completo* (relatório técnico integral)

_Responda com o número (1, 2, 3 ou 4) ou escreva o que precisa._
```

---

## 4. Riscos Principais e Mitigações

1. **Risco de Variação de Tempo por Modelo Específico:**
   - *Mitigação:* O card explicita a faixa típica de variação (`0,90h a 1,40h` / `R$ 243,00 a R$ 378,00`) e convida o operador a informar o modelo para cravar o tempo exato caso o carro seja de mecânica complexa (ex: importados ou motores transversais com acesso obstruído).
2. **Risco de Confusão do Usuário quanto ao Custo da APIBrasil:**
   - *Mitigação:* O diagnóstico transparente orienta claramente que a conta `mktfunil1@gmail.com` precisa de recarga na APIBrasil se a rede desejar consultas externas de placas desconhecidas totalmente automáticas.
