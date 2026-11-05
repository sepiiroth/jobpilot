import { createConnection } from 'node:net';
export async function sendMailFixture(host: string, port: number, raw: string) {
  const socket = createConnection({ host, port });
  let buffer = '',
    failure: Error | undefined;
  const ready: string[] = [],
    waiting: Array<{
      resolve: (line: string) => void;
      reject: (error: Error) => void;
    }> = [];
  socket.setTimeout(5000, () =>
    socket.destroy(new Error('SMTP fixture timeout')),
  );
  socket.on('error', (error) => {
    failure = error;
    for (const waiter of waiting.splice(0)) waiter.reject(error);
  });
  socket.on('data', (chunk) => {
    buffer += chunk.toString();
    let index: number;
    while ((index = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      if (/^\d{3} /.test(line)) {
        const waiter = waiting.shift();
        if (waiter) waiter.resolve(line);
        else ready.push(line);
      }
    }
  });
  const reply = async (code: number) => {
    if (failure) throw failure;
    const line =
      ready.shift() ??
      (await new Promise<string>((resolve, reject) =>
        waiting.push({ resolve, reject }),
      ));
    if (!line.startsWith(String(code)))
      throw new Error('SMTP fixture rejected');
  };
  const command = async (value: string, code: number) => {
    socket.write(value + '\r\n');
    await reply(code);
  };
  try {
    await reply(220);
    await command('EHLO fixture.example.invalid', 250);
    await command('MAIL FROM:<alerts@example.invalid>', 250);
    await command('RCPT TO:<inbox@example.invalid>', 250);
    await command('DATA', 354);
    const body = raw
      .replace(/\r\n/g, '\n')
      .replace(/\n/g, '\r\n')
      .replace(/(^|\r\n)\./g, '$1..');
    socket.write(body + (body.endsWith('\r\n') ? '' : '\r\n') + '.\r\n');
    await reply(250);
    await command('QUIT', 221);
  } finally {
    socket.destroy();
  }
}
