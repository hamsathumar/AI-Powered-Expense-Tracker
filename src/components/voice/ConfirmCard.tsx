/**
 * Confirmation card for a single freshly-parsed transaction (design ref:
 * "Progressive entity extraction" + the logged-state chips).
 *
 * Instead of a bare "Done", each detected transaction surfaces its extracted
 * fields as chips that pop in one-by-one — amount, type, category, account,
 * person, date — so the parse is verifiable at a glance. When the safety gate
 * is already satisfied the user can Approve now (commits through the SAME gate
 * as the queue — nothing bypasses it); otherwise we route into the queue/editor
 * to finish the missing details. One spoken sentence can yield several of these
 * cards, each approved independently.
 *
 * Reanimated note: `Animated.View entering={FadeInDown...}` plays a mount
 * animation on the UI thread; staggering the `.delay()` per chip gives the
 * "live reasoning" reveal. Skipped under Reduce Motion.
 */
import { Feather } from '@expo/vector-icons';
import { format, isValid, parseISO } from 'date-fns';
import { useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Amount } from '@/components/Amount';
import {
  commitPendingOperation,
  confirmAndCommitPendingOperation,
  type EvaluatedPending,
} from '@/ai/commitOperation';
import { confirmableInline, describeIssues } from '@/ai/interpretation/issues';
import { lendingPresentation } from '@/domain/lendingPresentation';
import type { PendingOutcome } from '@/state/pendingOutcomes';
import { hapticSuccess, hapticTick } from '@/lib/haptics';
import { useTheme } from '@/theme/ThemeContext';
import { fontFamily, layout, minTouchTarget, radius, space, type } from '@/theme/tokens';

type FeatherName = ComponentProps<typeof Feather>['name'];

const TYPE_ICON: Record<string, FeatherName> = {
  expense: 'arrow-up-right',
  income: 'arrow-down-left',
  transfer: 'repeat',
  lending: 'users',
};

const TYPE_LABEL: Record<string, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
  lending: 'Lending',
};

/** Human date from the operation's date expression. Null → today. */
function dateLabel(expr: string | null): string {
  if (!expr) return 'Today';
  const iso = parseISO(expr);
  if (isValid(iso)) return format(iso, 'd MMM');
  // relative/named expression (e.g. "yesterday") — show as spoken, capitalized
  return expr.charAt(0).toUpperCase() + expr.slice(1);
}

interface ChipSpec {
  icon: FeatherName;
  label: string;
  /** true when the field is still missing — rendered as a warning chip. */
  missing?: boolean;
}

/** The extracted fields to show as chips, in reveal order, per operation kind. */
function chipsFor(op: EvaluatedPending['op']): ChipSpec[] {
  const ref = (r: { status: string; reference: string | null } | null, missingLabel: string): ChipSpec =>
    r && r.status === 'resolved' && r.reference
      ? { icon: 'check-circle', label: r.reference }
      : { icon: 'alert-circle', label: missingLabel, missing: true };

  const chips: ChipSpec[] = [];
  if (op.kind === 'bill_split') return [{ icon: 'users', label: 'Bill split · open editor' }];
  if (op.kind === 'recurring') return [{ icon: 'repeat', label: 'Recurring · open editor' }];

  if (op.kind === 'expense' || op.kind === 'income') {
    chips.push({ ...ref(op.category, 'Category needed'), icon: 'tag' });
    chips.push({ ...ref(op.account, 'Account needed'), icon: 'credit-card' });
  } else if (op.kind === 'transfer') {
    chips.push({ ...ref(op.account, 'From needed'), icon: 'credit-card' });
    chips.push({ ...ref(op.toAccount, 'To needed'), icon: 'arrow-right' });
  } else if (op.kind === 'lending') {
    chips.push({ ...ref(op.person, 'Person needed'), icon: 'user' });
    chips.push({
      icon: 'shuffle',
      label: op.direction ? lendingPresentation(op.direction).kind : 'Direction needed',
      missing: !op.direction,
    });
    // Lending moves money in or out of an account too — show which (V1.3).
    chips.push({ ...ref(op.account, 'Account needed'), icon: 'credit-card' });
  }
  // V1.3: someone else paid (recorded as a borrow + this expense), and any
  // note the user dictated — shown so neither is a surprise after approval.
  if (op.kind === 'expense' && op.paidBy) {
    chips.push(
      op.paidBy.status === 'resolved' && op.paidBy.reference
        ? { icon: 'user', label: `Paid by ${op.paidBy.reference}` }
        : { icon: 'user', label: 'Who paid?', missing: true },
    );
  }
  chips.push({ icon: 'calendar', label: dateLabel(op.dateExpression) });
  if (op.note) chips.push({ icon: 'file-text', label: op.note });
  return chips;
}

/** How a resolved card reads. Each pairs an icon with words — never colour alone. */
const RESOLVED: Record<
  PendingOutcome | 'gone',
  { icon: FeatherName; label: string; tone: 'income' | 'textMuted' }
> = {
  approved: { icon: 'check-circle', label: 'Approved · counting now', tone: 'income' },
  saved: { icon: 'check-circle', label: 'Saved', tone: 'income' },
  rejected: { icon: 'x-circle', label: 'Rejected · not recorded', tone: 'textMuted' },
  gone: { icon: 'info', label: 'No longer pending', tone: 'textMuted' },
};

interface Props {
  item: EvaluatedPending;
  /** Set once the pending item was approved / rejected / saved — HERE or on
   *  another screen (state/pendingOutcomes.ts). Null while it is still pending. */
  resolved?: PendingOutcome | 'gone' | null;
  /** Stagger offset (ms) so cards and their chips cascade in. */
  baseDelay: number;
  reduceMotion: boolean;
  onApproved: () => void;
  onOpenReview: (item: EvaluatedPending) => void;
  onOpenEditor: (item: EvaluatedPending) => void;
}

export function ConfirmCard({
  item,
  resolved = null,
  baseDelay,
  reduceMotion,
  onApproved,
  onOpenReview,
  onOpenEditor,
}: Props) {
  const { colors, isDark } = useTheme();
  const { op, gate } = item;
  const [status, setStatus] = useState<'idle' | 'committing' | 'approved'>('idle');
  const [error, setError] = useState<string | null>(null);

  // The shared outcome wins; our own just-committed state covers the moment
  // before the screen re-reads it, so the button never flashes back.
  const outcome = resolved ?? (status === 'approved' ? 'approved' : null);
  const specialized = op.kind === 'bill_split' || op.kind === 'recurring';
  const blocked = !gate.approvable;
  const chips = chipsFor(op);
  const typeColor = colors[op.operation];

  const approveNow = (commit: (id: string) => ReturnType<typeof commitPendingOperation> = commitPendingOperation) => {
    setStatus('committing');
    setError(null);
    commit(item.id)
      .then((res) => {
        if (res.committed) {
          setStatus('approved');
          hapticSuccess();
          onApproved();
        } else {
          setStatus('idle');
          setError(res.blockers[0]?.message ?? 'Not ready to approve yet.');
        }
      })
      .catch((e) => {
        setStatus('idle');
        setError(e instanceof Error ? e.message : String(e));
      });
  };

  const enter = (delay: number) =>
    reduceMotion ? undefined : FadeInDown.delay(delay).duration(380).springify().damping(16);

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeInDown.delay(baseDelay).duration(420)}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {/* Header: type badge + name + amount */}
      <View style={styles.header}>
        <View style={[styles.typeBadge, { backgroundColor: `${typeColor}1F` }]}>
          <Feather name={TYPE_ICON[op.operation]} size={14} color={typeColor} />
          <Text style={[styles.typeLabel, { color: typeColor }]}>{TYPE_LABEL[op.operation]}</Text>
        </View>
        {op.amountMinor === null ? (
          // Audit F3: heard the intent, never heard the figure. Say so plainly
          // rather than rendering a zero that looks like a real amount.
          <Text style={[styles.amount, { color: isDark ? colors.warning : colors.lending }]}>Amount needed</Text>
        ) : (
          <Amount
            valueMinor={op.amountMinor}
            txType={op.operation}
            direction={op.kind === 'lending' ? op.direction : undefined}
            textStyle={styles.amount}
          />
        )}
      </View>

      <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
        {op.name}
      </Text>

      {/* Extracted-field chips — staggered pop-in */}
      <View style={styles.chipRow}>
        {chips.map((c, i) => (
          <Animated.View key={`${c.icon}-${i}`} entering={enter(baseDelay + 120 + i * 90)}>
            <View
              style={[
                styles.chip,
                c.missing
                  ? { backgroundColor: `${colors.warning}1A`, borderColor: colors.warning }
                  : { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
              ]}>
              <Feather
                name={c.icon}
                size={12}
                color={c.missing ? (isDark ? colors.warning : colors.lending) : colors.textMuted}
              />
              <Text
                numberOfLines={1}
                style={[
                  styles.chipLabel,
                  { color: c.missing ? (isDark ? colors.warning : colors.lending) : colors.text },
                ]}>
                {c.label}
              </Text>
            </View>
          </Animated.View>
        ))}
      </View>

      {error ? <Text style={[type.caption, { color: colors.expense }]}>{error}</Text> : null}

      {/* TC-040: what is holding this item back, said HERE — the first screen
          the user sees — in the same words as the Home queue and review screen. */}
      {!outcome && !specialized && blocked ? (
        <View style={styles.issues}>
          {describeIssues(gate).map((issue) => (
            <View key={issue.message} style={styles.issueRow}>
              <Feather name="alert-circle" size={13} color={isDark ? colors.warning : colors.lending} />
              <Text style={[type.caption, styles.issueText, { color: colors.text }]}>{issue.message}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Action */}
      {outcome ? (
        <View style={[styles.approvedRow]}>
          <Feather name={RESOLVED[outcome].icon} size={16} color={colors[RESOLVED[outcome].tone]} />
          <Text style={[styles.approvedLabel, { color: colors[RESOLVED[outcome].tone] }]}>
            {RESOLVED[outcome].label}
          </Text>
        </View>
      ) : specialized ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => onOpenEditor(item)}
          style={[styles.action, { backgroundColor: colors.surfaceAlt }]}>
          <Feather name="edit-2" size={15} color={colors.primary} />
          <Text style={[styles.actionLabel, { color: colors.primary }]}>Open editor</Text>
        </Pressable>
      ) : blocked && confirmableInline(gate) ? (
        // Only confirmations stand in the way, and they are listed just above:
        // confirm them here rather than on another screen (V1.3).
        <View style={styles.dualAction}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Confirm and approve"
            disabled={status === 'committing'}
            onPress={() => approveNow(confirmAndCommitPendingOperation)}
            style={[styles.action, styles.actionPrimary, { backgroundColor: colors.positiveFill }]}>
            <Feather name="check" size={15} color={colors.onFilled} />
            <Text style={[styles.actionLabel, { color: colors.onFilled }]}>
              {status === 'committing' ? 'Approving…' : 'Confirm & approve'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Review in queue"
            onPress={() => {
              hapticTick();
              onOpenReview(item);
            }}
            style={[styles.action, styles.actionSecondary, { borderColor: colors.border }]}>
            <Text style={[styles.actionLabel, { color: colors.textMuted }]}>Review</Text>
          </Pressable>
        </View>
      ) : blocked ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => onOpenReview(item)}
          style={[styles.action, { backgroundColor: colors.surfaceAlt }]}>
          <Feather name="sliders" size={15} color={colors.text} />
          <Text style={[styles.actionLabel, { color: colors.text }]}>Finish details</Text>
        </Pressable>
      ) : (
        <View style={styles.dualAction}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Approve now"
            disabled={status === 'committing'}
            onPress={() => approveNow()}
            style={[styles.action, styles.actionPrimary, { backgroundColor: colors.positiveFill }]}>
            <Feather name="check" size={15} color={colors.onFilled} />
            <Text style={[styles.actionLabel, { color: colors.onFilled }]}>
              {status === 'committing' ? 'Approving…' : 'Approve now'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Review in queue"
            onPress={() => {
              hapticTick();
              onOpenReview(item);
            }}
            style={[styles.action, styles.actionSecondary, { borderColor: colors.border }]}>
            <Text style={[styles.actionLabel, { color: colors.textMuted }]}>Review</Text>
          </Pressable>
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: layout.cardRadius,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.md + 2,
    gap: space.sm + 2,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
  },
  typeLabel: { fontFamily: fontFamily.medium, fontSize: 12 },
  amount: { ...type.amount, fontSize: 20 },
  name: { fontFamily: fontFamily.heading, fontSize: 17 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs + 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.sm,
    paddingVertical: 5,
    maxWidth: 200,
  },
  chipLabel: { fontFamily: fontFamily.medium, fontSize: 12.5 },
  issues: { gap: space.xs },
  issueRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xs + 2 },
  issueText: { flex: 1 },
  approvedRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs + 2, paddingVertical: space.xs },
  approvedLabel: { fontFamily: fontFamily.medium, fontSize: 14 },
  dualAction: { flexDirection: 'row', gap: space.sm },
  action: {
    minHeight: minTouchTarget,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs + 2,
    paddingHorizontal: space.md,
  },
  actionPrimary: { flex: 1 },
  actionSecondary: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.lg },
  actionLabel: { fontFamily: fontFamily.medium, fontSize: 14 },
});
