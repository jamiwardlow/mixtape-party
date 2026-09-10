import { Redirect } from 'expo-router';
import { useSession } from '../lib/session';

export default function Index() {
  const { token, profile, isLoading } = useSession();
  if (isLoading) return null;

  if (token === null) return <Redirect href="/sign-in" />;
  if (profile?.onboarded !== true) return <Redirect href="/onboarding" />;
  return <Redirect href="/home" />;
}
