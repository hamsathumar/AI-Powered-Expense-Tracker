/**
 * Strip the push-notification entitlement (TC-027 follow-up).
 *
 * Kaasu only ever schedules LOCAL notifications — `scheduleNotificationAsync`
 * with `trigger: null`, telling the user a voice parse they started has landed.
 * It never registers for remote push and has no notification server.
 *
 * `expo-notifications` cannot know that, so its config plugin adds
 * `aps-environment` to the iOS entitlements, which flips on the Push
 * Notifications capability. A **free personal Apple developer team cannot sign
 * that capability**, so `expo run:ios` fails at the provisioning step:
 *
 *   Cannot create a iOS App Development provisioning profile for
 *   "com.hamsath.kaasu". Personal development teams … do not support the Push
 *   Notifications capability.
 *
 * Removing the entitlement costs nothing here: local notifications are
 * delivered by the OS on-device and require no entitlement at all. If Kaasu
 * ever needs real push (it will not — it is single-user and offline-first),
 * this plugin is the one thing to delete, and it would require a paid Apple
 * Developer Program membership.
 *
 * ORDERING (verified empirically, and it is the opposite of what it looks
 * like): this must be listed BEFORE "expo-notifications" in app.json. Expo
 * config-plugin mods chain by WRAPPING — each newly registered mod runs its own
 * action first and then calls the previously registered one — so the LAST entry
 * in the plugins array runs FIRST. Listing this after expo-notifications makes
 * the delete run before their add, and the entitlement survives.
 *
 * Verify after any change to the plugins array:
 *   npx expo prebuild -p ios && cat ios/Kaasu/Kaasu.entitlements
 * It should print an empty <dict/>.
 */
const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = function withLocalNotificationsOnly(config) {
  return withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults['aps-environment'];
    return cfg;
  });
};
