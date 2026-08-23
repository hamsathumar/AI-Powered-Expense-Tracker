/**
 * Appearance subpage (Settings → Appearance). Overrides the system theme
 * (v2 §5.10): Follow system / Light / Dark, persisted via ThemeContext.setMode.
 * The selected option shows a check — colour never carries the choice alone.
 *
 * Also owns the two "feel" switches. Haptics and motion are enhancements, and
 * this app gets used in meetings and in bed — both need an off switch that
 * doesn't require digging through iOS Settings. Motion here can only ever
 * reduce further: if iOS asks for reduced motion, that wins regardless.
 */
import { Feather } from '@expo/vector-icons';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import type { AppearanceMode } from '@/db/queries/settings';
import { PressableScale } from '@/components/PressableScale';
import { hapticTick } from '@/lib/haptics';
import { useFeedback } from '@/theme/FeedbackContext';
import { useTheme } from '@/theme/ThemeContext';
import { layout, motion, radius, screenPaddingH, space, type } from '@/theme/tokens';

const OPTIONS: { mode: AppearanceMode; label: string; hint: string; icon: 'smartphone' | 'sun' | 'moon' }[] = [
  { mode: 'system', label: 'Follow system', hint: 'Match your device setting', icon: 'smartphone' },
  { mode: 'light', label: 'Light', hint: 'Always the warm light theme', icon: 'sun' },
  { mode: 'dark', label: 'Dark', hint: 'Always the warm dark theme', icon: 'moon' },
];

export default function AppearanceScreen() {
  const { colors, mode, setMode } = useTheme();
  const { haptics, setHaptics, motion: motionMode, setMotion, reduceMotion } = useFeedback();

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScreenHeader title="Appearance" />
      <ScrollView contentContainerStyle={styles.container}>
        {OPTIONS.map((opt) => {
          const selected = opt.mode === mode;
          return (
            <PressableScale
              key={opt.mode}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => {
                hapticTick();
                void setMode(opt.mode);
              }}
              scaleTo={motion.pressScale.card}
              style={[
                styles.row,
                { backgroundColor: colors.surface, borderColor: selected ? colors.primary : colors.border },
              ]}>
              <View style={[styles.tile, { backgroundColor: colors.primarySoft }]}>
                <Feather name={opt.icon} size={18} color={colors.primary} />
              </View>
              <View style={styles.text}>
                <Text style={[type.h2, { color: colors.text }]}>{opt.label}</Text>
                <Text style={[type.caption, { color: colors.textMuted }]}>{opt.hint}</Text>
              </View>
              {selected ? <Feather name="check" size={20} color={colors.primary} /> : null}
            </PressableScale>
          );
        })}

        <Text style={[type.h2, styles.sectionTitle, { color: colors.text }]}>Feel</Text>

        <View
          style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.tile, { backgroundColor: colors.primarySoft }]}>
            <Feather name="smartphone" size={18} color={colors.primary} />
          </View>
          <View style={styles.text}>
            <Text style={[type.h2, { color: colors.text }]}>Haptics</Text>
            <Text style={[type.caption, { color: colors.textMuted }]}>
              A tap when something is selected, saved or rejected
            </Text>
          </View>
          <Switch
            value={haptics}
            onValueChange={(next) => {
              // Tick on the way ON so you feel what you just enabled.
              if (next) hapticTick();
              void setHaptics(next);
            }}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        </View>

        <View
          style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.tile, { backgroundColor: colors.primarySoft }]}>
            <Feather name="wind" size={18} color={colors.primary} />
          </View>
          <View style={styles.text}>
            <Text style={[type.h2, { color: colors.text }]}>Animations</Text>
            <Text style={[type.caption, { color: colors.textMuted }]}>
              {reduceMotion && motionMode !== 'reduced'
                ? 'Reduced by your iOS accessibility setting'
                : 'Charts, transitions and list movement'}
            </Text>
          </View>
          <Switch
            value={motionMode !== 'reduced'}
            // The iOS setting always wins, so the switch is locked off when the
            // system has asked for reduced motion.
            disabled={reduceMotion && motionMode !== 'reduced'}
            onValueChange={(next) => {
              hapticTick();
              void setMotion(next ? 'full' : 'reduced');
            }}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { paddingHorizontal: screenPaddingH, paddingTop: space.sm, paddingBottom: space.xxl, gap: space.md - 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md + 2,
    borderRadius: layout.cardRadius,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
  },
  tile: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1, gap: 2 },
  sectionTitle: { paddingTop: space.lg, paddingHorizontal: space.xs },
});
