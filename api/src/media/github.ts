import { mediaBranch, type Env } from '../env.ts';
import { HttpError } from '../errors.ts';

export interface RepoFile { path: string; bytes: Uint8Array }

const MAX_RETRIES = 3;

/**
 * Commits files to the media branch through the GitHub Git Data API: blobs, tree, commit, ref update.
 * One commit per call. When the branch moved (the ref update is refused as a non-fast-forward) the tree and commit
 * are rebuilt on the new head, up to 3 more times. `add` paths and `remove` paths are repository paths.
 */
export async function commitMedia(env: Env, change: { add: RepoFile[]; remove: string[]; message: string }): Promise<{ sha: string }> {
  const repo = env.GITHUB_REPO;
  const token = env.GITHUB_REPO_TOKEN;
  if (!repo || !token) throw new HttpError(503, 'media_unavailable', 'Media storage is not configured.');
  const branch = mediaBranch(env);

  const gh = async (path: string, init?: RequestInit): Promise<Response> =>
    fetch(`https://api.github.com/repos/${repo}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'gd-business-site',
        'Content-Type': 'application/json',
      },
    });
  const json = async <T>(r: Response, what: string): Promise<T> => {
    if (!r.ok) throw new HttpError(502, 'media_commit_failed', `GitHub ${what} failed (${r.status}).`);
    return (await r.json()) as T;
  };

  // Blobs are content-addressed, so they are created once and reused by every retry.
  const tree: { path: string; mode: '100644'; type: 'blob'; sha: string | null }[] = [];
  for (const f of change.add) {
    const blob = await json<{ sha: string }>(
      await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: Buffer.from(f.bytes).toString('base64'), encoding: 'base64' }) }),
      'blob upload',
    );
    tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  for (const path of change.remove) tree.push({ path, mode: '100644', type: 'blob', sha: null });

  const ref = `heads/${branch.split('/').map(encodeURIComponent).join('/')}`;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const head = await json<{ object: { sha: string } }>(await gh(`/git/ref/${ref}`), 'ref lookup');
    const base = await json<{ tree: { sha: string } }>(await gh(`/git/commits/${head.object.sha}`), 'commit lookup');
    const t = await json<{ sha: string }>(await gh('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: base.tree.sha, tree }) }), 'tree');
    const c = await json<{ sha: string }>(
      await gh('/git/commits', { method: 'POST', body: JSON.stringify({ message: change.message, tree: t.sha, parents: [head.object.sha] }) }),
      'commit',
    );
    const up = await gh(`/git/refs/${ref}`, { method: 'PATCH', body: JSON.stringify({ sha: c.sha, force: false }) });
    if (up.ok) return { sha: c.sha };
    if (up.status !== 422 && up.status !== 409) throw new HttpError(502, 'media_commit_failed', `GitHub ref update failed (${up.status}).`);
  }
  throw new HttpError(409, 'media_conflict', 'The media branch kept changing. Try again.');
}
