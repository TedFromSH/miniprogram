// app.js

const { CLOUD_ENV } = require("./utils/cloud");

App({
  onLaunch: function () {
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        // 当前小程序云开发环境：first-weixin
        env: CLOUD_ENV,
        traceUser: true,
      });
      console.info("wx.cloud initialized with env:", CLOUD_ENV);
    }
  },
});
