---
version: alpha
name: xobi Mono Violet
description: A minimal, playful image-translation workspace for frequent personal use.
colors:
  primary: "#F7F7F8"
  primary-hover: "#FFFFFF"
  accent-contrast: "#000000"
  violet: "#A985FF"
  violet-hover: "#C2AAFF"
  violet-soft: "#2F2547"
  surface: "#000000"
  surface-raised: "#151517"
  on-surface: "#FFFFFF"
  muted: "#C8C8CE"
  border: "#1C1C20"
  warning: "#E9AD4B"
  error: "#FF716D"
typography:
  display:
    fontFamily: Inter
    fontSize: 64px
    fontWeight: 600
    lineHeight: 1.04
    letterSpacing: -0.04em
  body:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: 0.08em
rounded:
  control: 12px
  surface: 24px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  page: 64px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.accent-contrast}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    height: 48px
    padding: 16px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.accent-contrast}"
  canvas:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
  floating-control:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.full}"
    size: 44px
  body-copy:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    typography: "{typography.body}"
  divider:
    backgroundColor: "{colors.border}"
    height: 1px
  ratio-selection:
    backgroundColor: "{colors.violet-soft}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.control}"
  selection-indicator:
    backgroundColor: "{colors.violet}"
    rounded: "{rounded.full}"
    size: 4px
  selection-indicator-hover:
    backgroundColor: "{colors.violet-hover}"
    rounded: "{rounded.full}"
    size: 4px
  warning-chip:
    backgroundColor: "{colors.warning}"
    textColor: "{colors.accent-contrast}"
    rounded: "{rounded.full}"
  error-chip:
    backgroundColor: "{colors.error}"
    textColor: "{colors.accent-contrast}"
    rounded: "{rounded.full}"
---

## Overview

xobi 是个人高频使用的图片翻译工作台。视觉概念是安静的数字灯箱：内容轻、画面有呼吸感，交互反馈鲜明，但不呈现公共 SaaS、数据后台或组件展厅的感觉。

首页只承担导入图片、导入文件夹以及全局的历史与主题入口。上传后才进入完整工作台。

## Colors

纯黑构成最底层画布，黑白功能层负责主要信息、主按钮、进度与成功；薰衣草紫是独立点缀层，只表示比例、选中、键盘焦点和少量装饰。琥珀色只用于需要留意的状态。整体取黑、白、紫的俏皮暗黑气质，不使用绿色。浅色主题保持同样的语义映射，以近黑承担主要动作，以深紫承担点缀。

大面积区域依靠黑白明度和透明度区分，不靠粗边框。`--xobi-accent` 属于黑白功能层；`--xobi-violet`、`--xobi-violet-hover`、`--xobi-violet-soft` 属于紫色点缀层。紫色不得铺满按钮、进度、成功状态或大面积表面，底层始终保持 `#000000`。

## Typography

标题使用偏轻的字重、紧凑字距和短句换行，形成编辑性而非宣传页式的大喊。正文保持自然行距。标签可使用较宽字距，但字号不得小于可读范围。

中英文必须使用完整 UTF-8 文本，禁止用乱码、拼音或占位符代替。

## Layout

首页不使用营销文案。图片与文件夹两个入口放在可用视口的真实中心，其余空间保持安静。整页接受拖放，但不画上传卡片、比例框、轨道或装饰矩阵。禁止巨型居中卡片、卡片套卡片和虚线投放框。

工作台使用 32px 中性灰细网格，网格必须可见但不能抢过图片；最底层仍是纯黑，不用紫色给整张画布染色。图片墙尽量吃满宽度，图片保持完整比例。左侧控制面板从左边缘悬停覆盖出现，不挤压画布。底部多选工具条按内容宽度水平居中。窄屏时控制面板改为底部弹层，布局保持单列与清晰的主次动作。

## Elevation & Depth

深度主要来自透明叠层、局部模糊和低对比阴影。首页拖入文件时才出现全页状态层。浮层和模态框才使用更明确的阴影。

指针光场只跟随光标缓慢移动，不追踪触屏手势。进度和状态动画不得高频闪烁。

## Shapes

主要按钮使用胶囊形。图片自身可以保留克制的小圆角，但工作台条目不再额外包一层卡片。状态用小圆点、文字和细分隔线表达。

不得通过堆叠圆角矩形制造设计感；一个区域只保留一个主要轮廓。

## Components

首页主按钮是唯一明确的实心动作，文件夹导入是文字式次级动作。主按钮使用黑白功能层，不用紫色整块填充。整页拖入时使用一次性的简洁状态反馈，不设置第二个重复上传入口。

历史入口使用“回转轨迹 + 图片轮廓”的自定义 SVG，位于主题切换左侧。悬停时只允许图标内部小幅回转，按钮本体不位移；有历史记录时显示静态薰衣草紫点。

输出比例选择器必须保留可视化矩形。切换比例时矩形连续改变宽高，并播放一次短扫光；选中项只做一次轻微弹性反馈，不持续闪烁。

所有可点击目标至少为 44px，具有键盘焦点样式。主要弹层使用 xobi 自定义交互，不使用浏览器原生 alert 或 confirm。

## Do's and Don'ts

Do：让图片、文字和动作拥有充足但有方向的留白；悬停只改变颜色、描边、透明度或图标内部状态，卡片和按钮本体不得上浮或放大；尊重 prefers-reduced-motion；让拖拽、悬停和键盘操作都能理解当前状态。语言选择使用 xobi 自定义 listbox，不调用系统原生下拉菜单。桌面大图预览限制在中等窗口内并始终 contain，小屏才接近全屏。

Don't：使用绿色、把紫色铺满主按钮/进度/成功状态/大面积背景、巨型矩形上传框、无意义统计卡片、持续闪烁、裁切关键图片内容，或让暂停后的继续重新提交成功任务。
