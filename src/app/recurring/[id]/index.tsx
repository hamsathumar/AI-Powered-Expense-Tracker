/**
 * Recurring item detail (screenshot 4b) — the full action set for one
 * template: mark-as-paid/received fast path, pause/resume, the schedule,
 * recent payments (with a "Price rose" tag), optional loan progress, and
 * cancel. Editing lives behind the pencil (→ ./edit).
 */
import { Feather } from '@expo/vector-icons';
import { addMonths, format, parseISO } from 'date-fns';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Amount } from '@/components/Amount';
import { PressableScale } from '@/components/PressableScale';
import {
  cancelTemplate,
  getRecurringStats,
  getTemplateItem,
  listPaymentsForRecurring,
  markRecurringPaid,
  pauseTemplate,
  resumeTemplate,
  type RecurringListItem,
  type RecurringPayment,
  type RecurringStats,
} from '@/db/queries/recurring';
import { formatAmount } from '@/domain/money';
import { isCurrentPeriodPaid } from '@/domain/recurring';
import { dueShortLabel, repeatsPhrase, repeatsRowLabel } from '@/domain/recurringDisplay';
import { useCurrency } from '@/theme/CurrencyContext';
import { useTheme } from '@/theme/ThemeContext';
import { layout, radius, recurringGroupColors, screenPaddingH, shadow, space, type } from '@/theme/tokens';

const RECENT_LIMIT = 3;

export default function RecurringDetailScreen() {
  const { colors } = useTheme();
  const { symbol } = useCurrency();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [item, setItem] = useState<RecurringListItem | null>(null);
  const [stats, setStats] = useState<RecurringStats | null>(null);
  const [payments, setPayments] = useState<RecurringPayment[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(() => {
    Promise.all([
      getTemplateItem(id),
      getRecurringStats(id),
      listPaymentsForRecurring(id, RECENT_LIMIT + 1),
    ])
      .then(([templateItem, s, pays]) => {
        if (!templateItem) throw new Error('Recurring item not found');
        setItem(templateItem);
        setStats(s);
        setPayments(pays);
        setLoaded(true);
      })
      .catch((e) => {
        Alert.alert('Error', String(e));
        router.back();
      });
  }, [id, router]);

  useFocusEffect(reload);

  if (!loaded || !item || !stats) {
    return (
      <SafeAreaView style={[styles.safe, styles.center, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  const t = item.template;
  const today = format(new Date(), 'yyyy-MM-dd');
  const isIncome = t.type === 'income';
  const icon: ComponentProps<typeof Feather>['name'] =
    (item.categoryIcon as ComponentProps<typeof Feather>['name']) ??
    (isIncome ? 'trending-up' : t.type === 'transfer' ? 'repeat' : t.type === 'lending' ? 'users' : 'refresh-cw');
  const iconColor = item.categoryColor ?? colors[t.type];

  // Only payable once per period: after markRecurringPaid advances nextDueDate,
  // the latest approved payment lines up exactly one step behind it, so this
  // reads true until the next occurrence rolls around (see isCurrentPeriodPaid).
  const lastApprovedDue = stats.lastApprovedOccurredAt
    ? stats.lastApprovedOccurredAt.slice(0, 10)
    : null;
  const paidThisPeriod = isCurrentPeriodPaid(t, lastApprovedDue);
  const paidMonthLabel = lastApprovedDue ? format(parseISO(lastApprovedDue), 'MMMM') : '';

  const isLoan = t.recurringGroup === 'loan' && t.totalInstallments != null;
  const remainingMinor =
    t.principalMinor != null ? Math.max(0, t.principalMinor - stats.approvedSumMinor) : null;
  const loanFraction =
    t.totalInstallments && t.totalInstallments > 0
      ? Math.min(1, Math.max(0, stats.approvedCount / t.totalInstallments))
      : 0;

  const statusPill = (() => {
    if (t.status === 'cancelled') return { text: 'Cancelled', tone: colors.textMuted };
    if (t.status === 'paused') {
      return {
        text: t.pausedUntil
          ? `Paused until ${format(parseISO(t.pausedUntil), 'd MMM')}`
          : 'Paused',
        tone: colors.textMuted,
      };
    }
    return {
      text: `${dueShortLabel(t.nextDueDate, today, isIncome)} · ${repeatsPhrase(t)}`,
      tone: colors.warning,
    };
  })();

  const runAction = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      reload();
    } catch (e) {
      Alert.alert('Could not do that', String(e));
    } finally {
      setBusy(false);
    }
  };

  const onMarkPaid = () => {
    const period = format(parseISO(t.nextDueDate), 'MMMM');
    Alert.alert(
      `Mark ${t.name} as ${isIncome ? 'received' : 'paid'}?`,
      `This logs ${formatAmount(t.amountMinor, symbol)} as an approved ${
        isIncome ? 'income' : 'expense'
      } for ${period}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isIncome ? 'Mark received' : 'Mark paid',
          onPress: () => void runAction(() => markRecurringPaid(t.id)),
        },
      ],
    );
  };

  const onPause = () => {
    Alert.alert('Pause this item', 'It stops generating until you resume it.', [
      {
        text: 'Pause 1 month',
        onPress: () =>
          void runAction(() => pauseTemplate(t.id, format(addMonths(new Date(), 1), 'yyyy-MM-dd'))),
      },
      {
        text: 'Pause 3 months',
        onPress: () =>
          void runAction(() => pauseTemplate(t.id, format(addMonths(new Date(), 3), 'yyyy-MM-dd'))),
      },
      { text: 'Pause indefinitely', onPress: () => void runAction(() => pauseTemplate(t.id)) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const onResume = () => runAction(() => resumeTemplate(t.id));

  const onCancel = () => {
    Alert.alert(
      'Cancel this recurring item?',
      'It stops generating. Payments already recorded are kept.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Cancel item',
          style: 'destructive',
          onPress: () =>
            void runAction(async () => {
              await cancelTemplate(t.id);
              router.back();
            }),
        },
      ],
    );
  };

  const recent = payments.slice(0, RECENT_LIMIT);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top']}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={12} onPress={() => router.back()}>
          <Feather name="chevron-left" size={26} color={colors.text} />
        </Pressable>
        <Text style={[type.h2, { color: colors.text }]}>Recurring item</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit"
          hitSlop={12}
          onPress={() => router.push({ pathname: '/recurring/[id]/edit', params: { id: t.id } })}>
          <Feather name="edit-2" size={20} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={[styles.hero, { backgroundColor: colors.surface, borderColor: colors.border }, shadow]}>
          <View style={[styles.heroIcon, { backgroundColor: `${iconColor}22` }]}>
            <Feather name={icon} size={26} color={iconColor} />
          </View>
          <Amount
            valueMinor={t.amountMinor}
            textStyle={type.displayXL}
            colorOverride={colors.text}
          />
          <Text style={[type.h2, { color: colors.text }]}>{t.name}</Text>
          <View style={[styles.pill, { backgroundColor: `${statusPill.tone}1F` }]}>
            <Feather
              name={t.status === 'active' ? 'clock' : 'pause'}
              size={13}
              color={statusPill.tone}
            />
            <Text style={[type.caption, { color: statusPill.tone }]}>{statusPill.text}</Text>
          </View>
        </View>

        {/* Actions */}
        {t.status !== 'cancelled' ? (
          <View style={styles.actions}>
            {t.status === 'paused' ? (
              <PressableScale
                accessibilityRole="button"
                disabled={busy}
                onPress={onResume}
                scaleTo={0.97}
                style={[styles.primaryBtn, { backgroundColor: colors.primary }, busy && styles.disabled]}>
                <Feather name="play" size={18} color={colors.onPrimary} />
                <Text style={[type.h2, { color: colors.onPrimary }]}>Resume</Text>
              </PressableScale>
            ) : (
              <>
                {paidThisPeriod ? (
                  <View
                    accessibilityRole="text"
                    accessibilityLabel={`${isIncome ? 'Received' : 'Paid'} for ${paidMonthLabel}`}
                    style={[styles.doneState, { backgroundColor: `${colors.success}22` }]}>
                    <Feather name="check-circle" size={18} color={colors.success} />
                    <Text style={[type.h2, { color: colors.success }]}>
                      {isIncome ? 'Received' : 'Paid'} for {paidMonthLabel}
                    </Text>
                  </View>
                ) : (
                  <PressableScale
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={onMarkPaid}
                    scaleTo={0.97}
                    style={[styles.primaryBtn, { backgroundColor: colors.primary }, busy && styles.disabled]}>
                    <Feather name="check" size={18} color={colors.onPrimary} />
                    <Text style={[type.h2, { color: colors.onPrimary }]}>
                      {isIncome ? 'Mark as received' : 'Mark as paid'}
                    </Text>
                  </PressableScale>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Pause"
                  disabled={busy}
                  onPress={onPause}
                  style={[styles.circleBtn, { borderColor: colors.border }]}>
                  <Feather name="pause" size={20} color={colors.text} />
                </Pressable>
              </>
            )}
          </View>
        ) : null}

        {/* Loan progress */}
        {isLoan ? (
          <View style={[styles.loanCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.loanTop}>
              <Text style={[type.label, { color: colors.textMuted }]}>
                {stats.approvedCount} of {t.totalInstallments} paid
              </Text>
              {t.endDate ? (
                <Text style={[type.caption, { color: colors.textSubtle }]}>
                  Ends {format(parseISO(t.endDate), 'MMM yyyy')}
                </Text>
              ) : null}
            </View>
            <View style={[styles.loanTrack, { backgroundColor: colors.surfaceAlt }]}>
              <View
                style={[
                  styles.loanFill,
                  { backgroundColor: recurringGroupColors.loan, width: `${loanFraction * 100}%` },
                ]}
              />
            </View>
            {remainingMinor != null ? (
              <Text style={[type.caption, { color: colors.textMuted }]}>
                {formatAmount(remainingMinor, symbol)} left of{' '}
                {formatAmount(t.principalMinor!, symbol)}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Details */}
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <DetailRow label="Repeats" value={repeatsRowLabel(t)} colors={colors} />
          {item.accountName ? (
            <DetailRow label="Account" value={item.accountName} colors={colors} border />
          ) : null}
          {item.categoryName ? (
            <DetailRow label="Category" value={item.categoryName} colors={colors} border />
          ) : null}
          <DetailRow
            label="Since"
            value={
              stats.firstOccurredAt
                ? `${format(parseISO(stats.firstOccurredAt), 'MMM yyyy')} · ${stats.totalCount} ${
                    stats.totalCount === 1 ? 'payment' : 'payments'
                  }`
                : 'No payments yet'
            }
            colors={colors}
            border
          />
        </View>

        {/* Recent payments */}
        <View style={styles.paymentsHead}>
          <Text style={[type.sectionLabel, { color: colors.textSubtle }]}>RECENT PAYMENTS</Text>
          {payments.length > RECENT_LIMIT ? (
            <Pressable
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => router.push({ pathname: '/recurring/[id]/payments', params: { id: t.id } })}>
              <Text style={[type.label, { color: colors.primary }]}>See all</Text>
            </Pressable>
          ) : null}
        </View>

        {recent.length === 0 ? (
          <Text style={[type.caption, styles.noPayments, { color: colors.textSubtle }]}>
            No payments recorded yet.
          </Text>
        ) : (
          <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {recent.map((p, i) => {
              const older = payments[i + 1];
              const priceRose = older ? p.amountMinor > older.amountMinor : false;
              return (
                <View
                  key={p.id}
                  style={[styles.payRow, i > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
                  <Text style={[type.body, { color: colors.text }]}>
                    {format(parseISO(p.occurredAt), 'd MMM yyyy')}
                  </Text>
                  {priceRose ? (
                    <View style={[styles.tag, { backgroundColor: `${colors.warning}22` }]}>
                      <Feather name="arrow-up-right" size={11} color={colors.warning} />
                      <Text style={[type.caption, { color: colors.warning }]}>Price rose</Text>
                    </View>
                  ) : null}
                  <View style={styles.flexEnd}>
                    <Amount valueMinor={p.amountMinor} colorOverride={colors.text} />
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Cancel */}
        {t.status !== 'cancelled' ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={onCancel}
            style={styles.cancelBtn}>
            <Text style={[type.label, { color: colors.danger }]}>Cancel this recurring item</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function DetailRow({
  label,
  value,
  colors,
  border,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useTheme>['colors'];
  border?: boolean;
}) {
  return (
    <View
      style={[
        styles.detailRow,
        border && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
      ]}>
      <Text style={[type.body, { color: colors.textMuted }]}>{label}</Text>
      <Text style={[type.body, styles.detailValue, { color: colors.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: screenPaddingH,
    paddingVertical: space.md,
  },
  scroll: {
    paddingHorizontal: screenPaddingH,
    paddingBottom: space.xxl * 2,
    gap: space.lg,
  },
  hero: {
    borderRadius: layout.heroCardRadius,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
    paddingVertical: space.xs + 2,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    marginTop: space.xs,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: layout.primaryButtonH,
    borderRadius: radius.pill,
  },
  doneState: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    minHeight: layout.primaryButtonH,
    borderRadius: radius.pill,
  },
  circleBtn: {
    width: layout.primaryButtonH,
    height: layout.primaryButtonH,
    borderRadius: layout.primaryButtonH / 2,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.6 },
  card: {
    borderRadius: layout.cardRadius,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.lg,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingVertical: space.md,
  },
  detailValue: { flexShrink: 1, textAlign: 'right' },
  loanCard: {
    borderRadius: layout.cardRadius,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.lg,
    gap: space.md,
  },
  loanTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  loanTrack: {
    height: 8,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  loanFill: { height: '100%', borderRadius: radius.pill },
  paymentsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xs,
  },
  noPayments: { paddingHorizontal: space.xs },
  payRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.md,
  },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingVertical: 2,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
  },
  flexEnd: { flex: 1, alignItems: 'flex-end' },
  cancelBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    marginTop: space.sm,
  },
});
