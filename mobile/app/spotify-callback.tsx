import * as WebBrowser from 'expo-web-browser';
import { Text, View } from 'react-native';

// On web, openAuthSessionAsync opens this route in a popup; calling this here
// closes the popup and resolves the promise in the opener window.
WebBrowser.maybeCompleteAuthSession();

export default function SpotifyCallback() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text>Finishing Spotify sign-in…</Text>
    </View>
  );
}
