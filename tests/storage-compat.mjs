// tests/storage-compat.mjs — localStorage 新旧版本互通测试（真实 headless Chromium）
//
// 运行方法（在仓库根目录）：
//   node tests/storage-compat.mjs
//
// 场景（方案 §4.4：不改变现有 key，兼容读取旧数据）：
//   A. 基线版 index.html（baseline/v1.1.0/）写入 10 个 key 的旧格式数据
//      （值格式见 stage0/STORAGE_KEYS.md；与基线实际写入的格式逐字节一致）。
//   B. 同一浏览器 context、同一 file:// 源打开新构建的 index.html，
//      验证草稿、主题、配色、画布、文件名、排版参数、格式化选项、历史版本、
//      脚注开关、暗色开关全部正确恢复（旧 → 新，前向兼容）。
//   C. 在新版页面上用真实 UI 操作改写全部 10 个 key（新版写入）。
//   D. 同一 context 再打开基线版 index.html，验证基线版仍能读取新版
//      写出的数据（新 → 旧，回滚兼容）。
//
// file:// 下 localStorage 在同一 context 内跨路径共享（已实测：基线页
// 写入后新版页可读；反之亦然），故用同一 context 的三个页面完成全程。
// 浏览器：playwright-core + 本机已缓存的 chromium_headless_shell
// （~/.cache/ms-playwright/，不要跑 npx playwright install chromium）。

import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OLD_URL = 'file:///home/hatch/workspace/wechat-md-formatter-upgrade/baseline/v1.1.0/index.html';
const NEW_URL = 'file://' + path.join(REPO, 'index.html');

// --- 定位本机缓存的 headless shell（与 tests/smoke.mjs 同款写法） ---
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
  console.log('FAIL 未找到缓存的 chromium_headless_shell（~/.cache/ms-playwright/），无法运行 storage-compat 测试');
  process.exit(1);
}

// 旧格式数据（与基线实际写入的格式一致；标记串用于证明恢复的是这份数据）
const OLD_MARKER = 'STORAGE-COMPAT-OLD-20261115';
const OLD_VALUES = {
  md_draft: '# 兼容测试草稿\n\n' + OLD_MARKER + ' 旧版草稿正文，含中文 English 123。\n',
  md_theme: 'classic',
  md_canvas: '0',
  md_filename: '兼容测试.md',
  md_history_v2: JSON.stringify([
    { id: 'mwhkold1', name: '兼容测试.md', content: '# 历史版本一\n\nHIST-V1 ' + OLD_MARKER, theme: 'neon', palette: 'magenta', canvas: false, savedAt: 1763000000000 },
    { id: 'mwhkold2', name: '兼容测试.md', content: '# 历史版本二\n\nHIST-V2 ' + OLD_MARKER, theme: 'tech', palette: 'default', canvas: true, savedAt: 1762999999000 },
  ]),
  md_palette: 'magenta',
  md_tweaks: JSON.stringify({ fs: 17, lh: 2.0 }),
  md_fmt: JSON.stringify({ space: true, clean: true, punct: true, quote: true }),
  md_footnote: '0',
  md_darkprev: '1',
};
const NEW_MARKER = 'STORAGE-COMPAT-NEW-20261115';

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const pageErrors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  // ---------- A. 基线版写入 10 个 key 的旧格式数据 ----------
  const pageOld = await ctx.newPage();
  pageOld.on('pageerror', (err) => pageErrors.push('old: ' + String(err && err.message || err)));
  await pageOld.goto(OLD_URL);
  await pageOld.waitForSelector('#preview', { timeout: 15000 });
  await pageOld.evaluate((values) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(values)) localStorage.setItem(k, v);
  }, OLD_VALUES);
  const written = await pageOld.evaluate(() => Object.keys(localStorage).sort());
  check('A. 基线版写入 10 个 key', written.length === 10 && written.includes('md_history_v2'),
    JSON.stringify(written));
  console.log('old values written:', JSON.stringify(written));

  // ---------- B. 新版读取旧数据（前向兼容） ----------
  const pageNew = await ctx.newPage();
  pageNew.on('pageerror', (err) => pageErrors.push('new: ' + String(err && err.message || err)));
  await pageNew.goto(NEW_URL);
  await pageNew.waitForSelector('#preview', { timeout: 15000 });
  await sleep(700);
  const restored = await pageNew.evaluate(() => ({
    editor: document.querySelector('#editor').value,
    preview: document.querySelector('#preview').innerText,
    themeSel: document.querySelector('#themeSel').value,
    canvasBtn: document.querySelector('#btnCanvas').textContent,
    fileName: document.querySelector('#fileName').textContent,
    history: window.getHistory(),
    themeStrong: window.getActiveTheme().strong,
    previewStyle: document.querySelector('#preview').getAttribute('style') || '',
    footBtn: document.querySelector('#btnFoot').textContent,
    darkClass: document.body.classList.contains('darkprev'),
    darkOn: document.querySelector('#btnDark').classList.contains('on'),
  }));
  check('B1. 新版恢复草稿正文（编辑区 + 预览）',
    restored.editor.includes(OLD_MARKER) && restored.preview.includes(OLD_MARKER));
  check('B2. 新版恢复主题 classic', restored.themeSel === 'classic', restored.themeSel);
  check('B3. 新版恢复画布关（背景:关）', restored.canvasBtn.includes('背景:关'), restored.canvasBtn);
  check('B4. 新版恢复文件名', restored.fileName === '兼容测试.md', restored.fileName);
  check('B5. 新版恢复历史版本（2 条，含主题/配色/画布字段）',
    restored.history.length === 2
    && restored.history[0].content.includes('HIST-V1')
    && restored.history[0].theme === 'neon' && restored.history[0].palette === 'magenta'
    && restored.history[0].canvas === false
    && restored.history[1].content.includes('HIST-V2'),
    JSON.stringify(restored.history.map((h) => h.content.slice(0, 20))));
  check('B6. 新版恢复配色 magenta（classic strong 映射为 #be185d）',
    restored.themeStrong.includes('#be185d'), restored.themeStrong);
  check('B7. 新版恢复排版参数（字号 17 / 行高 2）',
    restored.previewStyle.includes('font-size:17px') && restored.previewStyle.includes('line-height:2;'),
    restored.previewStyle.slice(0, 160));
  check('B8. 新版恢复脚注关', restored.footBtn.includes('脚注:关'), restored.footBtn);
  check('B9. 新版恢复暗色开', restored.darkClass && restored.darkOn);
  // 弹窗内状态同样恢复：历史列表 2 条、排版滑杆 17、格式化四项全勾
  await pageNew.click('#btnHistory');
  await sleep(400);
  const histItems = await pageNew.evaluate(() => document.querySelectorAll('#historyList .history-item').length);
  check('B10. 新版历史弹窗渲染 2 条', histItems === 2, '实际 ' + histItems + ' 条');
  await pageNew.keyboard.press('Escape');
  await sleep(200);
  await pageNew.click('#btnTweak');
  await sleep(300);
  const tw = await pageNew.evaluate(() => ({
    fs: document.querySelector('#twFs').value, tvFs: document.querySelector('#tvFs').textContent,
  }));
  check('B11. 新版排版弹窗回显字号 17', tw.fs === '17' && tw.tvFs === '17px', JSON.stringify(tw));
  await pageNew.keyboard.press('Escape');
  await sleep(200);
  await pageNew.click('#btnFmt');
  await sleep(300);
  const fmt = await pageNew.evaluate(() => ['fmtSpace', 'fmtClean', 'fmtPunct', 'fmtQuote']
    .map((id) => document.querySelector('#' + id).checked));
  check('B12. 新版格式化弹窗回显四项全勾', fmt.every(Boolean), JSON.stringify(fmt));
  await pageNew.keyboard.press('Escape');
  await sleep(200);

  // ---------- C. 新版用真实 UI 改写全部 10 个 key ----------
  await pageNew.fill('#editor', '# 新版草稿\n\n' + NEW_MARKER + '\n');
  await sleep(900); // saveDraft 防抖 400ms
  await pageNew.evaluate(() => window.saveDraft(true));
  await pageNew.selectOption('#themeSel', 'neon');
  await sleep(300);
  await pageNew.click('#btnCanvas'); // 关 -> 开
  await sleep(300);
  await pageNew.click('#btnHistory');
  await sleep(300);
  await pageNew.click('#btnSnapshot');
  await sleep(300);
  await pageNew.keyboard.press('Escape');
  await sleep(200);
  await pageNew.click('#btnPalette');
  await sleep(300);
  await pageNew.evaluate(() => {
    const card = Array.from(document.querySelectorAll('.palette-card'))
      .find((c) => c.textContent.includes('葱绿'));
    if (card) card.click();
  });
  await sleep(300);
  await pageNew.click('#btnFmt');
  await sleep(300);
  await pageNew.evaluate(() => { document.querySelector('#fmtPunct').checked = false; });
  await pageNew.click('#btnFmtApply'); // 写 md_fmt（含 punct:false），并格式化（标记串不受影响）
  await sleep(400);
  await pageNew.click('#btnTweak');
  await sleep(300);
  await pageNew.evaluate(() => {
    const el = document.querySelector('#twFs');
    el.value = '16';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(300);
  await pageNew.keyboard.press('Escape');
  await sleep(200);
  await pageNew.click('#btnFoot'); // 关 -> 开
  await sleep(200);
  await pageNew.click('#btnDark'); // 开 -> 关
  await sleep(200);
  const newWritten = await pageNew.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      out[k] = localStorage.getItem(k);
    }
    return out;
  });
  console.log('new values written:', JSON.stringify(newWritten, null, 1));
  check('C1. 新版写出 10 个 key', Object.keys(newWritten).length === 10,
    JSON.stringify(Object.keys(newWritten).sort()));
  check('C2. 新版写出草稿含新标记', (newWritten.md_draft || '').includes(NEW_MARKER));
  check('C3. 新版写出主题 neon / 画布开 / 配色 green / 脚注开 / 暗色关',
    newWritten.md_theme === 'neon' && newWritten.md_canvas === '1'
    && newWritten.md_palette === 'green' && newWritten.md_footnote === '1'
    && newWritten.md_darkprev === '0',
    JSON.stringify({ theme: newWritten.md_theme, canvas: newWritten.md_canvas,
      palette: newWritten.md_palette, foot: newWritten.md_footnote, dark: newWritten.md_darkprev }));
  check('C4. 新版写出排版参数 fs:16（保留 lh:2）',
    JSON.parse(newWritten.md_tweaks || '{}').fs === 16
    && JSON.parse(newWritten.md_tweaks || '{}').lh === 2,
    newWritten.md_tweaks);
  check('C5. 新版写出格式化选项 punct:false',
    JSON.parse(newWritten.md_fmt || '{}').punct === false
    && JSON.parse(newWritten.md_fmt || '{}').space === true,
    newWritten.md_fmt);
  const newHist = JSON.parse(newWritten.md_history_v2 || '[]');
  check('C6. 新版写出历史版本（新快照在首，旧 2 条保留）',
    newHist.length === 3 && newHist[0].content.includes(NEW_MARKER)
    && newHist.some((h) => h.content.includes('HIST-V1')),
    JSON.stringify(newHist.map((h) => (h.content || '').slice(0, 24))));

  // ---------- D. 基线版读取新版数据（回滚兼容） ----------
  const pageOld2 = await ctx.newPage();
  pageOld2.on('pageerror', (err) => pageErrors.push('old2: ' + String(err && err.message || err)));
  await pageOld2.goto(OLD_URL);
  await pageOld2.waitForSelector('#preview', { timeout: 15000 });
  await sleep(700);
  const rolled = await pageOld2.evaluate(() => ({
    editor: document.querySelector('#editor').value,
    themeSel: document.querySelector('#themeSel').value,
    canvasBtn: document.querySelector('#btnCanvas').textContent,
    fileName: document.querySelector('#fileName').textContent,
    history: window.getHistory(),
    themeStrong: window.getActiveTheme().strong,
    previewStyle: document.querySelector('#preview').getAttribute('style') || '',
    footBtn: document.querySelector('#btnFoot').textContent,
    darkClass: document.body.classList.contains('darkprev'),
  }));
  check('D1. 基线版读回新版草稿', rolled.editor.includes(NEW_MARKER));
  check('D2. 基线版读回主题 neon', rolled.themeSel === 'neon', rolled.themeSel);
  check('D3. 基线版读回画布开', rolled.canvasBtn.includes('背景:开'), rolled.canvasBtn);
  check('D4. 基线版读回文件名', rolled.fileName === '兼容测试.md', rolled.fileName);
  check('D5. 基线版读回历史版本（新快照在首，旧条目保留）',
    rolled.history.length === 3 && rolled.history[0].content.includes(NEW_MARKER)
    && rolled.history.some((h) => h.content.includes('HIST-V1')),
    '实际 ' + rolled.history.length + ' 条');
  check('D6. 基线版读回配色 green（neon strong 映射为 #15803d）',
    rolled.themeStrong.includes('#15803d'), rolled.themeStrong);
  check('D7. 基线版读回排版参数 fs:16',
    rolled.previewStyle.includes('font-size:16px'), rolled.previewStyle.slice(0, 160));
  check('D8. 基线版读回脚注开', rolled.footBtn.includes('脚注:开'), rolled.footBtn);
  check('D9. 基线版读回暗色关', rolled.darkClass === false);
  await pageOld2.click('#btnFmt');
  await sleep(300);
  const fmtOld = await pageOld2.evaluate(() => ['fmtSpace', 'fmtClean', 'fmtPunct', 'fmtQuote']
    .map((id) => document.querySelector('#' + id).checked));
  check('D10. 基线版格式化弹窗回显（勾/勾/不勾/勾）',
    fmtOld[0] === true && fmtOld[1] === true && fmtOld[2] === false && fmtOld[3] === true,
    JSON.stringify(fmtOld));
  await pageOld2.keyboard.press('Escape');

  check('全程无未捕获 JS 异常', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)));
} catch (err) {
  fail++;
  failures.push('storage-compat 流程异常：' + (err && err.message));
  console.log('FAIL storage-compat 流程异常：' + (err && err.message));
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('失败项：' + failures.join('；')); process.exit(1); }
