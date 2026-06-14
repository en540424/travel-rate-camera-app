import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import type { CurrencyCode } from '@/constants/currencies';
import { card, color, radius, spacing, statusColor, typography } from '@/theme/tokens';
import { formatForeign, formatJpy } from '@/utils/format';

export interface ItemCardProps {
  /** 商品名（任意） */
  title?: string | null;
  foreignAmount: number;
  currency: CurrencyCode;
  jpyAmount: number;
  memo?: string | null;
  /** 写真URI。未指定/nullなら写真なし表示 */
  imageUri?: string | null;
  /** 表示用に整形済みの日付文字列 */
  date?: string | null;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

type ItemStatus = 'candidate' | 'purchased';

const CARD_TOKEN: Record<ItemStatus, typeof card.candidate | typeof card.purchased> = {
  candidate: card.candidate,
  purchased: card.purchased,
};

function ItemCardBase({ status, ...props }: ItemCardProps & { status: ItemStatus }) {
  const { title, foreignAmount, currency, jpyAmount, memo, imageUri, date, onPress, style } = props;
  const tokens = statusColor[status];
  const cardTokens = CARD_TOKEN[status];

  return (
    <Pressable
      onPress={onPress}
      disabled={onPress == null}
      style={[
        styles.container,
        {
          backgroundColor: cardTokens.bg,
          borderColor: cardTokens.borderColor,
          borderWidth: cardTokens.borderWidth,
          borderRadius: cardTokens.borderRadius,
        },
        style,
      ]}>
      <View style={styles.photo}>
        {imageUri != null ? (
          <Image source={{ uri: imageUri }} style={styles.photoImage} contentFit="cover" />
        ) : (
          <View style={[styles.photoPlaceholder, { backgroundColor: tokens.badgeBg }]} />
        )}
        <View style={[styles.dot, { backgroundColor: tokens.dot }]} />
      </View>
      <View style={styles.body}>
        {title != null && title !== '' && (
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        )}
        {memo != null && memo !== '' && (
          <Text style={styles.memo} numberOfLines={1}>
            {memo}
          </Text>
        )}
        {date != null && date !== '' && <Text style={styles.date}>{date}</Text>}
      </View>
      <View style={styles.amounts}>
        <Text style={styles.jpy}>{formatJpy(jpyAmount)}</Text>
        {currency !== 'JPY' && <Text style={styles.foreign}>{formatForeign(foreignAmount, currency)}</Text>}
        <View style={[styles.badge, { backgroundColor: tokens.badgeBg }]}>
          <Text style={[styles.badgeText, { color: tokens.text }]}>{tokens.label}</Text>
        </View>
      </View>
    </Pressable>
  );
}

/** 候補（未購入）の商品カード。写真有無・金額・円換算・メモ・日付を表示 */
export function CandidateItemCard(props: ItemCardProps) {
  return <ItemCardBase status="candidate" {...props} />;
}

/** 購入済みの商品カード。写真有無・金額・円換算・メモ・日付を表示 */
export function PurchasedItemCard(props: ItemCardProps) {
  return <ItemCardBase status="purchased" {...props} />;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  photo: {
    width: 48,
    height: 48,
    borderRadius: radius.chip,
    overflow: 'hidden',
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  photoPlaceholder: {
    width: '100%',
    height: '100%',
  },
  dot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typography.bodyLg,
    color: color.text,
  },
  memo: {
    ...typography.body,
    color: color.muted,
  },
  date: {
    ...typography.caption,
    color: color.faint,
  },
  amounts: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  jpy: {
    ...typography.title,
    color: color.text,
    fontVariant: ['tabular-nums'],
  },
  foreign: {
    ...typography.caption,
    color: color.muted,
    fontVariant: ['tabular-nums'],
  },
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    ...typography.caption,
  },
});
