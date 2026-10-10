const MIGRATION_FILE_PATTERN = /^\d{3}_[a-z0-9_]+\.sql$/;

export interface MigrationFileDetails {
  migrationName: string;
  fileName: string;
}

export function listMigrationFiles(directoryEntryList: string[]): MigrationFileDetails[] {
  return directoryEntryList
    .filter((fileName) => MIGRATION_FILE_PATTERN.test(fileName))
    .sort()
    .map((fileName) => ({ migrationName: fileName.replace(/\.sql$/, ''), fileName }));
}

export function selectPendingMigrations(
  migrationFileList: MigrationFileDetails[],
  appliedMigrationNameList: string[],
): MigrationFileDetails[] {
  const appliedNameSet = new Set(appliedMigrationNameList);
  return migrationFileList.filter((migrationFile) => !appliedNameSet.has(migrationFile.migrationName));
}
