# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
