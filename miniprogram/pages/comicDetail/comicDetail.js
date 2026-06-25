const { callFunction } = require("../../utils/cloud");

Page({
  data: {
    comic: null,
    coverSrc: "",
    loading: true,
    processing: false,
    imageDebug: null,
  },

  onLoad(options) {
    if (!options.id) {
      wx.showToast({
        title: "缺少漫画 ID",
        icon: "none",
      });
      return;
    }
    this.coverRetryCount = 0;
    this.loadComic(options.id);
  },

  onUnload() {
    this.clearImagePoll();
  },

  async processIfNeeded(comic) {
    if (!comic || this.processingStarted) return;

    const needsStory = !comic.panels || !comic.panels.length;
    const needsImage = !comic.generatedImageFileID;
    if (!needsStory && !needsImage) return;

    this.processingStarted = true;
    this.setData({ processing: true });

    try {
      if (needsStory) {
        await callFunction("dailyComic", {
          action: "processStory",
          comicId: comic._id,
        });
        await this.loadComic(comic._id, { skipProcess: true });
      }

      const latestComic = this.data.comic || comic;
      if (!latestComic.generatedImageFileID) {
        const imageRes = await callFunction("dailyComic", {
          action: "processImage",
          comicId: comic._id,
        });
        const imageResult = imageRes.result || {};
        await this.loadComic(comic._id, { skipProcess: true });
        if (imageResult.code === "processing") {
          this.scheduleImagePoll(comic._id);
        }
      }
    } catch (err) {
      console.error("process comic failed", err);
      wx.showToast({
        title: "生成仍在处理中",
        icon: "none",
      });
    } finally {
      this.setData({ processing: false });
      this.processingStarted = false;
    }
  },

  async loadComic(id, options = {}) {
    this.setData({ loading: true });
    try {
      const res = await callFunction("dailyComic", {
        action: "getComic",
        comicId: id,
      });
      const result = res.result || {};
      if (result.code !== "ok") {
        throw new Error(result.code || "load failed");
      }
      const comic = this.normalizeComic(result.comic);
      this.setData({
        comic,
        coverSrc:
          comic.generatedImageDisplayURL ||
          comic.sourceDisplayURL ||
          comic.sourceFileID,
        loading: false,
      });
      if (!options.skipProcess) {
        this.processIfNeeded(comic);
      } else if (comic.status === "image_processing" && !comic.generatedImageFileID) {
        this.scheduleImagePoll(comic._id);
      }
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({
        title: "内容加载失败",
        icon: "none",
      });
    }
  },

  normalizeComic(comic) {
    if (!comic) return comic;
    const hasGeneratedImage = Boolean(comic.generatedImageFileID || comic.generatedImageDisplayURL);
    const displayAiError =
      hasGeneratedImage && /^image:/i.test(comic.aiError || "") ? "" : comic.aiError || "";

    return {
      ...comic,
      displayAiError,
    };
  },

  scheduleImagePoll(comicId) {
    if (!comicId) return;
    this.clearImagePoll();
    this.imagePollTimer = setTimeout(() => {
      this.pollImageStatus(comicId);
    }, 12000);
  },

  clearImagePoll() {
    if (this.imagePollTimer) {
      clearTimeout(this.imagePollTimer);
      this.imagePollTimer = null;
    }
  },

  async pollImageStatus(comicId) {
    if (!comicId || this.data.processing) {
      this.scheduleImagePoll(comicId);
      return;
    }

    this.setData({ processing: true });
    try {
      const res = await callFunction("dailyComic", {
        action: "processImage",
        comicId,
      });
      const result = res.result || {};
      await this.loadComic(comicId, { skipProcess: true });
      if (result.code === "processing") {
        this.scheduleImagePoll(comicId);
      } else {
        this.clearImagePoll();
      }
    } catch (err) {
      console.error("poll image status failed", err);
      this.scheduleImagePoll(comicId);
    } finally {
      this.setData({ processing: false });
    }
  },

  onCoverLoad(e) {
    console.info("comic cover loaded", this.data.coverSrc, e.detail);
  },

  onCoverError(e) {
    console.error("comic cover load failed", this.data.coverSrc, e.detail);
    this.retryCoverImage();
  },

  async retryCoverImage() {
    const comic = this.data.comic;
    if (!comic || this.coverRetryStarted) return;
    if (!comic.generatedImageFileID && !comic.generatedImageUrl) return;
    if (this.coverRetryCount >= 1) {
      this.useSourceCover(comic);
      return;
    }

    this.coverRetryStarted = true;
    this.coverRetryCount = (this.coverRetryCount || 0) + 1;
    this.setData({ processing: true });

    try {
      const res = await callFunction("dailyComic", {
        action: "processImage",
        comicId: comic._id,
        force: true,
      });
      const result = res.result || {};
      if (result.code === "processing") {
        await this.loadComic(comic._id, { skipProcess: true });
        this.scheduleImagePoll(comic._id);
        return;
      }
      if (result.code !== "ok" && result.code !== "skipped") {
        throw new Error(result.message || result.code || "retry image failed");
      }
      await this.loadComic(comic._id, { skipProcess: true });
    } catch (err) {
      console.error("retry comic image failed", err);
      this.useSourceCover(comic);
      wx.showToast({
        title: "漫画图还在处理中",
        icon: "none",
      });
    } finally {
      this.coverRetryStarted = false;
      this.setData({ processing: false });
    }
  },

  useSourceCover(comic) {
    const sourceCover = comic.sourceDisplayURL || comic.sourceFileID || "";
    if (sourceCover && sourceCover !== this.data.coverSrc) {
      this.setData({ coverSrc: sourceCover });
    }
  },

  async regenerateComicImage() {
    const comic = this.data.comic;
    if (!comic || this.data.processing) return;

    this.coverRetryCount = 0;
    this.setData({ processing: true });
    wx.showLoading({ title: "生成中" });

    try {
      const res = await callFunction("dailyComic", {
        action: "processImage",
        comicId: comic._id,
        force: true,
      });
      const result = res.result || {};
      if (result.code === "processing") {
        await this.loadComic(comic._id, { skipProcess: true });
        this.scheduleImagePoll(comic._id);
        return;
      }
      if (result.code !== "ok") {
        throw new Error(result.message || result.code || "image generation failed");
      }
      await this.loadComic(comic._id, { skipProcess: true });
    } catch (err) {
      console.error("manual regenerate image failed", err);
      wx.showToast({
        title: "图片生成失败",
        icon: "none",
      });
    } finally {
      wx.hideLoading();
      this.setData({ processing: false });
    }
  },

  async debugImagePipeline() {
    const comic = this.data.comic;
    if (!comic || this.data.processing) return;

    this.setData({ processing: true, imageDebug: null });
    wx.showLoading({ title: "验证中" });

    try {
      const res = await callFunction("dailyComic", {
        action: "debugImagePipeline",
        comicId: comic._id,
      });
      const result = res.result || {};
      this.setData({
        imageDebug: {
          ...result,
          json: JSON.stringify(result, null, 2),
        },
      });
    } catch (err) {
      console.error("debug image pipeline failed", err);
      this.setData({
        imageDebug: {
          code: "call_failed",
          error: err && err.message ? err.message : "debug call failed",
        },
      });
      wx.showToast({
        title: "验证失败",
        icon: "none",
      });
    } finally {
      wx.hideLoading();
      this.setData({ processing: false });
    }
  },

  copyText() {
    const comic = this.data.comic;
    if (!comic) return;

    const panels = (comic.panels || [])
      .map((panel, index) => `${index + 1}. ${panel.caption}\n${panel.dialogue}`)
      .join("\n\n");
    const text = `${comic.title}\n\n${comic.summary}\n\n${panels}\n\n${comic.ending || ""}`;

    wx.setClipboardData({
      data: text,
      success() {
        wx.showToast({
          title: "已复制",
          icon: "success",
        });
      },
    });
  },

  onShareAppMessage() {
    const comic = this.data.comic || {};
    return {
      title: comic.title || "我的今日照片漫画",
      path: `/pages/comicDetail/comicDetail?id=${comic._id || ""}`,
    };
  },
});
