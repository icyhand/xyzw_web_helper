import { ref, type Ref } from "vue";

const API_BASE = import.meta.env.VITE_API_URL || "";

interface StorageItem {
  data: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, any>;
}

interface UseIndexedDBReturn {
  isReady: Ref<boolean>;
  error: Ref<string | null>;
  storeArrayBuffer: (
    key: string,
    data: ArrayBuffer,
    metadata?: Record<string, any>,
  ) => Promise<boolean>;
  getArrayBuffer: (key: string) => Promise<ArrayBuffer | null>;
  getAllKeys: () => Promise<string[]>;
  deleteArrayBuffer: (key: string) => Promise<boolean>;
  clearAll: () => Promise<boolean>;
  getStorageInfo: () => Promise<{ totalSize: number; keyCount: number }>;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    chunks.push(String.fromCharCode(...chunk));
  }
  return btoa(chunks.join(""));
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiRequest(endpoint: string, options: RequestInit = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...getAuthHeaders(),
    ...(options.headers as Record<string, string>),
  };

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });
    return await response.json();
  } catch (error) {
    console.error("API请求失败:", error);
    return { success: false, message: "网络请求失败" };
  }
}

let cachedBins: Record<string, StorageItem> | null = null;

async function fetchAllBins(): Promise<Record<string, StorageItem>> {
  if (cachedBins !== null) {
    return cachedBins;
  }

  const token = localStorage.getItem("token");
  if (!token) {
    return {};
  }

  const result = await apiRequest("/api/bins");
  if (result.success) {
    cachedBins = result.data || {};
    return cachedBins;
  }
  return {};
}

async function saveBinToServer(key: string, item: StorageItem): Promise<boolean> {
  const result = await apiRequest(`/api/bins/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify({ data: item.data, metadata: item.metadata }),
  });

  if (result.success && cachedBins) {
    cachedBins[key] = item;
  }

  return result.success;
}

async function deleteBinFromServer(key: string): Promise<boolean> {
  const result = await apiRequest(`/api/bins/${encodeURIComponent(key)}`, {
    method: "DELETE",
  });

  if (result.success && cachedBins) {
    delete cachedBins[key];
  }

  return result.success;
}

/**
 * Server-based bin storage with API backend.
 * Falls back to localStorage when not logged in.
 */
export function useIndexedDB(_config: any = {}): UseIndexedDBReturn {
  const isReady = ref(true);
  const error = ref<string | null>(null);

  const storeArrayBuffer = async (
    key: string,
    data: ArrayBuffer,
    metadata?: Record<string, any>,
  ): Promise<boolean> => {
    try {
      const token = localStorage.getItem("token");

      const item: StorageItem = {
        data: arrayBufferToBase64(data),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata,
      };

      if (token) {
        const success = await saveBinToServer(key, item);
        if (success) {
          console.log(`✅ ArrayBuffer 存储成功 (服务器)，键: ${key}, 大小: ${data.byteLength} 字节`);
          return true;
        }
      }

      const localKey = "xyzw_bin_storage";
      const storage = JSON.parse(localStorage.getItem(localKey) || "{}");
      storage[key] = item;
      localStorage.setItem(localKey, JSON.stringify(storage));
      console.log(`✅ ArrayBuffer 存储成功 (本地)，键: ${key}, 大小: ${data.byteLength} 字节`);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      error.value = `存储数据失败: ${msg}`;
      console.error("❌ 存储 ArrayBuffer 错误:", err);
      return false;
    }
  };

  const getArrayBuffer = async (key: string): Promise<ArrayBuffer | null> => {
    try {
      const token = localStorage.getItem("token");

      if (token) {
        const bins = await fetchAllBins();
        const item = bins[key];
        if (item) {
          const buffer = base64ToArrayBuffer(item.data);
          console.log(`✅ ArrayBuffer 读取成功 (服务器)，键: ${key}, 大小: ${buffer.byteLength} 字节`);
          return buffer;
        }
      }

      const localKey = "xyzw_bin_storage";
      const storage = JSON.parse(localStorage.getItem(localKey) || "{}");
      const localItem = storage[key];
      if (localItem) {
        const buffer = base64ToArrayBuffer(localItem.data);
        console.log(`✅ ArrayBuffer 读取成功 (本地)，键: ${key}, 大小: ${buffer.byteLength} 字节`);
        return buffer;
      }

      console.warn(`⚠️ 未找到键为 "${key}" 的数据`);
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      error.value = `读取数据失败: ${msg}`;
      console.error("❌ 读取 ArrayBuffer 错误:", err);
      return null;
    }
  };

  const getAllKeys = async (): Promise<string[]> => {
    try {
      const token = localStorage.getItem("token");
      const keys = new Set<string>();

      if (token) {
        const bins = await fetchAllBins();
        Object.keys(bins).forEach((k) => keys.add(k));
      }

      const localKey = "xyzw_bin_storage";
      const storage = JSON.parse(localStorage.getItem(localKey) || "{}");
      Object.keys(storage).forEach((k) => keys.add(k));

      return Array.from(keys);
    } catch {
      return [];
    }
  };

  const deleteArrayBuffer = async (key: string): Promise<boolean> => {
    try {
      const token = localStorage.getItem("token");

      if (token) {
        await deleteBinFromServer(key);
      }

      const localKey = "xyzw_bin_storage";
      const storage = JSON.parse(localStorage.getItem(localKey) || "{}");
      delete storage[key];
      localStorage.setItem(localKey, JSON.stringify(storage));

      console.log(`✅ ArrayBuffer 删除成功，键: ${key}`);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      error.value = `删除数据失败: ${msg}`;
      console.error("❌ 删除 ArrayBuffer 错误:", err);
      return false;
    }
  };

  const clearAll = async (): Promise<boolean> => {
    try {
      cachedBins = null;
      localStorage.removeItem("xyzw_bin_storage");
      console.log("✅ 所有 ArrayBuffer 数据已清空");
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      error.value = `清空数据失败: ${msg}`;
      console.error("❌ 清空数据错误:", err);
      return false;
    }
  };

  const getStorageInfo = async (): Promise<{ totalSize: number; keyCount: number }> => {
    try {
      const keys = await getAllKeys();
      let totalSize = 0;

      for (const key of keys) {
        const buffer = await getArrayBuffer(key);
        if (buffer) {
          totalSize += buffer.byteLength;
        }
      }

      return { totalSize, keyCount: keys.length };
    } catch {
      return { totalSize: 0, keyCount: 0 };
    }
  };

  return {
    isReady,
    error,
    storeArrayBuffer,
    getArrayBuffer,
    getAllKeys,
    deleteArrayBuffer,
    clearAll,
    getStorageInfo,
  };
}

export function clearBinCache() {
  cachedBins = null;
}

export default useIndexedDB;
