import {
  ActivityIndicator,
  Button,
  Platform,
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
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
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

// The box shape TapeInput and TapeDateField's web control share. It lives out here because the
// web branch is a DOM node and can't reach into the StyleSheet.
const INPUT_SHAPE = { borderRadius: 6, padding: 12, fontSize: 15, minHeight: 44 };

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

/** The one way a deadline is written in the UI: the date and the time, in the viewer's locale. */
export function formatDeadline(date: Date): string {
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const pad = (n: number) => String(n).padStart(2, '0');

// <input type="datetime-local"> speaks local wall-clock time, so toISOString() would shift the
// value by the UTC offset and show the host a date they did not pick.
function toLocalInputValue(date: Date | undefined): string {
  if (!date) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// A date *and* time field: deadlines are TIMESTAMPTZ and the notification sweep fires on a
// fraction of the remaining window, so the instant matters, not just the day.
//
// ponytail: one field, three controls. @react-native-community/datetimepicker ships no
// react-native-web build, so web falls back to the DOM control -- which is the native picker
// there -- and Android has no 'datetime' mode, so it chains the date dialog into the time one.
// PRODUCT.md wants one design language across iOS and Android; this is as close as the library
// gets. Replace all three with one JS calendar if that stops being close enough.
//
// minimumDate/maximumDate are affordances, not guarantees: Android applies them to the date
// dialog only, and DOM `min`/`max` outside a <form> aren't enforced. Callers still have to check
// the order themselves.
export function TapeDateField({
  label,
  value,
  onChange,
  minimumDate,
  maximumDate,
  testID,
}: {
  label: string;
  value: Date;
  onChange: (date: Date) => void;
  minimumDate?: Date;
  maximumDate?: Date;
  testID?: string;
}) {
  const t = useTheme();

  function control() {
    if (Platform.OS === 'web') {
      return (
        <input
          type="datetime-local"
          aria-label={label}
          data-testid={testID}
          value={toLocalInputValue(value)}
          min={toLocalInputValue(minimumDate)}
          max={toLocalInputValue(maximumDate)}
          onChange={(e) => {
            // Clearing the field, or a half-typed date, parses to Invalid Date -- keep the last
            // good value rather than handing the caller a NaN instant.
            const picked = new Date(e.target.value);
            if (!Number.isNaN(picked.getTime())) onChange(picked);
          }}
          // Clicking a segment only focuses it for typing; the calendar otherwise hides behind
          // the small icon at the right edge. showPicker() opens it from anywhere in the field.
          onClick={(e) => {
            try {
              e.currentTarget.showPicker();
            } catch {
              // No user gesture, or a browser without showPicker -- the icon still works.
            }
          }}
          style={{
            ...INPUT_SHAPE,
            borderWidth: StyleSheet.hairlineWidth,
            borderStyle: 'solid',
            borderColor: t.hairline,
            color: t.ink,
            backgroundColor: t.bg,
            fontFamily: 'inherit',
          }}
        />
      );
    }

    if (Platform.OS === 'android') {
      return (
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={() =>
            DateTimePickerAndroid.open({
              value,
              mode: 'date',
              minimumDate,
              maximumDate,
              // The date dialog answers first; the time dialog then refines the day it returned.
              onValueChange: (_event, date) =>
                DateTimePickerAndroid.open({
                  value: date,
                  mode: 'time',
                  onValueChange: (_timeEvent, withTime) => onChange(withTime),
                }),
            })
          }
        >
          <Text style={[styles.input, styles.dateValue, { borderColor: t.hairline, color: t.ink }]}>
            {formatDeadline(value)}
          </Text>
        </Pressable>
      );
    }

    return (
      <DateTimePicker
        testID={testID}
        value={value}
        mode="datetime"
        display="compact"
        minimumDate={minimumDate}
        maximumDate={maximumDate}
        onValueChange={(_event, date) => onChange(date)}
      />
    );
  }

  return (
    <View style={styles.dateField}>
      <Label>{label}</Label>
      {control()}
    </View>
  );
}

/** A round's two deadlines, laid out the same way by the setup preview and the schedule screen. */
export function DeadlineRows({
  submissionDeadline,
  guessingDeadline,
  testID,
}: {
  submissionDeadline: Date;
  guessingDeadline: Date;
  testID: string;
}) {
  return (
    <>
      <View style={styles.deadlineRow}>
        <Label>Submissions due</Label>
        <Label testID={`${testID}-submission`}>{formatDeadline(submissionDeadline)}</Label>
      </View>
      <View style={styles.deadlineRow}>
        <Label>Guesses due</Label>
        <Label testID={`${testID}-guessing`}>{formatDeadline(guessingDeadline)}</Label>
      </View>
    </>
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
  input: { borderWidth: StyleSheet.hairlineWidth, ...INPUT_SHAPE },
  dateField: { gap: 4 },
  dateValue: { lineHeight: 20 },
  deadlineRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  sprocket: { borderTopWidth: StyleSheet.hairlineWidth, marginVertical: 4 },
  spinner: { alignSelf: 'center' },
});
