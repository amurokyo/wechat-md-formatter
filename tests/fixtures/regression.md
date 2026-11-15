# 回归样例 · 中文 English 123 混排测试

> 本文件是 wechat-md-formatter v1.2.0 升级的固定 Markdown 回归样例（阶段 0 建立，基线 v1.1.0）。
> 覆盖：中文/英文/数字混排、多级标题、行内样式、多行代码块与特殊字符、三类列表、表格对齐、引用与嵌套列表、
> 图片（相对路径 / data URL / 外链）、公众号域名链接与普通外链、details/summary、原始 HTML 与危险 HTML、长文段落。
> 注意：危险 HTML 样例预期被 DOMPurify 清除，渲染后不得执行；验证方法见 `stage0/FUNCTION_CHECKLIST.md`（F-038）。

## 中文 English 123 混排

这是一段中文、英文 English 与数字 123456 混排的正文，用于验证中英文混排渲染与一键格式化（F-012）。
The quick brown fox jumps over the lazy dog 1234567890，中文标点，。！？、引号"测试"与括号（test）混排。
版本号 v1.2.0 发布于 2026-11-15，售价 99.9 元，折扣 8.5 折，联系电话 13800000000，邮箱 test@example.com。

## 多级标题

### 三级标题 H3

#### 四级标题 H4

##### 五级标题 H5（基线映射为 H4 样式）

###### 六级标题 H6（基线映射为 H4 样式）

## 行内样式

这是 **加粗 Bold**、*斜体 Italic*、***粗斜体***、~~删除线~~ 与 `行内代码 inline code` 的组合。
行内代码含特殊字符：`a < b && c > d`、`x | y`、`foo("bar")`。
链接与强调混用：[**加粗链接**](https://example.com)、*[斜体链接](https://example.com)*。

## 多行代码块与特殊字符

```js
// 注释：中文注释 + special chars <>&"'`
const article = {
  title: "阅读原文测试",
  price: 99.9,
  tags: ["a&b", "x<y", "it's"],
  render: () => fullStyle()  // 全量样式，一个不少
};
if (a < b && c > d) { console.log(`模板 ${article.title}`); }
```

```python
def hello(name: str) -> str:
    # 特殊字符：<script> & "quotes" 'single'
    return f"你好，{name}！ 123"
print(hello("世界"))
```

```html
<div class="test" data-x="1 & 2">A < B && C > D</div>
```

```text
纯文本块：| 管道符 | *星号* `反引号` #井号
第二行：反斜杠 \ 与美元 $100、百分号 50%、波浪 ~~~
```

## 有序 / 无序 / 任务列表

- 无序列表项一 Apple 苹果
- 无序列表项二 Banana 香蕉
  - 嵌套无序第二层
    - 嵌套无序第三层
  - 嵌套回到第二层
- 无序列表项三

1. 有序列表第一项 2026 年
2. 有序列表第二项
   1. 嵌套有序 2.1
   2. 嵌套有序 2.2
3. 有序列表第三项

- [x] 已完成任务：写完回归样例
- [ ] 待办任务：跑通基线截图
- [ ] 待办任务：验证微信复制
- [x] 已完成任务：确认主题列表

## 表格及左右居中对齐

| 功能 | 说明 | 状态 | 价格 |
| --- | --- | --- | --- |
| 一键复制 | 富文本剪贴板 | ✅ 已支持 | 免费 |
| 本地文件 | 手机/电脑通用 | ✅ 已支持 | 免费 |
| 主题切换 | 9 套主题 | ✅ 已支持 | 免费 |

| 左对齐 | 居中对齐 | 右对齐 | 默认对齐 |
| :--- | :---: | ---: | --- |
| 左边文字 left | 居中 center | 右边 12345 | 默认 default |
| 短 | 中等长度文本 | 999.99 | 混合 Mixed 123 |

## 引用块和嵌套列表

> 引用块：本工具会把主题样式内联到正文，并在复制前清理危险 HTML；复杂标签仍建议在公众号后台复核。
>
> > 嵌套引用：第二层引用内容，English nested quote 123。
>
> 引用内列表：
> - 引用中的无序项一
> - 引用中的无序项二
>   1. 引用中嵌套有序
>   2. 引用中嵌套有序二

## 图片

相对路径图片（预期 404 / 破图，验证相对路径原样保留）：

![相对路径图片](./images/cover.png)

data URL 图片（1×1 红色像素 PNG base64，预期正常显示，计为本地图片；注：SVG data URL 不宜作回归样例——
marked 会把其中 `xmlns='http://…'` 的单引号与 `://` 误解析为自动链接，导致图片语法失效，2026-11-15 实测确认）：

![data URL 图片](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==)

外链图片（需联网加载；离线时破图不影响回归判定，只验证 src 原样保留）：

![外链图片](https://picsum.photos/seed/wechat-regression/640/360)

带标题的图片：

![外链图片带标题](https://picsum.photos/seed/wechat-title/640/240 "示例标题")

## 链接

公众号域名链接（复制时保留、不转脚注）：[微信公众号文章](https://mp.weixin.qq.com/s/abc123XYZ)。

普通外链（复制时默认转文末脚注）：[MD 排版台 GitHub](https://github.com/amurokyo/wechat-md-formatter)、[示例站点](https://example.com)、[中文路径](https://example.com/中文路径?a=1&b=2)。

自动链接：https://example.com/auto-link 与邮箱 test@example.com。

## details / summary

<details>
<summary>点击展开：折叠块标题</summary>

折叠块内的正文内容，**加粗**与 `行内代码` 应正常渲染。

- 折叠块内的列表项一
- 折叠块内的列表项二

</details>

<details>
<summary>第二个折叠块</summary>

第二块内容：复制到公众号时应自动展开为普通段落（F-009）。

</details>

## 原始 HTML（合法部分，预期保留）

<div align="center">居中 div（align 属性经 DOMPurify ADD_ATTR 保留）</div>

<p>行内 <b>粗体 HTML</b> 与 <i>斜体 HTML</i>、<u>下划线</u>、<mark>高亮 mark</mark>、<kbd>Ctrl</kbd>+<kbd>C</kbd>。</p>

<details open><summary>已展开的 details</summary>内容</details>

<table><tr><th>原生 HTML 表格</th></tr><tr><td>单元格</td></tr></table>

## 危险 HTML（预期全部被 DOMPurify 清除，不得执行）

<script>alert("XSS-script")</script>

<img src="x" onerror="alert('XSS-onerror')">

<a href="javascript:alert('XSS-js')">javascript: 链接</a>

<a href="JaVaScRiPt:alert(1)">大小写混淆 javascript: 链接</a>

<svg onload="alert('XSS-svg')"><circle r="10"/></svg>

<iframe src="https://example.com"></iframe>

<div onclick="alert('XSS-click')">带 onclick 的 div</div>

<form action="https://example.com"><input type="text" value="表单"></form>

<object data="https://example.com/x.swf"></object>

<embed src="https://example.com/x.swf">

<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">data:text/html 链接</a>

<img src="x" onerror="alert(1)" onmouseover="alert(2)">

`style` 标签样例（`body{background:red}`）已从回归样例中移除，仅保留在 dangerous.md 中

> 说明（2026-11-15 实测）：基线 DOMPurify 配置的 FORBID_TAGS 不含 `style`，`<style>body{background:red}</style>` 会原样进入预览 DOM
> 并真实生效（body 背景变为 rgb(255,0,0)，编辑器 chrome 被染红），因此不得出现在截图用回归文档中；该样例仅保留在
> `dangerous.md` §7 供阶段 4 安全加固验证。同理 `<style><img …></style>` 嵌套样例也一并移出。

<link rel="stylesheet" href="https://example.com/evil.css">

<meta http-equiv="refresh" content="0;url=https://example.com">

<math><mi//xlink:href="data:x,<script>alert(4)</script>">

---

## 长文段落

第一段长文。公众号排版是一项细致的工作，好的排版应当让读者在第一眼就感受到内容的质感，而不是被杂乱的格式分散注意力。Markdown 作为一种轻量级标记语言，让作者可以专注于内容本身，而把样式交给工具去处理。本工具的目标就是在保持 Markdown 简洁的同时，输出符合微信公众号规范的富文本，让每一次复制粘贴都稳定可靠。无论是技术文章、产品介绍还是生活随笔，都应当在手机上呈现出舒适的阅读体验：合适的字号、恰当的行高、清晰的层级、克制的色彩，这些细节共同决定了读者是否愿意读完一篇文章。

第二段长文。The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump! Bright vixens jump; dozy fowl quack. Jack amazed a few girls by dropping the antique onyx vase. The five boxing wizards jump quickly. Sympathizing would fix Quaker objectives. A wizard's job is to vex chumps quickly in fog. Watching "Jeopardy!", Alex Trebek's fun TV quiz game. Two driven jocks help fax my big quiz. The jay, pig, fox, zebra and my wolves quack! Blowzy red vixens fight for a quick jump. Lazy movers quit hard-packing of the jugs. 1234567890 abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ.

第三段长文。主题与配色是排版的灵魂：科技青的冷峻、极简黑白的克制、公众号绿的亲切、霓虹渐变的张扬、硬朗粗野的力量、书卷宋体的温润、蓝图工程的精确、暖纸的柔和、杂志的优雅，九套主题各自对应不同的内容气质。配色叠加则让同一主题可以演绎出更多可能：洋红的热烈、紫棠的神秘、杏黄的温暖、葱绿的生机、石榴红的醒目、煤黑的沉稳、绀青的古雅、玄色的深邃。在复制到公众号之前，作者应当逐一检查标题、引用、列表、表格、代码块与图片，确认每一处样式都与预期一致，因为微信后台不会给第二次机会去修正已经推送的内容。

第四段长文。性能同样重要：当文档达到 5KB、50KB、200KB 甚至 500KB 时，全量解析与 DOM 遍历的成本会显著上升。输入防抖 180 毫秒、保存防抖 400 毫秒是当前基线的折中方案；移动端编辑态下延迟渲染是为了避免输入卡顿。未来的优化必须在不改变渲染结果的前提下进行，任何增量渲染方案都要与全量渲染做 DOM 等价比较。存储方面，Base64 图片会显著放大正文体积，历史版本保存完整文稿，八个版本与当前草稿共同占用浏览器配额，超限时必须明确提示而不是静默失败。

第五段长文。安全是底线：DOMPurify 负责清除危险标签与事件属性，内容安全策略禁止一切对外连接，图片来源限定为本地 data、blob 与 http、https。正文仅存于本机浏览器，不上传、不遥测、不联网。这些承诺不是口号，而是写进代码的约束：CSP 的 connect-src 是 none，源码中不存在 fetch、XMLHttpRequest、navigator.sendBeacon。升级改造可以在内部重构模块、优化性能、加固安全，但绝不能以任何理由放宽这些边界，也不能为了精简代码而删除任何已有功能。

*—— 回归样例结束 · 由 MD 排版台生成 · 样式全内联 ——*
