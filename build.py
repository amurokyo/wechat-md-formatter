# -*- coding: utf-8 -*-
"""MD 排版台构建：editor.src.html + marked.min.js + purify.min.js -> index.html
库文件保存的是 <script> 标签内的原始块内容（含首尾换行），构建时原样拼回，保证字节级还原。"""
import io, sys

SRC = 'editor.src.html'
OUT = 'index.html'

src = io.open(SRC, encoding='utf-8').read()
marked = io.open('marked.min.js', encoding='utf-8').read()
purify = io.open('purify.min.js', encoding='utf-8').read()

out = src.replace('<script src="marked.min.js"></script>', '<script>' + marked + '</script>', 1)
out = out.replace('<script src="purify.min.js"></script>', '<script>' + purify + '</script>', 1)

# 自检：占位符必须全部被替换
assert 'src="marked.min.js"' not in out and 'src="purify.min.js"' not in out, '占位符未替换干净'
# 自检：关键微信兼容特征必须在场
for key in ('bgcolor', 'width:100%;max-width:100%;box-sizing:border-box;background-color:', 'normalizeForWechat', 'cleanHTML'):
    assert key in out, '缺少关键特征: ' + key

io.open(OUT, 'w', encoding='utf-8', newline='').write(out)
print('built %s: %d bytes' % (OUT, len(out)))
