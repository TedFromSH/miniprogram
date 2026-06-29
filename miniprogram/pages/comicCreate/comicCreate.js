const { callFunction } = require("../../utils/cloud");

const STYLES = [
  {
    id: "warm_handdrawn",
    name: "温暖手绘",
    desc: "柔和线条和日常感，适合家庭与生活瞬间。",
  },
  {
    id: "healing_picturebook",
    name: "治愈绘本",
    desc: "轻盈、安静，像一本温柔的小绘本。",
  },
  {
    id: "retro_newspaper",
    name: "复古报纸",
    desc: "复古网点、纸张质感，带一点幽默感。",
  },
  {
    id: "soft_3d_cartoon",
    name: "3D 卡通",
    desc: "立体、可爱、明亮，适合轻松剧情。",
  },
  {
    id: "watercolor_fairytale",
    name: "水彩童话",
    desc: "水彩晕染和童话氛围，画面更梦幻。",
  },
  {
    id: "dark_cinematic",
    name: "暗黑电影",
    desc: "高反差光影、冷峻氛围，把日常瞬间改成悬疑感漫画。",
  },
  {
    id: "hong_kong_comic",
    name: "港漫热血",
    desc: "强烈线条、速度感和冲击力，让普通照片像热血漫画分镜。",
  },
  {
    id: "american_superhero",
    name: "美漫英雄",
    desc: "厚重勾线、鲜明色块和英雄感构图，适合夸张又明亮的故事。",
  },
];

const STORY_GUIDE_ERROR_TEXT = "剧情描述需要围绕照片漫画创作，请换成健康、日常、适合生成漫画的内容。";

Page({
  data: {
    loading: true,
    submitting: false,
    photo: null,
    styles: STYLES,
    selectedStyleId: "",
    selectedStyleDesc: "",
    storyGuide: "",
    storyGuideError: "",
    comicReadyTemplateId: "",
    subscribeConfigLoaded: false,
  },

  async onLoad() {
    await this.loadSubscribeConfig();
    this.prepareGeneration();
  },

  async loadSubscribeConfig() {
    try {
      const res = await callFunction("dailyComic", {
        action: "getSubscribeConfig",
      });
      const result = res.result || {};
      if (!result.comicReadyTemplateId) {
        console.warn("comic ready subscribe template id is not configured");
      }
      this.setData({
        comicReadyTemplateId: result.comicReadyTemplateId || "",
        subscribeConfigLoaded: true,
      });
    } catch (err) {
      console.warn("load subscribe config failed", err);
      this.setData({
        subscribeConfigLoaded: true,
      });
    }
  },

  async prepareGeneration() {
    this.setData({ loading: true });
    try {
      const res = await callFunction("dailyComic", {
        action: "prepareGeneration",
      });
      const result = res.result || {};

      if (result.code === "no_photo") {
        wx.showToast({
          title: "请先上传新照片",
          icon: "none",
        });
        this.setData({ loading: false });
        return;
      }

      if (result.code !== "ok") {
        throw new Error(result.code || "prepare failed");
      }

      this.setData({
        photo: result.photo,
        loading: false,
      });
    } catch (err) {
      console.error("prepare generation failed", err);
      this.setData({ loading: false });
      wx.showToast({
        title: "照片选择失败",
        icon: "none",
      });
    }
  },

  selectStyle(e) {
    const { id } = e.currentTarget.dataset;
    if (!id) return;
    const style = this.data.styles.find((item) => item.id === id);
    this.setData({
      selectedStyleId: id,
      selectedStyleDesc: style ? style.desc : "",
    });
  },

  onStoryGuideInput(e) {
    this.setData({
      storyGuide: e.detail.value || "",
      storyGuideError: "",
    });
  },

  async submitGeneration() {
    if (this.data.submitting) return;
    if (!this.data.photo || !this.data.photo._id) {
      wx.showToast({
        title: "还没有选中照片",
        icon: "none",
      });
      return;
    }
    if (!this.data.selectedStyleId) {
      wx.showToast({
        title: "请选择漫画风格",
        icon: "none",
      });
      return;
    }

    const notifyOnReady = await this.requestComicReadySubscribe();

    this.setData({ submitting: true });
    wx.showLoading({ title: "提交中" });

    try {
      const res = await callFunction("dailyComic", {
        action: "submitGeneration",
        photoId: this.data.photo._id,
        styleId: this.data.selectedStyleId,
        storyGuide: this.data.storyGuide,
        notifyOnReady,
      });
      const result = res.result || {};

      if (result.code === "unsafe_story_guide") {
        this.setData({
          storyGuideError: STORY_GUIDE_ERROR_TEXT,
        });
        wx.showToast({
          title: STORY_GUIDE_ERROR_TEXT,
          icon: "none",
        });
        return;
      }

      if (result.code === "missing_style") {
        wx.showToast({
          title: "请选择漫画风格",
          icon: "none",
        });
        return;
      }

      if (result.code === "moderation_unavailable") {
        wx.showToast({
          title: "内容审核暂不可用",
          icon: "none",
        });
        return;
      }

      if (result.code === "photo_unavailable" || result.code === "not_found") {
        wx.showToast({
          title: "这张照片已不可用",
          icon: "none",
        });
        await this.prepareGeneration();
        return;
      }

      if (!result.comicId) {
        throw new Error(result.code || "submit failed");
      }

      wx.redirectTo({
        url: `/pages/comicDetail/comicDetail?id=${result.comicId}`,
      });
    } catch (err) {
      console.error("submit generation failed", err);
      wx.showToast({
        title: "提交失败，请稍后重试",
        icon: "none",
      });
    } finally {
      wx.hideLoading();
      this.setData({ submitting: false });
    }
  },

  requestComicReadySubscribe() {
    const templateId = this.data.comicReadyTemplateId;
    if (!wx.requestSubscribeMessage) {
      console.warn("wx.requestSubscribeMessage is unavailable");
      return Promise.resolve(false);
    }

    if (!templateId) {
      console.warn("comic ready subscribe template id is empty");
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      wx.requestSubscribeMessage({
        tmplIds: [templateId],
        success(res) {
          resolve(res && res[templateId] === "accept");
        },
        fail(err) {
          console.warn("request comic ready subscribe failed", err);
          resolve(false);
        },
      });
    });
  },
});
