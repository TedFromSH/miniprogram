const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

exports.main = async (event) => {
  await ensureCollections();

  if (event.action === "init") {
    return { code: "ok" };
  }

  if (event.action === "generate") {
    const wxContext = cloud.getWXContext();
    return processUser(wxContext.OPENID);
  }

  return processAllUsers();
};

async function ensureCollections() {
  await ensureCollection("photos");
  await ensureCollection("comics");
}

async function ensureCollection(name) {
  try {
    await db.createCollection(name);
  } catch (err) {
    const message = err && err.message ? err.message : "";
    if (!message.includes("exist") && !message.includes("already")) {
      console.warn(`create collection ${name} skipped`, message);
    }
  }
}

async function processAllUsers() {
  const res = await db
    .collection("photos")
    .where({ status: "unused" })
    .limit(100)
    .get();
  const openids = Array.from(new Set((res.data || []).map((item) => item._openid).filter(Boolean)));
  const results = [];

  for (let i = 0; i < openids.length; i += 1) {
    results.push(await processUser(openids[i]));
  }

  return {
    code: "ok",
    total: results.length,
    results,
  };
}

async function processUser(openid) {
  if (!openid) {
    return { code: "missing_openid" };
  }

  const date = getShanghaiDateKey();
  const existing = await db
    .collection("comics")
    .where({
      _openid: openid,
      date,
      status: "ready",
    })
    .limit(1)
    .get();

  if (existing.data && existing.data.length) {
    return {
      code: "already_generated",
      comicId: existing.data[0]._id,
      date,
    };
  }

  const candidates = await db
    .collection("photos")
    .where({
      _openid: openid,
      status: "unused",
    })
    .limit(100)
    .get();

  if (!candidates.data || !candidates.data.length) {
    return {
      code: "no_photo",
      date,
    };
  }

  const photo = pickRandom(candidates.data);

  try {
    await db.collection("photos").doc(photo._id).update({
      data: {
        status: "processing",
        processingAt: db.serverDate(),
      },
    });

    const tempUrl = await getTempFileURL(photo.fileID);
    const content = buildMockComicContent(date);
    const addRes = await db.collection("comics").add({
      data: {
        _openid: openid,
        photoId: photo._id,
        sourceFileID: photo.fileID,
        sourceTempURL: tempUrl,
        date,
        title: content.title,
        summary: content.summary,
        panels: content.panels,
        ending: content.ending,
        status: "ready",
        generator: "mock-v1",
        createdAt: db.serverDate(),
      },
    });

    await db.collection("photos").doc(photo._id).update({
      data: {
        status: "used",
        usedAt: db.serverDate(),
        comicId: addRes._id,
      },
    });

    return {
      code: "generated",
      comicId: addRes._id,
      photoId: photo._id,
      date,
    };
  } catch (err) {
    await db.collection("photos").doc(photo._id).update({
      data: {
        status: "failed",
        failedAt: db.serverDate(),
        errorMessage: err && err.message ? err.message : "unknown error",
      },
    });

    return {
      code: "failed",
      photoId: photo._id,
      message: err && err.message ? err.message : "unknown error",
    };
  }
}

function pickRandom(items) {
  const index = Math.floor(Math.random() * items.length);
  return items[index];
}

async function getTempFileURL(fileID) {
  if (!fileID) return "";
  const res = await cloud.getTempFileURL({
    fileList: [fileID],
  });
  const file = res.fileList && res.fileList[0];
  return file && file.tempFileURL ? file.tempFileURL : "";
}

function getShanghaiDateKey() {
  const shanghaiTime = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return shanghaiTime.toISOString().slice(0, 10);
}

function buildMockComicContent(date) {
  const titles = [
    "今天也有一点小小的光",
    "被照片保存下来的轻剧情",
    "普通一天的漫画分镜",
    "镜头里的今日冒险",
  ];
  const title = titles[Math.floor(Math.random() * titles.length)];

  return {
    title,
    summary: `这是一篇根据 ${date} 随机抽取照片生成的漫画脚本。当前版本先跑通产品链路，后续会替换为真实 AI 识图和创作。`,
    panels: [
      {
        caption: "画面从一个安静的瞬间开始，主角像是刚刚发现今天藏着一点不同寻常。",
        dialogue: "旁白：有些故事不是发生在远方，而是藏在一张照片的边角里。",
      },
      {
        caption: "镜头推进，照片里的细节被放大，普通场景变成了漫画里的关键线索。",
        dialogue: "主角：等一下，这里好像有今天的主题。",
      },
      {
        caption: "情绪变得轻快，画面里的色彩和动作被重新组织成一个小转折。",
        dialogue: "旁白：当回忆被重新排列，它就拥有了新的节奏。",
      },
      {
        caption: "最后一格停在温柔的收束上，像给今天盖了一个小印章。",
        dialogue: "主角：好吧，今天也值得被画下来。",
      },
    ],
    ending: "今日彩蛋：这张照片已经从素材池移出，明天会随机抽取下一张未使用照片。",
  };
}
