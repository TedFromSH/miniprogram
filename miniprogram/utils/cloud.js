const CLOUD_ENV = "first-weixin-d0grdrujrf2e58e71";

function callFunction(name, data) {
  return wx.cloud.callFunction({
    name,
    data,
    config: {
      env: CLOUD_ENV,
    },
  });
}

function uploadFile(cloudPath, filePath) {
  return wx.cloud.uploadFile({
    cloudPath,
    filePath,
    config: {
      env: CLOUD_ENV,
    },
  });
}

module.exports = {
  CLOUD_ENV,
  callFunction,
  uploadFile,
};
