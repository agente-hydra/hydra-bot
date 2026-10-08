fetch('https://evo.tork.services/instance/fetchInstances', {
  headers: { apikey: 'TorkEvoApiKey2026Secure!' }
}).then(r => r.json()).then(data => {
  data.forEach(i => console.log(i.name.padEnd(20) + ' | Token: ' + (i.token || 'none') + ' | Status: ' + i.connectionStatus));
});
