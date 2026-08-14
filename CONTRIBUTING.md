# 贡献规范

感谢你考虑为 Vetro 做贡献！本项目是**零框架、零构建**的原生 HTML / CSS / JS + Electron 应用，请保持这个原则。

## 开发

```bash
npm install        # 安装 Electron + electron-builder
npm start          # 桌面版开发运行
npm run build      # 打包 Windows 安装包 + 免安装版
# 浏览器调试：用任意静态服务器打开 index.html，如 python -m http.server 8765
```

## 项目结构

- `index.html` 页面骨架 + UI；`style.css` 全部样式（CSS 变量做主题）；`app.js` 全部逻辑
- `main.js` / `preload.js`：Electron 主进程与安全桥接
- `vendor/`：本地内置的第三方库（marked / highlight.js / DOMPurify）
- `assets/`：应用图标；`_headers`：Cloudflare 安全响应头

## 代码风格

- 原生 JavaScript（无框架、无构建步骤、无 TypeScript）
- 样式统一走 CSS 变量（`--accent`、`--bg-*`、`--glass-*` 等），主题 / 强调色必须走变量，**不硬编码颜色**
- 新增 UI 保持玻璃态设计语言与动效，动效需兼容 `prefers-reduced-motion`
- 事件监听、定时器等副作用应可清理

## Commit 规范

遵循 Conventional Commits：`feat:` / `fix:` / `docs:` / `style:` / `refactor:` / `chore:`。

## 安全底线

- 绝不把 API Key 明文写入存储、日志、导出文件或主题文件
- 预览 / 用户输入内容必须经 DOMPurify 净化后再渲染
- 外部链接一律走系统浏览器，不允许替换应用自身窗口
