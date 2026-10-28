import { View } from 'react-native';
import { BodyText, Label } from './ui';

export interface Bestie {
  accountId: string;
  displayName: string | null;
  count: number;
}

export function BestieGroup({ title, caption, besties }: { title: string; caption: string; besties: Bestie[] }) {
  return (
    <>
      <Label>{title}</Label>
      <Label>{caption}</Label>
      {besties.length === 0 && <BodyText>No correct guesses yet</BodyText>}
      {besties.map((b) => (
        <View key={b.accountId} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <BodyText>{b.displayName || 'A player'}</BodyText>
          <BodyText>{b.count}</BodyText>
        </View>
      ))}
    </>
  );
}
