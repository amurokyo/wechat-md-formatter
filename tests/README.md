# 测试说明

阶段 1 建立的测试体系（方案 §6）：无框架、无联网依赖（产品运行时仍为
零依赖单文件；`playwright-core` 只是测试工具，不进入产品）。

## 运行方法（仓库根目录）

```bash
# 全部测试
node tests/unit.mjs && node tests/smoke.mjs && node tests/storage-compat.mjs && node tests/preview-dirty.mjs && node tests/storage-prompts.mjs && node tests/security.mjs

# 或在 tests/ 目录用 npm 脚本（等价）
cd tests && npm test

# 只跑一类
node tests/unit.mjs            # 离线单元测试
node tests/smoke.mjs           # 真实浏览器端到端 smoke 测试
node tests/storage-compat.mjs  # localStorage 新旧版本互通测试
node tests/preview-dirty.mjs   # 移动端 previewDirty 同步 + 超大文稿提示
node tests/storage-prompts.mjs # 存储失败/容量提示 + 图片处理
node tests/security.mjs        # 安全专项：危险 HTML/URL/SVG/CSS、脚注与导出标题、CSP 与离线、剪贴板三路降级
node tests/perf.mjs            # 性能测量（只记录、不硬性失败；见下）
```

首次运行 smoke 测试前需安装测试工具依赖（只需一次，需联网；CI 里同样执行）：

```bash
cd tests && npm install
```

## 浏览器来源

`smoke.mjs` 使用 `playwright-core` + 本机已缓存的
`chromium_headless_shell`（`~/.cache/ms-playwright/`，与
`~/workspace/rs-browser` 同款写法；可用环境变量
`PLAYWRIGHT_CHROMIUM_EXE` 覆盖可执行文件路径）。
**不要跑 `npx playwright install chromium`**——本机代理下它会静默失败，
且测试不需要下载浏览器。

## 文件

| 文件 | 内容 |
|---|---|
| `unit.mjs` | 离线单测：从 `editor.src.html` 提取纯函数源码到 `node:vm` 沙箱执行（不改业务逻辑）；覆盖 `safeBaseName`、`formatMarkdown`（代码块/行内代码/链接保护）、`esc`、`store` 写入失败处理、`getHistory`、`snapshotCurrent`（去重与 8 份上限） |
| `smoke.mjs` | 真实浏览器测试：示例渲染、9 套主题切换、按钮、页内 `formatMarkdown` / `normalizeForWechat` / `getWechatHTML`（外链脚注与 `mp.weixin.qq.com` 排除）、危险 HTML 消毒（含 `fixtures/dangerous.md` 全量样例）、回归样例、localStorage 草稿刷新恢复、无 JS 控制台错误 |
| `fixtures/regression.md` | 固定回归样例（方案 §6.2）：标题/列表/表格/代码/引用/图片/外链/details/危险 HTML/长文；阶段 2 已与 stage0 的 212 行版本统一（以 stage0 为准并入增量内容：H4–H6、三类列表嵌套、四列表格、html/text 代码块、更多图片与链接、第二个 details、合法原始 HTML、更多危险样例、长文段落） |
| `fixtures/dangerous.md` | 危险 HTML 攻击样例专放（与 stage0 同源）：script/事件属性/javascript:/data:/vbscript:/SVG/iframe/object/form/base/link/meta/style/CSS 注入/嵌套畸形/模板表达式/合法对照；smoke §7b 全量断言其消毒结果 |
| `storage-compat.mjs` | localStorage 新旧版本互通测试：基线版写 10 个 key 的旧格式数据 → 新版读（恢复验证）→ 新版写 → 基线版读（回滚验证） |
| `perf.mjs` | 性能测量（阶段 3）：对 `fixtures/perf-{5k,50k,200k,500k}.md` 四档文稿，分别测基线产物与当前产物的直接渲染耗时（同步 `render()`，默认 5 次取中位数）与防抖输入耗时（设值 + 派发 input 到预览稳定，含 180ms 防抖，默认 3 次取中位数）；`--out <json>` 写原始数据。**只记录、不硬性失败**（CI 机器波动大）；仅渲染超时或浏览器不可用时退出码为 1。默认基线路径为工作区 `../../baseline/v1.1.0/index.html`，不存在时跳过基线列 |
| `preview-dirty.mjs` | 移动端 previewDirty 专项（阶段 3，390×844 视口）：编辑态延迟渲染契约、编辑→切预览 / 编辑→复制（`getWechatHTML()` 与打桩捕获的 `copyWechat()`）/ 编辑→导出（捕获 `exportHTML()` 的 blob）三路含最新输入、超大文稿（500KB）温和提示且不截断 |
| `storage-prompts.mjs` | 存储与图片专项（阶段 3）：`storageStats()` 体积统计与总量 ≥3MB 容量提示、写入失败时编辑区保留 + Toast + 一次“立即导出 MD 备份”确认（接受后真的下载 .md 备份）+ 同一轮只问一次 + 快照失败不报“已保存”、图片有效/损坏/非图片 MIME/空文件/超 2MB/FileReader 失败/多图累计超 1MB 提示 |
| `security.mjs` | 安全专项（阶段 4，65 断言）：script/事件属性/危险 URL/SVG/iframe-object-form-base-link-meta/style 标签与 CSS 注入/嵌套畸形/模板表达式，预览 DOM、复制输出与 HTML 导出三路均断言干净且无执行（alert 探针）；合法对照组不受损；脚注 URL 为纯文本附录、导出标题转义；CSP（connect-src 'none'）与离线验证（断网重载/编辑/主题切换/导出可用、加载阶段零网络请求）；Clipboard 三路降级（API 可用时成功提示只在写完成之后、API 不可用时 execCommand 兼容复制、execCommand 失败时备用弹窗 + 富文本全选 + HTML 源码复制）。剪贴板实际写入用打桩捕获验证，真实写入与微信后台粘贴见 `../stage4/WECHAT_MANUAL_TEST.md` |
| `fixtures/perf-5k.md` / `perf-50k.md` / `perf-200k.md` / `perf-500k.md` | 性能测量文稿（与 stage0 同源，5KB / 50KB / 200KB / 500KB 近似体积；拷入 `tests/` 使测试自包含） |
| `package.json` | 仅测试工具依赖 `playwright-core`（devDependencies） |

## 已知事项

- `fmtPlain` 标点分支缺陷（F-012，阶段 1 的 `KNOWN-FAIL` 探针）已在阶段 2
  修复：标点正则加第二个捕获组，`你好,世界` 正确转为 `你好，世界`；探针
  已转为正常断言，并补了多标点混合、句末标点、右括号/分号/冒号、句号、
  纯英文与数字小数点不受影响、行内代码/链接保护等用例。括号对顺序问题
  （`你好(世界)` 修后为 `你好(世界）`）已在阶段 4 修复：括号配对分支移到
  标点转换之前，`你好(世界)` 现正确转为 `你好（世界）`，unit 新增 4 条
  断言；残留：`）` 后的 ASCII 标点（如 `你好（世界）,你好` 中的逗号）
  仍不转全角——标点规则只认中文前导字符，属既有局限，见阶段 4 报告。
- 阶段 4 已修 `<style>` 穿透与内联 style 危险声明保留（阶段 2/3 遗留）：
  `style` 加入 `cleanHTML()` 的 `FORBID_TAGS`（标签连内容一并清除），
  内联 style 属性由 `uponSanitizeAttribute` 钩子逐声明清洗
  （expression()/url(javascript:)/vbscript:/data:text/html/-moz-binding/
  behavior:，含 CSS 转义变体），无危险声明时属性值原样保留；smoke §7b
  的基线行为断言已同步改为已修断言，security.mjs 另有 65 条专项断言。
- `smoke.mjs` / `security.mjs` 不测剪贴板实际写入（headless `file://` 下
  Clipboard API 不可靠；复制三路降级链路在 security.mjs §12 用打桩捕获
  验证，真实写入与微信后台实测见 `../stage4/WECHAT_MANUAL_TEST.md`）。
- `smoke.mjs` 忽略 `Failed to load resource` 类控制台信息：回归样例含
  外链图片与相对路径图片，在离线沙箱里加载失败是环境使然；只断言 JS
  层面的 `console.error` 与未捕获异常为零。
