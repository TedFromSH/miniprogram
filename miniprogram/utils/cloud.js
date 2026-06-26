const CLOUD_ENV = "first-weixin-d0grdrujrf2e58e71";
const ACTIVE_SCOPE_STORAGE_KEY = "activeDataScope";

function callFunction(name, data) {
  return wx.cloud.callFunction({
    name,
    data: {
      ...getActiveScopePayload(),
      ...(data || {}),
    },
    config: {
      env: CLOUD_ENV,
    },
  });
}

function getActiveScopePayload() {
  const scope = getActiveScope();

  if (scope.scopeType !== "family" || !scope.scopeId) {
    return {};
  }

  return {
    scopeType: "family",
    scopeId: scope.scopeId,
  };
}

function getActiveScope() {
  let scope;

  try {
    scope = wx.getStorageSync(ACTIVE_SCOPE_STORAGE_KEY);
  } catch (err) {
    scope = null;
  }

  if (!scope || scope.scopeType !== "family" || !scope.scopeId) {
    return {
      scopeType: "personal",
      scopeId: "",
    };
  }

  return {
    scopeType: "family",
    scopeId: scope.scopeId,
    scopeName: scope.scopeName || "",
  };
}

function setActiveScope(scope) {
  if (scope && scope.scopeType === "family" && scope.scopeId) {
    wx.setStorageSync(ACTIVE_SCOPE_STORAGE_KEY, {
      scopeType: "family",
      scopeId: scope.scopeId,
      scopeName: scope.scopeName || "",
    });
    return;
  }

  wx.removeStorageSync(ACTIVE_SCOPE_STORAGE_KEY);
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
  getActiveScope,
  getActiveScopePayload,
  setActiveScope,
};
