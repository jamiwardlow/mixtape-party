import { Fragment, type Ref, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
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
  TouchableWithoutFeedback,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ServiceName } from './rounds';
import { SERVICE_META, useServiceColor, useTheme, type Theme } from './theme';
import { openPlaybackLink } from './bandcamp';

// Sticker Pop primitives. Component names predate the design; screens import them as-is.

/** A solid ink block offset behind a child: the hard "sticker" shadow, drawn as a view so Android gets it too. */
function Sticker({ style, radius, children }: { style?: StyleProp<ViewStyle>; radius: number; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={[{ marginRight: t.shadow, marginBottom: t.shadow }, style]}>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: t.shadow, left: t.shadow, right: -t.shadow, bottom: -t.shadow, borderRadius: radius, backgroundColor: t.shadowColor }}
      />
      {children}
    </View>
  );
}

/** Tapping anywhere that isn't a control puts the keyboard away; iOS has no way to otherwise. No-op on web. */
function TapAwayDismiss({ children }: { children: React.ReactNode }) {
  if (Platform.OS === 'web') return <>{children}</>;
  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={{ flex: 1 }}>{children}</View>
    </TouchableWithoutFeedback>
  );
}

/** Full-bleed centered page for screens that sit outside Screen (sign-in, join). */
export function Page({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return (
    <TapAwayDismiss>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.page, { backgroundColor: t.bg }]}>
        <View style={styles.pageInner}>{children}</View>
      </KeyboardAvoidingView>
    </TapAwayDismiss>
  );
}

/** `wide` screens (lists, standings) get the design's 1120px wrap; forms stay a readable column. */
export function Screen({ label, wide, tapAway, children }: { label: string; wide?: boolean; tapAway?: boolean; children: React.ReactNode }) {
  const t = useTheme();
  // TapAwayDismiss claims the touch responder and kills ScrollView scrolling on iOS, so only non-scrolling form screens opt in.
  const Wrap = tapAway ? TapAwayDismiss : Fragment;
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: t.bg }]} edges={['top', 'bottom']}>
      <Wrap>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.wrap, { maxWidth: wide ? 1120 : 640 }]}>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={[styles.headerText, { color: t.ink, fontFamily: t.font.display }]}>{label}</Text>
          </View>
          <View style={styles.body}>{children}</View>
        </KeyboardAvoidingView>
      </Wrap>
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

/**
 * Cover art for a submitted track. When the service has none (Bandcamp without an art id) or the image
 * fails to load, shows a sticker tile with a note instead, its color picked from the title so a list
 * of them isn't one flat color.
 */
export function Thumb({ url, title = '', size = 48 }: { url?: string | null; title?: string; size?: number }) {
  const t = useTheme();
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size, borderRadius: 8, borderWidth: 2, borderColor: t.ink };
  if (url && !failed) return <Image testID="thumb-image" source={{ uri: url }} onError={() => setFailed(true)} accessibilityIgnoresInvertColors style={box} />;
  const colors = [t.mint, t.accent, t.tangerine];
  const color = colors[[...title].reduce((n, c) => n + c.charCodeAt(0), 0) % colors.length];
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[box, { backgroundColor: color, alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ color: t.accentInk, fontSize: size * 0.5 }}>♪</Text>
    </View>
  );
}

/**
 * Thumb + "title — artist" for a track. `onPlay` makes the thumb a play/stop button; `href` makes the
 * title a link out to the track on its service. Either is optional (a Bandcamp track has no thumb).
 */
export function TrackRow({
  thumbnailUrl,
  title,
  artist,
  href,
  playing,
  onPlay,
  stacked,
  style,
  testID,
}: {
  thumbnailUrl?: string | null;
  title: string;
  artist: string;
  href?: string;
  playing?: boolean;
  onPlay?: () => void;
  /** Artist on its own line under the title, with only the title linked. */
  stacked?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const t = useTheme();
  const thumb = (
    <View>
      <Thumb url={thumbnailUrl} title={title} />
      {onPlay ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', backgroundColor: t.scrim, borderRadius: 8 }]}>
          <Text style={{ color: t.onScrim, fontSize: 20 }}>{playing ? '■' : '▶︎'}</Text>
        </View>
      ) : null}
    </View>
  );
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }, style]}>
      {onPlay ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`${playing ? 'Stop' : 'Play'} preview of ${title}`} onPress={onPlay}>
          {thumb}
        </Pressable>
      ) : (
        thumb
      )}
      <View testID={stacked ? testID : undefined} style={{ flex: 1, minWidth: 0 }}>
        <BodyText
          testID={stacked ? undefined : testID}
          numberOfLines={stacked ? 2 : undefined}
          style={href ? { textDecorationLine: 'underline' } : undefined}
          accessibilityRole={href ? 'link' : undefined}
          onPress={href ? () => openPlaybackLink(href) : undefined}
        >
          {stacked ? title : `${title} — ${artist}`}
        </BodyText>
        {stacked ? <Label numberOfLines={2}>{artist}</Label> : null}
      </View>
    </View>
  );
}

export function ServiceBadge({ service }: { service: ServiceName }) {
  const t = useTheme();
  const color = useServiceColor(service);
  return (
    <View style={[styles.chip, { borderColor: t.ink, backgroundColor: t.shell }]}>
      <View style={[styles.dot, { backgroundColor: color ?? t.ink, borderColor: t.ink }]} />
      <Text style={{ color: t.ink, fontFamily: t.font.bold, fontSize: 12 }}>{SERVICE_META[service]?.label ?? service}</Text>
    </View>
  );
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
  variant?: 'primary' | 'secondary' | 'danger';
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
            backgroundColor: variant === 'secondary' ? t.shell : variant === 'danger' ? t.tangerine : t.accent,
            transform: pressed ? [{ translateX: t.shadow }, { translateY: t.shadow }] : hovered ? [{ translateX: -1 }, { translateY: -1 }] : [],
          },
          focusRing(t, focused),
        ]}
      >
        <Text style={{ color: variant === 'secondary' ? t.ink : t.accentInk, fontFamily: t.font.display, fontSize: 16 }}>{title}</Text>
      </Pressable>
    </Sticker>
  );
}

// The box shape TapeInput and deadlines.tsx's TapeDateField web control share. It lives out here because the
// web branch is a DOM node and can't reach into the StyleSheet.
export const INPUT_SHAPE = { borderRadius: 14, padding: 12, fontSize: 15, minHeight: 44 };

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

/** Sticker colours cycled by name, so a player keeps the same one across screens. */
export function avatarColor(seed: string, t: Theme): string {
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
      style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: t.ink, backgroundColor: avatarColor(name, t), alignItems: 'center', justifyContent: 'center' }}
    >
      <Text style={{ color: t.accentInk, fontFamily: t.font.display, fontSize: size * 0.5 }}>{name[0]?.toUpperCase() ?? '?'}</Text>
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
  taken,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  avatar?: string;
  testID?: string;
  disabled?: boolean;
  /** Already used elsewhere: dimmed, dotted outline, not pressable. */
  taken?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected, disabled: !!disabled || !!taken }}
      disabled={disabled || taken}
      onPress={onPress}
      style={({ focused, hovered }: WebState) => [
        styles.pill,
        {
          borderColor: t.ink,
          borderWidth: t.border,
          borderStyle: taken ? 'dotted' : 'solid',
          backgroundColor: selected ? t.mint : t.shell,
          opacity: taken ? 0.45 : disabled ? 0.5 : 1,
        },
        hovered && !disabled && !selected ? { backgroundColor: t.mint + '55' } : null,
        focusRing(t, focused),
      ]}
    >
      {avatar !== undefined && <InitialDisc name={avatar} size={22} />}
      <Text style={{ color: selected ? t.accentInk : t.ink, fontFamily: t.font.bold, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

export function Toast({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Sticker radius={999} style={{ alignSelf: 'flex-start' }}>
      <View accessibilityLiveRegion="polite" style={[styles.pill, { borderColor: t.ink, borderWidth: t.border, backgroundColor: t.mint }]}>
        <Text style={{ color: t.accentInk, fontFamily: t.font.bold, fontSize: 14 }}>{children}</Text>
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
        <Text testID={pointsTestID} style={{ color: t.accentInk, fontFamily: t.font.display, fontSize: 14 }}>{points}</Text>
      </View>
    </View>
  );
}

/** The logo: a tilted bubblegum sticker, matching the landing page's. Not the cassette mark. */
export function StickerBadge({ small }: { small?: boolean }) {
  const t = useTheme();
  const size = small ? 18 : 30;
  const line = { color: t.accentInk, fontFamily: t.font.display, fontSize: size, lineHeight: size * 1.05, textAlign: 'center' } as const;
  return (
    <Sticker radius={t.radius} style={{ alignSelf: 'flex-start', transform: [{ rotate: '-4deg' }] }}>
      <View
        accessibilityRole="image"
        accessibilityLabel="Mixtape Party"
        style={{ backgroundColor: t.accent, borderColor: t.ink, borderWidth: t.border, borderRadius: t.radius, paddingVertical: small ? 6 : 10, paddingHorizontal: small ? 12 : 20 }}
      >
        <Text style={line}>Mixtape</Text>
        <Text style={{ ...line, color: t.badgeLight }}>Party!</Text>
      </View>
    </Sticker>
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
  sprocket: { borderTopWidth: 3, borderStyle: 'dashed', marginVertical: 4 },
  button: { paddingVertical: 10, paddingHorizontal: 22, borderRadius: 999, minHeight: 44, justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderWidth: 2, borderRadius: 999, paddingVertical: 3, paddingHorizontal: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1.5 },
  spinner: { alignSelf: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 14, minHeight: 36 },
  lbRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, paddingVertical: 8, paddingHorizontal: 12 },
  points: { borderWidth: 2, borderRadius: 999, paddingVertical: 2, paddingHorizontal: 10 },
});
