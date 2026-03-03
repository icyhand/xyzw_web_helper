import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3100;

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const TOKENS_FILE = path.join(DATA_DIR, "tokens.json");
const BINS_FILE = path.join(DATA_DIR, "bins.json");
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "15198666";

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJSON(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {};
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function ensureAdminAccount() {
  const users = readJSON(USERS_FILE);
  let changed = false;

  // 兼容旧数据：补齐 role 字段
  Object.keys(users).forEach((username) => {
    if (!users[username].role) {
      users[username].role = username === ADMIN_USERNAME ? "admin" : "user";
      changed = true;
    }
  });

  if (!users[ADMIN_USERNAME]) {
    users[ADMIN_USERNAME] = {
      id: "user_admin",
      username: ADMIN_USERNAME,
      passwordHash: hashPassword(ADMIN_PASSWORD),
      createdAt: new Date().toISOString(),
      sessionToken: null,
      role: "admin",
    };
    changed = true;
    console.log("✅ 已创建默认管理员账号: admin");
  } else {
    // 确保管理员角色与密码与配置一致
    const admin = users[ADMIN_USERNAME];
    const targetHash = hashPassword(ADMIN_PASSWORD);
    if (admin.role !== "admin" || admin.passwordHash !== targetHash) {
      admin.role = "admin";
      admin.passwordHash = targetHash;
      changed = true;
      console.log("✅ 已更新管理员账号配置");
    }
  }

  if (changed) {
    writeJSON(USERS_FILE, users);
  }
}

app.use(cors());
app.use(express.json({ limit: "50mb" }));

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, message: "未登录" });
  }
  const token = authHeader.slice(7);
  const users = readJSON(USERS_FILE);
  const user = Object.values(users).find((u) => u.sessionToken === token);
  if (!user) {
    return res.status(401).json({ success: false, message: "登录已过期" });
  }
  req.user = user;
  next();
}

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "需要管理员权限" });
  }
  next();
}

app.post("/api/register", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.json({ success: false, message: "请输入用户名和密码" });
  }
  if (username.length < 2 || username.length > 20) {
    return res.json({ success: false, message: "用户名长度应在2-20个字符之间" });
  }
  if (password.length < 6) {
    return res.json({ success: false, message: "密码长度不能少于6位" });
  }

  const users = readJSON(USERS_FILE);

  if (users[username]) {
    return res.json({ success: false, message: "用户名已存在" });
  }

  const userId = "user_" + Date.now() + "_" + crypto.randomBytes(4).toString("hex");
  users[username] = {
    id: userId,
    username,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString(),
    sessionToken: null,
    role: "user",
  };

  writeJSON(USERS_FILE, users);
  console.log(`✅ 用户注册成功: ${username}`);

  res.json({ success: true, message: "注册成功，请登录" });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.json({ success: false, message: "请输入用户名和密码" });
  }

  const users = readJSON(USERS_FILE);
  const user = users[username];

  if (!user) {
    return res.json({ success: false, message: "用户名不存在" });
  }

  if (user.passwordHash !== hashPassword(password)) {
    return res.json({ success: false, message: "密码错误" });
  }

  const sessionToken = generateToken();
  user.sessionToken = sessionToken;
  user.lastLoginAt = new Date().toISOString();
  writeJSON(USERS_FILE, users);

  console.log(`✅ 用户登录成功: ${username}`);

  res.json({
    success: true,
    data: {
      token: sessionToken,
      user: {
        id: user.id,
        username: user.username,
        createdAt: user.createdAt,
        role: user.role || "user",
      },
    },
  });
});

app.post("/api/logout", authMiddleware, (req, res) => {
  const users = readJSON(USERS_FILE);
  if (users[req.user.username]) {
    users[req.user.username].sessionToken = null;
    writeJSON(USERS_FILE, users);
  }
  res.json({ success: true });
});

app.get("/api/user", authMiddleware, (req, res) => {
  res.json({
    success: true,
    data: {
      id: req.user.id,
      username: req.user.username,
      createdAt: req.user.createdAt,
      role: req.user.role || "user",
    },
  });
});

app.get("/api/tokens", authMiddleware, (req, res) => {
  const allTokens = readJSON(TOKENS_FILE);
  const userTokens = allTokens[req.user.id] || [];
  res.json({ success: true, data: userTokens });
});

app.post("/api/tokens", authMiddleware, (req, res) => {
  const { tokens } = req.body;
  const allTokens = readJSON(TOKENS_FILE);
  allTokens[req.user.id] = tokens;
  writeJSON(TOKENS_FILE, allTokens);
  res.json({ success: true });
});

// 管理员：查看所有用户
app.get("/api/admin/users", authMiddleware, adminOnly, (req, res) => {
  const users = readJSON(USERS_FILE);
  const list = Object.values(users).map((u) => ({
    id: u.id,
    username: u.username,
    role: u.role || "user",
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt || null,
  }));
  res.json({ success: true, data: list });
});

// 管理员：查看所有用户的 token
app.get("/api/admin/tokens", authMiddleware, adminOnly, (req, res) => {
  const allTokens = readJSON(TOKENS_FILE);
  res.json({ success: true, data: allTokens });
});

// 管理员：查看指定用户 token
app.get("/api/admin/tokens/:userId", authMiddleware, adminOnly, (req, res) => {
  const allTokens = readJSON(TOKENS_FILE);
  res.json({ success: true, data: allTokens[req.params.userId] || [] });
});

// 管理员：覆盖指定用户 token
app.put("/api/admin/tokens/:userId", authMiddleware, adminOnly, (req, res) => {
  const { tokens } = req.body;
  if (!Array.isArray(tokens)) {
    return res.status(400).json({ success: false, message: "tokens 必须是数组" });
  }
  const allTokens = readJSON(TOKENS_FILE);
  allTokens[req.params.userId] = tokens;
  writeJSON(TOKENS_FILE, allTokens);
  res.json({ success: true });
});

// 管理员：清空指定用户 token
app.delete("/api/admin/tokens/:userId", authMiddleware, adminOnly, (req, res) => {
  const allTokens = readJSON(TOKENS_FILE);
  delete allTokens[req.params.userId];
  writeJSON(TOKENS_FILE, allTokens);
  res.json({ success: true });
});

app.get("/api/bins", authMiddleware, (req, res) => {
  const allBins = readJSON(BINS_FILE);
  const userBins = allBins[req.user.id] || {};
  res.json({ success: true, data: userBins });
});

app.post("/api/bins", authMiddleware, (req, res) => {
  const { bins } = req.body;
  const allBins = readJSON(BINS_FILE);
  allBins[req.user.id] = bins;
  writeJSON(BINS_FILE, allBins);
  res.json({ success: true });
});

app.get("/api/bins/:key", authMiddleware, (req, res) => {
  const allBins = readJSON(BINS_FILE);
  const userBins = allBins[req.user.id] || {};
  const bin = userBins[req.params.key];
  if (!bin) {
    return res.json({ success: false, message: "未找到" });
  }
  res.json({ success: true, data: bin });
});

app.put("/api/bins/:key", authMiddleware, (req, res) => {
  const { data, metadata } = req.body;
  const allBins = readJSON(BINS_FILE);
  if (!allBins[req.user.id]) {
    allBins[req.user.id] = {};
  }
  allBins[req.user.id][req.params.key] = {
    data,
    metadata,
    createdAt: allBins[req.user.id][req.params.key]?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeJSON(BINS_FILE, allBins);
  res.json({ success: true });
});

app.delete("/api/bins/:key", authMiddleware, (req, res) => {
  const allBins = readJSON(BINS_FILE);
  if (allBins[req.user.id]) {
    delete allBins[req.user.id][req.params.key];
    writeJSON(BINS_FILE, allBins);
  }
  res.json({ success: true });
});

ensureAdminAccount();
app.listen(PORT, () => {
  console.log(`🚀 XYZW API Server running at http://localhost:${PORT}`);
  console.log(`📁 Data directory: ${DATA_DIR}`);
});
