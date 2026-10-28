// 讀寫 GitHub repo 裡的筆記檔（用 GitHub REST API）

const API = 'https://api.github.com';
const CONFIG_KEY = 'notes-app:config';

const DEFAULT_CONFIG = { owner: 'alicenoted-coder', repo: 'about-me', branch: 'main', token: '' };

export function getConfig() {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(cfg) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  } catch {
    // 無痕模式等情況可能無法儲存
  }
}

export function isConfigured(cfg = getConfig()) {
  return Boolean(cfg.owner && cfg.repo && cfg.branch && cfg.token);
}

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function friendlyMessage(status, apiMessage) {
  if (status === 401) return 'GitHub 金鑰無效或已過期，請到設定重新貼上。';
  if (status === 403) return 'GitHub 金鑰沒有權限，請確認金鑰有這個 repo 的「Contents：Read and write」權限。';
  if (status === 404) return '找不到 repo 或分支，請到設定確認帳號、repo 名稱和分支。';
  if (status === 409) return '檔案剛被其他地方修改過，請重新整理後再試一次。';
  if (status === 422) return `GitHub 拒絕了這次儲存：${apiMessage}`;
  if (status === 0) return '連不上 GitHub，請確認網路連線。';
  return `GitHub 發生錯誤（${status}）：${apiMessage}`;
}

async function gh(path, { method = 'GET', body, cfg = getConfig() } = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${cfg.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new GitHubError(0, friendlyMessage(0));
  }
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).message || msg;
    } catch {
      // 回應不是 JSON
    }
    throw new GitHubError(res.status, friendlyMessage(res.status, msg));
  }
  return res.status === 204 ? null : res.json();
}

function repoPath(cfg) {
  return `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

export function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function fromBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export async function testConnection(cfg) {
  const repo = await gh(repoPath(cfg), { cfg });
  if (repo.permissions && !repo.permissions.push) {
    throw new GitHubError(403, '這個金鑰只能讀、不能寫，請把「Contents」權限改成「Read and write」。');
  }
  await gh(`${repoPath(cfg)}/branches/${encodeURIComponent(cfg.branch)}`, { cfg });
  return repo;
}

// 列出 notes/ 底下所有 .md 檔：[{ path, sha }]
export async function listNoteFiles() {
  const cfg = getConfig();
  let tree;
  try {
    tree = await gh(`${repoPath(cfg)}/git/trees/${encodeURIComponent(cfg.branch)}?recursive=1`, { cfg });
  } catch (e) {
    if (e.status === 409) return []; // 空的 repo
    throw e;
  }
  return tree.tree
    .filter((f) => f.type === 'blob' && f.path.startsWith('notes/') && f.path.endsWith('.md'))
    .map((f) => ({ path: f.path, sha: f.sha }));
}

export async function readBlob(sha) {
  const cfg = getConfig();
  const blob = await gh(`${repoPath(cfg)}/git/blobs/${sha}`, { cfg });
  return fromBase64(blob.content);
}

// 新增或更新檔案；更新時要帶舊的 sha。回傳新的 sha
export async function putFile(path, text, sha, message) {
  const cfg = getConfig();
  const res = await gh(`${repoPath(cfg)}/contents/${encodePath(path)}`, {
    method: 'PUT',
    cfg,
    body: { message, content: toBase64(text), branch: cfg.branch, ...(sha ? { sha } : {}) },
  });
  return res.content.sha;
}

export async function deleteFile(path, sha, message) {
  const cfg = getConfig();
  await gh(`${repoPath(cfg)}/contents/${encodePath(path)}`, {
    method: 'DELETE',
    cfg,
    body: { message, sha, branch: cfg.branch },
  });
}

export function githubFileUrl(path) {
  const cfg = getConfig();
  return `https://github.com/${cfg.owner}/${cfg.repo}/blob/${cfg.branch}/${encodePath(path)}`;
}
