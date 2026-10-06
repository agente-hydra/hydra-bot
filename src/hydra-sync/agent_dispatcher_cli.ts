import { dispatchMessage, DispatcherInput } from './agent_dispatcher.js';

async function main() {
  const rawArgs = process.argv.slice(2);
  let inputRaw = rawArgs.join(' ');
  if (rawArgs[0] && (rawArgs[0].endsWith('.ts') || rawArgs[0].endsWith('.js'))) {
    inputRaw = rawArgs.slice(1).join(' ');
  }

  if (!inputRaw || !inputRaw.trim()) {
    console.error(JSON.stringify({ error: 'Nenhum payload fornecido' }));
    process.exit(1);
  }

  try {
    let input: DispatcherInput;
    if (inputRaw.trim().startsWith('{')) {
      input = JSON.parse(inputRaw);
    } else {
      input = { phone: '5511999999999', message: inputRaw.trim() };
    }
    const result = await dispatchMessage(input);
    console.log(JSON.stringify(result, null, 2));
  } catch (err: any) {
    console.error(JSON.stringify({ error: err.message || String(err) }));
    process.exit(1);
  }
}

main();
