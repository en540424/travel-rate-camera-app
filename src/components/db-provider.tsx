// Web 用: expo-sqlite を一切使わない透過プロバイダー
// Metro は .native.tsx を iOS/Android で優先し、
// このファイルを Web（および未指定環境）で使う。
import type { ReactNode } from 'react';

export function DbProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
