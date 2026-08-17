/**
 * Voice review list (Transaction AI V1) — the AI-interpreted pending operations
 * produced by the voice pipeline.
 *
 * Rendered HEADERLESS inside Home's single "To review" section (alongside the
 * manual pending-transaction queue) so there is exactly one review heading and
 * one empty state. It loads its own data on focus and reports its item count up
 * via `onCountChange` so Home can drive the shared header badge / empty card.
 *
 * Every Approve routes through the deterministic final safety gate
 * (commitPendingOperation); an operation with unresolved fields or a conflict is
 * NOT approvable and must be opened/edited first. Renders nothing when empty.
 */
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Amount } from '@/components/Amount';
import {
  commitPendingOperation,
  evaluateAllPending,
  type EvaluatedPending,
} from '@/ai/commitOperation';
import { deletePendingOperation } from '@/db/queries/pendingOperations';
import { useTheme } from '@/theme/ThemeContext';
import { fontFamily, layout, minTouchTarget, radius, space, type } from '@/theme/tokens';

function metaLine(item: EvaluatedPending): string {
  const { op } = item;
  if (op.kind === 'bill_split') return 'Bill Split · review & edit';
  if (op.kind === 'recurring') return 'Recurring · review & edit';
  const parts: string[] = [];
  const acc = op.account?.status === 'resolved' ? op.account.reference ?? 'Account' : 'Account needed';
  parts.push(acc);
  if (op.kind === 'expense' || op.kind === 'income') {
    parts.push(op.category?.status === 'resolved' ? op.category.reference ?? 'Category' : 'Category needed');
  }
  if (op.kind === 'transfer') {
    parts.push(op.toAccount?.status === 'resolved' ? `→ ${op.toAccount.reference ?? ''}` : '→ needed');
  }
  if (op.kind === 'lending') {
    parts.push(op.person?.status === 'resolved' ? op.person.reference ?? 'Person' : 'Person needed');
  }
  return parts.join(' · ');
}

interface Props {
  /** Reports the current pending-operation count to Home (shared header/empty). */
  onCountChange?: (n: number) => void;
}

export function VoiceReviewSection({ onCountChange }: Props) {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const [items, setItems] = useState<EvaluatedPending[]>([]);

  const reload = useCallback(() => {
    evaluateAllPending()
      .then(setItems)
      .catch((e) => Alert.alert('Review error', String(e)));
  }, []);
  useFocusEffect(reload);

  // Keep Home's shared badge / empty-state in sync (effect, not during render).
  useEffect(() => onCountChange?.(items.length), [items, onCountChange]);

  const isSpecialized = (item: EvaluatedPending) =>
    item.op.kind === 'bill_split' || item.op.kind === 'recurring';

  const openEditor = (item: EvaluatedPending) => {
    if (item.op.kind === 'bill_split') {
      router.push({ pathname: '/bill-split', params: { fromPending: item.id } });
    } else if (item.op.kind === 'recurring') {
      router.push({ pathname: '/recurring/new', params: { fromPending: item.id } });
    }
  };

  const edit = (item: EvaluatedPending) => {
    if (isSpecialized(item)) openEditor(item);
    else router.push({ pathname: '/review/[id]', params: { id: item.id } });
  };

  const approve = (item: EvaluatedPending) => {
    // Specialized operations are completed in their dedicated editors — they
    // are never committed through the ordinary gate from the queue.
    if (isSpecialized(item)) {
      openEditor(item);
      return;
    }
    if (!item.gate.approvable) {
      router.push({ pathname: '/review/[id]', params: { id: item.id } });
      return;
    }
    commitPendingOperation(item.id).then((res) => {
      if (!res.committed) {
        Alert.alert('Not ready', res.blockers.map((b) => b.message).join('\n'));
      }
      reload();
    });
  };

  const reject = (item: EvaluatedPending) => {
    deletePendingOperation(item.id).then(reload);
  };

  if (items.length === 0) return null;

  return (
    <View style={styles.list}>
      {items.map((item) => {
          const specialized = isSpecialized(item);
          const blocked = !item.gate.approvable;
          const primaryLabel = specialized ? 'Review & Edit' : blocked ? 'Finish details' : 'Approve';
          const primaryIcon = specialized || blocked ? 'edit-2' : 'check';
          const primaryFilled = !specialized && !blocked;
          return (
            <View key={item.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.body}>
                <View style={styles.middle}>
                  <View style={styles.titleRow}>
                    <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
                      {item.op.name}
                    </Text>
                    <Amount valueMinor={item.op.amountMinor} txType={item.op.operation} />
                  </View>
                  <Text numberOfLines={1} style={[type.caption, { color: colors.textMuted }]}>
                    {metaLine(item)}
                  </Text>
                  {item.op.transcript ? (
                    <Text numberOfLines={2} style={[styles.transcript, { color: colors.textSubtle }]}>
                      “{item.op.transcript}”
                    </Text>
                  ) : null}
                  {blocked && !specialized ? (
                    <View style={styles.flagRow}>
                      {item.gate.blockers.slice(0, 3).map((b, i) => (
                        <View key={i} style={[styles.flagPill, { borderColor: colors.warning }]}>
                          <Text style={[type.caption, { color: isDark ? colors.warning : colors.lending }]}>
                            {b.message}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              </View>

              <View style={styles.actions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={primaryLabel}
                  onPress={() => approve(item)}
                  style={[
                    styles.approve,
                    { backgroundColor: primaryFilled ? colors.positiveFill : colors.surfaceAlt },
                  ]}>
                  <Feather
                    name={primaryIcon}
                    size={15}
                    color={primaryFilled ? colors.onFilled : specialized ? colors.primary : colors.text}
                  />
                  <Text
                    style={[
                      styles.approveLabel,
                      { color: primaryFilled ? colors.onFilled : specialized ? colors.primary : colors.text },
                    ]}>
                    {primaryLabel}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Edit"
                  onPress={() => edit(item)}
                  style={[styles.iconButton, { borderColor: colors.border }]}>
                  <Feather name="sliders" size={15} color={colors.textMuted} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Reject"
                  onPress={() => reject(item)}
                  style={[styles.iconButton, { borderColor: colors.border }]}>
                  <Feather name="x" size={16} color={colors.expense} />
                </Pressable>
              </View>
            </View>
          );
        })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.md - 2 },
  card: { borderRadius: layout.cardRadius, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  body: { flexDirection: 'row', gap: space.md, paddingTop: space.md + 2, paddingHorizontal: space.md + 2, paddingBottom: space.sm + 2 },
  middle: { flex: 1, gap: space.xs },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm },
  name: { flex: 1, fontFamily: fontFamily.heading, fontSize: 16 },
  transcript: { fontFamily: fontFamily.body, fontSize: 13, lineHeight: 19, fontStyle: 'italic' },
  flagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, paddingTop: 2 },
  flagPill: { borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.sm, paddingVertical: 1 },
  actions: { flexDirection: 'row', gap: space.sm, paddingLeft: space.md + 2, paddingRight: space.md + 2, paddingBottom: space.md + 2 },
  approve: { flex: 1, minHeight: minTouchTarget, borderRadius: radius.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs + 2 },
  approveLabel: { fontFamily: fontFamily.medium, fontSize: 13 },
  iconButton: { width: minTouchTarget, minHeight: minTouchTarget, borderRadius: radius.pill, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
});
