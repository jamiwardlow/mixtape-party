import { CONTACT_EMAIL, LegalPage } from '../lib/legal';

export default function Privacy() {
  return (
    <LegalPage
      label="Privacy Policy"
      sections={[
        {
          title: 'The short version',
          body: [
            'Mixtape Party is a game for friends. We collect what the game needs to run, we don’t sell it, and we don’t show ads.',
          ],
        },
        {
          title: 'What we collect',
          body: [
            'Your email address, and a password (stored hashed) if you sign up with one.',
            'Your display name and profile photo, if you add them. Your league sees these on rosters, guesses and results.',
            'Your Expo push token, if you allow notifications, so we can send round reminders.',
            'What you do in the game: the tracks you submit, your guesses, comments and reactions, and your favorites.',
          ],
        },
        {
          title: 'Who else handles it',
          body: [
            'Google: if you choose “Continue with Google”, Google tells us your email address and name.',
            'Apple: if you choose “Continue with Apple”, Apple tells us your email address (possibly a private relay address) and, the first time, your name.',
            'Resend sends our emails (sign-in links, password resets, reminders).',
            'Expo delivers push notifications to your device.',
            'Neon and Google Cloud host our database and servers.',
            'We don’t share your data with anyone else.',
          ],
        },
        {
          title: 'Who sees what',
          body: [
            'Players in your leagues see your display name, photo, guesses, comments and reactions. Submissions stay anonymous until results are revealed.',
          ],
        },
        {
          title: 'Your choices',
          body: [
            'Change your name or photo, or turn off push and email notifications, any time from My Account.',
            `You can delete your account from My Account, or see mixtape-party.com/delete-account. Your email, password, name, photo and notification data are removed; your submitted songs and guesses stay in your leagues, no longer linked to you. If you can’t sign in, email ${CONTACT_EMAIL} from the address you signed up with.`,
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
