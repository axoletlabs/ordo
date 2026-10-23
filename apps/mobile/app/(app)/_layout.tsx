/**
 * Authenticated library stack. Details retain native push/pop motion and
 * singular route identities, including when multiple taps are queued.
 */
import React, { useEffect } from "react";
import { Platform, View } from "react-native";
import { Stack } from "expo-router";
import { enableFreeze } from "react-native-screens";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useReducedMotionPreference } from "../../src/hooks/use-reduced-motion-preference";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useServerInfo, useValidateSession } from "../../src/hooks/queries";
import { useAuthStore } from "../../src/store/auth";
import { screenAnimationDuration, stackScreenAnimation } from "../../src/lib/navigation-animation";
import { resolveStackNavigationAnimation } from "../../src/lib/navigation-animation-policy";
import { useSettingsStore } from "../../src/store/settings";
import { MfaEnrollmentScreen } from "../../src/components/auth/MfaEnrollmentScreen";
import { ReminderNotificationHost } from "../../src/components/bookmarks/ReminderNotificationHost";
import { PageTransition } from "../../src/components/ui/PageTransition";
import { ChangelogAnnouncementHost } from "../../src/components/settings/ChangelogAnnouncementHost";
import { useOverlayFocus } from "../../src/hooks/use-overlay-focus";
import { AnimationActivityContext } from "../../src/hooks/use-animation-activity";

enableFreeze(true);

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

/**
 * Full-screen MFA enrollment surface. It appears once the server's
 * mfa-required answer lands, which can be after the library painted — so it
 * fades in like an incoming page instead of popping over the content.
 */
function MfaEnrollmentGate() {
  const { palette } = useTheme();
  const reducedMotion = useReducedMotionPreference();
  const opacity = useSharedValue(0);
  const focusRef = useOverlayFocus(true, () => {}, "dialog", false);

  useEffect(() => {
    opacity.value = withTiming(1, { duration: reducedMotion ? 0 : 200 });
  }, [opacity, reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      ref={focusRef}
      {...(Platform.OS === "web" ? { dataSet: { materialOverlay: "true" } } : {})}
      accessibilityViewIsModal
      importantForAccessibility="yes"
      style={[
        {
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 40,
          elevation: 40,
          backgroundColor: palette.background,
        },
        animatedStyle,
      ]}
    >
      <MfaEnrollmentScreen />
    </Animated.View>
  );
}

/**
 * Themed blank surface shown while the router holds this group before the
 * auth redirect reconciles (web URLs can deep-link into "/" = the library).
 * The launch cover sits above it, so it is a safety net, not a screen.
 */
function UnauthenticatedSurface() {
  const { palette } = useTheme();
  return <View style={{ flex: 1, backgroundColor: palette.background }} />;
}

export default function AppLayout() {
  const status = useAuthStore((s) => s.status);

  // Latch once this layout instance has seen a session. The router can mount
  // this group while logged out (web URL resolution); without the latch that
  // fires the entire library query volley behind the splash. After the first
  // authentication the content instead stays mounted through the sign-out
  // crossfade, keeping the outgoing library painted.
  const [seenAuthenticated, setSeenAuthenticated] = React.useState(
    status === "authenticated",
  );
  useEffect(() => {
    if (status === "authenticated") setSeenAuthenticated(true);
  }, [status]);

  if (!seenAuthenticated) return <UnauthenticatedSurface />;
  return <AuthenticatedAppLayout />;
}

function renderStackScreen({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}

/** Keep host activity below the navigation shell. Inherit only the legacy
 * boolean: the host scope and app foreground are combined by each animation
 * leaf hook, so the Stack never republishes those subscriptions as a context
 * value across the screen tree. */
function StackActivity({ paused, children }: { paused: boolean; children: React.ReactNode }) {
  const inheritedActive = React.useContext(AnimationActivityContext);
  return (
    <AnimationActivityContext.Provider value={inheritedActive && !paused}>
      {children}
    </AnimationActivityContext.Provider>
  );
}

function AuthenticatedAppLayout() {
  const { palette } = useTheme();
  // Reader/account preference saves replace `user`. The navigation shell only
  // needs the enrollment gate, not those unrelated account fields.
  const userNeedsMfa = useAuthStore((s) => Boolean(s.user && !s.user.mfaEnabled));
  const status = useAuthStore((s) => s.status);
  const reducedMotion = useReducedMotionPreference();
  const navigationAnimation = resolveStackNavigationAnimation(
    useSettingsStore((s) => s.navigationAnimation),
  );
  const { data: serverInfo } = useServerInfo();
  useValidateSession();

  const needsMfaEnrollment = Boolean(serverInfo?.mfaRequired && userNeedsMfa);
  const contentRef = React.useRef<View>(null);
  React.useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const root = contentRef.current as unknown as HTMLElement | null;
    if (!root) return;
    root.inert = needsMfaEnrollment;
    return () => { root.inert = false; };
  }, [needsMfaEnrollment]);

  const stack = (
    <Stack
      screenLayout={renderStackScreen}
      screenOptions={{
        headerShown: false,
        animation: reducedMotion ? "none" : stackScreenAnimation(navigationAnimation),
        animationDuration: screenAnimationDuration(navigationAnimation),
        freezeOnBlur: true,
        contentStyle: { backgroundColor: palette.background },
        fullScreenGestureEnabled: true,
      }}
    >
      <Stack.Screen name="(tabs)" options={{ animation: "none", gestureEnabled: false }} />
      {/* Identity is owned by the router, so even queued double taps reuse one screen. */}
      <Stack.Screen name="folder/[id]" dangerouslySingular />
      <Stack.Screen name="reader/[id]" dangerouslySingular />
      <Stack.Screen name="tags/index" dangerouslySingular />
      <Stack.Screen name="tags/[id]" dangerouslySingular />
      <Stack.Screen name="settings/index" dangerouslySingular />
      <Stack.Screen name="settings/sessions" dangerouslySingular />
      <Stack.Screen name="settings/about" dangerouslySingular />
      <Stack.Screen name="settings/account" dangerouslySingular />
      <Stack.Screen name="settings/appearance" dangerouslySingular />
      <Stack.Screen name="settings/controls" dangerouslySingular />
      <Stack.Screen name="settings/data" dangerouslySingular />
      <Stack.Screen name="settings/server" dangerouslySingular />
      <Stack.Screen name="settings/display-name" dangerouslySingular />
      <Stack.Screen name="settings/security" dangerouslySingular />
      <Stack.Screen name="settings/email" dangerouslySingular />
      <Stack.Screen name="settings/verify-email" dangerouslySingular />
      <Stack.Screen name="settings/password" dangerouslySingular />
      <Stack.Screen name="settings/delete-account" dangerouslySingular />
    </Stack>
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <View ref={contentRef} style={{ flex: 1 }} pointerEvents={needsMfaEnrollment ? "none" : "auto"}
        accessibilityElementsHidden={needsMfaEnrollment}
        importantForAccessibility={needsMfaEnrollment ? "no-hide-descendants" : "auto"}
        {...(Platform.OS === "web" ? { "aria-hidden": needsMfaEnrollment } : {})}>
        <StackActivity paused={needsMfaEnrollment}>
          {stack}
          <ReminderNotificationHost />
        </StackActivity>
      </View>
      <ChangelogAnnouncementHost enabled={status === "authenticated" && Boolean(serverInfo) && !needsMfaEnrollment} />
      {needsMfaEnrollment ? <MfaEnrollmentGate /> : null}
    </View>
  );
}
