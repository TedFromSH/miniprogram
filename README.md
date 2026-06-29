# 生活瞬间小程序

这是一个微信小程序：用户上传照片形成照片池，系统从照片池中随机抽取照片生成漫画故事，并在小程序内提供阅读、历史回顾和家庭空间共享能力。

## 当前功能

1. 在小程序「照片池」上传多张图片，并以「待生成」「生成中」「已生成漫画」「生成失败」展示照片状态。
2. 图片保存到微信云存储，照片记录写入 `photos` 集合。
3. 首页点击「随机生成漫画」调用 `dailyComic` 云函数。
4. 云函数随机选择一张 `unused` 照片，调用 AI 生成漫画图和分镜脚本，并写入 `comics` 集合。
5. 照片状态从 `unused` 变为 `used`。
6. 已生成漫画的照片卡片可以直接跳转到对应漫画详情页。
7. 小程序进入漫画详情页阅读内容，并支持查看漫画全图、查看原图；在微信图片预览页可长按保存图片。
8. 用户可以创建家庭空间，并在个人空间/家庭空间之间切换。不同空间的照片池、统计和漫画历史相互隔离。
9. 家庭 owner 可以生成邀请卡片，通过微信分享给家人；被邀请人确认后加入家庭空间。

## 页面

- `pages/index/index`：首页，展示当前空间、照片池统计、随机生成入口、今日漫画故事或历史漫画故事。
- `pages/familySpace/familySpace`：家庭空间页，支持创建家庭空间、切换空间，并由 owner 发送家庭邀请卡片。
- `pages/familyInvite/familyInvite`：家庭邀请确认页，被邀请人通过分享卡片进入后确认加入家庭。
- `pages/photoPool/photoPool`：照片池，支持批量上传、删除未使用照片，并从已生成照片跳转到对应漫画详情。
- `pages/history/history`：漫画历史列表。
- `pages/comicCreate/comicCreate`：漫画生成设置页，展示本次随机抽中的照片，支持选择漫画风格和输入剧情描述。
- `pages/comicDetail/comicDetail`：漫画详情阅读页，支持预览漫画全图和原始照片。

## 云函数

- `cloudfunctions/dailyComic`：照片漫画生成和数据空间管理函数。

支持的主要调用方式：

- `{ action: "init" }`：初始化集合。
- `{ action: "dashboard" }`：获取当前空间的照片统计、今日漫画故事和历史漫画故事。
- `{ action: "generate", force: true }`：从当前空间随机抽取一张未使用照片生成漫画。
- `{ action: "prepareGeneration" }`：为手动生成流程预选一张未使用照片，并短期预占。
- `{ action: "submitGeneration", photoId, styleId, storyGuide }`：提交生成设置，先审核剧情描述，通过后创建漫画任务。
- `{ action: "addPhoto", fileID }`：向当前空间添加照片。
- `{ action: "listPhotos" }`：列出当前空间照片池。
- `{ action: "deletePhoto", photoId }`：删除当前空间未使用或失败的照片。
- `{ action: "listComics" }`：列出当前空间漫画历史。
- `{ action: "getComic", comicId }`：读取有权限访问的漫画详情。
- `{ action: "processStory", comicId }`：生成或补全漫画文案。
- `{ action: "processImage", comicId }`：生成或补全漫画图片。
- `{ action: "listFamilies" }`：列出当前用户加入的家庭空间。
- `{ action: "createFamily", name }`：创建家庭空间，创建人自动成为 owner。
- `{ action: "createFamilyInvite", familyId }`：由家庭 owner 创建邀请 token，用于分享邀请卡片。
- `{ action: "getFamilyInvite", token }`：读取邀请信息，展示家庭名称和加入状态。
- `{ action: "joinFamilyInvite", token }`：确认加入家庭空间，写入 `familyMembers`。
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
6. 在照片池点击「已生成漫画」照片，确认可以进入对应漫画详情。
7. 切回个人空间，确认个人照片池和历史不包含家庭空间数据。
8. 再切回家庭空间，确认家庭空间数据仍然存在。

## 调试家庭邀请

1. 重新部署 `cloudfunctions/dailyComic`。
2. 在微信开发者工具上传体验版，并将被邀请账号加入体验成员。
3. owner 进入家庭空间页，切换到自己创建的家庭。
4. 点击「生成邀请卡片」，再点击「发送邀请卡片」。
5. 被邀请账号点击微信卡片进入 `familyInvite` 页面。
6. 点击「加入家庭」，成功后会自动切换到该家庭空间。
7. 在云数据库 `familyMembers` 中确认新增 member 记录。

邀请 token 默认 7 天有效。当前版本支持 owner 邀请，暂不支持普通成员继续邀请。

## 开发者工具操作

1. 用微信开发者工具打开本项目目录。
2. 确认云开发环境 ID 已在 `miniprogram/utils/cloud.js` 中配置。
3. 在 `dailyComic` 云函数配置中添加环境变量 `AI_API_KEY`。
4. 右键 `cloudfunctions/dailyComic`，选择「上传并部署：云端安装依赖」。
5. 运行小程序，进入首页或照片池，云函数会尝试初始化数据库集合。
6. 上传照片后，在首页点击「随机生成漫画」验证完整链路。
7. 在生成设置页确认随机抽中的照片，选择必填的漫画风格，可选填写剧情描述，再点击「开始生成」。
8. 如果剧情描述包含不适合生成的内容，或提出脱离漫画剧情场景的 AI/问答/解题等要求，系统会拦截并提示重新调整。
9. 进入漫画详情页，点击顶部图片右下角「查看全图」「查看原图」，确认可进入微信图片预览页；如需保存图片，可在预览页长按操作。

## Subscribe message setup

To enable WeChat completion notifications for comic generation:

1. In the WeChat Mini Program admin, add a one-time subscribe message template for a completed generation/task notification.
2. Configure the template keywords to match the cloud function payload:
   - `thing1`: pending item / comic title
   - `phrase5`: generation status
   - `time12`: completion time
3. Set the `dailyComic` cloud function environment variable `COMIC_READY_TEMPLATE_ID` to the template ID.
4. Optional: set `SUBSCRIBE_MINIPROGRAM_STATE` to `developer`, `trial`, or `formal`. The default is `formal`.
5. Redeploy `cloudfunctions/dailyComic`. The `comicQueueTimer` trigger runs every 5 minutes to continue queued comics and send pending ready notifications.

## Git

`project.private.config.json` 是微信开发者工具本机配置，已被 `.gitignore` 忽略，不进入仓库。

## 新机器接手开发

如果在另一台电脑从 GitHub 获取项目继续开发，请先阅读：

- [新机器接手开发指南](docs/new-machine-setup.md)
