const { callFunction } = require("../../utils/cloud");

Page({
  data: {
    comics: [],
    loading: true,
  },

  onShow() {
    this.loadComics();
  },

  async loadComics() {
    this.setData({ loading: true });
    try {
      const res = await callFunction("dailyComic", { action: "listComics" });
      const result = res.result || {};
      this.setData({
        comics: (result.comics || []).map((comic) => ({
          ...comic,
          isGenerating: comic.status !== "ready",
          coverSrc: comic.generatedImageDisplayURL || comic.sourceDisplayURL || comic.sourceFileID,
        })),
        loading: false,
      });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({
        title: "历史加载失败",
        icon: "none",
      });
    }
  },

  openComic(e) {
    const { id } = e.currentTarget.dataset;
    wx.navigateTo({
      url: `/pages/comicDetail/comicDetail?id=${id}`,
    });
  },
});
