import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextProps,
  View,
  ViewStyle,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ServiceName } from './rounds';
import { fonts, SERVICE_META, useTheme } from './theme';

export function Screen({ label, children }: { label: string; children: React.ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { backgroundColor: t.bg }]}>
      <View style={[styles.spine, { backgroundColor: t.shell, borderColor: t.hairline, paddingTop: insets.top + 14 }]}>
        <ReelHoles color={t.reel} />
        <Label style={styles.spineLabel}>{label}</Label>
      </View>
      <View style={[styles.body, { paddingBottom: 20 + insets.bottom }]}>{children}</View>
    </View>
  );
}

export function ReelHoles({ color }: { color: string }) {
  return (
    <View style={styles.reelHoles} pointerEvents="none">
      <View style={[styles.reelHole, { borderColor: color }]} />
      <View style={[styles.reelHole, { borderColor: color }]} />
    </View>
  );
}

export function ReelSpinner({ color }: { color?: string }) {
  const t = useTheme();
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const c = color ?? t.accent;
  return (
    <View style={styles.spinnerRow}>
      {[0, 1].map((i) => (
        <Animated.View key={i} style={[styles.spinnerHub, { borderColor: c, transform: [{ rotate }] }]}>
          <View style={[styles.spinnerSpoke, { backgroundColor: c }]} />
        </Animated.View>
      ))}
    </View>
  );
}

export function JCard({ style, children }: { style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const t = useTheme();
  return <View style={[styles.card, { backgroundColor: t.shell, borderColor: t.hairline }, style]}>{children}</View>;
}

export function Label({ style, children, ...props }: TextProps) {
  const t = useTheme();
  return (
    <Text {...props} style={[styles.label, { color: t.inkMuted, fontFamily: fonts.mono }, style]}>
      {children}
    </Text>
  );
}

export function HandText({ style, children, ...props }: TextProps) {
  const t = useTheme();
  return (
    <Text {...props} style={[{ color: t.ink, fontFamily: fonts.hand, fontSize: 26 }, style]}>
      {children}
    </Text>
  );
}

export function BodyText({ style, children, ...props }: TextProps) {
  const t = useTheme();
  return (
    <Text {...props} style={[{ color: t.ink, fontFamily: fonts.mono, fontSize: 14 }, style]}>
      {children}
    </Text>
  );
}

export function ServiceBadge({ service }: { service: ServiceName }) {
  const meta = SERVICE_META[service];
  return (
    <View style={[styles.badge, { backgroundColor: meta?.color ?? '#666' }]}>
      <Label style={[styles.badgeText, { color: '#fff' }]}>{meta?.label ?? service}</Label>
    </View>
  );
}

export function RoundGate({
  label,
  error,
  ready,
  children,
}: {
  label: string;
  error: string | null;
  ready: boolean;
  children: React.ReactNode;
}) {
  if (error) {
    return (
      <Screen label={label}>
        <ErrorNote>{error}</ErrorNote>
        <TapeButton title="Back to home" onPress={() => router.replace('/home')} />
      </Screen>
    );
  }
  if (!ready) {
    return (
      <Screen label={label}>
        <ReelSpinner />
      </Screen>
    );
  }
  return <>{children}</>;
}

export function PressScale({
  children,
  style,
  ...props
}: PressableProps & { style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v: number) => Animated.timing(scale, { toValue: v, duration: 110, useNativeDriver: true }).start();
  return (
    <Pressable
      {...props}
      onPressIn={(e) => {
        to(0.97);
        props.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        to(1);
        props.onPressOut?.(e);
      }}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

export function TapeButton({
  title,
  onPress,
  disabled,
  variant = 'primary',
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  const t = useTheme();
  const primary = variant === 'primary';
  return (
    <PressScale
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        {
          backgroundColor: primary ? t.accent : t.shell,
          borderColor: primary ? t.accent : t.hairline,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Label style={[styles.buttonText, { color: primary ? t.accentInk : t.ink }]}>{title}</Label>
    </PressScale>
  );
}

export function TapeInput(props: TextInputProps) {
  const t = useTheme();
  return (
    <TextInput
      placeholderTextColor={t.inkMuted}
      {...props}
      style={[styles.input, { borderColor: t.hairline, color: t.ink, fontFamily: fonts.mono }, props.style]}
    />
  );
}

export function Sprocket() {
  const t = useTheme();
  return <View style={[styles.sprocket, { borderColor: t.hairline }]} />;
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <Label style={{ color: t.accent }}>{children}</Label>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  spine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 60,
    paddingBottom: 14,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
  },
  spineLabel: { fontSize: 13, letterSpacing: 2 },
  body: { flex: 1, padding: 20, gap: 14 },
  reelHoles: { flexDirection: 'row', gap: 4 },
  reelHole: { width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 10,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.16,
    shadowRadius: 6,
    elevation: 3,
  },
  label: { fontSize: 12, letterSpacing: 1.5 },
  badge: { borderRadius: 4, paddingVertical: 3, paddingHorizontal: 6, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, letterSpacing: 1 },
  button: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 13, letterSpacing: 1.5 },
  input: { borderWidth: 1, borderRadius: 8, padding: 12, fontSize: 14, minHeight: 44 },
  sprocket: { borderTopWidth: 1, borderStyle: 'dashed', marginVertical: 4 },
  spinnerRow: { flexDirection: 'row', gap: 16, alignSelf: 'center' },
  spinnerHub: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  spinnerSpoke: { width: 2, height: 11, position: 'absolute', top: 2 },
});
