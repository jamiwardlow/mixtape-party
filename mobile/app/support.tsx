import { CONTACT_EMAIL, LegalPage } from '../lib/legal';

// Public URL for the App Store / Play "Support URL": https://mixtape-party.com/support
export default function Support() {
  return (
    <LegalPage
      label="Support"
      sections={[
        {
          title: 'Contact us',
          body: [`Questions, bugs or feedback? Email ${CONTACT_EMAIL}. We read everything and usually reply within a couple of days.`],
        },
        {
          title: 'Can’t sign in?',
          body: ['Tap “Forgot password” on the sign-in screen for a reset link. If you signed up with Google or Apple, use that button instead.'],
        },
        {
          title: 'Delete your account',
          body: ['See mixtape-party.com/delete-account, or go to My Account in the app.'],
        },
      ]}
    />
  );
}
