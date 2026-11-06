import { execFileSync } from 'node:child_process';
try {
  if (!process.env.npm_execpath) throw new Error('Run this check with pnpm');
  const tree = JSON.parse(
    execFileSync(
      process.execPath,
      [
        process.env.npm_execpath,
        'list',
        '--recursive',
        '--prod',
        '--depth',
        'Infinity',
        '--json',
      ],
      {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ),
  );
  const packages = new Map();
  function visit(values) {
    for (const [key, value] of Object.entries(values ?? {})) {
      const name = value.name ?? key,
        version = value.version;
      if (
        typeof version === 'string' &&
        /^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version) &&
        !name.startsWith('@jobpilot/')
      )
        packages.set(name + '@' + version, { name, version });
      visit(value.dependencies);
      visit(value.optionalDependencies);
    }
  }
  for (const project of tree) {
    visit(project.dependencies);
    visit(project.optionalDependencies);
  }
  if (!packages.size) throw new Error('No production packages found');
  let pending = [...packages.values()].map((value) => ({
    package: { ecosystem: 'npm', name: value.name },
    version: value.version,
  }));
  const findings = new Set();
  while (pending.length) {
    const batch = pending.splice(0, 100);
    const response = await fetch('https://api.osv.dev/v1/querybatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: batch }),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error('OSV service unavailable');
    const data = await response.json();
    if (!Array.isArray(data.results) || data.results.length !== batch.length)
      throw new Error('Invalid OSV response');
    data.results.forEach((result, index) => {
      if (result.vulns !== undefined && !Array.isArray(result.vulns))
        throw new Error('Invalid OSV findings');
      for (const vulnerability of result.vulns ?? []) {
        if (typeof vulnerability.id !== 'string')
          throw new Error('Invalid OSV vulnerability');
        findings.add(
          batch[index].package.name +
            '@' +
            batch[index].version +
            ': ' +
            vulnerability.id,
        );
      }
      if (result.next_page_token)
        pending.push({ ...batch[index], page_token: result.next_page_token });
    });
  }
  if (findings.size) {
    console.error([...findings].sort().join('\n'));
    process.exitCode = 1;
  } else
    console.log(
      'OSV: no known vulnerabilities in ' +
        packages.size +
        ' production package versions',
    );
} catch {
  console.error('OSV production dependency verification failed');
  process.exitCode = 1;
}
