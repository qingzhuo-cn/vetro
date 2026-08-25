// 检查更新：查询 GitHub Releases API，对比版本号。
import { httpRequest, getVersion } from './backend';

export interface UpdateInfo {
  latest: string;
  url: string;
  notes: string;
}

/** 解析版本号为 [major, minor, patch, isRelease]，预发布（-beta/-rc 等）排在同版本正式版之前 */
function parseVersion(v: string): number[] {
  const clean = (v || '').trim().replace(/^v/i, '');
  const dash = clean.indexOf('-');
  const core = dash >= 0 ? clean.slice(0, dash) : clean;
  const nums = core.split('.').map((n) => parseInt(n, 10) || 0);
  while (nums.length < 3) nums.push(0);
  nums.push(dash >= 0 ? 0 : 1); // 预发布 = 0，正式版 = 1
  return nums;
}

/** latest > current 时返回 true */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** 查询 GitHub 最新 Release；无更新或出错返回 null */
export async function checkForUpdates(): Promise<UpdateInfo | null> {
  try {
    const res = await httpRequest({
      url: 'https://api.github.com/repos/qingzhuo-cn/vetro/releases/latest',
      method: 'GET',
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Vetro' },
      timeout_secs: 15,
    });
    if (res.status >= 400) return null;
    const data = JSON.parse(res.body);
    const tag: string = data.tag_name || '';
    const current = await getVersion();
    if (!tag || !isNewer(tag, current)) return null;
    return {
      latest: tag,
      url: data.html_url || 'https://github.com/qingzhuo-cn/vetro/releases/latest',
      notes: (data.body || '').slice(0, 300),
    };
  } catch {
    return null;
  }
}
