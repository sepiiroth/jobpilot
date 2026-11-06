import { restoreBackup } from './restore.ts';
try {
  const {
    RESTORE_DATABASE_URL,
    RESTORE_AGE_IDENTITY_FILE,
    RESTORE_ARCHIVE_FILE,
    RESTORE_CONFIRM_EMPTY_DATABASE,
  } = process.env;
  if (
    !RESTORE_DATABASE_URL ||
    !RESTORE_AGE_IDENTITY_FILE ||
    !RESTORE_ARCHIVE_FILE ||
    RESTORE_CONFIRM_EMPTY_DATABASE !== 'true'
  )
    throw new Error('Missing restore configuration');
  await restoreBackup(
    RESTORE_DATABASE_URL,
    RESTORE_AGE_IDENTITY_FILE,
    RESTORE_ARCHIVE_FILE,
  );
  console.log('Encrypted backup restored; sessions revoked');
} catch {
  console.error(
    'Restore failed: check the empty target, archive, identity and PostgreSQL tools',
  );
  process.exitCode = 1;
}
