# -*- coding: utf-8 -*-
"""MD 排版台构建：editor.src.html + vendor/marked.min.js + vendor/purify.min.js -> index.html
库文件保存的是 <script> 标签内的原始块内容（含首尾换行），构建时原样拼回，保证字节级还原。"""
import io
import sys
from pathlib import Path

SRC = 'editor.src.html'
OUT = 'index.html'
MARKED = Path('vendor') / 'marked.min.js'
PURIFY = Path('vendor') / 'purify.min.js'

src = io.open(SRC, encoding='utf-8').read()
marked = io.open(MARKED, encoding='utf-8').read()
purify = io.open(PURIFY, encoding='utf-8').read()

out = src.replace('<script src="vendor/marked.min.js"></script>', '<script>' + marked + '</script>', 1)
out = out.replace('<script src="vendor/purify.min.js"></script>', '<script>' + purify + '</script>', 1)

# 自检：占位符必须全部被替换
assert 'src="vendor/marked.min.js"' not in out and 'src="vendor/purify.min.js"' not in out, '占位符未替换干净'
# 自检：v1.1.0 关键特征必须在场
required = (
    'bgcolor',
    'width:100%;max-width:100%;box-sizing:border-box;background-color:',
    'normalizeForWechat',
    'cleanHTML',
    'id="btnPalette"',
    'id="paletteGrid"',
    'ACCENT_MAPS',
    'data-h1-pill',
)
for key in required:
    assert key in out, '缺少关键特征: ' + key
# 自检：v1.1.0 已移除 AI/CloudBase 功能
forbidden = ('btnAI', 'aiGenerate', 'cloudbase.init', 'KEY_AI_PROMPT')
for key in forbidden:
    assert key not in out, '发现应移除的 AI/CloudBase 特征: ' + key

io.open(OUT, 'w', encoding='utf-8', newline='').write(out)
print('built %s: %d bytes' % (OUT, len(out)))
