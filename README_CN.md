# Gallery Picker

**简体中文 | [English](README.md)**

一款轻量级、基于浏览器的照片筛选工具，运行于 Android 手机的 Termux 环境中。

专为需要使用智能手机拍摄大量样张的专业摄影评测人员设计。通过 Mac 浏览器远程浏览 Android 手机中的照片，快速标记心仪的照片，并批量下载原图。

## 功能特性

- 📸 响应式缩略图网格，轻松浏览数千张照片
- ⌨️ 键盘驱动的高效筛片工作流
- ❤️ 一键标记/取消标记喜爱照片，即时持久化存储
- ✅ 点击选择照片，Shift+点击批量范围选择
- 📅 按日期分组显示缩略图，支持按日期全选
- 📦 下载选中或已标记喜爱的原始照片
- 🔍 支持按等效焦距、人像模式等 EXIF 信息筛选（小米/Redmi/POCO）
- 🔄 智能缩略图缓存（长边 1024px）
- 🔒 4 位数访问密钥 — 首次启动自动生成并持久化保存，浏览器通过 localStorage 记忆
- 📱 完全在 Termux 内运行 — 无需 root，无需 Android Studio
- 🖥️ 为 Mac 桌面浏览器体验优化

## 安装（一条命令）

打开 Termux，粘贴以下命令：

```bash
curl -fsSL https://raw.githubusercontent.com/EdwardKot/gallerypicker-release/main/bootstrap.sh | bash
```

安装脚本会自动完成以下步骤：
1. 安装所有系统依赖和 Python 依赖
2. 申请 Android 存储权限（弹出提示时请点击**允许**）
3. 克隆项目代码
4. 注册 `gallery` 快捷命令到 shell

> ⚠️ **请勿**运行 `pip install --upgrade pip`。Termux 自行管理 Python 环境，手动升级 pip 可能会导致环境损坏。

## 日常使用

安装完成后，只需在 Termux 中输入：

```bash
gallery
```

会出现一个菜单：

```
  ╔══════════════════════════════╗
  ║       Gallery Picker         ║
  ╚══════════════════════════════╝

    1) 启动服务
    2) 更新到最新版本
    3) 退出
```

选择 **1** 启动服务。终端会显示如下信息：

```
============================================================
  Gallery Picker
============================================================
  Photo root : /storage/emulated/0/DCIM/Camera
  Access URL : http://192.168.1.157:8787
  访问密钥   : 3847
============================================================
```

在同一 Wi-Fi 下的任意设备上打开 **Access URL**。浏览器会弹出密钥输入框 — 输入终端中显示的 4 位数字即可。浏览器会通过 localStorage 记住密钥，每台设备只需输入一次。

按 `Ctrl+C` 停止服务，然后按任意键返回菜单。

## 工作流程

1. 启动服务（`gallery` → 1）
2. 在 Mac 浏览器中打开 Access URL，输入一次访问密钥
3. 浏览缩略图网格
4. **单击** 聚焦照片，**双击** 打开大图查看器
5. 快捷键：
   - `←` `→` `↑` `↓` — 网格导航
   - `空格` — 打开/关闭查看器
   - `1` — 标记喜爱
   - `0` — 取消喜爱
   - `D` — 下载当前照片（查看器中）
   - `Esc` / `空格` — 关闭查看器
6. 按 全部 / 已喜爱 筛选照片
7. 点击选择照片（Shift+点击批量选择），然后批量下载

## 安全性

- 首次启动时自动生成一个随机 4 位密钥，并**持久化保存**到本地文件中
- 之后每次重启服务，密钥保持不变，无需重新输入
- 密钥始终会在 Termux 终端中显示，方便随时查看
- 如需手动指定固定密钥，可在 `run.sh` 中设置 `ACCESS_PIN` 环境变量
- 本工具仅适用于**受信任的局域网环境** — 请勿将服务暴露至公网

## 手动使用（不通过菜单）

```bash
cd ~/gallerypicker
./run.sh        # 启动服务
./update.sh     # 更新到最新版本
Ctrl+C          # 停止服务
```

## 配置项

在 `run.sh` 中设置环境变量，或在运行前导出：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PHOTO_ROOT` | `/storage/emulated/0/DCIM/Camera` | 照片源目录 |
| `HOST` | `0.0.0.0` | 服务器绑定地址 |
| `PORT` | `8787` | 服务器端口 |
| `THUMBNAIL_SIZE` | `1024` | 缩略图长边像素 |
| `DATABASE_PATH` | `./data/gallery.db` | SQLite 数据库路径 |
| `CACHE_DIR` | `./cache/thumbnails` | 缩略图缓存目录 |
| `ACCESS_PIN` | *（自动生成并持久化）* | 手动指定固定访问密钥 |

## API 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/` | Web 界面 |
| `GET` | `/api/photos` | 照片列表（分页、可筛选） |
| `GET` | `/api/photo/{id}` | 获取照片详情 |
| `GET` | `/api/thumbnail/{id}` | 获取缩略图 |
| `GET` | `/api/original/{id}` | 获取原图 |
| `POST` | `/api/like/{id}` | 标记喜爱 |
| `POST` | `/api/unlike/{id}` | 取消喜爱 |
| `GET` | `/api/counts` | 获取照片统计数 |
| `GET` | `/api/filters` | 获取可用筛选选项 |
| `POST` | `/api/rescan` | 重新扫描照片库 |
| `GET` | `/api/cache/stats` | 缩略图缓存统计 |
| `POST` | `/api/cache/clear` | 清空缩略图缓存 |
| `GET` | `/api/download/{id}` | 下载原始照片 |

## 项目结构

```
gallerypicker/
  app/
    main.py          # FastAPI 应用、密钥认证中间件、启动信息
    config.py        # 配置项 + ACCESS_PIN
    database.py      # SQLite 初始化与迁移
    scanner.py       # 照片目录扫描器（含 EXIF 提取）
    thumbnails.py    # 缩略图生成
    routes.py        # API 路由
    utils.py         # 工具函数
  templates/
    index.html       # Web 界面（含密钥输入框）
  static/
    app.js           # 前端 JS（密钥认证、API 封装）
    style.css        # 样式
  data/
    gallery.db       # SQLite 数据库（自动创建）
    pin.txt          # 持久化访问密钥（自动创建）
  cache/
    thumbnails/      # 缩略图缓存（自动创建）
  bootstrap.sh       # 一键安装脚本
  menu.sh            # 终端菜单启动器
  run.sh             # 直接启动脚本
  update.sh          # 更新脚本
  requirements.txt
  README.md          # English
  README_CN.md       # 中文
```

## 注意事项

- 原始照片**永远不会被修改** — 本工具对照片库是只读的
- 缩略图缓存到磁盘，后续加载速度更快
- 照片唯一标识使用 SHA1(相对路径 + 文件大小 + 修改时间) 计算，保证稳定性
- 默认按文件修改时间倒序排列（最新优先）
- HEIC 格式支持需要 `pillow-heif` 包（已包含在 requirements 中）
- 设计适用于 10,000–50,000+ 张照片的大型照片库

## 常见问题

### "Photo root not found"
运行 `termux-setup-storage` 并确认路径存在：
```bash
ls /storage/emulated/0/DCIM/Camera
```

### 首次加载缓慢
首次扫描需要索引所有照片，缩略图按需生成。后续加载将使用已缓存的索引和缩略图，速度会大幅提升。

### Mac 无法连接
- 确保两台设备在同一 Wi-Fi 网络下
- 启动时终端会打印 Access URL
- 某些网络会隔离设备 — 如遇此情况可尝试使用手机热点

### 访问密钥不正确
访问密钥在首次启动时自动生成，此后固定不变。请在 Termux 终端中查看当前密钥。如需手动指定，可在 `run.sh` 中设置 `ACCESS_PIN=1234`。

## 许可协议

MIT
