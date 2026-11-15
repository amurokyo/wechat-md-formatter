// tests/smoke.mjs — 端到端 smoke 测试（真实 headless Chromium）
//
// 运行方法（在仓库根目录）：
//   node tests/smoke.mjs
// 或：
//   cd tests && npm test        （先跑 unit.mjs 再跑 smoke.mjs）
//
// 浏览器：playwright-core + 本机已缓存的 chromium_headless_shell
// （~/.cache/ms-playwright/，与 ~/workspace/rs-browser 同款写法）。
// 不要跑 `npx playwright install chromium`——本机代理下它会静默失败，
// 且测试不需要下载浏览器。可用环境变量 PLAYWRIGHT_CHROMIUM_EXE 覆盖
// 可执行文件路径。产品本身零联网依赖；playwright-core 只是测试工具。
//
// 覆盖：页面加载无控制台错误、示例文档渲染出预览 DOM、9 套主题可切换且
// 预览变化、复制/导出按钮存在、localStorage 草稿保存与刷新恢复、
// 危险 HTML 被消毒、回归样例渲染、normalizeForWechat 降级、
// 外链脚注编号与 mp.weixin.qq.com 排除。
// 每个断言独立计数并打印 PASS/FAIL；任一失败退出码为 1。
// 剪贴板实际写入：§11 回归用例在授予 clipboard-read/write 权限的
// 新 context 里实测（直通与兼容两路剪贴板内容逐字节比对）。

import { chromium } from 'playwright-core';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_URL = 'file://' + path.join(REPO, 'index.html');
const FIXTURE = path.join(REPO, 'tests', 'fixtures', 'regression.md');
const DANGEROUS = path.join(REPO, 'tests', 'fixtures', 'dangerous.md');

// --- 定位本机缓存的 headless shell（参考 ~/workspace/rs-browser/repro-draft.mjs） ---
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
  console.log('FAIL 未找到缓存的 chromium_headless_shell（~/.cache/ms-playwright/），无法运行 smoke 测试');
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const consoleErrors = [];
const pageErrors = [];
let page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
  await page.goto(INDEX_URL);
  await page.waitForSelector('#preview', { timeout: 15000 });
  await sleep(600); // 首屏渲染 + 防抖完成

  // --- 1. 示例文档渲染 ---
  const previewInfo = await page.evaluate(() => {
    const p = document.querySelector('#preview');
    return {
      htmlLen: p.innerHTML.length,
      h1: p.querySelectorAll('h1').length,
      h2: p.querySelectorAll('h2').length,
      table: p.querySelectorAll('table').length,
      pre: p.querySelectorAll('pre').length,
      text: p.innerText.slice(0, 60),
    };
  });
  console.log('preview:', JSON.stringify(previewInfo));
  check('示例文档渲染出预览 DOM（h1/h2/表格/代码块）',
    previewInfo.htmlLen > 500 && previewInfo.h1 >= 1 && previewInfo.h2 >= 1
    && previewInfo.table >= 1 && previewInfo.pre >= 1);

  // --- 2. 9 套主题可切换且预览变化 ---
  const THEMES = ['tech', 'minimal', 'classic', 'neon', 'brutal', 'serif', 'blueprint', 'warm', 'mag'];
  const signatures = {};
  for (const theme of THEMES) {
    await page.selectOption('#themeSel', theme);
    await sleep(400);
    signatures[theme] = await page.evaluate(() => {
      const p = document.querySelector('#preview');
      const h1 = p.querySelector('h1');
      const h2 = p.querySelector('h2');
      return (p.getAttribute('style') || '') + '||'
        + (h1 ? h1.getAttribute('style') || '' : '') + '||'
        + (h2 ? h2.getAttribute('style') || '' : '');
    });
    check(`主题可切换：${theme}`,
      (await page.evaluate(() => document.querySelector('#themeSel').value)) === theme
      && signatures[theme].length > 20);
  }
  const distinct = new Set(Object.values(signatures)).size;
  check('9 套主题预览样式互不相同', distinct === 9, `实际去重后 ${distinct} 种`);
  // 切回默认主题，避免后续测试受主题影响
  await page.selectOption('#themeSel', 'tech');
  await sleep(400);

  // --- 3. 复制/导出按钮存在（工具栏按钮可见；版本保存按钮在历史弹窗内，需先打开弹窗） ---
  for (const id of ['#btnCopy', '#btnMd', '#btnExport', '#btnExample', '#btnHistory']) {
    check(`按钮存在且可见：${id}`, await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return !!el && el.offsetParent !== null;
    }, id));
  }
  await page.click('#btnHistory');
  await sleep(400);
  check('按钮存在且可见：#btnSnapshot（历史弹窗内）', await page.evaluate(() => {
    const el = document.querySelector('#btnSnapshot');
    return !!el && el.offsetParent !== null;
  }));
  await page.keyboard.press('Escape');
  await sleep(200);

  // --- 4. formatMarkdown 代码块保护（浏览器页内 window 函数） ---
  const fm = await page.evaluate(() =>
    window.formatMarkdown('```\n你好,世界\n```\n你好,世界', { clean: true, space: true, punct: true, quote: true }));
  check('formatMarkdown（页内）：代码块内标点受保护',
    fm.split('```')[1] === '\n你好,世界\n', JSON.stringify(fm));

  // --- 5. normalizeForWechat 降级（任务列表 / details / 图片属性） ---
  const norm = await page.evaluate(() => {
    const div = document.createElement('div');
    div.innerHTML = '<ul><li><input type="checkbox" checked>已做</li>'
      + '<li><input type="checkbox">待做</li></ul>'
      + '<details style="color:red;"><summary>标题</summary><p>内容</p></details>'
      + '<img src="https://example.com/a.png" loading="lazy" decoding="async">'
      + '<a href="https://example.com" target="_blank" rel="noopener">外链</a>';
    document.body.appendChild(div);
    window.normalizeForWechat(div);
    const out = div.innerHTML;
    div.remove();
    return {
      out,
      noCheckbox: !div.querySelector('input[type="checkbox"]'),
      hasCheck: out.includes('✅') && out.includes('⬜'),
      noDetails: !div.querySelector('details'),
      hasSection: !!div.querySelector('section'),
      imgNoLoading: !div.querySelector('img').hasAttribute('loading')
        && !div.querySelector('img').hasAttribute('decoding'),
      aNoTarget: !div.querySelector('a').hasAttribute('target')
        && !div.querySelector('a').hasAttribute('rel'),
    };
  });
  check('normalizeForWechat：任务列表 checkbox 转 ✅/⬜', norm.noCheckbox && norm.hasCheck, norm.out.slice(0, 120));
  check('normalizeForWechat：details 降级为 section', norm.noDetails && norm.hasSection);
  check('normalizeForWechat：图片去 loading/decoding，链接去 target/rel',
    norm.imgNoLoading && norm.aNoTarget);

  // --- 6. 外链脚注编号与 mp.weixin.qq.com 排除（getWechatHTML） ---
  await page.fill('#editor', '[外链一](https://example.com/page1) 与 [公众号](https://mp.weixin.qq.com/s/abc) 与 [外链二](https://github.com/x) 混合。');
  await sleep(600);
  const wx = await page.evaluate(() => window.getWechatHTML());
  console.log('wechat html snippet:', wx.html.slice(0, 200));
  check('外链脚注：普通外链编号为 [1][2] 并列入文末附录',
    wx.html.includes('[1]') && wx.html.includes('[2]')
    && wx.html.includes('https://example.com/page1') && wx.html.includes('https://github.com/x'));
  check('外链脚注：mp.weixin.qq.com 链接保留为 <a> 不转脚注',
    /<a[^>]*href="https:\/\/mp\.weixin\.qq\.com\/s\/abc"/.test(wx.html));
  check('外链脚注：普通外链不再以 <a> 形式出现在正文',
    !/<a[^>]*href="https:\/\/example\.com\/page1"/.test(wx.html));
  check('外链脚注：输出不含 script/iframe/事件属性',
    !/<script/i.test(wx.html) && !/<iframe/i.test(wx.html) && !/ on\w+=/i.test(wx.html));

  // --- 7. 危险 HTML 被消毒 ---
  await page.fill('#editor', '<script>alert(1)</script>\n\n<img src="x" onerror="alert(2)">\n\n[点我](javascript:alert(3))\n\n<a href="https://example.com" onclick="alert(4)">外链</a>\n\n<iframe src="https://example.com"></iframe>');
  await sleep(600);
  const clean = await page.evaluate(() => {
    const p = document.querySelector('#preview');
    return {
      script: p.querySelectorAll('script').length,
      iframe: p.querySelectorAll('iframe').length,
      onerror: p.querySelectorAll('[onerror]').length,
      onclick: p.querySelectorAll('[onclick]').length,
      jsHref: Array.from(p.querySelectorAll('a')).filter((a) =>
        (a.getAttribute('href') || '').toLowerCase().startsWith('javascript:')).length,
      object: p.querySelectorAll('object,embed,form').length,
    };
  });
  console.log('sanitized:', JSON.stringify(clean));
  check('消毒：script/iframe/object/embed/form 全部清除',
    clean.script === 0 && clean.iframe === 0 && clean.object === 0);
  check('消毒：onerror/onclick 事件属性全部清除', clean.onerror === 0 && clean.onclick === 0);
  check('消毒：javascript: 链接全部清除', clean.jsHref === 0);

  // --- 7b. dangerous.md 全量消毒（stage0 危险样例并入；断言如实反映基线行为） ---
  const dangerous = readFileSync(DANGEROUS, 'utf-8');
  await page.fill('#editor', dangerous);
  await sleep(900);
  const dz = await page.evaluate(() => {
    const p = document.querySelector('#preview');
    const q = (s) => p.querySelectorAll(s).length;
    const onAttrs = Array.from(p.querySelectorAll('*')).flatMap((el) =>
      Array.from(el.attributes).map((a) => a.name).filter((n) => n.toLowerCase().startsWith('on')));
    const hrefs = Array.from(p.querySelectorAll('a[href]')).map((a) => a.getAttribute('href') || '');
    const styleAttrHits = Array.from(p.querySelectorAll('[style]'))
      .map((el) => el.getAttribute('style') || '')
      .filter((s) => /expression|javascript:/i.test(s));
    return {
      script: q('script'), iframe: q('iframe'), object: q('object'), embed: q('embed'),
      form: q('form'), link: q('link'), meta: q('meta'), base: q('base'),
      svg: q('svg'), math: q('math'), foreignObject: q('foreignObject'), animate: q('animate'),
      onAttrs: [...new Set(onAttrs)],
      badHref: hrefs.filter((h) => /^\s*(javascript|data:text\/html|vbscript):/i.test(h)),
      badSrc: Array.from(p.querySelectorAll('[src]'))
        .map((el) => el.getAttribute('src') || '').filter((s) => /javascript:/i.test(s)),
      styleTags: Array.from(p.querySelectorAll('style')).map((s) => s.textContent),
      styleAttrHits,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      hasMpLink: hrefs.includes('https://mp.weixin.qq.com/s/test'),
      hasExampleLink: hrefs.includes('https://example.com'),
      legalImg: q('img[src="https://picsum.photos/seed/safe/200/100"]'),
      legalDetails: q('details'), legalTable: q('table'), alignDiv: q('div[align="center"]'),
      templateText: p.innerText.includes('XSS-9a') && p.innerText.includes('XSS-9b'),
    };
  });
  console.log('dangerous preview:', JSON.stringify({
    script: dz.script, iframe: dz.iframe, object: dz.object, embed: dz.embed,
    form: dz.form, link: dz.link, meta: dz.meta, base: dz.base,
    svg: dz.svg, math: dz.math, onAttrs: dz.onAttrs, badHref: dz.badHref,
    styleTags: dz.styleTags, styleAttrHits: dz.styleAttrHits, bodyBg: dz.bodyBg,
  }));
  check('dangerous.md：script/iframe/object/embed/form/link/meta/base 全部清除',
    dz.script === 0 && dz.iframe === 0 && dz.object === 0 && dz.embed === 0
    && dz.form === 0 && dz.link === 0 && dz.meta === 0 && dz.base === 0);
  check('dangerous.md：SVG 攻击面（svg/math/foreignObject/animate）全部清除',
    dz.svg === 0 && dz.math === 0 && dz.foreignObject === 0 && dz.animate === 0);
  check('dangerous.md：全部 on* 事件属性清除', dz.onAttrs.length === 0, JSON.stringify(dz.onAttrs));
  check('dangerous.md：javascript:/data:/vbscript: 链接与 src 全部清除',
    dz.badHref.length === 0 && dz.badSrc.length === 0,
    JSON.stringify({ badHref: dz.badHref, badSrc: dz.badSrc }));
  check('dangerous.md：合法对照保留（公众号/外链/图片/details/表格/align/模板文本）',
    dz.hasMpLink && dz.hasExampleLink && dz.legalImg >= 1 && dz.legalDetails >= 1
    && dz.legalTable >= 1 && dz.alignDiv >= 1 && dz.templateText);
  // 阶段 4 已修：<style> 加入 FORBID_TAGS，标签连内容一并清除，不再穿透；
  // 内联 style 属性中的 expression()/url(javascript:) 声明被逐条清除，
  // 其余合法声明保留。页面背景全程不被染红。
  check('dangerous.md（阶段 4 已修）：<style> 标签连内容一并清除，不染红页面',
    dz.styleTags.length === 0 && dz.bodyBg !== 'rgb(255, 0, 0)',
    JSON.stringify({ styleTags: dz.styleTags, bodyBg: dz.bodyBg }));
  check('dangerous.md（阶段 4 已修）：内联 style 的 expression()/url(javascript:) 声明已清除',
    dz.styleAttrHits.length === 0, JSON.stringify(dz.styleAttrHits));
  // 导出链路：同一危险内容经 getWechatHTML 后无可执行向量
  // （阶段 4 已修：<style> 不再穿透到导出 HTML）。
  const wxDz = await page.evaluate(() => window.getWechatHTML().html);
  check('dangerous.md（导出）：无 script/iframe/事件属性/href="javascript:',
    !/<script/i.test(wxDz) && !/<iframe/i.test(wxDz) && !/ on\w+=/i.test(wxDz)
    && !/href\s*=\s*["']\s*javascript:/i.test(wxDz));
  check('dangerous.md（导出）（阶段 4 已修）：<style> 不再穿透到导出 HTML',
    !/<style/i.test(wxDz) && !/expression\s*\(/i.test(wxDz) && !/url\(\s*javascript:/i.test(wxDz));

  // --- 8. 回归样例渲染 ---
  const fixture = readFileSync(FIXTURE, 'utf-8');
  await page.fill('#editor', fixture);
  await sleep(800);
  const fx = await page.evaluate(() => {
    const p = document.querySelector('#preview');
    return {
      h1: p.querySelectorAll('h1').length,
      h2: p.querySelectorAll('h2').length,
      table: p.querySelectorAll('table').length,
      pre: p.querySelectorAll('pre').length,
      blockquote: p.querySelectorAll('blockquote').length,
      details: p.querySelectorAll('details').length,
      img: p.querySelectorAll('img').length,
      li: p.querySelectorAll('li').length,
      script: p.querySelectorAll('script').length,
      iframe: p.querySelectorAll('iframe').length,
    };
  });
  console.log('fixture preview:', JSON.stringify(fx));
  check('回归样例：标题/表格/代码/引用/details/图片均渲染',
    fx.h1 >= 1 && fx.h2 >= 1 && fx.table >= 2 && fx.pre >= 2
    && fx.blockquote >= 1 && fx.details >= 1 && fx.img >= 3 && fx.li >= 10);
  check('回归样例：危险 HTML 被消毒', fx.script === 0 && fx.iframe === 0);

  // --- 9. localStorage 草稿保存与刷新恢复 ---
  const MARKER = 'SMOKE-DRAFT-20261115-' + Date.now();
  await page.fill('#editor', '# 草稿恢复测试\n\n' + MARKER + '\n');
  await sleep(900); // saveDraft 防抖 400ms
  const stored = await page.evaluate(() => localStorage.getItem('md_draft'));
  check('草稿自动保存到 localStorage', stored !== null && stored.includes(MARKER));
  await page.reload();
  await page.waitForSelector('#preview', { timeout: 15000 });
  await sleep(600);
  const restored = await page.evaluate(() => ({
    editor: document.querySelector('#editor').value,
    preview: document.querySelector('#preview').innerText,
  }));
  check('刷新后草稿从 localStorage 恢复（编辑区 + 预览）',
    restored.editor.includes(MARKER) && restored.preview.includes(MARKER));

  // --- 10. 页面加载无控制台错误 ---
  // 资源加载失败（Failed to load resource）单独看：回归样例含外链图片
  // （https://example.com/cover.png）与相对路径图片（./images/cover.png），
  // 在离线沙箱里加载失败是环境使然，不是应用错误；favicon 在 file:// 下
  // 同样无文件可加载。CSP 强制日志同样排除：dangerous.md §6 含 <base> /
  // <meta refresh>，浏览器按 base-uri 'none' 拦截并记录该拦截——这是 CSP
  // 在起作用（动作已被阻止），不是应用错误；实测：单放 <base> 产生 1 条，
  // §6 整段产生 2 条，导出链路不新增。此处只断言 JS 层面的 console.error
  //（应用仅在渲染失败时调用 console.error），资源失败与 CSP 拦截只记录不判失败。
  const jsConsoleErrors = consoleErrors.filter((m) => !m.startsWith('Failed to load resource')
    && !m.includes('violates the following Content Security Policy directive'));
  const resourceErrors = consoleErrors.filter((m) => m.startsWith('Failed to load resource'));
  console.log('resource load errors (expected offline, ignored):', JSON.stringify(resourceErrors));
  check('页面无 JS 控制台错误（console.error）', jsConsoleErrors.length === 0, JSON.stringify(jsConsoleErrors.slice(0, 3)));
  check('页面加载无未捕获 JS 异常', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)));

  // --- 11. 回归：兼容复制路径不丢行间背景（1.2.0 反馈） ---
  // 旧的选区复制会让浏览器在序列化选区时剥掉外层 <section> 包裹，行间画布
  // 底色随之丢失（块上背景还在、块间缝隙变白）；修复后兼容路径改用 copy
  // 事件直写原始 HTML，剪贴板内容应与直通（ClipboardItem）路径逐字节一致。
  // 需授予剪贴板读写权限（headless file:// 下默认不可读写剪贴板）。
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page2 = await ctx2.newPage();
  page2.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
  page2.on('dialog', (d) => d.accept());
  await page2.goto(INDEX_URL);
  await page2.waitForSelector('#preview', { timeout: 15000 });
  await sleep(600);
  await page2.fill('#editor', '# 行间背景回归\n\n第一段正文。\n\n第二段正文。\n\n## 小标题\n\n- 列表一\n- 列表二\n');
  await sleep(700);
  const wxDirect = await page2.evaluate(() => window.getWechatHTML().html);
  await page2.evaluate(() => { window.ClipboardItem = undefined; });
  await page2.click('#btnCopy');
  await sleep(600);
  const clipHtml = await page2.evaluate(async () => {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      if (item.types.includes('text/html')) return await (await item.getType('text/html')).text();
    }
    return '';
  });
  check('回归（1.2.0）：兼容复制路径剪贴板 HTML 与直通一致（section 包裹与行间背景都在）',
    clipHtml === wxDirect && clipHtml.includes('<section')
    && (clipHtml.match(/background-color:/g) || []).length === (wxDirect.match(/background-color:/g) || []).length,
    `clipLen=${clipHtml.length} directLen=${wxDirect.length}`);
  await ctx2.close();
} catch (err) {
  fail++;
  failures.push('smoke 流程异常：' + (err && err.message));
  console.log('FAIL smoke 流程异常：' + (err && err.message));
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('失败项：' + failures.join('；')); process.exit(1); }
