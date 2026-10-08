const fs = require('fs');
let code = fs.readFileSync('scratch/worker_orig.js', 'utf-8');

const targetStr = 'await redis.del(`debounce:conv:${convId}`);';
const replacementStr = 'await redis.del(`debounce:conv:${convId}`);\n      await redis.del(`debounce_start:conv:${convId}`);';

const parts = code.split(targetStr);
console.log('Split into parts:', parts.length);
if (parts.length === 6) {
  const newCode = parts.join(replacementStr);
  fs.writeFileSync('scratch/worker_sliding.js', newCode, 'utf-8');
  console.log('Successfully created scratch/worker_sliding.js with 5 replacements!');
} else {
  console.error('Unexpected count of occurrences:', parts.length - 1);
  process.exit(1);
}
