import { Redirect } from 'expo-router';
import { useSession } from '../lib/session';

export default function Index() {
  const { token, isLoading } = useSession();
  if (isLoading) return null;

  if (token === null) return <Redirect href="/sign-in" />;
  return <Redirect href="/home" />;
}
