import { CONTACT_EMAIL, LegalPage } from '../lib/legal';

// Public URL for the Play Data Safety form: https://mixtape-party.com/delete-account
export default function DeleteAccount() {
  return (
    <LegalPage
      label="Delete your account"
      sections={[
        {
          title: 'In the app',
          body: ['Open Mixtape Party, go to My Account, scroll to “Delete account”, and confirm with your password (or your email address if you sign in without one).'],
        },
        {
          title: 'What gets deleted',
          body: [
            'Your email address, password, Google and Apple links, name, photo, notification settings, push tokens, inbox, favorites and exports are removed straight away, and every device is signed out.',
            'The songs you submitted, your guesses, comments and reactions stay in your leagues so everyone else’s results still add up. They’re no longer linked to you and show as “A player”.',
            'If you host a league that’s still playing, finish the season first, then delete.',
          ],
        },
        {
          title: 'Can’t get into the app?',
          body: [`Email ${CONTACT_EMAIL} from the address you signed up with and we’ll delete it for you.`],
        },
      ]}
    />
  );
}
