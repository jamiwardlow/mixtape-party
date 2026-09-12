import {
  ActivityIndicator,
  Button,
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
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ServiceName } from './rounds';
import { SERVICE_META, useTheme } from './theme';

// Deliberately undesigned: stock React Native primitives and system fonts while
// the rest of the app is built out. The cassette/J-card look was removed, but
// its component names stay so the screens are untouched and a real design can
// land here without editing them again.

export function Screen({ label, children }: { label: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: t.bg }]} edges={['top', 'bottom']}>
      <View style={[styles.header, { borderBottomColor: t.hairline }]}>
        <Text style={[styles.headerText, { color: t.ink }]}>{label}</Text>
      </View>
      <View style={styles.body}>{children}</View>
    </SafeAreaView>
  );
}

// Cassette reel holes; nothing to draw without the cassette. Kept so callers compile.
export function ReelHoles(_props: { color: string }) {
  return null;
}

export function ReelSpinner({ color }: { color?: string }) {
  return <ActivityIndicator color={color} style={styles.spinner} />;
}

export function JCard({ style, children }: { style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const t = useTheme();
  return <View style={[styles.card, { backgroundColor: t.shell, borderColor: t.hairline }, style]}>{children}</View>;
}

export function Label({ style, children, ...props }: TextProps) {
  const t = useTheme();
  return (
    <Text {...props} style={[styles.label, { color: t.inkMuted }, style]}>
      {children}
    </Text>
  );
}

export function HandText({ style, children, ...props }: TextProps) {
  const t = useTheme();
  return (
    <Text {...props} style={[styles.heading, { color: t.ink }, style]}>
      {children}
    </Text>
  );
}

export function BodyText({ style, children, ...props }: TextProps) {
  const t = useTheme();
  return (
    <Text {...props} style={[styles.body_, { color: t.ink }, style]}>
      {children}
    </Text>
  );
}

export function ServiceBadge({ service }: { service: ServiceName }) {
  return <Label>{SERVICE_META[service]?.label ?? service}</Label>;
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
  return (
    <Pressable {...props}>
      <View style={style}>{children}</View>
    </Pressable>
  );
}

export function TapeButton({
  title,
  onPress,
  disabled,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  // Accepted and ignored: stock Button has no variants. Callers keep passing it
  // so the distinction survives for whatever design lands next.
  variant?: 'primary' | 'secondary';
}) {
  return <Button title={title} onPress={onPress} disabled={disabled} />;
}

export function TapeInput(props: TextInputProps) {
  const t = useTheme();
  return (
    <TextInput
      placeholderTextColor={t.inkMuted}
      {...props}
      style={[styles.input, { borderColor: t.hairline, color: t.ink }, props.style]}
    />
  );
}

export function Sprocket() {
  const t = useTheme();
  return <View style={[styles.sprocket, { borderTopColor: t.hairline }]} />;
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <Label style={{ color: t.accent }}>{children}</Label>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  headerText: { fontSize: 20, fontWeight: '600' },
  body: { flex: 1, padding: 16, gap: 12 },
  body_: { fontSize: 15 },
  heading: { fontSize: 18, fontWeight: '600' },
  label: { fontSize: 13 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, padding: 12, gap: 8 },
  input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 6, padding: 12, fontSize: 15, minHeight: 44 },
  sprocket: { borderTopWidth: StyleSheet.hairlineWidth, marginVertical: 4 },
  spinner: { alignSelf: 'center' },
});
