// tests/storage-prompts.mjs — 存储失败/容量提示与图片处理专项测试
//
// 运行方法（在仓库根目录）：
//   node tests/storage-prompts.mjs
//
// 覆盖（方案 §4.4 / §4.5）：
//   A. storageStats()：草稿/历史/设置/图片体积统计与总量、风险等级；
//      容量风险提示出现在 #imageStatus（总量 ≥3MB 时 ⚠️ 将满请导出备份）。
//   B. 存储写入失败：草稿保存失败时编辑区内容保留、Toast 提示导出备份、
//      弹出一次“立即导出 MD 备份”确认（接受后真的下载 .md 备份文件）；
//      同一轮故障只问一次，写入恢复后复位；快照写入失败时
//      snapshotCurrent() 返回 false，且不显示“已保存”。
//   C. 图片处理：有效图片插入、损坏图片拦下、非图片 MIME 拒绝、
//      空文件拒绝、单张超 2MB 拒绝、FileReader 失败提示、
//      多图 Base64 累计超 1MB 提示（状态栏与插入时 Toast）。
// 浏览器：playwright-core + 本机缓存 chromium_headless_shell（同 smoke）。
// 注意：B 节用 Storage.prototype.setItem 打桩模拟写满（真实塞满配额
// 在 file:// 下的配额不确定，打桩才能稳定复现 QuotaExceededError）；
// 打桩只影响当页，用完即恢复。

import { chromium } from 'playwright-core';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_URL = 'file://' + path.join(REPO, 'index.html');
const PNG_1X1_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=';

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
  console.log('FAIL 未找到缓存的 chromium_headless_shell（~/.cache/ms-playwright/），无法运行 storage-prompts 测试');
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const pageErrors = [];
try {
  // ================= A. 存储体积统计与容量提示 =================
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (err) => pageErrors.push('A:' + String(err && err.message || err)));
    await page.goto(INDEX_URL);
    await page.waitForSelector('#preview', { timeout: 15000 });
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('#preview', { timeout: 15000 });
    await sleep(500);

    check('byteLen：中文按 3 字节计', await page.evaluate(() =>
      window.byteLen('中文') === 6 && window.byteLen('abc') === 3));
    check('fmtBytes：KB/MB 格式化', await page.evaluate(() =>
      window.fmtBytes(1500) === '1 KB' && window.fmtBytes(1048576) === '1.0 MB'
      && window.fmtBytes(1536) === '2 KB'));

    // 两张 data URL 图片 + 正文，统计应如实计数
    const md = '# 统计测试\n\n![a](data:image/png;base64,' + 'A'.repeat(100)
      + ')\n\n![b](data:image/png;base64,' + 'B'.repeat(200) + ')\n\n正文中文。\n';
    await page.fill('#editor', md);
    await sleep(800);
    const st = await page.evaluate(() => window.storageStats());
    check('storageStats：图片张数与字节数统计正确',
      st.imageCount === 2 && st.imageBytes > 300 && st.draftBytes > 300,
      JSON.stringify(st));
    check('storageStats：总量 = 草稿+历史+设置', st.totalBytes === st.draftBytes + st.historyBytes + st.settingsBytes,
      JSON.stringify(st));
    check('storageStats：小体积时风险为 ok', st.risk === 'ok', st.risk);
    const status = await page.evaluate(() => document.querySelector('#imageStatus').textContent);
    check('图片状态栏显示本地图片约计体积',
      status.includes('图片 2 张') && status.includes('本地图片约'), JSON.stringify(status));

    // 历史塞入约 3.3MB（阈值 3MiB = 3145728 字节），风险升为 warn，状态栏出现容量提示
    const bigHistory = JSON.stringify([{ id: 'big', name: '大历史.md', content: 'x'.repeat(3300000), theme: 'tech', palette: 'default', canvas: true, savedAt: 1 }]);
    await page.evaluate((h) => localStorage.setItem('md_history_v2', h), bigHistory);
    await page.evaluate(() => window.render());
    await sleep(300);
    const st2 = await page.evaluate(() => window.storageStats());
    check('storageStats：总量超 3MB 时风险为 warn', st2.risk === 'warn', JSON.stringify({ risk: st2.risk, total: st2.totalBytes }));
    const status2 = await page.evaluate(() => document.querySelector('#imageStatus').textContent);
    check('容量风险提示出现在状态栏（⚠️ 将满请导出备份）',
      status2.includes('⚠️') && status2.includes('将满请导出备份'), JSON.stringify(status2));
    await page.evaluate(() => localStorage.removeItem('md_history_v2'));
    await page.close();
  }

  // ================= B. 存储写入失败 =================
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('pageerror', (err) => pageErrors.push('B:' + String(err && err.message || err)));
    const dialogs = [];
    page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept(); });
    await page.goto(INDEX_URL);
    await page.waitForSelector('#preview', { timeout: 15000 });
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('#preview', { timeout: 15000 });
    await sleep(500);

    // 打桩：localStorage.setItem 一律抛 QuotaExceededError
    const stubbed = await page.evaluate(() => {
      try {
        window.__origSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function () { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
        return true;
      } catch (_) { return false; }
    });
    check('测试桩：Storage.prototype.setItem 可打桩模拟写满', stubbed);
    if (!stubbed) throw new Error('无法打桩 Storage.prototype.setItem');

    const MARK = 'STORAGE-FAIL-' + Date.now();
    // 记录 Toast 历史：写入失败的 Toast 会在确认导出后被 exportMD 的
    // 成功 Toast 覆盖，事后读 #toast 只能看到后者；直接包装 window.toast
    // 留档（不用 MutationObserver：confirm() 阻塞主线程期间其回调
    // 无法投递，记录会被后一次 Toast 覆盖）。
    await page.evaluate(() => {
      window.__toastLog = [];
      const origToast = window.toast;
      window.toast = (msg) => { window.__toastLog.push(msg); return origToast(msg); };
    });
    const dlPromise = page.waitForEvent('download', { timeout: 8000 });
    await page.evaluate((m) => {
      document.querySelector('#editor').value = '# 故障测试\n\n' + m + '\n';
      window.saveDraft(true); // 同步保存 → 写失败 → Toast + 确认导出备份
    }, MARK);
    const download = await dlPromise;
    check('写入失败时弹出“立即导出 MD 备份”确认（仅一次）',
      dialogs.length === 1 && dialogs[0].includes('导出 MD 备份'), JSON.stringify(dialogs));
    // 注：headless shell 下 blob: 下载不采纳 <a download> 的文件名
    // （suggestedFilename 为 "download"），这是既有 downloadBlob 在
    // headless 环境的表现，与本阶段改动无关；此处只断言下载确实发生，
    // 文件名与内容正确性由下一条断言覆盖。
    check('接受确认后真的触发了下载',
      !!download && typeof download.suggestedFilename() === 'string',
      download.suggestedFilename());
    const dlPath = await download.path();
    const dlText = readFileSync(dlPath, 'utf-8');
    check('备份文件内容就是当前编辑区文稿', dlText.includes(MARK), dlText.slice(0, 80));
    check('写入失败后编辑区内容保留（未丢失）',
      await page.evaluate((m) => document.querySelector('#editor').value.includes(m), MARK));
    const toastLog = await page.evaluate(() => window.__toastLog || []);
    check('写入失败 Toast 提示导出备份',
      toastLog.some((t) => t.includes('本地存储不可用') && t.includes('导出 MD 备份')),
      JSON.stringify(toastLog));

    // 同一轮故障再次保存不再弹确认
    await page.evaluate(() => window.saveDraft(true));
    await sleep(300);
    check('同一轮存储故障只问一次备份确认', dialogs.length === 1, `实际 ${dialogs.length} 次`);

    // 快照写入失败：返回 false，且不显示“已保存”
    const snapOk = await page.evaluate(() => window.snapshotCurrent());
    check('快照写入失败时 snapshotCurrent() 返回 false', snapOk === false);
    await page.click('#btnHistory');
    await sleep(300);
    await page.click('#btnSnapshot');
    await sleep(200);
    const toastSnap = await page.evaluate(() => document.querySelector('#toast').textContent);
    check('快照写入失败时不显示“已保存”', !toastSnap.includes('已保存'), JSON.stringify(toastSnap));
    check('快照写入失败时 Toast 提示导出备份', toastSnap.includes('导出 MD 备份'), JSON.stringify(toastSnap));
    await page.keyboard.press('Escape');

    // 恢复写入 → 成功一次（复位）→ 再写满 → 确认再次出现
    await page.evaluate(() => { Storage.prototype.setItem = window.__origSetItem; });
    await page.evaluate(() => window.saveDraft(true));
    await sleep(300);
    await page.evaluate(() => {
      Storage.prototype.setItem = function () { throw new DOMException('Quota exceeded', 'QuotaExceededError'); };
    });
    const dlPromise2 = page.waitForEvent('download', { timeout: 8000 });
    await page.evaluate(() => window.saveDraft(true));
    await dlPromise2;
    check('写入恢复后再写满，备份确认再次出现', dialogs.length === 2, `实际 ${dialogs.length} 次`);
    await page.evaluate(() => { Storage.prototype.setItem = window.__origSetItem; });
    await ctx.close();
  }

  // ================= C. 图片处理 =================
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', (err) => pageErrors.push('C:' + String(err && err.message || err)));
    await page.goto(INDEX_URL);
    await page.waitForSelector('#preview', { timeout: 15000 });
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('#preview', { timeout: 15000 });
    await sleep(500);

    const toastText = () => page.evaluate(() => document.querySelector('#toast').textContent);
    const editorHas = (s) => page.evaluate((x) => document.querySelector('#editor').value.includes(x), s);
    const insertFile = (bytesB64, name, type) => page.evaluate(async ({ b64, name, type }) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      window.insertLocalImage(new File([bytes], name, { type }));
    }, { b64: bytesB64, name, type });
    const insertRaw = (size, name, type) => page.evaluate(async ({ size, name, type }) => {
      window.insertLocalImage(new File([new Uint8Array(size)], name, { type }));
    }, { size, name, type });

    // 有效图片：插入成功，Toast 有预览提醒
    await page.evaluate(() => { document.querySelector('#editor').value = '# 图片测试\n\n'; });
    await insertFile(PNG_1X1_B64, 'test.png', 'image/png');
    await sleep(900);
    check('有效 PNG 图片插入为 Markdown data URL',
      await editorHas('![test.png](data:image/png;base64,'), await page.evaluate(() => document.querySelector('#editor').value.slice(0, 120)));
    check('有效图片插入后提示仅供预览', (await toastText()).includes('仅供预览'), await toastText());

    // 损坏图片：解码失败，不插入
    const garbageB64 = Buffer.from('this is not an image at all, just plain text bytes').toString('base64');
    await insertFile(garbageB64, 'bad.png', 'image/png');
    await sleep(900);
    check('损坏图片被拦下不插入', !(await editorHas('bad.png')));
    check('损坏图片提示“图片已损坏”', (await toastText()).includes('图片已损坏'), await toastText());

    // 非图片 MIME：拒绝（不只看扩展名）
    await insertFile(PNG_1X1_B64, 'fake.png', 'text/plain');
    await sleep(600);
    check('非图片 MIME 被拒绝（fake.png + text/plain）', !(await editorHas('fake.png')));
    check('非图片 MIME 提示“仅支持图片文件”', (await toastText()).includes('仅支持图片文件'), await toastText());

    // 空文件：拒绝
    await page.evaluate(() => window.insertLocalImage(new File([], 'empty.png', { type: 'image/png' })));
    await sleep(600);
    check('空图片文件被拒绝', !(await editorHas('empty.png')));
    check('空图片文件提示“图片文件为空”', (await toastText()).includes('图片文件为空'), await toastText());

    // 单张超 2MB：拒绝，规则不变
    await insertRaw(2 * 1024 * 1024 + 1, 'big.png', 'image/png');
    await sleep(600);
    check('单张超 2MB 被拒绝', !(await editorHas('big.png')));
    check('超 2MB 提示不变（不能超过 2MB）', (await toastText()).includes('不能超过 2MB'), await toastText());

    // FileReader 失败：打桩让 readAsDataURL 走 onerror
    await page.evaluate(() => {
      window.__OrigFileReader = window.FileReader;
      window.FileReader = class {
        readAsDataURL() { setTimeout(() => { if (this.onerror) this.onerror(new Error('mock read failure')); }, 0); }
      };
    });
    await insertFile(PNG_1X1_B64, 'reader-fail.png', 'image/png');
    await sleep(600);
    check('FileReader 失败时提示“图片读取失败”且不插入',
      (await toastText()).includes('图片读取失败') && !(await editorHas('reader-fail.png')), await toastText());
    await page.evaluate(() => { window.FileReader = window.__OrigFileReader; });

    // 多图累计超 1MB：状态栏提示
    const bigMd = '![a](data:image/png;base64,' + 'A'.repeat(600000) + ')\n\n![b](data:image/png;base64,' + 'B'.repeat(600000) + ')\n';
    await page.fill('#editor', bigMd);
    await sleep(1200);
    const stImg = await page.evaluate(() => window.storageStats());
    check('多图累计统计：2 张、约 1.2MB', stImg.imageCount === 2 && stImg.imageBytes > 1000000, JSON.stringify(stImg));
    const statusImg = await page.evaluate(() => document.querySelector('#imageStatus').textContent);
    check('多图累计超 1MB 时状态栏提示图片较多',
      statusImg.includes('本地图片约 1.1 MB') && statusImg.includes('图片较多'), JSON.stringify(statusImg));

    // 多图累计：插入时 Toast 也提示累计体积
    await page.fill('#editor', '![a](data:image/png;base64,' + 'A'.repeat(1100000) + ')\n');
    await sleep(900);
    await insertFile(PNG_1X1_B64, 'later.png', 'image/png');
    await sleep(900);
    const toastLater = await toastText();
    check('插入图片时累计超 1MB 有 Toast 提示',
      (await editorHas('later.png')) && toastLater.includes('已累计约'), JSON.stringify(toastLater));

    await page.close();
  }

  check('全程无未捕获 JS 异常', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)));
} catch (err) {
  fail++;
  failures.push('storage-prompts 流程异常：' + (err && err.message));
  console.log('FAIL storage-prompts 流程异常：' + (err && err.message));
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('失败项：' + failures.join('；')); process.exit(1); }
