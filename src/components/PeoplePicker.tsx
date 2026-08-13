/**
 * PeoplePicker — a bottom-sheet list for choosing people, replacing the
 * cluttered wrap of pill chips wherever a person / participants must be picked
 * (bill split, lending). It opens on demand from an "Add" affordance, shows one
 * tappable row per person with a selection check, and can create a new person
 * inline. Used in both multi-select (participants) and single-select (one
 * person) modes.
 *
 * RN note: this is a plain `Modal` with a slide-up sheet and a tap-to-dismiss
 * backdrop — no extra gesture library. The draft selection lives inside the
 * sheet and is only committed to the caller on "Done", so cancelling leaves the
 * previous selection untouched.
 */
import { Feather } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { initials } from '@/components/PersonRow';
import { useTheme } from '@/theme/ThemeContext';
import { minTouchTarget, radius, space, type } from '@/theme/tokens';

export interface PickerOption {
  id: string;
  name: string;
}

interface Props {
  visible: boolean;
  title?: string;
  options: PickerOption[];
  selectedIds: string[];
  /** Multi-select (default). When false, tapping a row selects it and closes. */
  multiple?: boolean;
  onClose: () => void;
  onDone: (ids: string[]) => void;
  /** Create a new person inline; return the created id so it's pre-selected. */
  onCreatePerson?: (name: string) => Promise<{ id: string }>;
}

export function PeoplePicker({
  visible,
  title = 'Select people',
  options,
  selectedIds,
  multiple = true,
  onClose,
  onDone,
  onCreatePerson,
}: Props) {
  const { colors } = useTheme();
  const [draft, setDraft] = useState<string[]>(selectedIds);

  // Reset the draft to the committed selection each time the sheet opens.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync draft on open
    if (visible) setDraft(selectedIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync only on open
  }, [visible]);

  const toggle = (id: string) => {
    if (!multiple) {
      onDone([id]);
      onClose();
      return;
    }
    setDraft((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const addPerson = () => {
    if (!onCreatePerson) return;
    Alert.prompt('New person', 'Name', async (text) => {
      const trimmed = text?.trim();
      if (!trimmed) return;
      try {
        const person = await onCreatePerson(trimmed);
        if (!multiple) {
          onDone([person.id]);
          onClose();
        } else {
          setDraft((prev) => [...prev, person.id]);
        }
      } catch (e) {
        Alert.alert('Could not add person', String(e));
      }
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <SafeAreaView edges={['bottom']} style={styles.sheetWrap} pointerEvents="box-none">
        <View style={[styles.sheet, { backgroundColor: colors.bg }]}>
          <View style={styles.header}>
            <Text style={[type.h1, { color: colors.text }]}>{title}</Text>
            {onCreatePerson ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add a new person"
                onPress={addPerson}
                hitSlop={space.sm}
                style={styles.headerAction}>
                <Feather name="user-plus" size={22} color={colors.primary} />
              </Pressable>
            ) : null}
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.list}>
            {options.length === 0 ? (
              <Text style={[type.body, styles.empty, { color: colors.textMuted }]}>
                No people yet — add one with the + above.
              </Text>
            ) : (
              options.map((opt) => {
                const selected = draft.includes(opt.id);
                return (
                  <Pressable
                    key={opt.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => toggle(opt.id)}
                    style={[styles.row, { backgroundColor: colors.surface, borderColor: selected ? colors.primary : colors.border }]}>
                    <View style={[styles.avatar, { backgroundColor: colors.primarySoft }]}>
                      <Text style={[type.label, { color: colors.primary }]}>{initials(opt.name)}</Text>
                    </View>
                    <Text numberOfLines={1} style={[type.body, styles.name, { color: colors.text }]}>
                      {opt.name}
                    </Text>
                    <View
                      style={[
                        styles.check,
                        selected
                          ? { backgroundColor: colors.primary, borderColor: colors.primary }
                          : { borderColor: colors.border },
                      ]}>
                      {selected ? <Feather name="check" size={14} color={colors.onPrimary} /> : null}
                    </View>
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              style={[styles.footerButton, { borderColor: colors.border }]}>
              <Text style={[type.h2, { color: colors.text }]}>Cancel</Text>
            </Pressable>
            {multiple ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  onDone(draft);
                  onClose();
                }}
                style={[styles.footerButton, styles.doneButton, { backgroundColor: colors.primary }]}>
                <Text style={[type.h2, { color: colors.onPrimary }]}>Done</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.lg,
  },
  headerAction: {
    minWidth: minTouchTarget,
    minHeight: minTouchTarget,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  scroll: { flexGrow: 0 },
  list: { gap: space.sm, paddingBottom: space.sm },
  empty: { textAlign: 'center', paddingVertical: space.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: minTouchTarget + space.sm,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { flex: 1 },
  check: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    flexDirection: 'row',
    gap: space.md,
    paddingTop: space.lg,
    paddingBottom: space.md,
  },
  footerButton: {
    flex: 1,
    minHeight: minTouchTarget + space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneButton: { borderWidth: 0 },
});
