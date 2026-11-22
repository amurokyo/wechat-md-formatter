# -*- coding: utf-8 -*-
"""MD 排版台构建：editor.src.html + vendor/marked.min.js + vendor/purify.min.js -> index.html

构建保护（方案 §4.1）：
  1. 构建前检查源模板与两个 vendor 文件存在且非空；
  2. 每个占位符必须且只能出现一次；
  3. 生成后检查占位符全部清除；
  4. 校验 marked / DOMPurify 实际版本与预期版本一致；
  5. 输出文件计算 SHA-256，并记录构建信息（打印 + build-info.json）；
  6. HTML/JS 语法检查（html.parser 基本解析 + node --check 内联脚本，
     无 node 时退化为 Python 括号平衡 + 特征检查并注明）；
  7. 关键功能 smoke test（required / forbidden 特征清单）；
  8. 先写临时文件、全部检查通过后再原子替换 index.html，
     失败时不得覆盖旧 index.html；
  9. --check 校验模式：只校验不写文件，并核对现有 index.html
     与重新构建的产物字节一致，供 CI 使用。

用法：
  python3 build.py            构建并原子替换 index.html，写 build-info.json
  python3 build.py --check    只校验，不写任何文件

库文件保存的是 <script> 标签内的原始块内容（含首尾换行），构建时原样拼回，
保证字节级还原；相同输入得到相同 index.html（构建可重复）。
"""
import argparse
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / 'editor.src.html'
OUT = ROOT / 'index.html'
MARKED = ROOT / 'vendor' / 'marked.min.js'
PURIFY = ROOT / 'vendor' / 'purify.min.js'
BUILD_INFO = ROOT / 'build-info.json'

EXPECTED_MARKED_VERSION = '12.0.2'
EXPECTED_PURIFY_VERSION = '3.4.17'

# 占位符 -> 要内联的 vendor 文件
PLACEHOLDERS = {
    '<script src="vendor/marked.min.js"></script>': MARKED,
    '<script src="vendor/purify.min.js"></script>': PURIFY,
}

# v1.1.0 关键特征必须在场（原有清单全部保留，另扩充构建产物完整性特征）
REQUIRED = (
    # --- 原有清单 ---
    'bgcolor',
    'width:100%;max-width:100%;box-sizing:border-box;background-color:',
    'normalizeForWechat',
    'cleanHTML',
    'id="btnPalette"',
    'id="paletteGrid"',
    'ACCENT_MAPS',
    'data-h1-pill',
    # --- 扩充：核心入口与服务 ---
    'id="editor"',
    'id="preview"',
    'id="themeSel"',
    'id="btnCopy"',
    'id="btnMd"',
    'id="btnExport"',
    'id="btnExample"',
    'id="btnHistory"',
    'id="btnSnapshot"',
    'THEMES',
    'PALETTES',
    'getWechatHTML',
    'formatMarkdown',
    'safeBaseName',
    'snapshotCurrent',
    'md_draft',
    'md_history_v2',
    "connect-src 'none'",
    'marked v12.0.2',
    'DOMPurify 3.4.17',
)
# v1.1.0 已移除 AI/CloudBase 功能（原有清单全部保留）
FORBIDDEN = (
    'btnAI',
    'aiGenerate',
    'cloudbase.init',
    'KEY_AI_PROMPT',
)

# HTML 空元素（无闭合标签）与可省略闭合标签的元素：标签平衡检查时宽容处理
VOID_TAGS = {
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
    'meta', 'param', 'source', 'track', 'wbr',
}
OPTIONAL_CLOSE_TAGS = {
    'p', 'li', 'dt', 'dd', 'tr', 'td', 'th', 'thead', 'tbody', 'tfoot',
    'option', 'optgroup', 'head', 'body', 'html', 'caption', 'colgroup',
}


class BuildError(Exception):
    """构建检查失败：抛出即终止构建，且不覆盖旧 index.html。"""


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def check_inputs() -> dict:
    """(1) 构建前检查源模板与 vendor 文件存在且非空。返回 {name: 文本}。"""
    contents = {}
    for path in (SRC, MARKED, PURIFY):
        if not path.is_file():
            raise BuildError('缺少构建输入文件: %s' % path)
        if path.stat().st_size == 0:
            raise BuildError('构建输入文件为空: %s' % path)
        contents[path.name] = io.open(path, encoding='utf-8').read()
        if not contents[path.name].strip():
            raise BuildError('构建输入文件无有效内容: %s' % path)
    return contents


def check_vendor_versions(contents: dict) -> dict:
    """(4) 校验 marked / DOMPurify 实际版本与预期版本一致。"""
    marked_text = contents[MARKED.name]
    m = re.search(r'marked v(\d+\.\d+\.\d+)', marked_text)
    if not m:
        raise BuildError('无法从 vendor/marked.min.js 识别 marked 版本号')
    if m.group(1) != EXPECTED_MARKED_VERSION:
        raise BuildError('marked 版本不符：实际 %s，预期 %s'
                         % (m.group(1), EXPECTED_MARKED_VERSION))
    purify_text = contents[PURIFY.name]
    m = re.search(r'DOMPurify (\d+\.\d+\.\d+)', purify_text)
    if not m:
        raise BuildError('无法从 vendor/purify.min.js 识别 DOMPurify 版本号')
    if m.group(1) != EXPECTED_PURIFY_VERSION:
        raise BuildError('DOMPurify 版本不符：实际 %s，预期 %s'
                         % (m.group(1), EXPECTED_PURIFY_VERSION))
    return {'marked': EXPECTED_MARKED_VERSION,
            'dompurify': EXPECTED_PURIFY_VERSION}


def build_output(src_text: str, contents: dict) -> str:
    """(2) 每个占位符必须且只能出现一次；替换后返回产物文本。"""
    out = src_text
    for placeholder, vendor_path in PLACEHOLDERS.items():
        count = out.count(placeholder)
        if count != 1:
            raise BuildError('占位符出现 %d 次（要求恰好 1 次）: %s'
                             % (count, placeholder))
        out = out.replace(placeholder,
                          '<script>' + contents[vendor_path.name] + '</script>', 1)
    return out


class _TagBalanceParser(HTMLParser):
    """基本 HTML 解析检查：解析无异常 + 非空/非可选闭合标签大体平衡。"""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.saw = set()

    def handle_starttag(self, tag, attrs):
        self.saw.add(tag)
        if tag in VOID_TAGS:
            return
        if tag in ('p', 'li', 'tr', 'option', 'dt', 'dd') and self.stack and self.stack[-1] == tag:
            self.stack.pop()  # 同类标签隐式闭合前一个
        self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.saw.add(tag)

    def handle_endtag(self, tag):
        self.saw.add(tag)
        if tag in VOID_TAGS:
            return
        if tag in self.stack:
            while self.stack and self.stack[-1] != tag:
                popped = self.stack.pop()
                if popped not in OPTIONAL_CLOSE_TAGS:
                    raise BuildError('HTML 标签未正确闭合：<%s> 被 </%s> 越过'
                                     % (popped, tag))
            self.stack.pop()
        elif tag not in OPTIONAL_CLOSE_TAGS:
            raise BuildError('HTML 存在多余的闭合标签：</%s>' % tag)


def check_html(out: str) -> None:
    """(6a) HTML 基本解析检查。"""
    parser = _TagBalanceParser()
    try:
        parser.feed(out)
        parser.close()
    except BuildError:
        raise
    except Exception as exc:  # html.parser 抛出的解析异常
        raise BuildError('HTML 解析失败：%s' % exc)
    for tag in ('html', 'head', 'body'):
        if tag not in parser.saw:
            raise BuildError('HTML 缺少 <%s> 结构标签' % tag)
    unclosed = [t for t in parser.stack if t not in OPTIONAL_CLOSE_TAGS]
    if unclosed:
        raise BuildError('HTML 标签未闭合：%s' % ', '.join('<%s>' % t for t in unclosed))


def _python_js_fallback(script: str, label: str) -> None:
    """无 node 时的 JS 简易检查：括号/引号平衡 + 关键特征。"""
    pairs = {'(': ')', '[': ']', '{': '}'}
    stack = []
    in_str = None  # 当前字符串界定符 ' " `
    escaped = False
    i = 0
    while i < len(script):
        ch = script[i]
        if in_str:
            if escaped:
                escaped = False
            elif ch == '\\':
                escaped = True
            elif ch == in_str:
                in_str = None
        else:
            if ch in '\'"`':
                in_str = ch
            elif ch in pairs:
                stack.append(pairs[ch])
            elif ch in ')]}':
                if not stack or stack.pop() != ch:
                    raise BuildError('JS 括号不平衡（%s）：在 %r 处多余' % (label, ch))
        i += 1
    if in_str:
        raise BuildError('JS 字符串未闭合（%s）：%r' % (label, in_str))
    if stack:
        raise BuildError('JS 括号未闭合（%s）：缺 %s' % (label, ''.join(stack)))


def check_js(out: str) -> str:
    """(6b) JS 语法检查：node --check 提取的内联脚本；无 node 则用 Python 简易检查。

    返回实际使用的方法名，供 build-info.json 记录。
    """
    scripts = re.findall(r'<script>(.*?)</script>', out, re.DOTALL)
    if len(scripts) != 3:
        raise BuildError('内联 <script> 块应为 3 个（marked + DOMPurify + 业务脚本），实际 %d 个'
                         % len(scripts))
    labels = ('marked.min.js', 'purify.min.js', 'editor app script')
    node = shutil.which('node')
    if node:
        for script, label in zip(scripts, labels):
            with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False,
                                            encoding='utf-8') as tmp:
                tmp.write(script)
                tmp_path = tmp.name
            try:
                proc = subprocess.run([node, '--check', tmp_path],
                                      capture_output=True, text=True, timeout=120)
            finally:
                os.unlink(tmp_path)
            if proc.returncode != 0:
                raise BuildError('JS 语法检查失败（%s）：%s'
                                 % (label, (proc.stderr or proc.stdout).strip()[:500]))
        return 'node --check'
    for script, label in zip(scripts, labels):
        _python_js_fallback(script, label)
    return 'python-fallback (no node found)'


def check_placeholders_cleared(out: str) -> None:
    """(3) 生成后检查占位符全部清除。"""
    for placeholder in PLACEHOLDERS:
        if placeholder in out:
            raise BuildError('占位符未替换干净：%s' % placeholder)
        if 'src="vendor/' in out:
            raise BuildError('产物仍引用 vendor 外部脚本：src="vendor/..." 未清除')


def smoke_test(out: str) -> None:
    """(7) 关键功能 smoke test：required 必须在场，forbidden 必须缺席。"""
    for key in REQUIRED:
        if key not in out:
            raise BuildError('缺少关键特征: ' + key)
    for key in FORBIDDEN:
        if key in out:
            raise BuildError('发现应移除的 AI/CloudBase 特征: ' + key)


def run_build(check_only: bool) -> dict:
    """执行全部检查；非 --check 模式下原子写出 index.html 与 build-info.json。

    返回构建信息 dict。任何 BuildError 都会在写出前抛出，旧 index.html 不动。
    """
    contents = check_inputs()
    versions = check_vendor_versions(contents)
    out = build_output(contents[SRC.name], contents)
    check_placeholders_cleared(out)
    check_html(out)
    js_method = check_js(out)
    smoke_test(out)

    out_bytes = out.encode('utf-8')
    info = {
        'built_at_utc': datetime.now(timezone.utc).isoformat(),
        'builder': 'build.py (wechat-md-formatter 1.2.1)',
        'source': {
            'editor.src.html': sha256_file(SRC),
            'vendor/marked.min.js': sha256_file(MARKED),
            'vendor/purify.min.js': sha256_file(PURIFY),
        },
        'vendor_versions': versions,
        'output': {
            'file': 'index.html',
            'bytes': len(out_bytes),
            'sha256': sha256_bytes(out_bytes),
        },
        'checks': {
            'inputs_exist_nonempty': True,
            'placeholders_exactly_once': True,
            'placeholders_cleared': True,
            'vendor_versions': True,
            'html_parse': True,
            'js_check': js_method,
            'smoke_test': True,
        },
    }

    if check_only:
        # --check：只校验不写文件；并核对现有产物与重新构建的产物字节一致。
        if not OUT.is_file():
            raise BuildError('--check：index.html 不存在，请先运行 python3 build.py 生成')
        existing = OUT.read_bytes()
        if existing != out_bytes:
            raise BuildError(
                '--check：现有 index.html 与源模板/vendor 重新构建的产物不一致\n'
                '  现有：%d bytes sha256=%s\n  重建：%d bytes sha256=%s\n'
                '  请运行 python3 build.py 重新构建'
                % (len(existing), sha256_bytes(existing),
                   len(out_bytes), info['output']['sha256']))
        info['check'] = {'existing_output_matches_rebuild': True}
        return info

    # (8) 先写临时文件，全部检查通过后再原子替换，失败不覆盖旧 index.html。
    fd, tmp_path = tempfile.mkstemp(prefix='.index.html.', dir=str(ROOT))
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(out_bytes)
        # 保持与旧 index.html 一致的文件权限（mkstemp 默认 0600 会收紧权限）
        try:
            os.chmod(tmp_path, OUT.stat().st_mode & 0o777 if OUT.is_file() else 0o644)
        except OSError:
            pass
        os.replace(tmp_path, OUT)
    except BaseException:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
    io.open(BUILD_INFO, 'w', encoding='utf-8', newline='').write(
        json.dumps(info, ensure_ascii=False, indent=2) + '\n')
    return info


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description='构建 wechat-md-formatter 单文件 index.html（附构建保护检查）')
    parser.add_argument('--check', action='store_true',
                        help='只校验不写文件，并核对现有 index.html 与重建产物一致（供 CI 使用）')
    args = parser.parse_args(argv)
    try:
        info = run_build(check_only=args.check)
    except BuildError as exc:
        print('BUILD FAILED: %s' % exc, file=sys.stderr)
        return 1
    out = info['output']
    mode = 'check OK (no files written)' if args.check else 'built'
    print('%s %s: %d bytes sha256=%s'
          % (mode, out['file'], out['bytes'], out['sha256']))
    print('marked %s, DOMPurify %s, js_check=%s'
          % (info['vendor_versions']['marked'],
             info['vendor_versions']['dompurify'],
             info['checks']['js_check']))
    if not args.check:
        print('build info written to build-info.json')
    return 0


if __name__ == '__main__':
    sys.exit(main())
