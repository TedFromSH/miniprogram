const db = wx.cloud.database();

Page({
  data: {
    comic: null,
    loading: true,
  },

  onLoad(options) {
    if (!options.id) {
      wx.showToast({
        title: "缺少漫画 ID",
        icon: "none",
      });
      return;
    }
    this.loadComic(options.id);
  },

  async loadComic(id) {
    this.setData({ loading: true });
    try {
      const res = await db.collection("comics").doc(id).get();
      this.setData({
        comic: res.data,
        loading: false,
      });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({
        title: "内容加载失败",
        icon: "none",
      });
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
