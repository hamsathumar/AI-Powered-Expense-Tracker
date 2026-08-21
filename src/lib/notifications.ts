/**
 * Local notifications for finished voice parses (TC-027).
 *
 * Scope is deliberately tiny: Kaasu never registers for push, never talks to a
 * notification server, and only ever schedules a LOCAL notification about work
 * the user themselves started. Nothing financial is put in the body beyond what
 * the user just said out loud.
 *
 * Honest limitation: iOS suspends a backgrounded app, so a long Gemini call
 * usually finishes only once Kaasu is foregrounded again — in that case the
 * notification arrives as an in-app banner rather than on the lock screen. When
 * the request does complete inside iOS's short post-background grace window,
 * the notification genuinely lands while the user is elsewhere. Both are
 * useful; neither pretends to be true background execution.
 */
import * as Notifications from 'expo-notifications';

let handlerInstalled = false;
let permissionGranted: boolean | null = null;

/** Show the banner even when Kaasu is the foreground app. */
function installHandler(): void {
  if (handlerInstalled) return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/**
 * Ask once, cache the answer. A refusal is respected silently — notifications
 * are a convenience, never a requirement for logging a transaction.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (permissionGranted !== null) return permissionGranted;
  try {
    installHandler();
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) {
      permissionGranted = true;
      return true;
    }
    if (!current.canAskAgain) {
      permissionGranted = false;
      return false;
    }
    const asked = await Notifications.requestPermissionsAsync();
    permissionGranted = asked.granted;
    return asked.granted;
  } catch {
    permissionGranted = false;
    return false;
  }
}

export interface ParseNotification {
  title: string;
  body: string;
}

/**
 * Fire-and-forget. Any failure here is swallowed: a missing notification must
 * never take down a parse that actually succeeded.
 */
export async function notifyVoiceParse(content: ParseNotification): Promise<void> {
  try {
    if (!(await ensureNotificationPermission())) return;
    await Notifications.scheduleNotificationAsync({
      content: { title: content.title, body: content.body },
      trigger: null, // deliver now
    });
  } catch {
    // ignore — cosmetic
  }
}
