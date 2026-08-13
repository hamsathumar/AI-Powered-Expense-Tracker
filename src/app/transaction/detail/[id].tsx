/**
 * Transaction detail (design-system-v2.md §5.14) — a read view for an existing
 * transaction: a centred amount card (category tile, signed amount coloured by
 * type, name, provenance chip), a label/value card, and — for voice items —
 * the "What you said" transcript. Footer: Edit (pending only, since approved
 * rows are historical facts) + Delete.
 */
import { Feather } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Amount } from '@/components/Amount';
import { ScreenHeader } from '@/components/ScreenHeader';
import { deleteTransaction, getTransactionItem, type TransactionListItem } from '@/db/queries/transactions';
import type { LendingDirection } from '@/domain/types';
import { fontFamily, layout, minTouchTarget, radius, screenPaddingH, space, tabularNums, type } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeContext';

const LENDING_LABELS: Record<LendingDirection, (name: string) => string> = {
  lend: (n) => `Lent to ${n}`,
  lend_repayment_received: (n) => `${n} repaid you`,
  borrow: (n) => `Borrowed from ${n}`,
  borrow_repayment_made: (n) => `Repaid ${n}`,
};

const TYPE_ICONS: Record<'transfer' | 'lending', ComponentProps<typeof Feather>['name']> = {
  transfer: 'repeat',
  lending: 'users',
};

const SOURCE_LABEL = { voice: 'voice', manual: 'you', recurring: 'a schedule', bill_split: 'a split' } as const;
const STATUS_LABEL = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' } as const;

const bigAmount = { fontFamily: fontFamily.headingBold, fontSize: 34, lineHeight: 40, ...tabularNums };

export default function TransactionDetailScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [item, setItem] = useState<TransactionListItem | null>(null);

  useFocusEffect(
    useCallback(() => {
      getTransactionItem(id)
        .then((found) => {
          if (!found) throw new Error('Transaction not found');
          setItem(found);
        })
        .catch((e) => {
          Alert.alert('Not found', String(e));
          router.back();
        });
    }, [id, router]),
  );

  if (!item) {
    return <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]} edges={['top']} />;
  }

  const { tx } = item;
  const icon =
    tx.type === 'expense' || tx.type === 'income'
      ? ((item.categoryIcon as ComponentProps<typeof Feather>['name']) ?? 'circle')
      : TYPE_ICONS[tx.type];
  const iconColor = item.categoryColor ?? colors[tx.type];

  const rows: { label: string; value: string }[] = [];
  if (tx.type === 'expense' || tx.type === 'income') {
    rows.push({ label: 'Category', value: item.categoryName ?? '—' });
    rows.push({ label: 'Account', value: item.accountName ?? '—' });
  } else if (tx.type === 'transfer') {
    rows.push({ label: 'From', value: item.accountName ?? '—' });
    rows.push({ label: 'To', value: item.toAccountName ?? '—' });
  } else {
    rows.push({ label: 'Account', value: item.accountName ?? '—' });
    rows.push({ label: 'Direction', value: LENDING_LABELS[tx.direction](item.personName ?? '—') });
  }
  rows.push({ label: 'When', value: format(new Date(tx.occurredAt), 'd MMM yyyy · HH:mm') });
  if ((tx.type === 'expense' || tx.type === 'income') && item.personName) {
    rows.push({ label: 'Person', value: item.personName });
  }
  if (tx.description) rows.push({ label: 'Note', value: tx.description });

  const confirmDelete = () => {
    Alert.alert('Delete transaction?', 'This removes it permanently and cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => deleteTransaction(tx.id).then(() => router.back()),
      },
    ]);
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScreenHeader
        title="Transaction"
        right={
          tx.status === 'pending' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit"
              onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: tx.id } })}
              hitSlop={space.sm}>
              <Feather name="edit-2" size={20} color={colors.textMuted} />
            </Pressable>
          ) : undefined
        }
      />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={[styles.amountCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.tile, { backgroundColor: `${iconColor}22` }]}>
            <Feather name={icon} size={26} color={iconColor} />
          </View>
          <Amount valueMinor={tx.amountMinor} txType={tx.type} textStyle={bigAmount} />
          <Text style={[type.h2, { color: colors.text }]}>{tx.name}</Text>
          <View style={[styles.provenance, { backgroundColor: colors.surfaceAlt }]}>
            <Feather name={tx.source === 'voice' ? 'mic' : 'edit-3'} size={13} color={colors.primary} />
            <Text style={[type.caption, { color: colors.textMuted }]}>
              Added by {SOURCE_LABEL[tx.source]} · {STATUS_LABEL[tx.status]}
            </Text>
          </View>
        </View>

        <View style={[styles.rowsCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {rows.map((row, i) => (
            <View
              key={row.label}
              style={[
                styles.row,
                i < rows.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
              ]}>
              <Text style={[type.caption, { color: colors.textMuted }]}>{row.label}</Text>
              <Text style={[type.body, styles.value, { color: colors.text }]}>{row.value}</Text>
            </View>
          ))}
        </View>

        {tx.transcript ? (
          <View style={[styles.transcriptCard, { backgroundColor: colors.surfaceAlt }]}>
            <Text style={[type.sectionLabel, { color: colors.textSubtle }]}>What you said</Text>
            <Text style={[styles.transcript, { color: colors.textMuted }]}>“{tx.transcript}”</Text>
          </View>
        ) : null}

        <View style={styles.footer}>
          {tx.status === 'pending' ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: tx.id } })}
              style={[styles.editButton, { backgroundColor: colors.primary }]}>
              <Feather name="edit-2" size={18} color={colors.onPrimary} />
              <Text style={[type.h2, { color: colors.onPrimary }]}>Edit</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete"
            onPress={confirmDelete}
            style={[styles.deleteButton, { borderColor: colors.border }, tx.status !== 'pending' && styles.deleteWide]}>
            <Feather name="trash-2" size={18} color={colors.expense} />
            {tx.status !== 'pending' ? (
              <Text style={[type.h2, { color: colors.expense }]}>Delete</Text>
            ) : null}
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { paddingHorizontal: screenPaddingH, paddingTop: space.sm, paddingBottom: space.xxl, gap: space.md },
  amountCard: {
    alignItems: 'center',
    gap: space.sm,
    borderRadius: layout.heroCardRadius,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.xl,
  },
  tile: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  provenance: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  rowsCard: {
    borderRadius: layout.cardRadius,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: space.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.xl,
    paddingVertical: space.md + 2,
  },
  value: { flexShrink: 1, textAlign: 'right' },
  transcriptCard: { borderRadius: layout.cardRadius, padding: space.lg, gap: space.xs },
  transcript: { fontFamily: fontFamily.body, fontSize: 15, lineHeight: 22, fontStyle: 'italic' },
  footer: { flexDirection: 'row', gap: space.sm + 2, paddingTop: space.sm },
  editButton: {
    flex: 1,
    minHeight: minTouchTarget + space.sm,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  deleteButton: {
    minWidth: minTouchTarget + space.sm,
    minHeight: minTouchTarget + space.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  deleteWide: { flex: 1 },
});
