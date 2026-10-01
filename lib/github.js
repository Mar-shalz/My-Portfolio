// Minimal GitHub contents API client. Used when the site runs on a host with a
// read-only disk (e.g. Vercel): the portal commits content and uploads to the
// repo, and the host redeploys with the new files.

export function createGitHub({ token, repo, branch = 'main', api = 'https://api.github.com' }) {
  const [owner, name] = String(repo).split('/');
  if (!owner || !name) throw new Error('GITHUB_REPO must look like "username/repository".');
  const base = `${api.replace(/\/+$/, '')}/repos/${owner}/${name}`;
  const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

  async function call(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'portfolio-cms',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const conflict = res.status === 409 || (res.status === 422 && /sha/i.test(data.message || ''));
      const err = new Error(conflict
        ? 'The content changed on GitHub since you opened it. Reload the portal to get the latest version.'
        : `GitHub said: ${data.message || res.statusText}. Check GITHUB_TOKEN and GITHUB_REPO.`);
      err.status = conflict ? 409 : 502;
      throw err;
    }
    return data;
  }

  return {
    branch,
    // Returns { sha, size, buf } or null. Files over 1 MB come through the blobs API.
    async get(path, ref = branch) {
      const d = await call('GET', `/contents/${enc(path)}?ref=${encodeURIComponent(ref)}`);
      if (!d || Array.isArray(d)) return null;
      let content = d.content;
      if (!content && d.sha) content = (await call('GET', `/git/blobs/${d.sha}`))?.content || '';
      return { sha: d.sha, size: d.size, buf: Buffer.from(content || '', 'base64') };
    },
    async list(path) {
      const d = await call('GET', `/contents/${enc(path)}?ref=${encodeURIComponent(branch)}`);
      return Array.isArray(d) ? d.filter((x) => x.type === 'file') : [];
    },
    put(path, buf, message, sha) {
      return call('PUT', `/contents/${enc(path)}`, { message, branch, content: Buffer.from(buf).toString('base64'), ...(sha ? { sha } : {}) });
    },
    del(path, sha, message) {
      return call('DELETE', `/contents/${enc(path)}`, { message, branch, sha });
    },
    async commits(path, perPage = 50) {
      return (await call('GET', `/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(branch)}&per_page=${perPage}`)) || [];
    },
  };
}
