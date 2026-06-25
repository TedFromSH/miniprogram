const { callFunction, uploadFile } = require("../../utils/cloud");

Page({
  data: {
    photos: [],
    loading: true,
    uploading: false,
  },

  async onShow() {
    const ready = await this.initCollections();
    if (ready) {
      this.loadPhotos();
    }
  },

  async initCollections() {
    try {
      await callFunction("dailyComic", { action: "init" });
      return true;
    } catch (err) {
      this.setData({ loading: false });
      console.error("dailyComic init failed", err);
      wx.showToast({
        title: "请先部署云函数",
        icon: "none",
      });
      return false;
    }
  },

  async loadPhotos() {
    this.setData({ loading: true });
    try {
      const res = await callFunction("dailyComic", { action: "listPhotos" });
      const result = res.result || {};
      this.setData({
        photos: result.photos || [],
        loading: false,
      });
    } catch (err) {
      this.setData({ loading: false });
      console.error("list photos failed", err);
      wx.showToast({
        title: "照片加载失败",
        icon: "none",
      });
    }
  },

  async chooseAndUpload() {
    if (this.data.uploading) return;

    let loadingShown = false;

    try {
      const chooseRes = await wx.chooseMedia({
        count: 9,
        mediaType: ["image"],
        sourceType: ["album", "camera"],
        sizeType: ["compressed"],
      });

      if (!chooseRes.tempFiles || !chooseRes.tempFiles.length) return;

      this.setData({ uploading: true });
      wx.showLoading({ title: "上传中" });
      loadingShown = true;

      for (let i = 0; i < chooseRes.tempFiles.length; i += 1) {
        const tempFile = chooseRes.tempFiles[i];
        const extension = this.getFileExtension(tempFile.tempFilePath);
        const cloudPath = `photos/${Date.now()}-${i}-${Math.random()
          .toString(36)
          .slice(2)}.${extension}`;
        const uploadRes = await uploadFile(cloudPath, tempFile.tempFilePath);

        await callFunction("dailyComic", {
          action: "addPhoto",
          fileID: uploadRes.fileID,
        });
      }

      wx.hideLoading();
      loadingShown = false;
      wx.showToast({
        title: "上传完成",
        icon: "success",
      });
      this.loadPhotos();
    } catch (err) {
      if (loadingShown) {
        wx.hideLoading();
        loadingShown = false;
      }
      console.error("upload photos failed", err);
      wx.showToast({
        title: "上传失败",
        icon: "none",
      });
    } finally {
      this.setData({ uploading: false });
    }
  },

  getFileExtension(path) {
    const matched = String(path).match(/\.([a-zA-Z0-9]+)$/);
    return matched ? matched[1].toLowerCase() : "jpg";
  },

  confirmDelete(e) {
    const { id, status } = e.currentTarget.dataset;
    if (status === "used" || status === "processing") {
      wx.showToast({
        title: "已生成照片暂不删除",
        icon: "none",
      });
      return;
    }

    wx.showModal({
      title: "删除照片",
      content: "这张照片将从素材池移除。",
      confirmColor: "#244638",
      success: async (res) => {
        if (!res.confirm) return;
        await this.deletePhoto(id);
      },
    });
  },

  async deletePhoto(id) {
    let loadingShown = false;

    try {
      wx.showLoading({ title: "删除中" });
      loadingShown = true;
      const res = await callFunction("dailyComic", {
        action: "deletePhoto",
        photoId: id,
      });
      const result = res.result || {};
      if (result.code !== "ok") {
        throw new Error(result.code || "delete failed");
      }
      wx.hideLoading();
      loadingShown = false;
      wx.showToast({
        title: "已删除",
        icon: "success",
      });
      this.loadPhotos();
    } catch (err) {
      if (loadingShown) {
        wx.hideLoading();
        loadingShown = false;
      }
      console.error("delete photo failed", err);
      wx.showToast({
        title: "删除失败",
        icon: "none",
      });
    } finally {
      if (loadingShown) {
        wx.hideLoading();
      }
    }
  },
});
