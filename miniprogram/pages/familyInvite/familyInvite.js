const { callFunction, setActiveScope } = require("../../utils/cloud");

Page({
  data: {
    loading: true,
    joining: false,
    token: "",
    invite: null,
    isMember: false,
    errorText: "",
  },

  onLoad(options = {}) {
    const token = options.token || "";
    this.setData({ token });
    this.loadInvite(token);
  },

  async loadInvite(token) {
    if (!token) {
      this.setData({
        loading: false,
        errorText: "邀请链接无效",
      });
      return;
    }

    this.setData({ loading: true, errorText: "" });

    try {
      const res = await callFunction("dailyComic", {
        action: "getFamilyInvite",
        token,
      });
      const result = res.result || {};
      if (result.code !== "ok") {
        throw new Error(result.code || "invite invalid");
      }

      this.setData({
        invite: result.invite || null,
        isMember: Boolean(result.isMember),
        loading: false,
      });
    } catch (err) {
      this.setData({
        loading: false,
        errorText: this.getInviteErrorText(err && err.message),
      });
    }
  },

  getInviteErrorText(code) {
    if (code === "invite_expired") return "邀请已过期";
    if (code === "invite_not_found") return "邀请不存在或已失效";
    if (code === "family_not_found") return "家庭空间已不可用";
    return "邀请链接无效";
  },

  async joinFamily() {
    if (this.data.joining || !this.data.token) return;

    this.setData({ joining: true });
    wx.showLoading({ title: "加入中" });

    try {
      const res = await callFunction("dailyComic", {
        action: "joinFamilyInvite",
        token: this.data.token,
      });
      const result = res.result || {};
      if (result.code !== "ok" || !result.family) {
        throw new Error(result.code || "join failed");
      }

      setActiveScope({
        scopeType: "family",
        scopeId: result.family._id,
        scopeName: result.family.name,
      });

      wx.showToast({
        title: result.alreadyMember ? "已在家庭中" : "加入成功",
        icon: "success",
      });

      setTimeout(() => {
        wx.redirectTo({
          url: "/pages/index/index",
        });
      }, 500);
    } catch (err) {
      wx.showToast({
        title: this.getInviteErrorText(err && err.message),
        icon: "none",
      });
    } finally {
      wx.hideLoading();
      this.setData({ joining: false });
    }
  },

  backHome() {
    wx.redirectTo({
      url: "/pages/index/index",
    });
  },
});
