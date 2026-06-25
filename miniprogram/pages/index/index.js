const { callFunction } = require("../../utils/cloud");

Page({
  data: {
    loading: true,
    generating: false,
    stats: {
      unused: 0,
      used: 0,
      failed: 0,
    },
    todayComic: null,
    latestComic: null,
    initError: "",
  },

  async onShow() {
    const ready = await this.initCollections();
    if (ready) {
      this.loadDashboard();
    } else {
      this.setData({ loading: false });
    }
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
        todayComic: result.todayComic || null,
        latestComic: result.latestComic || null,
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
          title: "照片池空了",
          icon: "none",
        });
        this.navigateToPhotoPool();
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
    const comic = this.data.todayComic || this.data.latestComic;
    if (!comic) return;
    wx.navigateTo({
      url: `/pages/comicDetail/comicDetail?id=${comic._id}`,
    });
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
});
