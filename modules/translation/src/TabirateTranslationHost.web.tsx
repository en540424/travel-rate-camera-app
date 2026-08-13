import type { ViewProps } from 'react-native';

// Apple Translation Frameworkはweb未対応のため、ホストViewは何も描画しない。
export function TabirateTranslationHost(_props: ViewProps) {
  return null;
}
