// tests/perf.mjs — 性能基线测量（真实 headless Chromium，可重复）
//
// 运行方法（在仓库根目录）：
//   node tests/perf.mjs [--runs N] [--input-runs M]
//     [--baseline <index.html>] [--current <index.html>]
//     [--fixtures <dir>] [--out <result.json>]
//
// 默认：current = 仓库根目录 index.html；
//       baseline = ../../baseline/v1.1.0/index.html（升级工作区布局，
//       即 v1.1.0 基线产物；文件不存在时跳过基线列并注明，不报错）；
//       fixtures = tests/fixtures/perf-{5k,50k,200k,500k}.md。
//
// 测量方法（每档文稿 × 每个构建）：
//   A. 直接渲染：页内同步调用 render()，performance.now() 计时，
//      默认 5 次取中位数。测的是 marked 解析 + DOMPurify 消毒 +
//      主题内联 + 代码高亮 + H1 包装的全量渲染耗时（不含 180ms 防抖）。
//   B. 防抖输入：页内设 editor.value 并派发 input 事件，计时从派发
//      到 previewDirty 变 false 且预览含探针文本「性能测试章节」为止，
//      含 180ms 防抖等待；默认 3 次取中位数。测的是用户真实输入路径。
//   两条路径都在同一页面、同一视口（1280×800 桌面端）下测；每次测量
//   前清 localStorage 并重载页面，避免旧草稿干扰；每档文稿的字节数
//   与各次原始耗时一并输出（--out 写 JSON）。
//
// 阈值说明：本脚本只做记录，不做硬性失败——CI 机器波动大，耗时数字
// 只用于同机前后对照（基线 vs 当前产物在同一次运行内测得）。
// 仅当渲染超时（30s 未完成）或浏览器不可用时退出码为 1。
// 浏览器：playwright-core + 本机缓存的 chromium_headless_shell
// （~/.cache/ms-playwright/；不要跑 `npx playwright install chromium`）。

import { chromium } from 'playwright-core';
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(TESTS_DIR, '..');
const PROBE = '性能测试章节'; // 四档 fixture 均含有的标题文本，示例文档中没有
const FIXTURE_NAMES = ['perf-5k.md', 'perf-50k.md', 'perf-200k.md', 'perf-500k.md'];
const RENDER_TIMEOUT_MS = 30000;

function parseArgs(argv) {
  const o = {
    runs: 5, inputRuns: 3,
    baseline: path.resolve(REPO, '..', 'baseline', 'v1.1.0', 'index.html'),
    current: path.join(REPO, 'index.html'),
    fixtures: path.join(TESTS_DIR, 'fixtures'),
    out: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--runs') o.runs = Number(argv[++i]);
    else if (a === '--input-runs') o.inputRuns = Number(argv[++i]);
    else if (a === '--baseline') o.baseline = path.resolve(argv[++i]);
    else if (a === '--current') o.current = path.resolve(argv[++i]);
    else if (a === '--fixtures') o.fixtures = path.resolve(argv[++i]);
    else if (a === '--out') o.out = path.resolve(argv[++i]);
    else if (a === '--help') {
      console.log('用法：node tests/perf.mjs [--runs N] [--input-runs M] [--baseline <index.html>] [--current <index.html>] [--fixtures <dir>] [--out <result.json>]');
      process.exit(0);
    } else { console.error('未知参数：' + a); process.exit(2); }
  }
  return o;
}

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

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round1 = (x) => Math.round(x * 10) / 10;
const summarize = (xs) => ({
  runs: xs.map(round1), median: round1(median(xs)),
  min: round1(Math.min(...xs)), max: round1(Math.max(...xs)), mean: round1(mean(xs)),
});

const opts = parseArgs(process.argv.slice(2));
const exe = findChromiumExe();
if (!exe) {
  console.log('FAIL 未找到缓存的 chromium_headless_shell（~/.cache/ms-playwright/），无法运行 perf 测试');
  process.exit(1);
}

const builds = [];
if (existsSync(opts.current)) builds.push({ name: 'current', file: opts.current });
else { console.log('FAIL 当前产物不存在：' + opts.current); process.exit(1); }
if (existsSync(opts.baseline)) builds.push({ name: 'baseline-v1.1.0', file: opts.baseline });
else console.log('NOTE 基线产物不存在，跳过基线列：' + opts.baseline);

const fixtures = FIXTURE_NAMES.map((name) => {
  const file = path.join(opts.fixtures, name);
  if (!existsSync(file)) { console.log('FAIL 缺少 fixture：' + file); process.exit(1); }
  return { name, file, text: readFileSync(file, 'utf-8'), bytes: readFileSync(file).length };
});

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const result = {
  generatedAt: new Date().toISOString(),
  browser: exe,
  viewport: { width: 1280, height: 800 },
  directRuns: opts.runs, inputRuns: opts.inputRuns,
  probe: PROBE, note: '阈值只做记录，不做硬性失败；同一次运行内基线与当前产物对照才有意义。',
  results: [],
};
try {
  for (const fx of fixtures) {
    const row = { fixture: fx.name, bytes: fx.bytes, builds: {} };
    for (const build of builds) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const pageErrors = [];
      page.on('pageerror', (err) => pageErrors.push(String(err && err.message || err)));
      try {
        await page.goto('file://' + build.file);
        await page.waitForSelector('#preview', { timeout: 15000 });
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        await page.waitForSelector('#preview', { timeout: 15000 });
        // 等首屏渲染完成（示例文档），再开始测量
        await page.waitForFunction(() => !previewDirty, { timeout: 15000 }).catch(() => {});

        // B. 防抖输入路径：设值 + 派发 input，计时到预览稳定（含 180ms 防抖）
        // 轮询用 textContent 而不用 innerText：innerText 会强制整页布局，
        // 在大文稿上每次轮询都触发一次 layout，测量本身会拖慢渲染。
        // 先做一次不计时的预热输入，排除首轮 JIT/缓存冷启动的影响。
        const inputTimes = [];
        const measureInput = () => page.evaluate(async ({ text, probe, timeout }) => {
          const editor = document.querySelector('#editor');
          editor.value = text;
          const t0 = performance.now();
          editor.dispatchEvent(new Event('input', { bubbles: true }));
          const deadline = t0 + timeout;
          while (performance.now() < deadline) {
            if (!previewDirty && document.querySelector('#preview').textContent.includes(probe)) {
              return performance.now() - t0;
            }
            await new Promise((r) => setTimeout(r, 20));
          }
          throw new Error('渲染超时：' + timeout + 'ms 内预览未稳定');
        }, { text: fx.text, probe: PROBE, timeout: RENDER_TIMEOUT_MS });
        await measureInput(); // 预热，不计入
        for (let i = 0; i < opts.inputRuns; i++) inputTimes.push(await measureInput());

        // A. 直接渲染路径：同步 render() 计时（同一文稿重复渲染取中位数）；
        // 先预热一次，排除首轮冷启动。
        const directTimes = await page.evaluate((n) => {
          render(); // 预热，不计入
          const ts = [];
          for (let i = 0; i < n; i++) {
            const t0 = performance.now();
            render();
            ts.push(performance.now() - t0);
          }
          return ts;
        }, opts.runs);

        row.builds[build.name] = {
          direct: summarize(directTimes),
          input: summarize(inputTimes),
          pageErrors,
        };
        console.log(`${fx.name} [${build.name}] direct median=${row.builds[build.name].direct.median}ms `
          + `input median=${row.builds[build.name].input.median}ms`);
      } finally {
        await page.close();
      }
    }
    result.results.push(row);
  }
} finally {
  await browser.close();
}

// --- 打印对照表 ---
console.log('\n直接渲染 render() 耗时（ms，中位数，括号内为 min~max）：');
console.log('文稿      字节数   基线 v1.1.0        当前产物            变化');
for (const row of result.results) {
  const b = row.builds['baseline-v1.1.0'], c = row.builds.current;
  const bStr = b ? `${b.direct.median}（${b.direct.min}~${b.direct.max}）` : '—';
  const cStr = `${c.direct.median}（${c.direct.min}~${c.direct.max}）`;
  const delta = b ? `${(((c.direct.median - b.direct.median) / b.direct.median) * 100).toFixed(1)}%` : '—';
  console.log(`${row.fixture.padEnd(12)}${String(row.bytes).padEnd(9)}${bStr.padEnd(20)}${cStr.padEnd(20)}${delta}`);
}
console.log('\n防抖输入路径耗时（ms，中位数，含 180ms 防抖）：');
console.log('文稿      字节数   基线 v1.1.0        当前产物            变化');
for (const row of result.results) {
  const b = row.builds['baseline-v1.1.0'], c = row.builds.current;
  const bStr = b ? `${b.input.median}（${b.input.min}~${b.input.max}）` : '—';
  const cStr = `${c.input.median}（${c.input.min}~${c.input.max}）`;
  const delta = b ? `${(((c.input.median - b.input.median) / b.input.median) * 100).toFixed(1)}%` : '—';
  console.log(`${row.fixture.padEnd(12)}${String(row.bytes).padEnd(9)}${bStr.padEnd(20)}${cStr.padEnd(20)}${delta}`);
}
console.log('\nNOTE：阈值只做记录，不做硬性失败。');

if (opts.out) {
  writeFileSync(opts.out, JSON.stringify(result, null, 2) + '\n', 'utf-8');
  console.log('原始数据已写入：' + opts.out);
}
