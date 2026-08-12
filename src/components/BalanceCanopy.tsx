/**
 * Balance canopy (design-system-v2.md §5.2) — replaces the inset BalanceHero.
 * A full-bleed header surface at the top of Home: app title + month pill,
 * total balance, this-month in/out, and an 8px spend bar with the pending
 * count. Approved transactions only — pending items NEVER enter these figures.
 *
 * The surface is `primary` (brown) in light mode — one of the only two places
 * the brand may be a full-bleed surface (v2 §2.8) — and the neutral `surface`
 * in dark mode, where semantic in/out hues stay legible. Meaning is never
 * carried by colour alone: in/out always keep their +/− sign.
 */
import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Amount } from '@/components/Amount';
import { useTheme } from '@/theme/ThemeContext';
import { fontFamily, layout, minTouchTarget, radius, space, tabularNums, type } from '@/theme/tokens';

interface Props {
  monthLabel: string;
  totalBalanceMinor: number;
  monthIncomeMinor: number;
  monthExpenseMinor: number;
  pendingCount: number;
}

const balanceStyle = { fontFamily: fontFamily.headingBold, fontSize: 38, lineHeight: 44, ...tabularNums };

export function BalanceCanopy({
  monthLabel,
  totalBalanceMinor,
  monthIncomeMinor,
  monthExpenseMinor,
  pendingCount,
}: Props) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [hidden, setHidden] = useState(false);

  // On the brown light canopy, in/out read as white + sign (green/red would
  // muddy on brown); on the neutral dark canopy the semantic hues work.
  const canopyBg = isDark ? colors.surface : colors.primary;
  const onCanopy = isDark ? colors.text : colors.onPrimary;
  const onCanopyMuted = isDark ? colors.textMuted : colors.onPrimary;
  const monthPillBg = isDark ? colors.surfaceAlt : colors.primaryPress;
  const monthPillText = isDark ? colors.primary : colors.onPrimary;
  const inOutOverride = isDark ? undefined : colors.onPrimary;
  const trackBg = isDark ? colors.border : colors.primaryPress;

  const pct =
    monthIncomeMinor > 0
      ? Math.min(100, Math.round((monthExpenseMinor / monthIncomeMinor) * 100))
      : null;

  return (
    <View style={[styles.canopy, { backgroundColor: canopyBg, paddingTop: insets.top + space.xs }]}>
      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: onCanopy }]}>Kaasu</Text>
        <View style={[styles.monthPill, { backgroundColor: monthPillBg }]}>
          <Text style={[type.label, { color: monthPillText }]}>{monthLabel}</Text>
          <Feather name="chevron-down" size={12} color={monthPillText} />
        </View>
      </View>

      <View style={styles.balanceBlock}>
        <View style={styles.balanceLabelRow}>
          <Text style={[type.label, { color: onCanopyMuted, opacity: isDark ? 1 : 0.75 }]}>
            Total balance
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show amounts' : 'Hide amounts'}
            onPress={() => setHidden((h) => !h)}
            hitSlop={space.sm}
            style={styles.eye}>
            <Feather
              name={hidden ? 'eye-off' : 'eye'}
              size={15}
              color={onCanopyMuted}
              style={{ opacity: isDark ? 1 : 0.75 }}
            />
          </Pressable>
        </View>
        {hidden ? (
          <Text style={[balanceStyle, { color: onCanopy }]}>Rs ••••••</Text>
        ) : (
          <Amount valueMinor={totalBalanceMinor} textStyle={balanceStyle} colorOverride={onCanopy} />
        )}
      </View>

      <View style={styles.inOutRow}>
        <View style={styles.inOutItem}>
          <Text style={[type.caption, { color: onCanopyMuted, opacity: isDark ? 1 : 0.8 }]}>
            This month in
          </Text>
          {hidden ? (
            <Text style={[type.amount, { color: onCanopy }]}>••••</Text>
          ) : (
            <Amount valueMinor={monthIncomeMinor} txType="income" colorOverride={inOutOverride} />
          )}
        </View>
        <View style={styles.inOutItem}>
          <Text style={[type.caption, { color: onCanopyMuted, opacity: isDark ? 1 : 0.8 }]}>
            This month out
          </Text>
          {hidden ? (
            <Text style={[type.amount, { color: onCanopy }]}>••••</Text>
          ) : (
            <Amount valueMinor={monthExpenseMinor} txType="expense" colorOverride={inOutOverride} />
          )}
        </View>
      </View>

      <View style={styles.spendBlock}>
        <View style={[styles.track, { backgroundColor: trackBg }]}>
          <View
            style={[
              styles.fill,
              { backgroundColor: colors.canopyAccent, width: `${pct ?? 0}%` },
            ]}
          />
        </View>
        <View style={styles.spendCaptions}>
          <Text style={[type.caption, { color: onCanopyMuted, opacity: isDark ? 1 : 0.85 }]}>
            {pct === null ? 'No income yet this month' : `Spent ${pct}% of what came in`}
          </Text>
          {pendingCount > 0 ? (
            <Text style={[type.caption, { color: onCanopyMuted, opacity: isDark ? 1 : 0.85 }]}>
              {pendingCount} to review — not counted
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canopy: {
    paddingHorizontal: layout.canopyPaddingH,
    paddingBottom: space.xxl + space.xs, // 34, sheet overlaps back up
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: space.sm,
  },
  title: { fontFamily: fontFamily.headingBold, fontSize: 20, lineHeight: 26 },
  monthPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.pill,
    paddingVertical: space.xs + 1,
    paddingHorizontal: space.md,
  },
  balanceBlock: { marginTop: space.xl, gap: space.xs + 2 },
  balanceLabelRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  eye: {
    minWidth: minTouchTarget - space.md,
    minHeight: minTouchTarget - space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inOutRow: { marginTop: space.lg, flexDirection: 'row', gap: space.xxl },
  inOutItem: { gap: space.xs },
  spendBlock: { marginTop: space.lg, gap: space.sm },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
  spendCaptions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
