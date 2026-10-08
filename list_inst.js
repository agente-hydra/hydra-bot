fetch('https://evo.tork.services/instance/fetchInstances', {
  headers: { apikey: 'TorkEvoApiKey2026Secure!' }
}).then(r => r.json()).then(data => {
  data.forEach(i => console.log(i.name.padEnd(25) + ' | Status: ' + (i.connectionStatus || '').padEnd(10) + ' | Phone: ' + (i.ownerJid || 'none')));
});
