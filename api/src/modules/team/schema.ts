import { z } from '../../http/validate.ts';
import type { Env } from '../../env.ts';
import { describeImage } from '../../media/service.ts';
import type { TeamMemberDoc } from '../../models.ts';
import { bilingual } from '../../support/bilingual.ts';
import { orderFields, stamp } from '../../support/content.ts';

const text = { role: { max: 100, required: true }, bio: { max: 2000 } } as const;
// name is single-language in legacy (no name_2nd).
const memberName = z.string().trim().min(1).max(100);
export const createTeamMember = z.strictObject({ name: memberName, ...bilingual(text, { partial: false }), ...orderFields });
export const updateTeamMember = z.strictObject({ name: memberName.optional(), ...bilingual(text), ...orderFields });

export const teamMemberResource = (env: Env, t: TeamMemberDoc) => ({
  id: t._id, name: t.name, role: t.role, role_2nd: t.role_2nd ?? null, bio: t.bio ?? null, bio_2nd: t.bio_2nd ?? null,
  image: describeImage(env, t.image), sort_order: t.sort_order, is_visible: t.is_visible, updated_at: stamp(t),
});
