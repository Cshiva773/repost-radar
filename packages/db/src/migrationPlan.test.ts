import { describe, expect, it } from 'vitest';
import { listMigrationFiles, selectPendingMigrations } from './migrationPlan.js';

describe('listMigrationFiles', () => {
  it('keeps only numbered .sql files, sorted', () => {
    const migrationFileList = listMigrationFiles(['002_b.sql', 'README.md', '001_a.sql', 'x.sql']);
    expect(migrationFileList.map((file) => file.migrationName)).toEqual(['001_a', '002_b']);
  });
});

describe('selectPendingMigrations', () => {
  it('skips migrations already applied', () => {
    const migrationFileList = listMigrationFiles(['001_a.sql', '002_b.sql', '003_c.sql']);
    const pendingList = selectPendingMigrations(migrationFileList, ['001_a']);
    expect(pendingList.map((file) => file.migrationName)).toEqual(['002_b', '003_c']);
  });

  it('returns an empty list when everything is applied', () => {
    const migrationFileList = listMigrationFiles(['001_a.sql']);
    expect(selectPendingMigrations(migrationFileList, ['001_a'])).toEqual([]);
  });
});
