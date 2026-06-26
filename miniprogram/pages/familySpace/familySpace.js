const { callFunction, getActiveScope, setActiveScope } = require("../../utils/cloud");

Page({
  data: {
    loading: true,
    creating: false,
    families: [],
    activeScope: {
      scopeType: "personal",
      scopeId: "",
      scopeName: "",
    },
    familyName: "",
  },

  onShow() {
    this.loadFamilies();
  },

  async loadFamilies() {
    this.setData({
      loading: true,
      activeScope: getActiveScope(),
    });

    try {
      const res = await callFunction("dailyComic", { action: "listFamilies" });
      const result = res.result || {};
      const families = result.families || [];
      const activeScope = this.normalizeActiveScope(getActiveScope(), families);

      this.setData({
        families,
        activeScope,
        loading: false,
      });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({
        title: "家庭空间加载失败",
        icon: "none",
      });
    }
  },

  normalizeActiveScope(activeScope, families) {
    if (!activeScope || activeScope.scopeType !== "family") {
      return {
        scopeType: "personal",
        scopeId: "",
        scopeName: "",
      };
    }

    const matched = families.find((family) => family._id === activeScope.scopeId);
    if (!matched) {
      setActiveScope(null);
      return {
        scopeType: "personal",
        scopeId: "",
        scopeName: "",
      };
    }

    const nextScope = {
      scopeType: "family",
      scopeId: matched._id,
      scopeName: matched.name,
    };
    setActiveScope(nextScope);
    return nextScope;
  },

  onFamilyNameInput(e) {
    this.setData({
      familyName: e.detail.value,
    });
  },

  async createFamily() {
    if (this.data.creating) return;

    this.setData({ creating: true });
    wx.showLoading({ title: "创建中" });

    try {
      const res = await callFunction("dailyComic", {
        action: "createFamily",
        name: this.data.familyName,
      });
      const result = res.result || {};
      if (result.code !== "ok" || !result.family) {
        throw new Error(result.code || "create failed");
      }

      setActiveScope({
        scopeType: "family",
        scopeId: result.family._id,
        scopeName: result.family.name,
      });

      this.setData({
        familyName: "",
      });
      await this.loadFamilies();
      wx.showToast({
        title: "已切换到家庭",
        icon: "success",
      });
    } catch (err) {
      wx.showToast({
        title: "创建失败",
        icon: "none",
      });
    } finally {
      wx.hideLoading();
      this.setData({ creating: false });
    }
  },

  switchToPersonal() {
    setActiveScope(null);
    this.setData({
      activeScope: getActiveScope(),
    });
    wx.showToast({
      title: "已切换到个人",
      icon: "success",
    });
  },

  switchToFamily(e) {
    const { id } = e.currentTarget.dataset;
    const family = this.data.families.find((item) => item._id === id);
    if (!family) return;

    setActiveScope({
      scopeType: "family",
      scopeId: family._id,
      scopeName: family.name,
    });

    this.setData({
      activeScope: getActiveScope(),
    });
    wx.showToast({
      title: "已切换到家庭",
      icon: "success",
    });
  },

  backHome() {
    wx.navigateBack({
      delta: 1,
      fail() {
        wx.redirectTo({
          url: "/pages/index/index",
        });
      },
    });
  },
});
