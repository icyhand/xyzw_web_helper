import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { useLocalTokenStore } from "./localTokenManager";

const API_BASE = import.meta.env.VITE_API_URL || "";

async function apiRequest(endpoint, options = {}) {
  const token = localStorage.getItem("token");
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });
    return await response.json();
  } catch (error) {
    console.error("API请求失败:", error);
    return { success: false, message: "网络请求失败，请检查服务器是否启动" };
  }
}

export const useAuthStore = defineStore("auth", () => {
  const user = ref(null);
  const token = ref(localStorage.getItem("token") || null);
  const isLoading = ref(false);

  const localTokenStore = useLocalTokenStore();

  const isAuthenticated = computed(() => !!token.value && !!user.value);
  const userInfo = computed(() => user.value);

  const login = async (credentials) => {
    try {
      isLoading.value = true;

      const { username, password } = credentials;

      if (!username || !password) {
        return { success: false, message: "请输入用户名和密码" };
      }

      const result = await apiRequest("/api/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });

      if (!result.success) {
        return result;
      }

      token.value = result.data.token;
      user.value = result.data.user;

      localStorage.setItem("token", result.data.token);
      localStorage.setItem("user", JSON.stringify(result.data.user));

      localTokenStore.setUserToken(result.data.token);
      try {
        const { useTokenStore } = await import("@/stores/tokenStore");
        const tokenStore = useTokenStore();
        await tokenStore.syncTokensFromServer();
      } catch (syncError) {
        console.warn("登录后拉取云端Token失败:", syncError);
      }

      return { success: true };
    } catch (error) {
      console.error("登录错误:", error);
      return { success: false, message: "登录失败: " + error.message };
    } finally {
      isLoading.value = false;
    }
  };

  const register = async (userInfo) => {
    try {
      isLoading.value = true;

      const { username, password } = userInfo;

      if (!username || !password) {
        return { success: false, message: "请输入用户名和密码" };
      }

      const result = await apiRequest("/api/register", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });

      return result;
    } catch (error) {
      console.error("注册错误:", error);
      return { success: false, message: "注册失败: " + error.message };
    } finally {
      isLoading.value = false;
    }
  };

  const logout = async () => {
    try {
      await apiRequest("/api/logout", { method: "POST" });
    } catch (e) {
      console.warn("登出请求失败:", e);
    }

    user.value = null;
    token.value = null;

    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("gameRoles");

    localTokenStore.clearUserToken();
    localTokenStore.clearAllGameTokens();
  };

  const fetchUserInfo = async () => {
    try {
      if (!token.value) return false;

      const result = await apiRequest("/api/user");

      if (result.success) {
        user.value = result.data;
        localStorage.setItem("user", JSON.stringify(result.data));
        return true;
      } else {
        logout();
        return false;
      }
    } catch (error) {
      console.error("获取用户信息失败:", error);
      logout();
      return false;
    }
  };

  const initAuth = async () => {
    const savedToken = localStorage.getItem("token");
    const savedUser = localStorage.getItem("user");

    if (savedToken && savedUser) {
      token.value = savedToken;
      try {
        user.value = JSON.parse(savedUser);
        localTokenStore.initTokenManager();

        fetchUserInfo();
        try {
          const { useTokenStore } = await import("@/stores/tokenStore");
          const tokenStore = useTokenStore();
          await tokenStore.syncTokensFromServer();
        } catch (syncError) {
          console.warn("初始化时拉取云端Token失败:", syncError);
        }
      } catch (error) {
        console.error("初始化认证失败:", error);
        logout();
      }
    }
  };

  return {
    user,
    token,
    isLoading,

    isAuthenticated,
    userInfo,

    login,
    register,
    logout,
    fetchUserInfo,
    initAuth,
  };
});

export { apiRequest };
