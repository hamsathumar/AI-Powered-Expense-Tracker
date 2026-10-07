/**
 * "Why?" — what happened inside one voice capture (Transaction AI V1.3,
 * Phase C): what was heard, what came out, whether the critic re-read it,
 * what the app's checks adjusted, and Gemini's raw answer.
 *
 * Read-only and local. Share sends the plain-text report through the iOS share
 * sheet — the only way it ever leaves the phone, and only when the user asks.
 */
import { Feather } from '@expo/vector-icons';
import { type ReactNode, useState } from 'react';
import { Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { describeCritic, diagnosticsReport, type VoiceDiagnostics } from '@/ai/diagnostics';
import { formatAmount } from '@/domain/money';
import { useTheme } from '@/theme/ThemeContext';
import { fontFamily, layout, minTouchTarget, radius, screenPaddingH, space, type } from '@/theme/tokens';

interface Props {
  diagnostics: VoiceDiagnostics | null;
  visible: boolean;
  onClose: () => void;
}

export function VoiceDiagnosticsSheet({ diagnostics, visible, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {visible && diagnostics ? <SheetBody d={diagnostics} onClose={onClose} /> : null}
    </Modal>
  );
}

function Section({ title, color, children }: { title: string; color: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={[type.sectionLabel, { color }]}>{title}</Text>
      {children}
    </View>
  );
}

function SheetBody({ d, onClose }: { d: VoiceDiagnostics; onClose: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [showRaw, setShowRaw] = useState(false);

  const share = () => {
    Share.share({ message: diagnosticsReport(d) }).catch(() => {});
  };

  return (
    <View style={styles.root}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.scrim} />
      <View style={[styles.sheet, { backgroundColor: colors.bg, paddingBottom: insets.bottom + space.md }]}>
        <View style={styles.grabberRow}>
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />
        </View>
        <View style={styles.titleRow}>
          <Text style={[type.h1, styles.title, { color: colors.text }]}>Why it read this way</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Share diagnostics" onPress={share} hitSlop={space.sm} style={styles.iconHit}>
            <Feather name="share" size={20} color={colors.primary} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={space.sm} style={styles.iconHit}>
            <Feather name="x" size={22} color={colors.textMuted} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Section title="Heard" color={colors.textSubtle}>
            <Text style={[type.body, { color: colors.text }]}>“{d.transcript}”</Text>
            <Text style={[type.caption, { color: colors.textMuted }]}>Model: {d.model}</Text>
          </Section>

          <Section title="Result" color={colors.textSubtle}>
            {d.operations.length === 0 ? (
              <Text style={[type.body, { color: colors.textMuted }]}>Nothing was recorded.</Text>
            ) : (
              d.operations.map((o, i) => (
                <View key={i} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                  <Text style={[type.body, { color: colors.text }]}>
                    {o.name} · {o.kind} · {o.amountMinor === null ? 'no amount' : formatAmount(o.amountMinor)}
                  </Text>
                  {o.blockers.length === 0 ? (
                    <Text style={[type.caption, { color: colors.textMuted }]}>Ready to approve</Text>
                  ) : (
                    o.blockers.map((b, j) => (
                      <Text key={j} style={[type.caption, { color: colors.textMuted }]}>
                        • {b}
                      </Text>
                    ))
                  )}
                </View>
              ))
            )}
          </Section>

          <Section title="Second check (critic)" color={colors.textSubtle}>
            <Text style={[type.body, { color: colors.text }]}>{describeCritic(d.critic)}</Text>
            {[...d.criticMissing.map((m) => `Missing: ${m}`), ...d.criticDuplicated.map((m) => `Counted twice: ${m}`)].map(
              (line, i) => (
                <Text key={i} style={[type.caption, { color: colors.textMuted }]}>
                  {line}
                </Text>
              ),
            )}
          </Section>

          <Section title="What the app adjusted" color={colors.textSubtle}>
            {d.validationIssues.length === 0 ? (
              <Text style={[type.body, { color: colors.textMuted }]}>Nothing — the reading was used as given.</Text>
            ) : (
              d.validationIssues.map((issue, i) => (
                <Text key={i} style={[type.body, { color: colors.text }]}>
                  • {issue}
                </Text>
              ))
            )}
          </Section>

          <Section title="Gemini's answer" color={colors.textSubtle}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowRaw((v) => !v)}
              style={[styles.toggle, { backgroundColor: colors.surfaceAlt }]}>
              <Feather name={showRaw ? 'chevron-up' : 'chevron-down'} size={16} color={colors.text} />
              <Text style={[type.label, { color: colors.text }]}>{showRaw ? 'Hide' : 'Show'} the raw response</Text>
            </Pressable>
            {showRaw ? (
              <>
                <Text selectable style={[styles.mono, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}>
                  {d.rawResponse}
                </Text>
                {d.repairedResponse ? (
                  <>
                    <Text style={[type.caption, { color: colors.textMuted }]}>
                      Re-read ({d.critic === 'applied' ? 'used' : 'not used'}):
                    </Text>
                    <Text selectable style={[styles.mono, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}>
                      {d.repairedResponse}
                    </Text>
                  </>
                ) : null}
              </>
            ) : null}
          </Section>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  // Conventional modal scrim (chrome, not a themeable design colour).
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    maxHeight: '90%',
    borderTopLeftRadius: layout.sheetRadius,
    borderTopRightRadius: layout.sheetRadius,
    overflow: 'hidden',
  },
  grabberRow: { alignItems: 'center', paddingTop: space.sm },
  grabber: { width: 36, height: 4, borderRadius: radius.pill },
  titleRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: screenPaddingH, gap: space.sm },
  title: { flex: 1 },
  iconHit: { minWidth: minTouchTarget, minHeight: minTouchTarget, alignItems: 'center', justifyContent: 'center' },
  body: { padding: screenPaddingH, gap: space.xl, paddingBottom: space.xl },
  section: { gap: space.sm },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: space.md, gap: 2 },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    minHeight: minTouchTarget - space.sm,
  },
  mono: {
    fontFamily: fontFamily.mono,
    fontSize: 11,
    lineHeight: 15,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: space.md,
  },
});
