import type { ServiceName } from './types.js';

/**
 * Cover art for a submitted track.
 * YouTube's comes from the external id; Bandcamp's needs the art_id stored at submit time, so
 * tracks submitted before that column existed have none.
 */
export function thumbnailUrlOf(service: ServiceName, externalId: string, artId?: string | number | null): string | null {
  if (service === 'youtube_music') return `https://i.ytimg.com/vi/${externalId}/mqdefault.jpg`;
  return artId ? `https://f4.bcbits.com/img/a${artId}_9.jpg` : null;
}
