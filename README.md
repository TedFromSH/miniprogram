# 每日照片漫画小程序

这是一个微信小程序 MVP：用户先上传一批照片形成素材池，系统每天随机抽取一张照片生成今日漫画内容，并在小程序内提供阅读和历史回顾体验。

## 当前 MVP 链路

1. 在小程序「照片池」上传多张图片。
2. 图片保存到微信云存储，照片记录写入 `photos` 集合。
3. 首页点击「生成今日漫画」调用 `dailyComic` 云函数。
4. 云函数随机选择一张 `unused` 照片，生成占位漫画脚本并写入 `comics` 集合。
5. 照片状态从 `unused` 变为 `used`。
6. 小程序进入漫画详情页阅读内容。

## 页面

- `pages/index/index`：MVP 首页，展示照片池统计、今日漫画和生成入口。
- `pages/photoPool/photoPool`：照片池，支持批量上传和删除未使用照片。
- `pages/history/history`：漫画历史列表。
- `pages/comicDetail/comicDetail`：漫画详情阅读页。

## 云函数

- `cloudfunctions/dailyComic`：每日漫画生成函数。

支持的调用方式：

- `{ action: "init" }`：初始化 `photos` 和 `comics` 集合。
- `{ action: "generate" }`：为当前用户生成今日漫画。
- 定时触发：默认配置为每天 8:00 触发，扫描有未使用照片的用户并生成内容。

当前云函数使用 `mock-v1` 占位生成器，后续真实 AI 接口应替换 `cloudfunctions/dailyComic/index.js` 中的 `buildMockComicContent` 流程。

## 开发者工具操作

1. 用微信开发者工具打开本项目目录。
2. 确认云开发环境 ID 已在 `miniprogram/app.js` 中配置。
3. 右键 `cloudfunctions/dailyComic`，选择上传并部署云函数。
4. 运行小程序，进入首页或照片池，云函数会尝试初始化数据库集合。
5. 上传照片后，在首页点击「生成今日漫画」验证完整链路。

## Git

`project.private.config.json` 是微信开发者工具本机配置，已被 `.gitignore` 忽略，不进入仓库。
