/**
 * Voice bar (design-system-v2.md §5.5) — the signature Home entry point.
 * A full-width "Hold to speak" bar (primary fill, mic + label) with a 56pt
 * `+` circle beside it for manual entry. It is the widest, easiest target on
 * Home — that is the point; never bury the voice control.
 *
 * Interaction note: pressing the bar opens the full-screen voice capture
 * screen (the existing, working flow). The press-and-hold recording states
 * live on that screen.
 */
import { Feather } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { PressableScale } from '@/components/PressableScale';
import { useTheme } from '@/theme/ThemeContext';
import { fontFamily, layout, radius, shadow, space } from '@/theme/tokens';

interface Props {
  onSpeak: () => void;
  onAdd: () => void;
}

export function VoiceBar({ onSpeak, onAdd }: Props) {
  const { colors, isDark } = useTheme();

  return (
    <View style={styles.row}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Log by voice"
        onPress={onSpeak}
        scaleTo={0.97}
        style={[styles.bar, { backgroundColor: colors.primary }, !isDark && shadow]}>
        <Feather name="mic" size={22} color={colors.onPrimary} />
        <Text style={[styles.barLabel, { color: colors.onPrimary }]}>Tap to speak</Text>
      </PressableScale>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Add transaction"
        onPress={onAdd}
        scaleTo={0.9}
        style={[
          styles.addButton,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}>
        <Feather name="plus" size={24} color={colors.primary} />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm + 2 },
  bar: {
    flex: 1,
    height: layout.voiceBarH,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm + 2,
  },
  barLabel: { fontFamily: fontFamily.heading, fontSize: 16 },
  addButton: {
    width: layout.fabSm,
    height: layout.fabSm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
