import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';
const webRoot = fileURLToPath(new URL('../', import.meta.url));
try {
  loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const directory = path.join(webRoot, '.next', 'static');
if (!fs.existsSync(directory))
  throw new Error(
    'Build the web application before checking its client bundle',
  );
const names = [
  'DATABASE_URL',
  'VALKEY_URL',
  'ENCRYPTION_KEY',
  'SESSION_SECRET',
  'ENCRYPTION_PREVIOUS_KEYS',
  'POSTGRES_PASSWORD',
  'VALKEY_PASSWORD',
  'CLI_USER_PASSWORD',
  'SEED_PASSWORD_HASH',
  'BACKUP_S3_SECRET_KEY',
];
const values = names
  .map((name) => process.env[name])
  .filter((value) => value && value.length >= 8);
let count = 0;
function inspect(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const filename = path.join(folder, entry.name);
    if (entry.isDirectory()) inspect(filename);
    else if (entry.name.endsWith('.js')) {
      count++;
      const source = fs.readFileSync(filename, 'utf8');
      if (
        values.some((value) => source.includes(value)) ||
        names.some((name) => source.includes('process.env.' + name))
      )
        throw new Error('Server configuration found in a client chunk');
    }
  }
}
inspect(directory);
console.log(
  'PASS: ' +
    count +
    ' client JavaScript chunks contain no server credentials or private environment references',
);
