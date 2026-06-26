# 新机器接手开发指南

这份文档用于在另一台电脑从 GitHub 获取项目后，快速恢复微信小程序开发环境。

## 1. 安装和权限

1. 安装微信开发者工具。
2. 用有权限的微信扫码登录。
3. 确认当前微信号已加入小程序项目成员：
   - 微信公众平台 -> 管理 -> 成员管理 -> 项目成员
   - 如需真机体验，也加入体验成员

## 2. 拉取项目

```bash
git clone https://github.com/TedFromSH/miniprogram.git
```

在微信开发者工具里选择「导入项目」，项目目录选择 clone 下来的文件夹。

## 3. 确认 AppID 和云环境

如果仍然开发同一个小程序、同一个云环境，通常不需要改代码。

需要重点确认：

- `project.config.json` 里的 `appid`
- `miniprogram/utils/cloud.js` 里的 `CLOUD_ENV`

当前云环境 ID：

```text
first-weixin-d0grdrujrf2e58e71
```

如果换成新的小程序或新的云环境，需要同步修改以上配置。

## 4. 部署云函数

GitHub 不提交 `node_modules`，所以新机器第一次必须让云端安装依赖。

在微信开发者工具中右键：

```text
cloudfunctions/dailyComic
```

选择：

```text
创建并部署：云端安装依赖（不上传 node_modules）
```

不要只选「创建并部署：所有文件」，否则可能出现：

```text
Cannot find module 'wx-server-sdk'
```

## 5. 配置云函数环境变量

环境变量不在 GitHub 中，需要在云函数配置中确认：

- `AI_API_KEY`：必填，AI 接口密钥
- `AI_BASE_URL`：可选，默认 `https://api.gptsapi.net`
- `AI_TEXT_MODEL`：可选，默认 `gpt-5.5`
- `AI_IMAGE_MODEL`：可选，默认 `gpt-image-2`

注意：不要把 `AI_API_KEY` 写进代码，也不要提交到 GitHub。

## 6. 云端数据说明

GitHub 只保存代码。以下内容都保存在微信云环境里：

- 照片池数据
- 漫画记录
- 云存储图片
- 用户 openid 数据
- 云函数环境变量

只要新机器连接的是同一个小程序和同一个云环境，就会访问同一套云端资源。

当前版本数据按用户 `openid` 隔离，不同微信账号默认看不到彼此的照片池和漫画历史。

## 7. 本地验证流程

导入项目并部署云函数后，建议按这个顺序验证：

1. 编译小程序。
2. 进入照片池上传图片。
3. 回首页点击「生成今日漫画」。
4. 进入详情页，确认文案先生成。
5. 等待图片状态从生成中变为四宫格漫画图。
6. 进入历史列表，确认生成中和已完成内容都能展示。

## 8. 协作开发建议

开始开发前先拉最新代码：

```bash
git pull
```

开发完成后：

```bash
git status
git add .
git commit -m "Describe the change"
git push
```

不要提交：

- `project.private.config.json`
- `node_modules`
- 本地缓存文件
- API Key 或其他密钥

## 9. 发布和体验版

上传体验版或提交审核仍需要在微信开发者工具和微信公众平台中完成：

1. 微信开发者工具点击「上传」。
2. 在微信公众平台 -> 管理 -> 版本管理 中设为体验版本。
3. 用体验版二维码真机验证。
4. 验证通过后提交审核。
5. 审核通过后发布。
