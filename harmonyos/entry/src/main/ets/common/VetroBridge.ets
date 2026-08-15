import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { http } from '@kit.NetworkKit';

const TAG = 'VetroBridge';
const STORE_NAME = 'vetro';
const KEY_STATE = 'state';
const PREFIX_SECRET = 'secret:';

/**
 * 原生桥：暴露给 H5（window.vetroNative）。
 * ⚠️ 模板实现：dbLoad/secureGet 因 registerJavaScriptProxy 的同步限制返回 null，
 * 生产方案请用「异步 + runJavaScript 回写」模式（见 HARMONYOS-PORT.md）。
 */
export class VetroBridge {
  private ctx: common.UIAbilityContext;

  constructor(ctx: common.UIAbilityContext) {
    this.ctx = ctx;
  }

  private async prefs(): Promise<preferences.Preferences> {
    return preferences.getPreferences(this.ctx, STORE_NAME);
  }

  // ---- 文档状态（简化：preferences 存状态 JSON；全文搜索建议改 relationalStore） ----
  dbInit(): void {
    // 预留：relationalStore 建库/建表（CREATE TABLE IF NOT EXISTS …）
  }

  dbSave(stateJson: string, docsJson: string): void {
    this.prefs().then((p) => {
      p.put(KEY_STATE, stateJson);
      p.flush();
      // TODO: 把 docsJson 写入 relationalStore 并建 FTS 索引，供 dbSearch 使用
    }).catch((e) => {
      console.error(TAG + ' dbSave failed ' + JSON.stringify(e));
    });
  }

  dbLoad(): string | null {
    // 同步限制：简化返回 null（H5 回退 localStorage）。
    // 生产：异步读取后 runJavaScript 回写 window.__vetroState
    return null;
  }

  dbSearch(query: string): Array<Object> {
    // TODO: relationalStore LIKE / FTS 查询，返回 [{ id, name, snippet }]
    return [];
  }

  // ---- 安全存储（建议改用 @ohos.security.asset 加密存储） ----
  secureSet(key: string, value: string): void {
    this.prefs().then((p) => {
      p.put(PREFIX_SECRET + key, value);
      p.flush();
    }).catch((e) => {
      console.error(TAG + ' secureSet failed ' + JSON.stringify(e));
    });
  }

  secureGet(key: string): string | null {
    // 同步限制：简化返回 null（H5 回退 localStorage）
    return null;
  }

  secureDelete(key: string): void {
    this.prefs().then((p) => {
      p.delete(PREFIX_SECRET + key);
      p.flush();
    }).catch((e) => {
      console.error(TAG + ' secureDelete failed ' + JSON.stringify(e));
    });
  }

  // ---- 网络代理（无 CORS 限制） ----
  private toMethod(m: string): http.RequestMethod {
    switch ((m || 'GET').toUpperCase()) {
      case 'POST': return http.RequestMethod.POST;
      case 'PUT': return http.RequestMethod.PUT;
      case 'DELETE': return http.RequestMethod.DELETE;
      case 'PATCH': return http.RequestMethod.PATCH;
      default: return http.RequestMethod.GET;
    }
  }

  httpRequest(req: Record<string, Object>): Object {
    const url: string = req.url as string;
    const headers: Record<string, string> = (req.headers as Record<string, string>) || {};
    const body: string = (req.body as string) || '';
    const client = http.createHttp();
    const opts: http.HttpRequestOptions = {
      method: this.toMethod(req.method as string),
      header: headers,
      connectTimeout: 30000,
      readTimeout: 120000
    };
    if (body) {
      opts.extraData = body;
    }
    try {
      const resp = client.requestSync(url, opts);
      return {
        status: resp.responseCode,
        headers: resp.header,
        body: typeof resp.result === 'string' ? resp.result : JSON.stringify(resp.result)
      };
    } catch (e) {
      console.error(TAG + ' httpRequest failed ' + JSON.stringify(e));
      return { status: 0, headers: {}, body: JSON.stringify(e) };
    } finally {
      client.destroy();
    }
  }

  // ---- 文件（建议用 @ohos.file.picker + @ohos.file.fs 实现） ----
  saveFile(defaultName: string): string | null {
    // TODO: picker.save() 选择保存位置，返回 uri 字符串
    return null;
  }

  writeFile(path: string, content: string): void {
    // TODO: fs.open(path, WRITE) + fs.write + fs.close
  }

  readFile(path: string): string | null {
    // TODO: fs.open(path, READ) + fs.read + fs.close
    return null;
  }

  openFile(): string | null {
    // TODO: picker.select() 选择 .md 文件，返回 uri 字符串
    return null;
  }
}
