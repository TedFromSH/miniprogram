const db = wx.cloud.database();

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
    await this.initCollections();
    this.loadDashboard();
  },

  async initCollections() {
    try {
      await wx.cloud.callFunction({
        name: "dailyComic",
        data: { action: "init" },
      });
    } catch (err) {
      this.setData({
        initError: "云函数尚未部署，上传和生成前请先在开发者工具中上传 dailyComic 云函数",
      });
    }
  },

  async loadDashboard() {
    this.setData({ loading: true });
    try {
      const [unused, used, failed, todayComic, latestComic] = await Promise.all([
        this.countPhotos("unused"),
        this.countPhotos("used"),
        this.countPhotos("failed"),
        this.fetchTodayComic(),
        this.fetchLatestComic(),
      ]);

      this.setData({
        stats: {
          unused,
          used,
          failed,
        },
        todayComic,
        latestComic,
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

  async countPhotos(status) {
    const res = await db.collection("photos").where({ status }).count();
    return res.total || 0;
  },

  async fetchTodayComic() {
    const date = this.getTodayKey();
    const res = await db
      .collection("comics")
      .where({ date, status: "ready" })
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();
    return res.data[0] || null;
  },

  async fetchLatestComic() {
    const res = await db
      .collection("comics")
      .where({ status: "ready" })
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();
    return res.data[0] || null;
  },

  getTodayKey() {
    const now = new Date();
    const year = now.getFullYear();
    const month = `${now.getMonth() + 1}`.padStart(2, "0");
    const day = `${now.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
  },

  async generateTodayComic() {
    if (this.data.generating) return;

    this.setData({ generating: true });
    wx.showLoading({ title: "生成中" });

    try {
      const res = await wx.cloud.callFunction({
        name: "dailyComic",
        data: { action: "generate" },
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
