# Spec 058 — Pesquisa e evidências

Pesquisa realizada nesta conversa em 02/11/2026. Fontes online são mutáveis: registrar versões/commits efetivamente escolhidos na implementação. A skill Superpowers solicitada não foi encontrada no caminho anteriormente instalado nem na busca dos diretórios locais de skills/plugins; esta entrega não declara execução dessa skill.

## 1. Ambiente próprio

Leituras via SSH: recursos de CPU/memória/disco; módulos de identidade, mídia e ferramentas; contrato de papéis; script local de transcrição; presença de FFmpeg e Tesseract. Sem alterações de serviços, usuários, mensagens ou código na VPS.

Resultados: 4 CPUs, 7,2 GiB RAM, 3,4 GiB disponíveis, 2,2 GiB swap em uso na amostra. Existem componentes de mídia e autorização; reaproveitá-los é mais fundamentado do que instalar outra pilha inteira sem medir.

Papéis no contrato inspecionado: sócio, gerente e operador. O papel administrativo necessita implementação explícita. O guard tem um caminho permissivo quando não há segredo de webhook; sua ativação real ainda precisa ser verificada. A presença de código não certifica sua ligação ao processo em produção.

O usuário confirmou que o sistema de análise de conversas transcreve áudio corretamente. Isso prevalece como orientação de escopo: reaproveitar o caminho funcional, não propor reescrita por preferência técnica.

## 2. Fontes primárias consultadas

### Hermes

- [Configuração oficial](https://hermes-agent.nousresearch.com/docs/user-guide/configuration): documenta STT local, idioma e dicas de vocabulário; útil para integrar transcrição antes do raciocínio. Inspira o contrato do adaptador, sem exigir migrar o transcritor do Hydra.
- [Segurança oficial](https://hermes-agent.nousresearch.com/docs/user-guide/security): descreve autorização, isolamento, proteção de arquivos e credenciais. O backend local executa no host; containerização tem fronteiras próprias. Recomendação derivada: aplicar permissões também no SO e manter credenciais fora do coordenador.

### OpenClaw

- [Sandboxing](https://docs.openclaw.ai/gateway/sandboxing): execução isolada e limites de acesso. Um mount read-only não impede leitura/exfiltração de credenciais que sejam disponibilizadas ao agente.
- [Sandbox, tool policy e elevated](https://docs.openclaw.ai/gateway/sandbox-vs-tool-policy-vs-elevated): são controles distintos. Recomendação derivada: não oferecer escape de sandbox ou execução elevada ao coordenador Hydra.
- [Segurança](https://docs.openclaw.ai/gateway/security): referência para revisar fronteiras de confiança e permissões, sem presumir que usar um framework resolve isolamento multiusuário automaticamente.

### Áudio e visão

- [SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper): implementação local, CPU INT8 e benchmarks. Apenas opção futura de otimização se o transcritor existente demonstrar gargalo; não é mudança obrigatória.
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp): alternativa local. Mesma regra: medir antes de trocar.
- [Qwen3-VL](https://github.com/QwenLM/Qwen3-VL): processamento visual e amostragem de vídeo com controles de resolução/quadros. Candidato a benchmark, não promessa de rodar com qualidade/latência aceitável nesta VPS.
- [edge-tts](https://github.com/rany2/edge-tts): declara usar serviço online Microsoft Edge. Sem chave de API não significa offline. TTS de resposta não foi solicitado e fica fora do escopo obrigatório.

## 3. Reddit: relatos lidos e o que aproveitar

### Voz e latência

[Hermes + voice, what is your current setup?](https://www.reddit.com/r/hermesagent/comments/1t84lds/hermes_voice_what_is_your_current_setup/)

O autor relata latência mesmo com hardware forte; participantes descrevem Whisper/serviço compatível e TTS. Um comentário chama a solução de totalmente local, mas depois corrige que TTS usa API Microsoft. Isso mostra por que relatos devem ser confrontados com documentação e medidas. Aplicação ao Hydra: preservar o STT funcional, medir a cadeia inteira e não anunciar “grátis/offline” com base em ausência de chave.

### Coordenador e separação de desenvolvimento

[Thinking of pairing Hermes with my OpenClaw as a setup auditor](https://www.reddit.com/r/hermesagent/comments/1sflo4b/thinking_of_pairing_hermes_with_my_openclaw_as_a/)

O autor propõe separar pesquisa/auditoria de um executor de desenvolvimento privilegiado e manifesta preocupação com manutenção e agentes consumindo tokens entre si. Trata-se de proposta pessoal, não benchmark comprovado. Aplicação ao Hydra: um coordenador com ferramentas limitadas, orçamento por tarefa e desenvolvimento fora do assistente de produção; evitar agentes autônomos conversando sem limite.

## 4. Conclusões e incertezas

As escolhas desta spec são síntese de evidências próprias e fontes primárias; opiniões do Reddit servem como sinais de problemas, não como comprovação de superioridade de produto.

Falta medir: caminho ativo e latência do transcritor, recursos sob carga real, capacidades visuais disponíveis, modelo principal/provedor atual, confiabilidade do mapeamento de usuários, autenticação efetiva do webhook e fator adicional disponível para owner. A Fase 0 resolve esses itens sem atrasar a documentação dos contratos obrigatórios.

O diretório `/opt/hermes` existe, mas a listagem foi negada ao usuário SSH; não se concluiu sua versão, configuração nem se está ativo. Não elevar privilégios só para presumir que ele deve ser reutilizado.
