/**
 * Pushed-screen header (design-system-v2.md §3/§6): a back chevron, a centred
 * h2 title, and an optional trailing action, sized to the 44pt touch target.
 * Shared by Settings subpages, Transaction detail, Bill split and Settle up so
 * the header bar reads the same everywhere.
 */
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, screenPaddingH, space, type } from '@/theme/tokens';

interface Props {
  title: string;
  right?: React.ReactNode;
  /** Close (×) instead of back (‹), e.g. for modally-presented forms. */
  variant?: 'back' | 'close';
  onBack?: () => void;
}

export function ScreenHeader({ title, right, variant = 'back', onBack }: Props) {
  const { colors } = useTheme();
  const router = useRouter();

  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={variant === 'close' ? 'Close' : 'Back'}
        onPress={onBack ?? (() => router.back())}
        style={styles.side}>
        <Feather name={variant === 'close' ? 'x' : 'chevron-left'} size={24} color={colors.text} />
      </Pressable>
      <Text numberOfLines={1} style={[type.h2, styles.title, { color: colors.text }]}>
        {title}
      </Text>
      <View style={styles.side}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: screenPaddingH,
    paddingVertical: space.sm,
  },
  side: {
    minWidth: minTouchTarget,
    height: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1, textAlign: 'center' },
});
