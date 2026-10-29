import { router } from 'expo-router';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { BodyText, HandText, Label, Screen, TapeButton } from './ui';

// Placeholder address; swap for the real one at review.
export const CONTACT_EMAIL = 'hello@mixtape-party.com';

export interface LegalSection {
  title: string;
  body: string[];
}

/** Privacy · Terms links for sign-in and My Account; the stores need both reachable in-app. */
export function LegalLinks() {
  return (
    <View style={styles.links}>
      <Label accessibilityRole="link" style={styles.link} onPress={() => router.push('/privacy')}>
        Privacy Policy
      </Label>
      <Label accessibilityRole="link" style={styles.link} onPress={() => router.push('/terms')}>
        Terms of Use
      </Label>
      <Label accessibilityRole="link" style={styles.link} onPress={() => Linking.openURL(`mailto:${CONTACT_EMAIL}`)}>
        Contact
      </Label>
    </View>
  );
}

export function LegalPage({ label, sections }: { label: string; sections: LegalSection[] }) {
  return (
    <Screen label={label}>
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <Label>Last updated October 2026.</Label>
        {sections.map((s) => (
          <View key={s.title} style={styles.section}>
            <HandText>{s.title}</HandText>
            {s.body.map((p) => (
              <BodyText key={p}>{p}</BodyText>
            ))}
          </View>
        ))}
        <TapeButton title="Back" variant="secondary" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { gap: 12 },
  section: { gap: 6 },
  links: { flexDirection: 'row', justifyContent: 'center', gap: 16 },
  // 44pt tap targets, like the other links in this app.
  link: { paddingVertical: 11, textDecorationLine: 'underline' },
});
