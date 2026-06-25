const cloud = require("wx-server-sdk");
const https = require("https");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const AI_BASE_URL = process.env.AI_BASE_URL || "https://api.gptsapi.net";
const TEXT_MODEL = process.env.AI_TEXT_MODEL || "gpt-5.5";
const IMAGE_MODEL = process.env.AI_IMAGE_MODEL || "gpt-image-2";
const IMAGE_REQUEST_TIMEOUT_MS = 50000;
const IMAGE_RESULT_POLL_INTERVAL_MS = 3000;
const IMAGE_RESULT_MAX_POLLS = 5;
const STORY_REQUEST_TIMEOUT_MS = 45000;

exports.main = async (event) => {
  await ensureCollections();
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;

  if (event.action === "init") {
    return { code: "ok" };
  }

  if (event.action === "generate") {
    return startGeneration(openid, { force: Boolean(event.force) });
  }

  if (event.action === "processStory") {
    return processComicStory(openid, event.comicId);
  }

  if (event.action === "processImage") {
    return processComicImage(openid, event.comicId, { force: Boolean(event.force) });
  }

  if (event.action === "debugImagePipeline") {
    return debugImagePipeline(openid, event.comicId);
  }

  if (event.action === "dashboard") {
    return getDashboard(openid);
  }

  if (event.action === "addPhoto") {
    return addPhoto(openid, event.fileID);
  }

  if (event.action === "listPhotos") {
    return listPhotos(openid);
  }

  if (event.action === "deletePhoto") {
    return deletePhoto(openid, event.photoId);
  }

  if (event.action === "listComics") {
    return listComics(openid);
  }

  if (event.action === "getComic") {
    return getComic(openid, event.comicId);
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

async function getDashboard(openid) {
  if (!openid) {
    return { code: "missing_openid" };
  }

  const date = getShanghaiDateKey();
  const [unused, used, failed, todayComic, latestComic] = await Promise.all([
    countPhotos(openid, "unused"),
    countPhotos(openid, "used"),
    countPhotos(openid, "failed"),
    getLatestComic(openid, { date }),
    getLatestComic(openid),
  ]);

  if (todayComic) {
    await attachDisplayUrls(todayComic);
  }
  if (latestComic && (!todayComic || latestComic._id !== todayComic._id)) {
    await attachDisplayUrls(latestComic);
  }

  return {
    code: "ok",
    stats: {
      unused,
      used,
      failed,
    },
    todayComic,
    latestComic,
  };
}

async function countPhotos(openid, status) {
  const res = await db
    .collection("photos")
    .where({
      _openid: openid,
      status,
    })
    .count();
  return res.total || 0;
}

async function getLatestComic(openid, options = {}) {
  const where = {
    _openid: openid,
    status: "ready",
  };
  if (options.date) {
    where.date = options.date;
  }

  const res = await db
    .collection("comics")
    .where(where)
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();
  return res.data && res.data[0] ? res.data[0] : null;
}

async function addPhoto(openid, fileID) {
  if (!openid) {
    return { code: "missing_openid" };
  }

  if (!fileID) {
    return { code: "missing_file" };
  }

  const res = await db.collection("photos").add({
    data: {
      _openid: openid,
      fileID,
      status: "unused",
      source: "manual_batch",
      createdAt: db.serverDate(),
      uploadedAt: db.serverDate(),
      usedAt: null,
      comicId: "",
    },
  });

  return {
    code: "ok",
    photoId: res._id,
  };
}

async function listPhotos(openid) {
  if (!openid) {
    return { code: "missing_openid", photos: [] };
  }

  const res = await db
    .collection("photos")
    .where({ _openid: openid })
    .orderBy("createdAt", "desc")
    .limit(80)
    .get();

  return {
    code: "ok",
    photos: res.data || [],
  };
}

async function deletePhoto(openid, photoId) {
  if (!openid) {
    return { code: "missing_openid" };
  }

  if (!photoId) {
    return { code: "missing_photo" };
  }

  const photoRes = await db.collection("photos").doc(photoId).get();
  const photo = photoRes.data;

  if (!photo || photo._openid !== openid) {
    return { code: "not_found" };
  }

  if (photo.status === "used" || photo.status === "processing") {
    return { code: "locked" };
  }

  await db.collection("photos").doc(photoId).remove();

  if (photo.fileID) {
    await cloud.deleteFile({
      fileList: [photo.fileID],
    });
  }

  return { code: "ok" };
}

async function listComics(openid) {
  if (!openid) {
    return { code: "missing_openid", comics: [] };
  }

  const res = await db
    .collection("comics")
    .where({
      _openid: openid,
      status: db.command.in(["processing", "story_ready", "image_processing", "ready"]),
    })
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();

  const comics = res.data || [];
  await attachDisplayUrlsBatch(comics);

  return {
    code: "ok",
    comics,
  };
}

async function getComic(openid, comicId) {
  if (!openid) {
    return { code: "missing_openid" };
  }

  if (!comicId) {
    return { code: "missing_comic" };
  }

  const res = await db.collection("comics").doc(comicId).get();
  const comic = res.data;

  if (!comic || comic._openid !== openid) {
    return { code: "not_found" };
  }

  await attachDisplayUrls(comic);

  return {
    code: "ok",
    comic,
  };
}

async function attachDisplayUrls(comic) {
  const fileList = [comic.generatedImageFileID, comic.sourceFileID].filter(Boolean);
  if (!fileList.length) return;

  try {
    const res = await cloud.getTempFileURL({ fileList });
    const map = {};
    (res.fileList || []).forEach((item) => {
      if (item.tempFileURL && (item.status === undefined || item.status === 0)) {
        map[item.fileID] = item.tempFileURL;
      }
    });

    if (comic.generatedImageFileID && map[comic.generatedImageFileID]) {
      comic.generatedImageDisplayURL = map[comic.generatedImageFileID];
    }
    if (comic.sourceFileID && map[comic.sourceFileID]) {
      comic.sourceDisplayURL = map[comic.sourceFileID];
    }
  } catch (err) {
    console.error("attach display url failed", err);
  }
}

async function attachDisplayUrlsBatch(comics) {
  if (!Array.isArray(comics) || !comics.length) return;

  for (let i = 0; i < comics.length; i += 1) {
    await attachDisplayUrls(comics[i]);
  }
}

async function startGeneration(openid, options = {}) {
  if (!openid) {
    return { code: "missing_openid" };
  }

  const date = getShanghaiDateKey();
  if (!options.force) {
    const existing = await db
      .collection("comics")
      .where({
        _openid: openid,
        date,
        status: db.command.in(["processing", "story_ready", "image_processing", "ready"]),
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
  const tempUrl = await getTempFileURL(photo.fileID);

  await db.collection("photos").doc(photo._id).update({
    data: {
      status: "processing",
      processingAt: db.serverDate(),
    },
  });

  const addRes = await db.collection("comics").add({
    data: {
      _openid: openid,
      photoId: photo._id,
      sourceFileID: photo.fileID,
      sourceTempURL: tempUrl,
      generatedImageUrl: "",
      generatedImageFileID: "",
      imagePrompt: "",
      aiError: "",
      date,
      title: "漫画生成中",
      summary: "正在根据照片生成漫画文案和图片，请稍候。",
      panels: [],
      ending: "",
      status: "processing",
      generator: "queued-v1",
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
    },
  });

  await db.collection("photos").doc(photo._id).update({
    data: {
      comicId: addRes._id,
    },
  });

  return {
    code: "queued",
    comicId: addRes._id,
    photoId: photo._id,
    date,
  };
}

async function processComicStory(openid, comicId) {
  const comic = await getOwnedComic(openid, comicId);
  if (!comic) {
    return { code: "not_found" };
  }

  if (comic.panels && comic.panels.length) {
    return { code: "skipped", comicId };
  }

  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    await applyMockStory(comic, "AI_API_KEY is not configured");
    return { code: "mock", comicId };
  }

  try {
    const story = await withTimeout(
      generateComicStory(apiKey, comic.sourceTempURL, "", comic.date),
      STORY_REQUEST_TIMEOUT_MS,
      "AI story generation"
    );
    const content = normalizeComicContent(story, comic.date);

    await db.collection("comics").doc(comic._id).update({
      data: {
        title: content.title,
        summary: content.summary,
        panels: content.panels,
        ending: content.ending,
        status: comic.generatedImageFileID ? "ready" : "story_ready",
        generator: comic.generatedImageFileID ? "ai-v1" : "ai-story-v1",
        updatedAt: db.serverDate(),
      },
    });
    await markPhotoUsed(comic);

    return { code: "ok", comicId };
  } catch (err) {
    const message = err && err.message ? err.message : "unknown story generation error";
    await applyMockStory(comic, `story: ${message}`);
    return { code: "mock", comicId, message };
  }
}

async function processComicImage(openid, comicId, options = {}) {
  const comic = await getOwnedComic(openid, comicId);
  if (!comic) {
    return { code: "not_found" };
  }

  if (comic.generatedImageFileID && !options.force) {
    return { code: "skipped", comicId };
  }

  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    await appendComicError(comic, "image: AI_API_KEY is not configured", {
      status: hasStory(comic) ? "ready" : "processing",
    });
    return { code: "missing_key", comicId };
  }

  const imagePrompt = buildComicImagePrompt(comic);

  try {
    let generatedImageUrl = comic.generatedImageUrl;
    let generatedImageFileID = "";

    if (!generatedImageUrl || options.force) {
      generatedImageUrl = await withTimeout(
        generateComicImage(apiKey, comic.sourceTempURL, imagePrompt),
        IMAGE_REQUEST_TIMEOUT_MS,
        "AI image generation"
      );
      await db.collection("comics").doc(comic._id).update({
        data: {
          generatedImageUrl,
          generatedImageFileID: "",
          imagePrompt,
          status: "image_processing",
          generator: "ai-image-task-v1",
          aiError: "",
          updatedAt: db.serverDate(),
        },
      });
    }

    try {
      generatedImageFileID = await saveRemoteImageToCloud(generatedImageUrl, comic._id, apiKey, {
        sourceUrl: comic.sourceTempURL,
      });
    } catch (err) {
      if (isImageProcessingError(err)) {
        await db.collection("comics").doc(comic._id).update({
          data: {
            generatedImageUrl,
            generatedImageFileID: "",
            imagePrompt,
            status: "image_processing",
            generator: "ai-image-task-v1",
            aiError: "",
            updatedAt: db.serverDate(),
          },
        });

        return {
          code: "processing",
          comicId,
          generatedImageUrl,
          message: err.message,
        };
      }

      throw err;
    }

    await db.collection("comics").doc(comic._id).update({
      data: {
        generatedImageUrl,
        generatedImageFileID,
        imagePrompt,
        status: hasStory(comic) ? "ready" : "processing",
        generator: hasStory(comic) ? "ai-v1" : "ai-image-v1",
        aiError: "",
        updatedAt: db.serverDate(),
      },
    });

    return { code: "ok", comicId, generatedImageUrl, generatedImageFileID };
  } catch (err) {
    const message = err && err.message ? err.message : "unknown image generation error";
    await appendComicError(comic, `image: ${message}`, {
      generatedImageFileID: "",
      imagePrompt,
      status: hasStory(comic) ? "ready" : "processing",
    });
    return { code: "failed", comicId, message };
  }
}

async function debugImagePipeline(openid, comicId) {
  const comic = await getOwnedComic(openid, comicId);
  if (!comic) {
    return { code: "not_found" };
  }

  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    return { code: "missing_key" };
  }

  const sourceUrl = comic.sourceTempURL || (await getTempFileURL(comic.sourceFileID));
  const result = {
    code: "ok",
    comicId,
    sourceUrl: redactUrl(sourceUrl),
    promptVersion: "four-panel-v1",
    currentGeneratedUrl: redactUrl(comic.generatedImageUrl || ""),
    currentGeneratedFileID: comic.generatedImageFileID || "",
  };

  try {
    const generatedImageUrl = comic.generatedImageUrl;
    if (!generatedImageUrl) {
      return {
        ...result,
        code: "no_generated_url",
      };
    }

    result.generatedImageUrl = redactUrl(generatedImageUrl);
    result.generatedUrlLooksLikeSource = isSourceImageUrl(generatedImageUrl, sourceUrl);
    result.debugMode = "existing-generated-url";

    const downloaded = await downloadRemoteImage(generatedImageUrl, apiKey, {
      sourceUrl,
    });
    result.download = {
      contentType: downloaded.contentType,
      size: downloaded.data.length,
      authMode: downloaded.authMode,
      finalUrl: redactUrl(downloaded.finalUrl || generatedImageUrl),
      pollCount: downloaded.pollCount || 0,
      looksLikeImage: isImageContentType(downloaded.contentType),
    };

    if (!isImageContentType(downloaded.contentType)) {
      result.code = "not_image";
      return result;
    }

    const extension = getImageExtension(downloaded.contentType, generatedImageUrl);
    const uploadRes = await cloud.uploadFile({
      cloudPath: `debug-comic-images/${comic._id}-${Date.now()}.${extension}`,
      fileContent: downloaded.data,
    });
    result.upload = {
      fileID: uploadRes.fileID,
    };

    const tempRes = await cloud.getTempFileURL({
      fileList: [uploadRes.fileID],
    });
    const tempFile = tempRes.fileList && tempRes.fileList[0] ? tempRes.fileList[0] : {};
    result.upload.tempFileURL = redactUrl(tempFile.tempFileURL || "");
    result.upload.status = tempFile.status;
    result.upload.errMsg = tempFile.errMsg || "";

    try {
      const verify = await requestBuffer(tempFile.tempFileURL, 15000);
      result.verify = {
        contentType: verify.contentType,
        size: verify.data.length,
        looksLikeImage: isImageContentType(verify.contentType),
      };
    } catch (err) {
      result.verify = {
        error: err && err.message ? err.message : "verify temp url failed",
      };
    }

    return result;
  } catch (err) {
    if (isImageProcessingError(err)) {
      result.code = "processing";
      result.error = err.message;
      return result;
    }
    result.code = "failed";
    result.error = err && err.message ? err.message : "unknown debug image pipeline error";
    return result;
  }
}

async function getOwnedComic(openid, comicId) {
  if (!openid || !comicId) return null;
  const res = await db.collection("comics").doc(comicId).get();
  const comic = res.data;
  if (!comic || comic._openid !== openid) return null;
  return comic;
}

function hasStory(comic) {
  return Boolean(comic && comic.panels && comic.panels.length);
}

async function applyMockStory(comic, errorMessage) {
  const content = buildMockComicContent(comic.date);
  const aiError = mergeError(comic.aiError, errorMessage);

  await db.collection("comics").doc(comic._id).update({
    data: {
      title: content.title,
      summary: content.summary,
      panels: content.panels,
      ending: content.ending,
      status: comic.generatedImageFileID ? "ready" : "story_ready",
      generator: "mock-fallback-v1",
      aiError,
      updatedAt: db.serverDate(),
    },
  });
  await markPhotoUsed(comic);
}

async function appendComicError(comic, errorMessage, extraData = {}) {
  await db.collection("comics").doc(comic._id).update({
    data: {
      ...extraData,
      aiError: mergeError(comic.aiError, errorMessage),
      updatedAt: db.serverDate(),
    },
  });
}

function mergeError(current, next) {
  return [current, next].filter(Boolean).join(" | ");
}

async function markPhotoUsed(comic) {
  if (!comic || !comic.photoId) return;

  await db.collection("photos").doc(comic.photoId).update({
    data: {
      status: "used",
      usedAt: db.serverDate(),
      comicId: comic._id,
    },
  });
}

async function processUser(openid, options = {}) {
  if (!openid) {
    return { code: "missing_openid" };
  }

  const date = getShanghaiDateKey();
  if (!options.force) {
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
    const generated = await generateComicContent(tempUrl, date);
    const content = generated.content;
    const addRes = await db.collection("comics").add({
      data: {
        _openid: openid,
        photoId: photo._id,
        sourceFileID: photo.fileID,
        sourceTempURL: tempUrl,
        generatedImageUrl: generated.generatedImageUrl || "",
        imagePrompt: generated.imagePrompt || "",
        aiError: generated.aiError || "",
        date,
        title: content.title,
        summary: content.summary,
        panels: content.panels,
        ending: content.ending,
        status: "ready",
        generator: generated.generator,
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

async function generateComicContent(imageUrl, date) {
  const apiKey = process.env.AI_API_KEY;

  if (!apiKey) {
    return {
      generator: "mock-v1",
      generatedImageUrl: "",
      imagePrompt: "",
      aiError: "AI_API_KEY is not configured",
      content: buildMockComicContent(date),
    };
  }

  let generatedImageUrl = "";
  const errors = [];
  let content = buildMockComicContent(date);

  try {
    const story = await withTimeout(
      generateComicStory(apiKey, imageUrl, "", date),
      STORY_REQUEST_TIMEOUT_MS,
      "AI story generation"
    );
    content = normalizeComicContent(story, date);
  } catch (err) {
    const message = err && err.message ? err.message : "unknown story generation error";
    errors.push(`story: ${message}`);
    console.error("AI story generation failed, fallback to mock", err);
  }

  const imagePrompt = buildComicImagePrompt(content);

  try {
    generatedImageUrl = await withTimeout(
      generateComicImage(apiKey, imageUrl, imagePrompt),
      IMAGE_REQUEST_TIMEOUT_MS,
      "AI image generation"
    );
  } catch (err) {
    const message = err && err.message ? err.message : "unknown image generation error";
    errors.push(`image: ${message}`);
    console.error("AI image generation failed, continue with original image", err);
  }

  return {
    generator: generatedImageUrl ? "ai-v1" : errors.length ? "mock-fallback-v1" : "ai-story-v1",
    generatedImageUrl,
    imagePrompt,
    aiError: errors.join(" | "),
    content,
  };
}

function buildComicImagePrompt(comic = {}) {
  const title = comic.title ? `Title: ${comic.title}` : "";
  const summary = comic.summary ? `Story summary: ${comic.summary}` : "";
  const ending = comic.ending ? `Ending mood: ${comic.ending}` : "";

  return [
    "Create one finished 2x2 four-panel comic page based on the input photo and the storyboard below.",
    "The output must be a single square image containing four clearly separated panels in a 2x2 grid.",
    "Use the photo as the visual reference for characters, place, lighting, colors, clothing, objects, and overall mood.",
    "Keep the same main subject identity and recognizable scene details across all four panels.",
    "Each panel should illustrate a distinct beat from the storyboard, with cinematic framing and gentle daily-life emotion.",
    "Style: warm hand-drawn comic, clean ink outlines, simplified shapes, soft flat colors, subtle paper texture, slight halftone shading.",
    "Make it visibly illustrated, not a photo retouch. The final image should be obviously different from the source photo.",
    "Do not add readable text, speech bubbles, captions, title lettering, logos, watermarks, or QR codes inside the image.",
    "Panel order: top-left is panel 1, top-right is panel 2, bottom-left is panel 3, bottom-right is panel 4.",
    title,
    summary,
    buildPanelPrompt(comic.panels || []),
    ending,
  ].filter(Boolean).join("\n");
}

function buildPanelPrompt(panels) {
  const source = Array.isArray(panels) ? panels.slice(0, 4) : [];
  const normalized = [];

  for (let i = 0; i < 4; i += 1) {
    const panel = source[i] || {};
    normalized.push(
      `Panel ${i + 1}: ${toShortText(panel.caption, "Continue the gentle daily-life story.")}` +
        (panel.dialogue ? ` Mood/dialogue reference: ${panel.dialogue}` : "")
    );
  }

  return normalized.join("\n");
}

async function generateComicImage(apiKey, inputUrl, prompt) {
  const result = await requestJson({
    url: `${AI_BASE_URL}/api/v3/openai/${IMAGE_MODEL}/image-edit`,
    apiKey,
    body: {
      prompt,
      input_urls: [inputUrl],
      aspect_ratio: "1:1",
      resolution: "1K",
    },
    timeoutMs: IMAGE_REQUEST_TIMEOUT_MS,
  });

  return extractImageUrl(result, inputUrl);
}

async function generateComicStory(apiKey, originalImageUrl, generatedImageUrl, date) {
  const imageForReading = generatedImageUrl || originalImageUrl;
  const result = await requestJson({
    url: `${AI_BASE_URL}/v1/chat/completions`,
    apiKey,
    body: {
      model: TEXT_MODEL,
      messages: [
        {
          role: "system",
          content:
            "你是一个擅长把日常照片改写成温暖漫画脚本的创作者。只输出合法 JSON，不要输出 Markdown。",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                `请根据这张照片，为 ${date} 的每日照片漫画生成中文内容。` +
                "输出 JSON，字段必须包括 title、summary、panels、ending。" +
                "panels 必须是 4 个分镜，每个分镜包含 caption 和 dialogue。" +
                "语气温暖、有画面感，避免夸张玄幻，适合私人照片回忆。",
            },
            {
              type: "image_url",
              image_url: {
                url: imageForReading,
              },
            },
          ],
        },
      ],
      max_tokens: 1200,
    },
    timeoutMs: STORY_REQUEST_TIMEOUT_MS,
  });

  const text = extractChatText(result);
  return parseJsonObject(text);
}

function normalizeComicContent(content, date) {
  const fallback = buildMockComicContent(date);
  const panels = Array.isArray(content.panels) ? content.panels.slice(0, 4) : [];

  return {
    title: toShortText(content.title, fallback.title),
    summary: toShortText(content.summary, fallback.summary),
    panels: panels.length
      ? panels.map((panel, index) => ({
          caption: toShortText(panel.caption, fallback.panels[index] && fallback.panels[index].caption),
          dialogue: toShortText(panel.dialogue, fallback.panels[index] && fallback.panels[index].dialogue),
        }))
      : fallback.panels,
    ending: toShortText(content.ending, fallback.ending),
  };
}

function toShortText(value, fallback) {
  if (typeof value !== "string") return fallback || "";
  const trimmed = value.trim();
  return trimmed || fallback || "";
}

function withTimeout(promise, timeoutMs, label) {
  let timer;

  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function requestJson({ url, apiKey, body, timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = https.request(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (response) => {
        let raw = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          let parsed;
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch (err) {
            reject(new Error(`AI response is not JSON: ${raw.slice(0, 200)}`));
            return;
          }

          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`AI request failed ${response.statusCode}: ${raw.slice(0, 500)}`));
            return;
          }

          resolve(parsed);
        });
      }
    );

    request.on("error", reject);
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`AI request timeout after ${timeoutMs}ms`));
    });
    request.write(payload);
    request.end();
  });
}

async function saveRemoteImageToCloud(imageUrl, comicId, apiKey, options = {}) {
  const buffer = await downloadRemoteImage(imageUrl, apiKey, options);

  if (!isImageContentType(buffer.contentType)) {
    throw new Error(`image download is not an image: ${buffer.contentType || "unknown content-type"}`);
  }

  const contentType = buffer.contentType || "";
  const extension = getImageExtension(contentType, imageUrl);
  const uploadRes = await cloud.uploadFile({
    cloudPath: `comic-images/${comicId}-${Date.now()}.${extension}`,
    fileContent: buffer.data,
  });

  return uploadRes.fileID;
}

async function downloadRemoteImage(imageUrl, apiKey, options = {}) {
  try {
    const buffer = await requestBuffer(imageUrl, IMAGE_REQUEST_TIMEOUT_MS);
    return resolveDownloadedImage(buffer, imageUrl, apiKey, {
      ...options,
      authMode: "none",
    });
  } catch (err) {
    console.warn("image download without auth failed, retrying with auth", err);
    const buffer = await requestBuffer(imageUrl, IMAGE_REQUEST_TIMEOUT_MS, apiKey);
    return resolveDownloadedImage(buffer, imageUrl, apiKey, {
      ...options,
      authMode: "bearer",
    });
  }
}

async function resolveDownloadedImage(buffer, currentUrl, apiKey, options = {}) {
  if (isImageContentType(buffer.contentType)) {
    return {
      ...buffer,
      authMode: options.authMode || "none",
      finalUrl: currentUrl,
    };
  }

  if (!isJsonContentType(buffer.contentType)) {
    return {
      ...buffer,
      authMode: options.authMode || "none",
      finalUrl: currentUrl,
    };
  }

  const excludeUrls = [currentUrl].concat(options.excludeUrls || []);
  let parsed = parseBufferJson(buffer.data);
  let finalUrl = "";
  let pollCount = 0;

  for (let attempt = 0; attempt <= IMAGE_RESULT_MAX_POLLS; attempt += 1) {
    try {
      finalUrl = extractImageUrl(parsed, options.sourceUrl || "", excludeUrls);
      break;
    } catch (err) {
      const status = getPredictionStatus(parsed);
      if (isFailedPredictionStatus(status)) {
        throw new Error(`AI image result failed: ${getPredictionError(parsed) || status}`);
      }
      if (isPendingPredictionStatus(status) && attempt === IMAGE_RESULT_MAX_POLLS) {
        throw createImageProcessingError(status);
      }
      if (!isPendingPredictionStatus(status)) {
        throw err;
      }

      pollCount += 1;
      await sleep(IMAGE_RESULT_POLL_INTERVAL_MS);
      const nextBuffer = await requestBuffer(currentUrl, IMAGE_REQUEST_TIMEOUT_MS, apiKey);

      if (isImageContentType(nextBuffer.contentType)) {
        return {
          ...nextBuffer,
          authMode: `${options.authMode || "none"}+json-poll`,
          finalUrl: currentUrl,
          pollCount,
        };
      }

      if (!isJsonContentType(nextBuffer.contentType)) {
        throw new Error(
          `AI image result is not image or JSON: ${nextBuffer.contentType || "unknown content-type"}`
        );
      }

      parsed = parseBufferJson(nextBuffer.data);
    }
  }

  let finalBuffer;

  try {
    finalBuffer = await requestBuffer(finalUrl, IMAGE_REQUEST_TIMEOUT_MS);
  } catch (err) {
    console.warn("resolved image download without auth failed, retrying with auth", err);
    finalBuffer = await requestBuffer(finalUrl, IMAGE_REQUEST_TIMEOUT_MS, apiKey);
  }

  if (!isImageContentType(finalBuffer.contentType)) {
    throw new Error(
      `resolved image url is not an image: ${finalBuffer.contentType || "unknown content-type"}`
    );
  }

  return {
    ...finalBuffer,
    authMode: `${options.authMode || "none"}+json${pollCount ? "-poll" : ""}`,
    finalUrl,
    pollCount,
  };
}

function requestBuffer(url, timeoutMs = 30000, apiKey = "", redirectsLeft = 3) {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: apiKey
          ? {
              Authorization: `Bearer ${apiKey}`,
            }
          : {},
      },
      (response) => {
      if (
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location &&
        redirectsLeft > 0
      ) {
        const nextUrl = new URL(response.headers.location, url).toString();
        response.resume();
        requestBuffer(nextUrl, timeoutMs, apiKey, redirectsLeft - 1).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        reject(new Error(`image download failed ${response.statusCode}`));
        response.resume();
        return;
      }

      const chunks = [];
      response.on("data", (chunk) => {
        chunks.push(chunk);
      });
      response.on("end", () => {
        resolve({
          data: Buffer.concat(chunks),
          contentType: response.headers["content-type"] || "",
        });
      });
      }
    );

    request.on("error", reject);
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`image download timeout after ${timeoutMs}ms`));
    });
  });
}

function getImageExtension(contentType, url) {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";

  const matched = String(url).match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  if (matched && ["jpg", "jpeg", "png", "webp", "gif"].includes(matched[1].toLowerCase())) {
    return matched[1].toLowerCase();
  }

  return "jpg";
}

function isImageContentType(contentType) {
  return /^image\//i.test(contentType || "");
}

function isJsonContentType(contentType) {
  return /application\/json|text\/json/i.test(contentType || "");
}

function parseBufferJson(buffer) {
  const raw = buffer.toString("utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`image result JSON parse failed: ${raw.slice(0, 300)}`);
  }
}

function getPredictionStatus(result) {
  return String(
    (result && result.status) ||
      (result && result.data && result.data.status) ||
      (result && result.result && result.result.status) ||
      ""
  ).toLowerCase();
}

function getPredictionError(result) {
  const error =
    (result && result.error) ||
    (result && result.message) ||
    (result && result.data && (result.data.error || result.data.message)) ||
    "";

  if (!error) return "";
  return typeof error === "string" ? error : JSON.stringify(error).slice(0, 300);
}

function isPendingPredictionStatus(status) {
  return ["pending", "queued", "processing", "running", "starting"].includes(status);
}

function isFailedPredictionStatus(status) {
  return ["failed", "error", "canceled", "cancelled"].includes(status);
}

function createImageProcessingError(status) {
  const err = new Error(`AI image still processing: ${status || "processing"}`);
  err.code = "image_processing";
  return err;
}

function isImageProcessingError(err) {
  return Boolean(err && err.code === "image_processing");
}

function isSourceImageUrl(url, sourceUrl) {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (sourceUrl && trimmed === sourceUrl.trim()) return true;
  return /\/photos\//i.test(trimmed);
}

function redactUrl(url) {
  if (!url || typeof url !== "string") return "";
  return url.split("?")[0];
}

function extractChatText(result) {
  const message = result && result.choices && result.choices[0] && result.choices[0].message;
  if (!message) {
    throw new Error("AI chat response has no message");
  }
  if (typeof message.content === "string") {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content.map((item) => item.text || "").join("");
  }
  throw new Error("AI chat response content is unsupported");
}

function parseJsonObject(text) {
  const cleaned = String(text)
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw err;
  }
}

function extractImageUrl(result, inputUrl = "", excludeUrls = []) {
  const candidates = [
    result && result.url,
    result && result.image_url,
    result && result.imageUrl,
    result && result.result_url,
    result && result.output_url,
    result && result.data && result.data.url,
    result && result.data && result.data.image_url,
    result && result.urls && result.urls[0],
    result && result.images && result.images[0] && result.images[0].url,
    result && result.output && result.output[0] && result.output[0].url,
    result && result.data && result.data[0] && result.data[0].url,
    result && result.data && result.data.image_urls && result.data.image_urls[0],
    result && result.data && result.data.urls && result.data.urls[0],
    result && result.result && result.result.url,
    result && result.result && result.result.image_url,
    result && result.result && result.result.image_urls && result.result.image_urls[0],
  ].filter((url) => isGeneratedImageUrl(url, inputUrl, excludeUrls));

  if (candidates.length) {
    return candidates[0];
  }

  const deepUrl = findImageUrlDeep(result, inputUrl, excludeUrls);
  if (deepUrl) {
    return deepUrl;
  }

  const b64 =
    (result && result.b64_json) ||
    (result && result.data && result.data.b64_json) ||
    (result && result.data && result.data[0] && result.data[0].b64_json) ||
    findBase64ImageDeep(result);

  if (b64) {
    throw new Error("AI returned base64 image, URL output is required for this MVP");
  }

  throw new Error(`AI image response has no image URL. response=${summarizeAiResponse(result)}`);
}

function isGeneratedImageUrl(url, inputUrl = "", excludeUrls = []) {
  if (!url || typeof url !== "string") return false;

  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  if (inputUrl && trimmed === inputUrl.trim()) return false;
  if (excludeUrls.some((excluded) => excluded && trimmed === String(excluded).trim())) return false;

  return !/\/photos\//i.test(trimmed);
}

function shouldSkipImageUrlKey(key) {
  return /input|source|origin|original|prompt|request|thumb|preview/i.test(key);
}

function findImageUrlDeep(value, inputUrl = "", excludeUrls = [], seen = new Set()) {
  if (!value) return "";

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (isGeneratedImageUrl(trimmed, inputUrl, excludeUrls)) {
      return trimmed;
    }
    return "";
  }

  if (typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = findImageUrlDeep(value[i], inputUrl, excludeUrls, seen);
      if (found) return found;
    }
    return "";
  }

  const preferredKeys = [
    "url",
    "image_url",
    "imageUrl",
    "image_urls",
    "urls",
    "result_url",
    "output_url",
    "download_url",
    "file_url",
    "cdn_url",
  ];

  for (let i = 0; i < preferredKeys.length; i += 1) {
    const found = findImageUrlDeep(value[preferredKeys[i]], inputUrl, excludeUrls, seen);
    if (found) return found;
  }

  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i += 1) {
    if (shouldSkipImageUrlKey(keys[i])) continue;
    const found = findImageUrlDeep(value[keys[i]], inputUrl, excludeUrls, seen);
    if (found) return found;
  }

  return "";
}

function findBase64ImageDeep(value, seen = new Set()) {
  if (!value) return "";

  if (typeof value === "string") {
    if (value.length > 1000 && /^[A-Za-z0-9+/=]+$/.test(value.slice(0, 120))) {
      return value;
    }
    return "";
  }

  if (typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = findBase64ImageDeep(value[i], seen);
      if (found) return found;
    }
    return "";
  }

  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i += 1) {
    if (/b64|base64/i.test(keys[i])) {
      const found = findBase64ImageDeep(value[keys[i]], seen);
      if (found) return found;
    }
  }

  return "";
}

function summarizeAiResponse(value) {
  try {
    return JSON.stringify(redactLargeValues(value)).slice(0, 800);
  } catch (err) {
    return "unserializable response";
  }
}

function redactLargeValues(value, depth = 0) {
  if (depth > 4) return "[MaxDepth]";
  if (typeof value === "string") {
    return value.length > 180 ? `${value.slice(0, 180)}...` : value;
  }
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 4).map((item) => redactLargeValues(item, depth + 1));
  }

  const output = {};
  Object.keys(value)
    .slice(0, 20)
    .forEach((key) => {
      output[key] = redactLargeValues(value[key], depth + 1);
    });
  return output;
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
