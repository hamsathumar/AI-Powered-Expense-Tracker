/**
 * Floating action button (design §5.5 / §4.1): circular, primary fill, soft
 * warm shadow in light mode, with a scale-down press feedback (§7).
 * Positioning is the caller's job (pass `style`).
 */
import { Feather } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { PressableScale } from '@/components/PressableScale';
import { useTheme } from '@/theme/ThemeContext';
import { shadow } from '@/theme/tokens';

interface Props {
  icon: ComponentProps<typeof Feather>['name'];
  onPress: () => void;
  accessibilityLabel: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

export function Fab({ icon, onPress, accessibilityLabel, size = 60, style }: Props) {
  const { colors, isDark } = useTheme();

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      scaleTo={0.9}
      style={[
        styles.base,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primary },
        !isDark && shadow,
        style,
      ]}>
      <Feather name={icon} size={Math.round(size * 0.42)} color={colors.onPrimary} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
