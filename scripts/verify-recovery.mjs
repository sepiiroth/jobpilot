import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const require = createRequire(
  new URL('../apps/worker/package.json', import.meta.url),
);
const { GenericContainer, Network, Wait } = await import(
  pathToFileURL(require.resolve('testcontainers'))
);
let network, postgres, targetPostgres, worker;
try {
  const password = randomBytes(32).toString('hex');
  network = await new Network().start();
  postgres = await new GenericContainer('pgvector/pgvector:0.8.2-pg18')
    .withNetwork(network)
    .withNetworkAliases('database')
    .withEnvironment({
      POSTGRES_USER: 'jobpilot',
      POSTGRES_PASSWORD: password,
      POSTGRES_DB: 'jobpilot_restore_source',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage('database system is ready to accept connections', 2),
    )
    .start();
  targetPostgres = await new GenericContainer('jobpilot-db:phase12')
    .withNetwork(network)
    .withNetworkAliases('restore-target')
    .withEnvironment({
      POSTGRES_USER: 'jobpilot',
      POSTGRES_PASSWORD: password,
      POSTGRES_DB: 'jobpilot_restore_target',
    })
    .withWaitStrategy(
      Wait.forLogMessage('database system is ready to accept connections', 2),
    )
    .start();
  const host =
    postgres.getHost() === 'localhost' ? '127.0.0.1' : postgres.getHost();
  execFileSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'migrate', 'deploy'],
    {
      cwd: fileURLToPath(new URL('../packages/db', import.meta.url)),
      env: {
        ...process.env,
        DATABASE_URL: `postgresql://jobpilot:${password}@${host}:${postgres.getMappedPort(5432)}/jobpilot_restore_source`,
      },
      stdio: 'pipe',
    },
  );
  worker = await new GenericContainer('jobpilot-worker:phase12')
    .withNetwork(network)
    .withCopyFilesToContainer([
      {
        source: fileURLToPath(
          new URL(
            '../apps/worker/src/testing/recovery-fixture.ts',
            import.meta.url,
          ),
        ),
        target: '/app/src/testing/recovery-fixture.ts',
      },
    ])
    .withLogConsumer((stream) =>
      stream.on('data', (chunk) => {
        for (const line of chunk.toString().split('\n'))
          if (/^(PASS|FAIL):/.test(line)) console.log(line);
      }),
    )
    .withEnvironment({
      NODE_ENV: 'test',
      RECOVERY_TEST_MODE: 'isolated',
      RECOVERY_TARGET_DATABASE_URL: `postgresql://jobpilot:${password}@restore-target:5432/jobpilot_restore_target`,
      DATABASE_URL: `postgresql://jobpilot:${password}@database:5432/jobpilot_restore_source`,
    })
    .withCommand(['node', '--import', 'tsx', 'src/testing/recovery-fixture.ts'])
    .withWaitStrategy(Wait.forOneShotStartup())
    .withStartupTimeout(120000)
    .start();
  console.log(
    'PASS: isolated backup/restore drill completed using production worker tools and Debian-to-Alpine empty-target migration',
  );
} catch {
  console.error(
    'Recovery drill failed; build jobpilot-worker:phase12 and check Docker/tool configuration',
  );
  process.exitCode = 1;
} finally {
  await worker?.stop();
  await targetPostgres?.stop();
  await postgres?.stop();
  await network?.stop();
}
