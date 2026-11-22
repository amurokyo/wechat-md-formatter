# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v1.2.1] - 2026-11-22

### Added

- 编辑-预览行同步高亮：编辑光标所在行，预览里对应的块描边高亮，带「当前行」角标。鼠标点到哪行、方向键移到哪行，预览就高亮哪一块；光标落在空行上时高亮下一块，文末空行高亮上一块；对应块不在视野内时预览自动滚动到它附近。
- 高亮只在工具界面内显示：高亮层是预览的兄弟节点（不在预览内），复制/导出只取预览的克隆，永远带不进公众号 HTML；预览 DOM 元素本身不加任何 class/style，复制/导出输出与 v1.2.0 逐字节一致。
- 显示方式与 md 格式区分：只用描边框 + 角标，不用色块填充——引用块/代码块是背景色块，这里是描边框，一眼就能分清这是工具的定位提示，不是正文格式；暗色预览下描边仍是青色，始终可见。

### Fixed

- 行映射的边界情况：`<details>` 这类块会被解析器拆成开标签/正文/闭标签三个片段，整组只对应预览里的 1 个顶层元素，映射时成组计数；纯链接定义段会被解析器丢掉，映射时按原文定位跳过；元素总数对不上时整篇停用同步，宁可不亮也不亮错。超大文稿（>100KB 或 >800 块）跳过映射，渲染性能与 1.2.0 持平。

## [v1.2.0] - 2026-11-15

### Added

- Hardened build pipeline (`build.py`): input validation, placeholder uniqueness checks, marked/DOMPurify version verification, HTML/JS syntax checks, atomic output replacement, SHA-256 build records (`build-info.json`), and a `--check` mode for CI.
- Automated test suite (`tests/`): unit tests, headless-Chromium smoke tests, localStorage compatibility tests, and GitHub Actions CI.
- Storage capacity reporting and backup prompts: draft/history/image volume statistics, clear failure messages, and an "export MD backup now" recovery path.
- Security hardening: `<style>` tags are now stripped during sanitizing, and dangerous CSS in inline styles (`expression()`, `javascript:` URLs) is cleaned per declaration.

### Fixed

- One-click formatting could corrupt Chinese punctuation into numbers (`你好,世界` became `你好1世界`); the punctuation rule now captures correctly.
- Mobile editing no longer copies or exports a stale preview: copy/export now force a fresh render first.
- Bracket pairing in formatting: `你好(世界)` now formats to `你好（世界）`.
- Images without a MIME type are no longer misread as text; corrupted images and FileReader failures are handled with clear prompts.
- Compatibility copy no longer loses the background between lines: when the ClipboardItem path is unavailable, the old selection-based fallback let the browser strip the outer `<section>` wrappers during selection serialization, so the canvas background between blocks was lost after pasting into the WeChat editor. The fallback now writes the exact HTML via the `copy` event (`clipboardData.setData`), and manual copy from the fallback dialog does the same; the selection-based copy remains only as a last resort.

### Changed

- Internal code is now organized into service sections (Storage, Markdown, Theme, Preview, WeChat Export, Clipboard, File, Image, Draft History, Formatting, UI) inside the single-file source template. No UI, feature, or behavior changes; the delivered `index.html` remains a single offline file and all localStorage keys are unchanged.

## [v1.1.0] - 2026-11-14

### Added

- Theme color palette switcher. Every theme can now be combined with Magenta, Violet, Apricot, Green, Garnet, Ink, Navy, or Xuan. The selected palette is saved locally and applied consistently to preview, WeChat clipboard output, and HTML export.
- Rounded H1 title pill for the “Tech Cyan” theme. The pill follows the active palette.
- Draft history now records the selected theme and color palette, so restoring a snapshot restores the full visual style.

### Changed

- Rebuilt the release from the stable `v1.0.0` codebase and retained its bug fixes and enhancements: one-click formatting, typography tweaks, external-link footnotes, dark-mode preview, MD/HTML export, draft history, and DOMPurify sanitizing.
- Updated the build pipeline to reference `vendor/marked.min.js` and `vendor/purify.min.js`, matching the repository layout and README.
- Expanded browser smoke tests for themes, palettes, export output, H1 pills, formatting, tweaks, and footnotes.

### Removed

- Removed the AI generation feature and all CloudBase login/cloud-function code to keep the editor fully local and offline.

## [v1.0.0] - 2026-11-08

### Added

- Initial public release of the single-file WeChat Markdown formatter.
- 9 article themes with inline styles and canvas backgrounds.
- WeChat clipboard output with inline styling, background fallbacks, and table `bgcolor` support.
- External-link footnote conversion, formatting tools, typography tweaks, dark-mode preview, draft history, local images, MD/HTML export, and DOMPurify sanitizing.
