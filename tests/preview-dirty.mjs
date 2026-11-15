// tests/preview-dirty.mjs — 移动端 previewDirty 状态同步专项测试
//
// 运行方法（在仓库根目录）：
//   node tests/preview-dirty.mjs
//
// 背景（方案 §4.3.7）：移动端编辑态下 render() 只置 previewDirty 而不
// 真正渲染（避免输入时反复全量解析）。切换到预览时 toggleMode('view')
// 会补渲染；但复制（copyWechat → getWechatHTML）与导出（exportHTML）
// 若直接读旧预览，就会输出旧内容。本阶段把这两条路改为强制刷新
// render(true)，本文件覆盖三种路径：
//   1. 编辑 → 切预览：预览含最新输入，previewDirty 复位
//   2. 编辑 → 复制：getWechatHTML() 与 copyWechat() 的输出含最新输入
//   3. 编辑 → 导出：exportHTML() 的导出内容含最新输入
// 另覆盖：编辑态下预览确实延迟（不含最新输入、previewDirty 为 true），
// 以及超大文稿温和提示（只提示、不截断）。
// 视口 390×844（移动端断点 860px 以内）；浏览器与 smoke.mjs 同款
// playwright-core + 本机缓存 chromium_headless_shell。

import { chromium } from 'playwright-core';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_URL = 'file://' + path.join(REPO, 'index.html');
const FIXTURE_500K = path.join(REPO, 'tests', 'fixtures', 'perf-500k.md');

function findChromiumExe() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXE) return process.env.PLAYWRIGHT_CHROMIUM_EXE;
  const base = path.join(process.env.HOME || '/home/hatch', '.cache', 'ms-playwright');
  if (!existsSync(base)) return null;
  for (const dir of readdirSync(base).filter((d) => d.startsWith('chromium_headless_shell-'))) {
    const exe = path.join(base, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
    if (existsSync(exe)) return exe;
  }
  return null;
}

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; failures.push(name); console.log('FAIL ' + name + (extra ? ' — ' + extra : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const exe = findChromiumExe();
if (!exe) {
  console.log('FAIL 未找到缓存的 chromium_headless_shell（~/.cache/ms-playwright/），无法运行 preview-dirty 测试');
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const pageErrors = [];
const consoleErrors = [];
let page;
try {
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  await page.goto(INDEX_URL);
  await page.waitForSelector('#preview', { timeout: 15000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('#preview', { timeout: 15000 });
  await sleep(500);
  // 移动端启动默认预览模式；确认断点生效
  check('移动端启动为预览模式', await page.evaluate(() =>
    document.body.classList.contains('mode-view') && matchMedia('(max-width:860px)').matches));

  const previewHas = (marker) => page.evaluate((m) =>
    document.querySelector('#preview').innerText.includes(m), marker);
  const isDirty = () => page.evaluate(() => previewDirty);

  // --- 1. 编辑 → 切预览：先确认延迟行为，再确认切换补渲染 ---
  await page.click('#tabEdit');
  await sleep(200);
  const MARK_A = 'PREVIEW-DIRTY-A-' + Date.now();
  await page.fill('#editor', '# 标题A\n\n' + MARK_A + '\n');
  await sleep(50); // 在 180ms 防抖窗口内，渲染尚未发生
  check('编辑态下预览延迟更新（不含最新输入）', !(await previewHas(MARK_A)));
  check('编辑后 previewDirty 为 true', await isDirty());
  await page.click('#tabView');
  await sleep(300);
  check('编辑→切预览：预览含最新输入', await previewHas(MARK_A));
  check('切预览后 previewDirty 复位', !(await isDirty()));

  // --- 2. 编辑 → 复制：getWechatHTML() 立即拿到最新输入 ---
  await page.click('#tabEdit');
  await sleep(200);
  const MARK_B = 'PREVIEW-DIRTY-B-' + Date.now();
  await page.fill('#editor', '# 标题B\n\n' + MARK_B + '\n');
  await sleep(50); // 防抖窗口内就取复制输出，不等渲染
  const wxB = await page.evaluate(() => window.getWechatHTML());
  check('编辑→复制：getWechatHTML() 含最新输入', wxB.html.includes(MARK_B) && wxB.plain.includes(MARK_B));
  check('取复制输出后 previewDirty 复位', !(await isDirty()));
  check('取复制输出后预览本身也已刷新', await previewHas(MARK_B));

  // --- 2b. 编辑 → 复制：走 copyWechat() 全程（剪贴板写操作打桩捕获） ---
  await page.click('#tabEdit');
  await sleep(200);
  const MARK_C = 'PREVIEW-DIRTY-C-' + Date.now();
  await page.fill('#editor', '# 标题C\n\n' + MARK_C + '\n');
  await sleep(50);
  const copied = await page.evaluate(async (marker) => {
    // headless file:// 下 Clipboard API 不可靠，打桩只为验证应用
    // 交给剪贴板的数据是否最新；真实写入留给阶段 4 与微信后台实测。
    window.__copiedHtml = null;
    try {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          // 注意：ClipboardItem.getType() 返回 Promise<Blob>，须先 await
          write: async (items) => {
            const blob = await items[0].getType('text/html');
            window.__copiedHtml = await blob.text();
          },
          writeText: async () => {},
        },
        configurable: true,
      });
      window.ClipboardItem = class {
        constructor(map) { this._map = map; }
        async getType(t) { return this._map[t]; }
      };
    } catch (_) { return 'STUB-FAILED'; }
    await window.copyWechat();
    return window.__copiedHtml;
  }, MARK_C);
  check('编辑→复制：copyWechat() 交给剪贴板的内容含最新输入',
    typeof copied === 'string' && copied.includes(MARK_C), String(copied && copied.slice(0, 80)));

  // --- 3. 编辑 → 导出：exportHTML() 的导出内容含最新输入 ---
  await page.click('#tabEdit');
  await sleep(200);
  const MARK_D = 'PREVIEW-DIRTY-D-' + Date.now();
  await page.fill('#editor', '# 标题D\n\n' + MARK_D + '\n');
  await sleep(50); // 防抖窗口内就导出，不等渲染
  const exported = await page.evaluate(async () => {
    window.__exportedBlob = null;
    const origCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { window.__exportedBlob = blob; return origCreate(blob); };
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {}; // 只取 blob 内容，不真的触发下载
    try { window.exportHTML(); } finally { HTMLAnchorElement.prototype.click = origClick; }
    return window.__exportedBlob ? await window.__exportedBlob.text() : null;
  });
  check('编辑→导出：exportHTML() 内容含最新输入',
    typeof exported === 'string' && exported.includes(MARK_D), String(exported && exported.slice(0, 80)));
  check('导出后 previewDirty 复位', !(await isDirty()));

  // --- 4. 超大文稿温和提示：只提示，不截断 ---
  // 注：500KB 文稿不用 page.fill（实测 fill 会在超大值 + 立即重渲染时
  // 挂起超时），改用 evaluate 直接设值 + 派发 input（与 perf.mjs 同款）。
  const big = readFileSync(FIXTURE_500K, 'utf-8');
  const setEditorBig = (text) => page.evaluate((t) => {
    const editor = document.querySelector('#editor');
    editor.value = t;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
  await page.click('#tabEdit');
  await sleep(200);
  await setEditorBig(big);
  await sleep(700); // 防抖渲染 + Toast 出现
  const toast1 = await page.evaluate(() => document.querySelector('#toast').textContent);
  check('超大文稿（500KB）给出温和提示', toast1.includes('文稿较大'), JSON.stringify(toast1));
  const kept = await page.evaluate(() => ({
    len: document.querySelector('#editor').value.length,
    dirty: previewDirty,
  }));
  check('超大文稿内容完整保留（编辑区未截断）', kept.len === big.length, `实际 ${kept.len} / 预期 ${big.length}`);
  await page.click('#tabView');
  await sleep(1500); // 500KB 全量渲染
  check('超大文稿切预览后正常渲染（含探针文本）',
    await page.evaluate(() => document.querySelector('#preview').innerText.includes('性能测试章节')));
  // 缩回小文稿再放大：提示标志复位，提示会再次出现
  await page.click('#tabEdit');
  await sleep(200);
  await page.fill('#editor', '# 小文稿\n\nhello\n');
  await sleep(600);
  await setEditorBig(big);
  await sleep(700);
  const toast2 = await page.evaluate(() => document.querySelector('#toast').textContent);
  check('文稿缩小后再放大，超大提示再次出现', toast2.includes('文稿较大'), JSON.stringify(toast2));

  // --- 5. 全程无 JS 错误 ---
  const jsErrors = consoleErrors.filter((m) => !m.startsWith('Failed to load resource')
    && !m.includes('violates the following Content Security Policy directive'));
  check('页面无 JS 控制台错误（console.error）', jsErrors.length === 0, JSON.stringify(jsErrors.slice(0, 3)));
  check('页面加载无未捕获 JS 异常', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)));
} catch (err) {
  fail++;
  failures.push('preview-dirty 流程异常：' + (err && err.message));
  console.log('FAIL preview-dirty 流程异常：' + (err && err.message));
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('失败项：' + failures.join('；')); process.exit(1); }
