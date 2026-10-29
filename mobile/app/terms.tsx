import { CONTACT_EMAIL, LegalPage } from '../lib/legal';

export default function Terms() {
  return (
    <LegalPage
      label="Terms of Use"
      sections={[
        {
          title: 'The deal',
          body: ['By using Mixtape Party you agree to these terms. If you don’t, please don’t use it.'],
        },
        {
          title: 'Your account',
          body: ['Keep your sign-in details to yourself. You’re responsible for what happens under your account.'],
        },
        {
          title: 'Be good to your league',
          body: [
            'No harassment, hate, or anything illegal in names, photos or comments.',
            'Only submit music links you’re allowed to share. Tracks play from their own services (YouTube Music, Bandcamp); we don’t host the music.',
            'We may remove content or accounts that break these rules.',
          ],
        },
        {
          title: 'Your content',
          body: [
            'You keep what you post. You let us store and show it to your league so the game works.',
          ],
        },
        {
          title: 'No guarantees',
          body: [
            'Mixtape Party is a hobby project provided as is. It may break, change, or go away, and we aren’t liable for losses from using it, to the extent the law allows.',
          ],
        },
        {
          title: 'Contact',
          body: [`Questions? Email ${CONTACT_EMAIL}.`],
        },
      ]}
    />
  );
}
