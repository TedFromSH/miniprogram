const db = wx.cloud.database();

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
      const res = await db
        .collection("comics")
        .where({ status: "ready" })
        .orderBy("createdAt", "desc")
        .limit(50)
        .get();
      this.setData({
        comics: res.data || [],
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
