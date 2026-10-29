import { type Ref, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Platform,
  Pressable,
  PressableProps,
  PressableStateCallbackType,
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
import Svg, { Circle, Line, Rect, Text as SvgText } from 'react-native-svg';
import type { RoundPhase, ServiceName } from './rounds';
import { SERVICE_META, useTheme } from './theme';

// Sticker Pop primitives. Component names predate the design; screens import them as-is.

/** A solid ink block offset behind a child: the hard "sticker" shadow, drawn as a view so Android gets it too. */
function Sticker({ style, radius, children }: { style?: StyleProp<ViewStyle>; radius: number; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={[{ marginRight: t.shadow, marginBottom: t.shadow }, style]}>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: t.shadow, left: t.shadow, right: -t.shadow, bottom: -t.shadow, borderRadius: radius, backgroundColor: t.ink }}
      />
      {children}
    </View>
  );
}

/** Full-bleed centered page for screens that sit outside Screen (sign-in, join). */
export function Page({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={[styles.page, { backgroundColor: t.bg }]}>
      <View style={styles.pageInner}>{children}</View>
    </View>
  );
}

/** `wide` screens (lists, standings) get the design's 1120px wrap; forms stay a readable column. */
export function Screen({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: t.bg }]} edges={['top', 'bottom']}>
      <View style={[styles.wrap, { maxWidth: wide ? 1120 : 640 }]}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[styles.headerText, { color: t.ink, fontFamily: t.font.display }]}>{label}</Text>
        </View>
        <View style={styles.body}>{children}</View>
      </View>
    </SafeAreaView>
  );
}

export function ReelSpinner({ color }: { color?: string }) {
  const t = useTheme();
  return <ActivityIndicator color={color ?? t.ink} style={styles.spinner} />;
}

export function JCard({ style, children }: { style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Sticker radius={t.radius}>
      <View style={[styles.card, { backgroundColor: t.shell, borderColor: t.ink, borderWidth: t.border, borderRadius: t.radius }, style]}>{children}</View>
    </Sticker>
  );
}

export function Label({ style, children, ...props }: TextProps) {
  const t = useTheme();
  return (
    <Text {...props} style={[styles.label, { color: t.inkMuted, fontFamily: t.font.body }, style]}>
      {children}
    </Text>
  );
}

export function HandText({ style, children, ...props }: TextProps) {
  const t = useTheme();
  return (
    <Text {...props} style={[styles.heading, { color: t.ink, fontFamily: t.font.display }, style]}>
      {children}
    </Text>
  );
}

export function BodyText({ style, children, ...props }: TextProps) {
  const t = useTheme();
  return (
    <Text {...props} style={[styles.body_, { color: t.ink, fontFamily: t.font.body }, style]}>
      {children}
    </Text>
  );
}

/** Cover art for a submitted track; renders nothing when the service has none (Bandcamp). */
export function Thumb({ url, size = 48 }: { url?: string | null; size?: number }) {
  const t = useTheme();
  if (!url) return null;
  return <Image source={{ uri: url }} accessibilityIgnoresInvertColors style={{ width: size, height: size, borderRadius: 8, borderWidth: 2, borderColor: t.ink }} />;
}

export function ServiceBadge({ service }: { service: ServiceName }) {
  const t = useTheme();
  return (
    <View style={[styles.chip, { borderColor: t.ink, backgroundColor: t.shell }]}>
      <View style={[styles.dot, { backgroundColor: SERVICE_META[service]?.color ?? t.ink, borderColor: t.ink }]} />
      <Text style={{ color: t.ink, fontFamily: t.font.bold, fontSize: 12 }}>{SERVICE_META[service]?.label ?? service}</Text>
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

// react-native-web adds hovered/focused to Pressable's state; the RN types don't know them.
export type WebState = PressableStateCallbackType & { hovered?: boolean; focused?: boolean };

// Keyboard focus ring from the design's :focus-visible. A no-op on native, where nothing focuses.
export const focusRing = (t: { cobalt: string }, focused?: boolean): ViewStyle =>
  focused ? { outlineWidth: 3, outlineStyle: 'solid', outlineColor: t.cobalt, outlineOffset: 3 } : {};

export function PressScale({
  children,
  style,
  ...props
}: PressableProps & { style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Pressable {...props} style={({ focused }: WebState) => [{ borderRadius: t.radius }, focusRing(t, focused)]}>
      <View style={style}>{children}</View>
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
  return (
    <Sticker radius={999} style={{ alignSelf: 'flex-start', opacity: disabled ? 0.5 : 1 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: !!disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed, hovered, focused }: WebState) => [
          styles.button,
          {
            borderColor: t.ink,
            borderWidth: t.border,
            backgroundColor: variant === 'secondary' ? t.shell : t.accent,
            transform: pressed ? [{ translateX: t.shadow }, { translateY: t.shadow }] : hovered ? [{ translateX: -1 }, { translateY: -1 }] : [],
          },
          focusRing(t, focused),
        ]}
      >
        <Text style={{ color: t.ink, fontFamily: t.font.display, fontSize: 16 }}>{title}</Text>
      </Pressable>
    </Sticker>
  );
}

// The box shape TapeInput and TapeDateField's web control share. It lives out here because the
// web branch is a DOM node and can't reach into the StyleSheet.
const INPUT_SHAPE = { borderRadius: 14, padding: 12, fontSize: 15, minHeight: 44 };

export function TapeInput(props: TextInputProps & { ref?: Ref<TextInput> }) {
  const t = useTheme();
  return (
    <TextInput
      placeholderTextColor={t.inkMuted}
      {...props}
      style={[styles.input, { borderColor: t.ink, borderWidth: t.border, color: t.ink, backgroundColor: t.shell, fontFamily: t.font.body }, props.style]}
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
            borderWidth: t.border,
            borderStyle: 'solid',
            borderColor: t.ink,
            color: t.ink,
            backgroundColor: t.shell,
            fontFamily: t.font.body,
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
          <Text style={[styles.input, styles.dateValue, { borderColor: t.ink, borderWidth: t.border, color: t.ink, backgroundColor: t.shell, fontFamily: t.font.body }]}>
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

/** Sticker colours cycled by name, so a player keeps the same one across screens. */
export function avatarColor(seed: string): string {
  const t = useTheme();
  const colors = [t.accent, t.cobalt, t.mint, t.tangerine];
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return colors[h % colors.length];
}

/** The letter disc used where a photo isn't wanted (chips, leaderboard). */
export function InitialDisc({ name, size = 28 }: { name: string; size?: number }) {
  const t = useTheme();
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: t.ink, backgroundColor: avatarColor(name), alignItems: 'center', justifyContent: 'center' }}
    >
      <Text style={{ color: t.ink, fontFamily: t.font.display, fontSize: size * 0.5 }}>{name[0]?.toUpperCase() ?? '?'}</Text>
    </View>
  );
}

/** A pill that toggles; `avatar` adds a player's letter disc in front of the label. */
export function Chip({
  label,
  selected,
  onPress,
  avatar,
  testID,
  disabled,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  avatar?: string;
  testID?: string;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ focused, hovered }: WebState) => [
        styles.pill,
        { borderColor: t.ink, borderWidth: t.border, backgroundColor: selected ? t.mint : t.shell, opacity: disabled ? 0.5 : 1 },
        hovered && !disabled && !selected ? { backgroundColor: t.mint + '55' } : null,
        focusRing(t, focused),
      ]}
    >
      {avatar !== undefined && <InitialDisc name={avatar} size={22} />}
      <Text style={{ color: t.ink, fontFamily: t.font.bold, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

const STEPS: { phase: RoundPhase; label: string }[] = [
  { phase: 'submission', label: 'Submit' },
  { phase: 'guessing', label: 'Guess' },
  { phase: 'results', label: 'Results' },
];

/** Where a round is: past steps mint, the current one bubblegum, the rest white. */
export function PhaseSteps({ phase }: { phase: RoundPhase }) {
  const t = useTheme();
  const at = STEPS.findIndex((s) => s.phase === phase);
  return (
    <View style={styles.steps} accessibilityLabel={`Step ${at + 1} of 3: ${STEPS[at].label}`}>
      {STEPS.map((s, i) => (
        <View
          key={s.phase}
          style={[styles.step, { borderColor: t.ink, borderWidth: t.border, backgroundColor: i < at ? t.mint : i === at ? t.accent : t.shell }]}
        >
          <Text style={{ color: t.ink, fontFamily: t.font.display, fontSize: 13 }}>{s.label}</Text>
        </View>
      ))}
    </View>
  );
}

export function Toast({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Sticker radius={999} style={{ alignSelf: 'flex-start' }}>
      <View accessibilityLiveRegion="polite" style={[styles.pill, { borderColor: t.ink, borderWidth: t.border, backgroundColor: t.mint }]}>
        <Text style={{ color: t.ink, fontFamily: t.font.bold, fontSize: 14 }}>{children}</Text>
      </View>
    </Sticker>
  );
}

/** One line of a standings table: rank, who, points. `children` replaces the default name+disc (e.g. a photo Avatar). */
export function LeaderboardRow({
  rank,
  name,
  points,
  avatar,
  pointsTestID,
  testID,
}: {
  rank?: number;
  name: string;
  points: number | string;
  avatar?: React.ReactNode;
  pointsTestID?: string;
  testID?: string;
}) {
  const t = useTheme();
  return (
    <View testID={testID} style={[styles.lbRow, { borderColor: t.ink, borderWidth: t.border, backgroundColor: t.shell }]}>
      {rank !== undefined && <Text style={{ color: t.ink, fontFamily: t.font.display, fontSize: 18, minWidth: 22 }}>{rank}</Text>}
      {avatar ?? <InitialDisc name={name} />}
      <Text numberOfLines={1} style={{ color: t.ink, fontFamily: t.font.body, fontSize: 15, flex: 1 }}>{name}</Text>
      <View style={[styles.points, { borderColor: t.ink, backgroundColor: t.accent }]}>
        <Text testID={pointsTestID} style={{ color: t.ink, fontFamily: t.font.display, fontSize: 14 }}>{points}</Text>
      </View>
    </View>
  );
}

/** The logo: a tilted bubblegum sticker. Not the cassette mark. */
export function StickerBadge({ small }: { small?: boolean }) {
  const t = useTheme();
  const size = small ? 18 : 30;
  return (
    <Sticker radius={t.radius} style={{ alignSelf: 'flex-start', transform: [{ rotate: '-4deg' }] }}>
      <View
        accessibilityRole="image"
        accessibilityLabel="Mixtape Party"
        style={{ backgroundColor: t.accent, borderColor: t.ink, borderWidth: t.border, borderRadius: t.radius, paddingVertical: small ? 6 : 10, paddingHorizontal: small ? 12 : 20 }}
      >
        <Text style={{ color: t.ink, fontFamily: t.font.display, fontSize: size, lineHeight: size * 1.05 }}>Mixtape</Text>
        <Text style={{ color: t.shell, fontFamily: t.font.display, fontSize: size, lineHeight: size * 1.05 }}>Party!</Text>
      </View>
    </Sticker>
  );
}

const REEL_SPOKES = [0, 60, 120, 180, 240, 300];

function Reel({ size, spin }: { size: number; spin: boolean }) {
  const t = useTheme();
  const turn = useRef(new Animated.Value(0)).current;
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduced, () => {});
  }, []);
  useEffect(() => {
    if (!spin || reduced) return;
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: 2400, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spin, reduced, turn]);
  const c = size / 2;
  return (
    <Animated.View
      style={{ width: size, height: size, transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }}
    >
      <Svg width={size} height={size}>
        <Circle cx={c} cy={c} r={c - 1} fill={t.shell} stroke={t.ink} strokeWidth={2} />
        {REEL_SPOKES.map((deg) => {
          const a = (deg * Math.PI) / 180;
          return <Line key={deg} x1={c} y1={c} x2={c + (c - 3) * Math.cos(a)} y2={c + (c - 3) * Math.sin(a)} stroke={t.ink} strokeWidth={2} />;
        })}
        <Circle cx={c} cy={c} r={c * 0.35} fill={t.ink} />
      </Svg>
    </Animated.View>
  );
}

/** A cassette with a title on its label; the reels turn unless `still` (or the OS asks for less motion). */
export function Cassette({ title, still, width = 220 }: { title?: string; still?: boolean; width?: number }) {
  const t = useTheme();
  const k = width / 220;
  const reel = 40 * k;
  return (
    <View accessibilityRole="image" accessibilityLabel={title ? `Cassette: ${title}` : 'Cassette'} style={{ width, height: 140 * k }}>
      <Svg width={width} height={140 * k} viewBox="0 0 220 140">
        <Rect x={2} y={2} width={216} height={136} rx={14} fill={t.cobalt} stroke={t.ink} strokeWidth={3} />
        <Rect x={16} y={14} width={188} height={52} rx={8} fill={t.shell} stroke={t.ink} strokeWidth={3} />
        <SvgText x={110} y={48} textAnchor="middle" fontSize={20} fontFamily={t.font.display} fill={t.ink}>
          {(title ?? 'Mixtape').slice(0, 16)}
        </SvgText>
        <Rect x={44} y={76} width={132} height={44} rx={22} fill={t.ink} />
        <Rect x={72} y={124} width={76} height={10} rx={3} fill={t.bg} stroke={t.ink} strokeWidth={2} />
      </Svg>
      <View style={{ position: 'absolute', left: 66 * k - reel / 2, top: 98 * k - reel / 2 }}>
        <Reel size={reel} spin={!still} />
      </View>
      <View style={{ position: 'absolute', left: 154 * k - reel / 2, top: 98 * k - reel / 2 }}>
        <Reel size={reel} spin={!still} />
      </View>
    </View>
  );
}

export function Sprocket() {
  const t = useTheme();
  return <View style={[styles.sprocket, { borderTopColor: t.ink }]} />;
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  // role=alert + polite live region so screen readers announce it when it appears (web and native).
  return (
    <Label accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: t.danger, fontFamily: t.font.bold }}>
      {children}
    </Label>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  pageInner: { width: '100%', maxWidth: 440, gap: 12 },
  wrap: { flex: 1, width: '100%', alignSelf: 'center' },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  headerText: { fontSize: 28, transform: [{ rotate: '-2deg' }] },
  body: { flex: 1, padding: 16, gap: 12 },
  body_: { fontSize: 15 },
  heading: { fontSize: 18 },
  label: { fontSize: 13 },
  card: { padding: 14, gap: 8 },
  input: { ...INPUT_SHAPE },
  dateField: { gap: 4 },
  dateValue: { lineHeight: 20 },
  deadlineRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  sprocket: { borderTopWidth: 3, borderStyle: 'dashed', marginVertical: 4 },
  button: { paddingVertical: 10, paddingHorizontal: 22, borderRadius: 999, minHeight: 44, justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderWidth: 2, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
  spinner: { alignSelf: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 14, minHeight: 36 },
  steps: { flexDirection: 'row', gap: 6 },
  step: { flex: 1, alignItems: 'center', borderRadius: 999, paddingVertical: 6 },
  lbRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, paddingVertical: 8, paddingHorizontal: 12 },
  points: { borderWidth: 2, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 10 },
});
