# 生活瞬间小程序

这是一个微信小程序：用户上传照片形成照片池，系统从照片池中随机抽取照片生成漫画故事，并在小程序内提供阅读、历史回顾和家庭空间共享能力。

## 当前功能

1. 在小程序「照片池」上传多张图片。
2. 图片保存到微信云存储，照片记录写入 `photos` 集合。
3. 首页点击「随机生成漫画」调用 `dailyComic` 云函数。
4. 云函数随机选择一张 `unused` 照片，调用 AI 生成漫画图和分镜脚本，并写入 `comics` 集合。
5. 照片状态从 `unused` 变为 `used`。
6. 小程序进入漫画详情页阅读内容。
7. 用户可以创建家庭空间，并在个人空间/家庭空间之间切换。不同空间的照片池、统计和漫画历史相互隔离。

## 页面

- `pages/index/index`：首页，展示当前空间、照片池统计、随机生成入口、今日漫画故事或历史漫画故事。
- `pages/familySpace/familySpace`：家庭空间页，支持创建家庭空间，并在个人空间/家庭空间之间切换。
- `pages/photoPool/photoPool`：照片池，支持批量上传和删除未使用照片。
- `pages/history/history`：漫画历史列表。
- `pages/comicDetail/comicDetail`：漫画详情阅读页。

## 云函数

- `cloudfunctions/dailyComic`：照片漫画生成和数据空间管理函数。

支持的主要调用方式：

- `{ action: "init" }`：初始化集合。
- `{ action: "dashboard" }`：获取当前空间的照片统计、今日漫画故事和历史漫画故事。
- `{ action: "generate", force: true }`：从当前空间随机抽取一张未使用照片生成漫画。
- `{ action: "addPhoto", fileID }`：向当前空间添加照片。
- `{ action: "listPhotos" }`：列出当前空间照片池。
- `{ action: "deletePhoto", photoId }`：删除当前空间未使用或失败的照片。
- `{ action: "listComics" }`：列出当前空间漫画历史。
- `{ action: "getComic", comicId }`：读取有权限访问的漫画详情。
- `{ action: "processStory", comicId }`：生成或补全漫画文案。
- `{ action: "processImage", comicId }`：生成或补全漫画图片。
- `{ action: "listFamilies" }`：列出当前用户加入的家庭空间。
- `{ action: "createFamily", name }`：创建家庭空间，创建人自动成为 owner。
- 定时触发：默认配置为每天 8:00 触发，扫描有未使用照片的数据空间并生成内容。

云函数会读取环境变量 `AI_API_KEY` 调用 AI 接口：

- `AI_API_KEY`：必填，AI 接口密钥。
- `AI_BASE_URL`：可选，默认 `https://api.gptsapi.net`。
- `AI_TEXT_MODEL`：可选，默认 `gpt-5.5`。
- `AI_IMAGE_MODEL`：可选，默认 `gpt-image-2`。

如果没有配置 `AI_API_KEY`，或 AI 接口调用失败，云函数会回退到 mock 内容，保证小程序主链路不中断。

## 数据空间

当前版本支持两类数据空间：

- 个人空间：默认空间，按用户 `openid` 隔离。
- 家庭空间：由用户创建，成员共享同一套照片池和漫画历史。

`photos` 和 `comics` 会写入：

- `scopeType`：`personal` 或 `family`。
- `scopeId`：个人空间为用户 `openid`，家庭空间为 `familyId`。
- `_openid`：上传者或创建者，用于追踪数据来源。
- `uploaderOpenid` / `creatorOpenid`：更明确地记录上传者或创建者。

旧版本没有 `scopeType` 的数据会被兼容为个人空间数据，不需要立即迁移。

## 调试家庭空间

1. 重新部署 `cloudfunctions/dailyComic`。
2. 编译小程序。
3. 首页点击「当前空间」卡片进入家庭空间页。
4. 创建一个家庭空间，创建完成后会自动切换到该家庭空间。
5. 在家庭空间上传照片并生成漫画，确认照片池和历史只展示家庭空间数据。
6. 切回个人空间，确认个人照片池和历史不包含家庭空间数据。
7. 再切回家庭空间，确认家庭空间数据仍然存在。

当前版本还没有邀请链路；家庭空间创建后先用于验证个人/家庭数据隔离。下一步会增加由 owner 触发的家庭邀请加入流程。

## 开发者工具操作

1. 用微信开发者工具打开本项目目录。
2. 确认云开发环境 ID 已在 `miniprogram/utils/cloud.js` 中配置。
3. 在 `dailyComic` 云函数配置中添加环境变量 `AI_API_KEY`。
4. 右键 `cloudfunctions/dailyComic`，选择「上传并部署：云端安装依赖」。
5. 运行小程序，进入首页或照片池，云函数会尝试初始化数据库集合。
6. 上传照片后，在首页点击「随机生成漫画」验证完整链路。

## Git

`project.private.config.json` 是微信开发者工具本机配置，已被 `.gitignore` 忽略，不进入仓库。

## 新机器接手开发

如果在另一台电脑从 GitHub 获取项目继续开发，请先阅读：

- [新机器接手开发指南](docs/new-machine-setup.md)
