import { useApi, type ApiResult } from './client';
import { useSession, type Profile } from './session';

export type ProfileFields = Partial<Pick<Profile, 'displayName' | 'pronouns' | 'aboutMe'>>;

/**
 * The writes that change the signed-in account: profile fields and avatar (each re-reads the
 * session profile on success, so a change shows everywhere without a sign-out), and joining from an
 * invite (which settles the session's pending invite code). Lives beside the session, not in it: the client
 * reads the session, so the session can't use the client.
 */
export function useProfile() {
  const { profile, refreshProfile, pendingInviteCode, setPendingInviteCode } = useSession();
  const api = useApi();

  async function refreshed(r: ApiResult<unknown>): Promise<ApiResult<unknown>> {
    if (r.ok) await refreshProfile();
    return r;
  }

  return {
    profile,
    update: async (fields: ProfileFields, fallback?: string) =>
      refreshed(await api('/accounts/me', { method: 'PATCH', body: fields, fallback })),
    uploadAvatar: async (bytes: Blob, fallback?: string) =>
      refreshed(await api('/accounts/me/avatar', { method: 'PUT', upload: { bytes, contentType: 'image/jpeg' }, fallback })),
    removeAvatar: async () => refreshed(await api('/accounts/me/avatar', { method: 'DELETE' })),
    async joinInvite(code: string) {
      const r = await api(`/leagues/invite/${code}/join`, { method: 'POST', fallback: 'Could not join the league' });
      // Cleared only once the server has answered: the code is persisted, so a request that never
      // lands (offline, API down) leaves it in place to retry on the next load instead of silently
      // dropping the join the invite link was opened for.
      if ((r.ok || r.status !== 0) && code === pendingInviteCode) setPendingInviteCode(null);
      return r;
    },
  };
}
