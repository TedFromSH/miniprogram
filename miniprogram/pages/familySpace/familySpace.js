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
    activeFamily: null,
    familyName: "",
    invitePreparing: false,
    inviteShare: null,
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
        activeFamily: this.getActiveFamily(activeScope, families),
        inviteShare: null,
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
      activeFamily: null,
      inviteShare: null,
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
      activeFamily: family,
      inviteShare: null,
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

  getActiveFamily(activeScope, families) {
    if (!activeScope || activeScope.scopeType !== "family") return null;
    return (families || []).find((family) => family._id === activeScope.scopeId) || null;
  },

  async prepareFamilyInvite() {
    const family = this.data.activeFamily;
    if (!family || family.role !== "owner" || this.data.invitePreparing) return;

    this.setData({ invitePreparing: true });
    wx.showLoading({ title: "生成中" });

    try {
      const res = await callFunction("dailyComic", {
        action: "createFamilyInvite",
        familyId: family._id,
      });
      const result = res.result || {};
      if (result.code !== "ok" || !result.invite) {
        throw new Error(result.code || "invite failed");
      }

      this.setData({
        inviteShare: {
          title: `邀请你加入「${result.invite.familyName}」`,
          path: `/pages/familyInvite/familyInvite?token=${result.invite.token}`,
        },
      });

      wx.showToast({
        title: "邀请卡片已生成",
        icon: "success",
      });
    } catch (err) {
      wx.showToast({
        title: "邀请生成失败",
        icon: "none",
      });
    } finally {
      wx.hideLoading();
      this.setData({ invitePreparing: false });
    }
  },

  onShareAppMessage(options = {}) {
    if (options.from === "button" && this.data.inviteShare) {
      return this.data.inviteShare;
    }

    return {
      title: "生活瞬间",
      path: "/pages/index/index",
    };
  },
});
