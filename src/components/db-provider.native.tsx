// iOS / Android 用: expo-sqlite の SQLiteProvider でラップ
import { SQLiteProvider } from 'expo-sqlite';
import type { ReactNode } from 'react';

import { migrateDatabase } from '@/db/schema';

export function DbProvider({ children }: { children: ReactNode }) {
  return (
    <SQLiteProvider databaseName="travelrate.db" onInit={migrateDatabase}>
      {children}
    </SQLiteProvider>
  );
}
