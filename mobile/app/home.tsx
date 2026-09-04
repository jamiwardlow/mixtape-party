import { Button, StyleSheet, Text, View } from 'react-native';
import { useSession } from '../lib/session';

export default function Home() {
  const { profile, signOut } = useSession();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>You're in, {profile?.email}</Text>
      <Button title="Sign out" onPress={signOut} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 12 },
  title: { fontSize: 20, fontWeight: '600' },
});
