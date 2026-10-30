-- #168: PKCE-style binding for the native Google handoff. A sign_in token issued with a challenge
-- can only be redeemed by whoever holds the matching verifier, so an app that intercepts the
-- mixtapeparty:// redirect gets a token it cannot spend.
ALTER TABLE auth_tokens ADD COLUMN IF NOT EXISTS code_challenge TEXT;
