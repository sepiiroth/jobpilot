import { connect } from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
export default async function setup() {
  for (const port of [3000, 3001])
    for (const host of ['localhost', '127.0.0.1'])
      await new Promise((resolve, reject) => {
        const socket = connect({ port, host });
        socket.once('connect', () => {
          socket.destroy();
          reject(
            new Error('E2E requires unused localhost ports 3000 and 3001'),
          );
        });
        socket.once('error', () => {
          socket.destroy();
          resolve();
        });
      });
  const child = spawn(
    process.execPath,
    [
      '--import',
      pathToFileURL(root + 'apps/api/node_modules/tsx/dist/loader.mjs').href,
      'scripts/e2e-server.mjs',
    ],
    { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );
  child.stdout.on('data', (chunk) => {
    for (const line of chunk.toString().split('\n'))
      if (line.startsWith('Synthetic e2e')) console.log(line);
  });
  child.stderr.resume();
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });
  const close = async () => {
    if (exited) return;
    child.stdin.write('shutdown\n');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 15000)),
    ]);
    if (!exited) child.kill();
  };
  try {
    for (let i = 0; i < 300; i++) {
      if (exited)
        throw new Error(
          'Synthetic e2e server failed; build the web app and check Docker',
        );
      try {
        if (
          (
            await fetch('http://localhost:3000/connexion', {
              signal: AbortSignal.timeout(1000),
            })
          ).ok
        )
          return close;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error('Synthetic e2e environment startup timed out');
  } catch (error) {
    await close();
    throw error;
  }
}
