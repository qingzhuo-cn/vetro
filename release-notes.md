Vetro v2.4.1 — 修复图片拖放

- 修复：外部图片拖入、预览内拖动图片调整位置失效的问题（Tauri 默认拦截了文件拖放，已设置 `dragDropEnabled: false` 让网页 DOM 正常接收 drop 事件）

上一版 v2.4.0 新增：所见即所得（WYSIWYG）预览 —— 预览可直接编辑文字、外部拖入图片、预览内拖动图片换位，双向同步回 Markdown。
