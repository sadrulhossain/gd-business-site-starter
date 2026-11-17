import type { Env } from '../../env.ts';
import type { Api } from '../../http/route.ts';
import type { TeamMemberDoc } from '../../models.ts';
import { contentRoutes } from '../../support/content.ts';
import { createTeamMember, teamMemberResource, updateTeamMember } from './schema.ts';

/** Admin path /team, public path /public/team, permissions team.*, tag team_members. */
export const teamRoutes = (api: Api, env: Env): void =>
  contentRoutes<TeamMemberDoc>(api, env, {
    path: 'team', model: 'TeamMember', create: createTeamMember, update: updateTeamMember, resource: teamMemberResource, imageDir: 'team',
  });
