# MD 排版台（WeChat MD Formatter）

专为微信公众号打造的单文件 Markdown 排版工具。写好 Markdown，一键复制带格式内容，直接粘贴进公众号后台，样式零损失。

**零依赖 · 单文件 · 离线可用 · 数据不出本机 · v1.1.0**

## 特性

- **9 套精心设计的文章主题**：科技青 / 极简黑白 / 公众号绿 / 霓虹渐变 / 硬朗粗野 / 书卷宋体 / 蓝图工程 / 暖纸 / 杂志，每套带专属画布底色
- **主题配色切换**：每个主题都可叠加洋红 / 紫棠 / 杏黄 / 葱绿 / 石榴红 / 煤黑 / 绀青绀紫 / 玄色配色；预览、复制与导出保持一致
- **科技青 H1 圆角标题块**：一级标题自动渲染为随文字宽度收缩的圆角色块，颜色跟随主题配色
- **一键复制到公众号**：所有样式内联到 `style=""`（微信编辑器只认内联样式），背景色逐块下沉 + 表格 `bgcolor` 属性 + 双层 section 包裹，实测粘贴零损失
- **外链自动转脚注**：公众号会剥掉外部链接，复制时自动把外链转为 `文字[1]` + 文末附录（`mp.weixin.qq.com` 域名链接保留）
- **一键格式化**：中英文加空格、中文标点转全角、直角引号化、清理空白——代码块/行内代码/链接地址受保护不受影响
- **排版微调**：字号 / 行高 / 段距 / 页面留白滑杆实时调节，预览即所得
- **暗黑模式预览**：近似模拟微信深色模式下的显示效果，发布前预检
- **草稿版本**：手动 + 替换前自动快照，最多保留 8 个版本，版本记录包含主题与配色
- **本地图片**：拖入/粘贴图片自动转 base64 插入（含 2MB 限制与复制前提醒）
- **导出**：带格式 HTML（可直传静态托管当「阅读原文」落地页）/ Markdown 源文件
- **安全**：DOMPurify 全量消毒，CSP 防护，正文仅存浏览器本地

## 快速开始

### 方式一：直接使用（推荐）

下载 [`index.html`](index.html)，双击用浏览器（Chrome / Edge）打开即可，无需安装、无需联网。

### 方式二：在线版

部署后的在线链接直接访问（见各 fork / 部署说明）。

### 方式三：源码构建

```bash
git clone https://github.com/amurokyo/wechat-md-formatter.git
cd wechat-md-formatter
python build.py   # 将 vendor 库内联进单文件，产出 index.html
```

## 项目结构

```
├── index.html          # 构建产物：单文件成品，可直接使用
├── editor.src.html     # 源模板（业务代码在这里改）
├── build.py            # 构建脚本：模板 + 库原料 → index.html
├── vendor/
│   ├── marked.min.js   # marked v12.0.2 (MIT)
│   └── purify.min.js   # DOMPurify 3.4.17 (Apache-2.0 / MPL-2.0)
├── CHANGELOG.md        # 版本变更记录
└── README.md
```

> 注：`vendor/` 下的 `.js` 保存的是 HTML `<script>` 块原文（含首尾换行），供构建脚本字节级还原，请勿直接作为 JS 模块引用。

## 微信兼容性设计

公众号编辑器（ProseMirror 底层）粘贴时的真实规则，本项目针对性处理：

| 微信行为 | 本项目对策 |
|----------|-----------|
| 只认内联样式，`<style>`/class 全部丢弃 | 所有主题样式逐标签写入 `style=""` |
| 会剥外部背景图、渐变背景 | 画布全部使用实色 `background-color` |
| 粘贴时拍平外层容器 | 外层大 section + 内层容器 + 逐块背景三层保险 |
| style 属性可能被清理 | 表格单元格追加老式 `bgcolor` 属性兜底 |
| 内联样式含双引号会截断属性 | 全部字体名不带引号（CSS 规范允许） |
| 剥 `<details>`、`<input>` 等标签 | 复制前自动降级为兼容结构 |
| 不允许脚本/动画 | 正文零 `@keyframes`，特效仅存在于编辑器 UI |

## 致谢

设计思路参考了这些优秀的开源项目：[doocs/md](https://github.com/doocs/md)、[WeMD](https://github.com/tenngoxars/WeMD)、[wechat-formatter (TypeZen)](https://github.com/mspringjade/wechat-formatter)、[ChicPage](https://github.com/joekind/chicpage)、[mdeditor](https://github.com/xiaobox/mdeditor)。

## License

[MIT](LICENSE) © 2026 amurokyo

第三方库：[marked](https://github.com/markedjs/marked) (MIT)、[DOMPurify](https://github.com/cure53/DOMPurify) (Apache-2.0 / MPL-2.0)
