const EVOLUTION_URL = 'https://evo.tork.services';
const EVOLUTION_KEY = 'TorkEvoApiKey2026Secure!';

async function test() {
  const instances = ['hydra', 'atendimento', 'Maua'];
  for (const inst of instances) {
    try {
      const res = await fetch(`${EVOLUTION_URL}/message/sendText/${inst}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': EVOLUTION_KEY
        },
        body: JSON.stringify({
          number: '5511996242812',
          text: `Teste de envio via node script (${inst})`
        })
      });
      console.log(`Instancia: ${inst} | Status: ${res.status} | Text: ${(await res.text()).slice(0, 100)}`);
    } catch (e) {
      console.error(`Instancia: ${inst} | Erro:`, e.message);
    }
  }
}
test();
