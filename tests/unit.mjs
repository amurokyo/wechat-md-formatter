// tests/unit.mjs — 离线单元测试（Node，无框架、无联网依赖）
//
// 运行方法（在仓库根目录）：
//   node tests/unit.mjs
//
// 实现方式：从 editor.src.html 提取目标纯函数的源码文本，在 node:vm 沙箱中执行，
// 以桩对象（localStorage / document / toast）提供其依赖的浏览器全局量。
// 不修改任何业务逻辑；被测函数以源码快照方式运行，源码变了测试会如实反映。
// 覆盖：safeBaseName、formatMarkdown（代码块/行内代码/链接保护）、esc、
//   store（localStorage 写入失败处理）、getHistory、snapshotCurrent（去重与 8 份上限）。
// DOM 相关的 normalizeForWechat 与外链脚注编号见 tests/smoke.mjs（在真实浏览器页内
// 通过 window 暴露的同名函数调用验证），因为它们需要真实 DOM。

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(path.join(REPO, 'editor.src.html'), 'utf-8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; failures.push(name); console.log('FAIL ' + name + (extra ? ' — ' + extra : '')); }
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// ---------- 源码提取：词法感知扫描（处理字符串、注释与正则字面量） ----------
// 被测函数源码里有含引号/反引号的正则（如 formatMarkdown 的 ` 与 fmtPlain 的 \"），
// 朴素的括号计数会被带偏；这里用小词法扫描器：字符串、模板字面量、注释、
// 正则字面量（按前一有效 token 判定 / 是正则开始还是除法）一律跳过，只数 { }。
function extractBalanced(src, openBraceIndex) {
  let depth = 0;
  let i = openBraceIndex;
  let prevSig = ''; // 上一个有效 token 的尾字符/关键字，用于判定正则
  const isRegexAllowed = () => {
    if (!prevSig) return true;
    if (/[({,=:\[!&|?;{}]/.test(prevSig)) return true;
    return /^(return|typeof|case|in|of|new|delete|void|instanceof|yield|await)$/.test(prevSig);
  };
  const readWord = (j) => {
    let k = j;
    while (k < src.length && /[A-Za-z0-9_$]/.test(src[k])) k++;
    return src.slice(j, k);
  };
  while (i < src.length) {
    const ch = src[i], nx = src[i + 1];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
    if (ch === '/' && nx === '/') { const e = src.indexOf('\n', i); i = e === -1 ? src.length : e; continue; }
    if (ch === '/' && nx === '*') { const e = src.indexOf('*/', i + 2); if (e === -1) throw new Error('注释未闭合'); i = e + 2; continue; }
    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch; i++;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) { i++; break; }
        i++;
      }
      prevSig = 'x'; continue;
    }
    if (ch === '/' && isRegexAllowed()) {
      i++; // 正则字面量：跳到未转义的 /（字符类内 / 不结束）
      let inClass = false;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) { i++; break; }
        else if (src[i] === '\n') throw new Error('正则字面量跨行');
        i++;
      }
      while (i < src.length && /[a-z]/i.test(src[i])) i++; // 标志 gimsuy
      prevSig = 'x'; continue;
    }
    if (/[A-Za-z0-9_$]/.test(ch)) { prevSig = readWord(i); i += prevSig.length; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i + 1; }
    prevSig = ch;
    i++;
  }
  throw new Error('花括号不平衡，提取失败');
}
function extractFunction(src, name) {
  const re = new RegExp('function\\s+' + name + '\\s*\\(');
  const m = re.exec(src);
  if (!m) throw new Error('在 editor.src.html 中找不到函数 ' + name);
  const brace = src.indexOf('{', m.index);
  const end = extractBalanced(src, brace);
  return src.slice(m.index, end);
}
function extractConst(src, name) {
  // 仅用于 PUNCT_MAP 这类无嵌套花括号的对象字面量常量
  const re = new RegExp('const\\s+' + name + '\\s*=\\s*\\{[^}]*\\};');
  const m = re.exec(src);
  if (!m) throw new Error('在 editor.src.html 中找不到常量 ' + name);
  return m[0];
}
function extractStore(src) {
  const start = src.indexOf('const store = {');
  if (start === -1) throw new Error('在 editor.src.html 中找不到 store');
  const brace = src.indexOf('{', start);
  const end = extractBalanced(src, brace);
  return src.slice(start, end) + ';';
}

// ---------- 沙箱桩 ----------
class FakeElement {
  constructor() {
    this.textContent = '';
    this.className = '';
    this.children = [];
    this.classList = { add() {}, remove() {}, toggle() {} };
    this.style = {};
  }
  appendChild(el) { this.children.push(el); return el; }
  append(...els) { this.children.push(...els); }
  addEventListener() {}
  setAttribute() {}
  getAttribute() { return null; }
}
function makeLocalStorage(throwOnSet = false) {
  const map = new Map();
  return {
    _map: map,
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { if (throwOnSet) throw new Error('QuotaExceededError'); map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
  };
}
function makeSandbox({ throwOnSet = false, fileName = '未命名.md' } = {}) {
  const fileNameEl = new FakeElement();
  fileNameEl.textContent = fileName;
  const historyEl = new FakeElement();
  const toasts = [];
  const sandbox = {
    console,
    localStorage: makeLocalStorage(throwOnSet),
    document: {
      querySelector(sel) {
        if (sel === '#fileName') return fileNameEl;
        if (sel === '#historyList') return historyEl;
        return new FakeElement();
      },
      createElement() { return new FakeElement(); },
    },
    toast(msg) { toasts.push(msg); },
    currentTheme: 'tech',
    currentPalette: 'default',
    canvasOn: true,
    KEY_HISTORY: 'md_history_v2',
    _fileNameEl: fileNameEl,
    _historyEl: historyEl,
    _toasts: toasts,
  };
  sandbox.$ = (s) => sandbox.document.querySelector(s);
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const sources = [
    extractConst(SRC, 'PUNCT_MAP'),
    extractFunction(SRC, 'fmtPlain'),
    extractFunction(SRC, 'formatMarkdown'),
    extractFunction(SRC, 'esc'),
    extractFunction(SRC, 'safeBaseName'),
    extractStore(SRC),
    extractFunction(SRC, 'getHistory'),
    extractFunction(SRC, 'snapshotCurrent'),
    extractFunction(SRC, 'renderHistory'),
  ].join('\n');
  vm.runInContext(sources, sandbox, { filename: 'editor-src-extracted.js' });
  // const 声明不挂到全局对象上，需显式取出才能从宿主侧调用
  sandbox.store = vm.runInContext('store', sandbox);
  return sandbox;
}
const OPT_ALL = { clean: true, space: true, punct: true, quote: true };

// ================= safeBaseName =================
{
  const sb = makeSandbox({ fileName: '测试：文章/2026.md' });
  check('safeBaseName：去扩展名并替换非法字符', sb.safeBaseName() === '测试：文章_2026', sb.safeBaseName());
  const sb2 = makeSandbox({ fileName: 'a<b>c|d?.MARKDOWN' });
  check('safeBaseName：<>|? 与大小写扩展名', sb2.safeBaseName() === 'a_b_c_d_', sb2.safeBaseName());
  const sb3 = makeSandbox({ fileName: '' });
  check('safeBaseName：空文件名回落 article', sb3.safeBaseName() === 'article', sb3.safeBaseName());
  const sb4 = makeSandbox({ fileName: 'report.txt' });
  check('safeBaseName：.txt 扩展名剥离', sb4.safeBaseName() === 'report', sb4.safeBaseName());
}

// ================= formatMarkdown =================
{
  const sb = makeSandbox();
  const fm = sb.formatMarkdown;
  // 代码块受保护：块内中文逗号与多余空格不被格式化。
  // 块外标点转换在阶段 2 已修复（见下方标点断言），这里只断言受保护段
  // 字节不变 + 块外段确实被改动。
  const md1 = '```\n你好,世界\n```\n你好,世界';
  const out1 = fm(md1, OPT_ALL);
  check('formatMarkdown：代码块内标点不受保护规则改动',
    out1.split('```')[1] === '\n你好,世界\n', JSON.stringify(out1));
  check('formatMarkdown：代码块外文本确实经过格式化处理',
    out1.split('```')[2] !== '\n你好,世界', JSON.stringify(out1));
  // 行内代码受保护
  const out2 = fm('`a,b` 你好,世界', OPT_ALL);
  check('formatMarkdown：行内代码受保护',
    out2.startsWith('`a,b` '), JSON.stringify(out2));
  // 链接受保护：URL 中的逗号保留
  const out3 = fm('[链接](https://example.com/a,b) 你好,世界', OPT_ALL);
  check('formatMarkdown：链接地址受保护',
    out3.includes('[链接](https://example.com/a,b)'), JSON.stringify(out3));
  // 标点转换（阶段 2 已修复 F-012：标点分支正则加第二个捕获组，回调
  // (m, c, p) 中的 p 即标点字符；修前 '你好,世界' → '你好1世界'）。
  check('formatMarkdown：块外中文逗号应转全角',
    fm('你好,世界', OPT_ALL) === '你好，世界',
    '实际=' + JSON.stringify(fm('你好,世界', OPT_ALL)));
  // 多标点混合：逗号/感叹号/问号/冒号一次转全角
  check('formatMarkdown：标点混合句一次转全角',
    fm('你好,世界!今天天气很好吗?请回答:好的。', OPT_ALL) === '你好，世界！今天天气很好吗？请回答：好的。',
    JSON.stringify(fm('你好,世界!今天天气很好吗?请回答:好的。', OPT_ALL)));
  // 句末标点
  check('formatMarkdown：句末感叹号/问号转全角',
    fm('今天天气很好!', OPT_ALL) === '今天天气很好！' && fm('你好吗?', OPT_ALL) === '你好吗？');
  // 右括号、分号、冒号、句号
  check('formatMarkdown：右括号/分号/冒号转全角',
    fm('你好)世界', OPT_ALL) === '你好）世界'
    && fm('你好;世界', OPT_ALL) === '你好；世界'
    && fm('你好:世界', OPT_ALL) === '你好：世界',
    JSON.stringify(fm('你好)世界', OPT_ALL)));
  check('formatMarkdown：中文后句号转全角（数字小数点除外）',
    fm('你好.世界', OPT_ALL) === '你好。世界' && fm('版本 1.5 发布', OPT_ALL) === '版本 1.5 发布');
  // 纯英文标点不受影响（标点前无中文）
  check('formatMarkdown：纯英文逗号不受影响',
    fm('Hello, world', OPT_ALL) === 'Hello, world');
  // 括号配对（阶段 4 已修遗留问题 3：括号配对分支移到标点转换之前，
  // 修前 '你好(世界)' → '你好(世界）' 半角左括号 + 全角右括号）。
  check('formatMarkdown：中文括号对转全角（遗留问题 3 已修）',
    fm('你好(世界)', OPT_ALL) === '你好（世界）'
    && fm('你好(世界)和(朋友)', OPT_ALL) === '你好（世界）和（朋友）',
    JSON.stringify(fm('你好(世界)', OPT_ALL)));
  check('formatMarkdown：括号对与标点混合一次转全角',
    fm('你好,世界(测试)', OPT_ALL) === '你好，世界（测试）',
    JSON.stringify(fm('你好,世界(测试)', OPT_ALL)));
  check('formatMarkdown：半角左括号+全角右括号混用仍成对',
    fm('你好（世界)测试', OPT_ALL) === '你好（世界）测试',
    JSON.stringify(fm('你好（世界)测试', OPT_ALL)));
  check('formatMarkdown：无中文括号对不受影响',
    fm('hello(world) test', OPT_ALL) === 'hello(world) test'
    && fm('测试(abc)你好', OPT_ALL) === '测试(abc)你好',
    JSON.stringify(fm('hello(world) test', OPT_ALL)));
  // 行内代码受保护（标点不转）
  check('formatMarkdown：行内代码内标点不受影响',
    fm('`你好,世界`', OPT_ALL) === '`你好,世界`');
  // 链接地址受保护、块外标点照常转换
  check('formatMarkdown：链接地址受保护、块外标点照常转换',
    fm('[链](https://example.com/a,b) 你好,世界', OPT_ALL) === '[链](https://example.com/a,b) 你好，世界');
  // 中英文之间加空格
  check('formatMarkdown：中英文之间加空格',
    fm('中文English混排123测试', OPT_ALL) === '中文 English 混排 123 测试',
    JSON.stringify(fm('中文English混排123测试', OPT_ALL)));
  // 引号转换
  check('formatMarkdown：中文引号转「」',
    fm('"你好世界" said', OPT_ALL) === '「你好世界」 said', JSON.stringify(fm('"你好世界" said', OPT_ALL)));
  // 清理：行尾空格与多余空行
  check('formatMarkdown：clean 清理行尾空格与多余空行',
    fm('第一行   \n\n\n\n第二行', OPT_ALL) === '第一行\n\n第二行',
    JSON.stringify(fm('第一行   \n\n\n\n第二行', OPT_ALL)));
  // 无选项时原文返回
  check('formatMarkdown：无选项时不改动',
    fm('你好,世界', {}) === '你好,世界');
}

// ================= esc =================
{
  const sb = makeSandbox();
  check('esc：转义 & < >', sb.esc('<a href="x">&') === '&lt;a href="x"&gt;&amp;', sb.esc('<a href="x">&'));
}

// ================= store / localStorage 失败处理 =================
{
  const sb = makeSandbox();
  check('store.set：成功返回 true 且可读回', sb.store.set('k', 'v') === true && sb.store.get('k') === 'v');
  check('store.get：缺失返回 fallback', sb.store.get('nope', 'fb') === 'fb');
  check('store.get：缺失无 fallback 返回 null', sb.store.get('nope') === null);
  const sbFail = makeSandbox({ throwOnSet: true });
  check('store.set：写入失败返回 false', sbFail.store.set('k', 'v') === false);
  check('store.set：写入失败提示用户导出备份',
    sbFail._toasts.length === 1 && sbFail._toasts[0].includes('导出 MD 备份'), JSON.stringify(sbFail._toasts));
  check('store.set：写入失败不抛异常', (() => { try { sbFail.store.set('k', 'v'); return true; } catch { return false; } })());
}

// ================= getHistory =================
{
  const sb = makeSandbox();
  check('getHistory：空时返回 []', eq(sb.getHistory(), []));
  sb.localStorage.setItem('md_history_v2', JSON.stringify([{ id: '1', content: 'a' }]));
  check('getHistory：合法 JSON 返回列表', sb.getHistory().length === 1 && sb.getHistory()[0].content === 'a');
  sb.localStorage.setItem('md_history_v2', 'not json{{{');
  check('getHistory：损坏 JSON 返回 []', eq(sb.getHistory(), []));
  sb.localStorage.setItem('md_history_v2', '"just a string"');
  check('getHistory：非数组 JSON 返回 []', eq(sb.getHistory(), []));
}

// ================= snapshotCurrent：去重与 8 份上限 =================
{
  const sb = makeSandbox({ fileName: '文稿.md' });
  sb._fileNameEl.textContent = '文稿.md';
  // 空文稿不保存：snapshotCurrent 读全局 editor.value；沙箱中补一个 editor 桩
  vm.runInContext('var editor = { value: "" };', sb);
  check('snapshotCurrent：空文稿不产生历史且返回 false',
    sb.snapshotCurrent() === false && eq(sb.getHistory(), []));
  vm.runInContext('editor.value = "第一版";', sb);
  check('snapshotCurrent：保存成功返回 true', sb.snapshotCurrent() === true);
  let list = sb.getHistory();
  check('snapshotCurrent：保存 1 份，带主题/配色/画布字段',
    list.length === 1 && list[0].content === '第一版' && list[0].theme === 'tech'
    && list[0].palette === 'default' && list[0].canvas === true && typeof list[0].savedAt === 'number',
    JSON.stringify(list[0]));
  // 去重：与最新一份内容相同不重复保存（返回 true，视为已保存）
  check('snapshotCurrent：与最新版相同内容去重且返回 true',
    sb.snapshotCurrent() === true && sb.getHistory().length === 1);
  // 8 份上限：先塞满 8 份不同内容，再存新版
  const seed = Array.from({ length: 8 }, (_, i) => ({
    id: 'seed' + i, name: 'v' + i, content: '旧版' + i, theme: 'tech', palette: 'default', canvas: true, savedAt: i,
  }));
  sb.localStorage.setItem('md_history_v2', JSON.stringify(seed));
  vm.runInContext('editor.value = "最新版";', sb);
  check('snapshotCurrent：保存成功返回 true（8 份上限）', sb.snapshotCurrent() === true);
  list = sb.getHistory();
  check('snapshotCurrent：8 份上限，新版在首、旧版末尾被淘汰',
    list.length === 8 && list[0].content === '最新版' && list[7].content === '旧版6'
    && !list.some((x) => x.content === '旧版7'), JSON.stringify(list.map((x) => x.content)));
  // 写入失败不抛异常、不显示“已保存”（snapshotCurrent 本身无成功 toast，只是不崩）
  const sbFail = makeSandbox({ throwOnSet: true });
  vm.runInContext('var editor = { value: "写不进" };', sbFail);
  check('snapshotCurrent：存储写满时返回 false', sbFail.snapshotCurrent() === false);
  check('snapshotCurrent：存储写满时不抛异常', (() => { try { sbFail.snapshotCurrent(); return true; } catch (e) { console.log(e); return false; } })());
  check('snapshotCurrent：存储写满时提示导出备份',
    sbFail._toasts.some((t) => t.includes('导出 MD 备份')), JSON.stringify(sbFail._toasts));
}

// ================= 汇总 =================
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('失败项：' + failures.join('；')); process.exit(1); }
