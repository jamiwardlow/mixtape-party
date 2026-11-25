import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Platform, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useTheme } from './theme';
import { INPUT_SHAPE, Label } from './ui';

// Deadline input and display, shared by create-league, the schedule and the round screens.

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
  const scheme = useColorScheme();

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
            // Tints the browser's calendar popup; there's no way to restyle it beyond that.
            accentColor: t.accent,
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

    // iOS: the system pills can't take our font, but the box, tint and light theme can match.
    return (
      <View style={[styles.input, styles.iosDate, { borderColor: t.ink, borderWidth: t.border, backgroundColor: t.shell }]}>
        <DateTimePicker
          testID={testID}
          value={value}
          mode="datetime"
          display="compact"
          accentColor={t.accent}
          themeVariant={scheme === 'dark' ? 'dark' : 'light'}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          onValueChange={(_event, date) => onChange(date)}
        />
      </View>
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

const styles = StyleSheet.create({
  input: { ...INPUT_SHAPE },
  dateField: { gap: 4 },
  dateValue: { lineHeight: 20 },
  iosDate: { alignItems: 'flex-start', paddingVertical: 4 },
  deadlineRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
});
