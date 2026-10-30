import { nameOf } from './rounds';
import { BodyText, Label, LeaderboardRow } from './ui';

export interface Bestie {
  accountId: string;
  displayName: string | null;
  count: number;
}

export function BestieGroup({ caption, besties }: { caption: string; besties: Bestie[] }) {
  return (
    <>
      <Label>{caption}</Label>
      {besties.length === 0 && <BodyText>No correct guesses yet</BodyText>}
      {besties.map((b) => (
        <LeaderboardRow key={b.accountId} name={nameOf(b)} points={b.count} />
      ))}
    </>
  );
}
