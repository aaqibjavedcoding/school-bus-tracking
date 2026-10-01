import { HttpStatus, NotFoundException } from '../framework';
import { container } from '../container';
import { User } from '../database/models';
import type { EndpointDefinition } from '../http/route-runtime';

/** Authenticated, tenant-pinned profile-photo byte serving. */
export const getCrewPhoto: EndpointDefinition = {
  raw: true,
  handler: async ({ user, params }) => {
    if (!user.school_id) throw new NotFoundException('Not found');
    const parts = Array.isArray(params.key) ? params.key : [params.key];
    if (!parts.length || parts.some((part) => !part || part === '..' || part.includes('..') || part.startsWith('/'))) {
      throw new NotFoundException('Not found');
    }
    const key = parts.join('/');
    const prefix = `${user.school_id}/`;
    if (!key.startsWith(prefix)) throw new NotFoundException('Not found');
    const owner = await User.findOne({ where: { school_id: user.school_id, profile_photo_key: key } });
    if (!owner) throw new NotFoundException('Not found');
    const metadata = await container().documentStorage().getMetadata(key);
    if (!metadata || !metadata.exists || !['image/jpeg', 'image/png'].includes(metadata.contentType)) throw new NotFoundException('Not found');
    const bytes = await container().documentStorage().retrieve(key);
    if (!bytes) throw new NotFoundException('Not found');
    const version = owner.profile_photo_updated_at?.toISOString() ?? metadata.lastModified.toISOString();
    return new Response(new Uint8Array(bytes), { status: HttpStatus.OK, headers: {
      'Content-Type': metadata.contentType, 'Content-Length': String(bytes.length),
      'Cache-Control': 'private, max-age=0, must-revalidate', ETag: `"${version}"`,
      'X-Content-Type-Options': 'nosniff',
    }});
  },
};
