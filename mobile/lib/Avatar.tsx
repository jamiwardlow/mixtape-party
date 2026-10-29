import { useEffect, useState } from 'react';
import { Image, Platform, View } from 'react-native';
import { API_URL } from './api';
import { useTheme } from './theme';
import { avatarColor, HandText } from './ui';

// The avatar endpoint is authenticated and an <img> can't send a bearer header, so on web fetch it
// into an object URL; native Image takes headers directly.
export function Avatar({ url, token, initial, size = 96, label = 'Your photo' }: { url?: string | null; token: string | null; initial: string; size?: number; label?: string }) {
  const t = useTheme();
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    setSrc(null);
    if (!url || !token || Platform.OS !== 'web') return;
    let objectUrl: string | undefined;
    let cancelled = false;
    fetch(`${API_URL}${url}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.blob() : Promise.reject()))
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, token]);

  const box = { width: size, height: size, borderRadius: size / 2 };
  const source =
    Platform.OS === 'web'
      ? src && { uri: src }
      : url && token && { uri: `${API_URL}${url}`, headers: { Authorization: `Bearer ${token}` } };
  if (source && !failed) {
    return <Image accessibilityLabel={label} source={source} style={box} onError={() => setFailed(true)} />;
  }
  return (
    <View
      accessibilityLabel={label}
      style={[box, { backgroundColor: avatarColor(initial), borderColor: t.ink, borderWidth: 2, alignItems: 'center', justifyContent: 'center' }]}
    >
      <HandText style={{ fontSize: size * 0.5 }}>{initial}</HandText>
    </View>
  );
}
