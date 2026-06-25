const db = wx.cloud.database();

Page({
  data: {
    photos: [],
    loading: true,
    uploading: false,
  },

  async onShow() {
    await this.initCollections();
    this.loadPhotos();
  },

  async initCollections() {
    try {
      await wx.cloud.callFunction({
        name: "dailyComic",
        data: { action: "init" },
      });
    } catch (err) {
      wx.showToast({
        title: "请先部署云函数",
        icon: "none",
      });
    }
  },

  async loadPhotos() {
    this.setData({ loading: true });
    try {
      const res = await db
        .collection("photos")
        .orderBy("createdAt", "desc")
        .limit(80)
        .get();
      this.setData({
        photos: res.data || [],
        loading: false,
      });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({
        title: "照片加载失败",
        icon: "none",
      });
    }
  },

  async chooseAndUpload() {
    if (this.data.uploading) return;

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

      for (let i = 0; i < chooseRes.tempFiles.length; i += 1) {
        const tempFile = chooseRes.tempFiles[i];
        const extension = this.getFileExtension(tempFile.tempFilePath);
        const cloudPath = `photos/${Date.now()}-${i}-${Math.random()
          .toString(36)
          .slice(2)}.${extension}`;
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath,
          filePath: tempFile.tempFilePath,
        });

        await db.collection("photos").add({
          data: {
            fileID: uploadRes.fileID,
            status: "unused",
            source: "manual_batch",
            createdAt: db.serverDate(),
            uploadedAt: db.serverDate(),
            usedAt: null,
            comicId: "",
          },
        });
      }

      wx.showToast({
        title: "上传完成",
        icon: "success",
      });
      this.loadPhotos();
    } catch (err) {
      wx.showToast({
        title: "上传失败",
        icon: "none",
      });
    } finally {
      wx.hideLoading();
      this.setData({ uploading: false });
    }
  },

  getFileExtension(path) {
    const matched = String(path).match(/\.([a-zA-Z0-9]+)$/);
    return matched ? matched[1].toLowerCase() : "jpg";
  },

  confirmDelete(e) {
    const { id, fileid, status } = e.currentTarget.dataset;
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
        await this.deletePhoto(id, fileid);
      },
    });
  },

  async deletePhoto(id, fileID) {
    try {
      wx.showLoading({ title: "删除中" });
      await db.collection("photos").doc(id).remove();
      if (fileID) {
        await wx.cloud.deleteFile({
          fileList: [fileID],
        });
      }
      wx.showToast({
        title: "已删除",
        icon: "success",
      });
      this.loadPhotos();
    } catch (err) {
      wx.showToast({
        title: "删除失败",
        icon: "none",
      });
    } finally {
      wx.hideLoading();
    }
  },
});
