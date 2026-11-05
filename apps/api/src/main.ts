import { createApplication } from './application.ts';
import { parseEnvironment } from './config/environment.ts';
try {
  const config = parseEnvironment(process.env);
  const app = await createApplication(process.env);
  await app.listen(config.API_PORT, config.API_HOST);
} catch (error) {
  console.error(
    error instanceof Error && error.message.startsWith('Invalid configuration:')
      ? error.message
      : 'API startup failed. Check configuration and service availability.',
  );
  process.exitCode = 1;
}
