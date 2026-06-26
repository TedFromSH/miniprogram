const { callFunction, getActiveScope } = require("../../utils/cloud");

Page({
  data: {
    loading: true,
    generating: false,
    stats: {
      unused: 0,
      used: 0,
      failed: 0,
    },
    todayComics: [],
    recentComics: [],
    displayComics: [],
    displaySectionTitle: "",
    initError: "",
    activeScopeLabel: "个人空间",
  },

  async onShow() {
    this.refreshActiveScopeLabel();
    const ready = await this.initCollections();
    if (ready) {
      this.loadDashboard();
    } else {
      this.setData({ loading: false });
    }
  },

  refreshActiveScopeLabel() {
    const scope = getActiveScope();
    this.setData({
      activeScopeLabel:
        scope.scopeType === "family" ? scope.scopeName || "家庭空间" : "个人空间",
    });
  },

  async initCollections() {
    try {
      await callFunction("dailyComic", { action: "init" });
      this.setData({ initError: "" });
      return true;
    } catch (err) {
      console.error("dailyComic init failed", err);
      this.setData({
        initError: "云函数尚未部署，上传和生成前请先在开发者工具中上传 dailyComic 云函数",
      });
      return false;
    }
  },

  async loadDashboard() {
    this.setData({ loading: true });
    try {
      const res = await callFunction("dailyComic", { action: "dashboard" });
      const result = res.result || {};

      this.setData({
        stats: result.stats || {
          unused: 0,
          used: 0,
          failed: 0,
        },
        ...this.buildDashboardComics(result),
        loading: false,
      });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({
        title: "数据加载失败",
        icon: "none",
      });
    }
  },

  async generateTodayComic() {
    if (this.data.generating) return;

    if (!this.data.stats || this.data.stats.unused <= 0) {
      wx.showToast({
        title: "所有照片都已生成过，请先上传新照片",
        icon: "none",
      });
      return;
    }

    this.setData({ generating: true });
    wx.showLoading({ title: "生成中" });

    try {
      const res = await callFunction("dailyComic", {
        action: "generate",
        force: true,
      });
      const result = res.result || {};

      if (result.code === "no_photo") {
        wx.showToast({
          title: "所有照片都已生成过，请先上传新照片",
          icon: "none",
        });
        return;
      }

      if (result.comicId) {
        wx.navigateTo({
          url: `/pages/comicDetail/comicDetail?id=${result.comicId}`,
        });
      }

      await this.loadDashboard();
    } catch (err) {
      wx.showToast({
        title: "生成失败，请稍后重试",
        icon: "none",
      });
    } finally {
      wx.hideLoading();
      this.setData({ generating: false });
    }
  },

  openTodayComic() {
    const comic = this.data.displayComics && this.data.displayComics[0];
    if (!comic) return;
    wx.navigateTo({
      url: `/pages/comicDetail/comicDetail?id=${comic._id}`,
    });
  },

  openComic(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;
    wx.navigateTo({
      url: `/pages/comicDetail/comicDetail?id=${id}`,
    });
  },

  buildDashboardComics(result) {
    const todayComics = this.normalizeComics(result.todayComics || []);
    const recentComics = this.normalizeComics(result.recentComics || []);
    const hasToday = todayComics.length > 0;

    return {
      todayComics,
      recentComics,
      displayComics: hasToday ? todayComics : recentComics,
      displaySectionTitle: hasToday ? "今日漫画故事" : recentComics.length ? "历史漫画故事" : "",
    };
  },

  normalizeComics(comics) {
    return (comics || []).map((comic) => ({
      ...comic,
      isGenerating: comic.status !== "ready",
      coverSrc: comic.generatedImageDisplayURL || comic.sourceDisplayURL || comic.sourceFileID,
    }));
  },

  navigateToPhotoPool() {
    wx.navigateTo({
      url: "/pages/photoPool/photoPool",
    });
  },

  navigateToHistory() {
    wx.navigateTo({
      url: "/pages/history/history",
    });
  },

  navigateToFamilySpace() {
    wx.navigateTo({
      url: "/pages/familySpace/familySpace",
    });
  },
});
