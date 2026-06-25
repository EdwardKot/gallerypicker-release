#!/data/data/com.termux/files/usr/bin/bash

set -e

echo ""
echo "============================================================"
echo "  Gallery Picker — 安装向导"
echo "============================================================"
echo ""

# 1. 安装系统依赖
echo "▶ 安装系统依赖..."
pkg update -y
pkg install python rust binutils git -y

# 2. 申请存储权限
echo ""
echo "▶ 申请存储权限..."
echo "  请在弹出的对话框中点击「允许」"
termux-setup-storage
sleep 3

# 3. Clone 项目
echo ""
echo "▶ 下载 Gallery Picker..."
if [ -d "$HOME/gallerypicker" ]; then
    echo "  目录已存在，跳过 clone，执行 git pull 更新..."
    cd "$HOME/gallerypicker"
    git pull
else
    git clone https://github.com/EdwardKot/gallerypicker-release.git "$HOME/gallerypicker"
    cd "$HOME/gallerypicker"
fi

# 4. 安装 Python 依赖
echo ""
echo "▶ 安装 Python 依赖（首次可能需要几分钟）..."
pip install -r requirements.txt

# 5. 初始化目录
mkdir -p data cache

# 6. 添加 alias
ALIAS_LINE="alias gallery='bash \$HOME/gallerypicker/menu.sh'"
if ! grep -qF "alias gallery=" "$HOME/.bashrc" 2>/dev/null; then
    echo "" >> "$HOME/.bashrc"
    echo "# Gallery Picker" >> "$HOME/.bashrc"
    echo "$ALIAS_LINE" >> "$HOME/.bashrc"
    echo ""
    echo "✓ 已添加快捷命令 'gallery'"
fi

echo ""
echo "============================================================"
echo "  安装完成！"
echo ""
echo "  以后只需输入：gallery"
echo "  即可打开菜单启动服务"
echo "============================================================"
echo ""
echo "  现在启动？输入 y 继续，直接回车跳过"
read -r START_NOW
if [ "$START_NOW" = "y" ] || [ "$START_NOW" = "Y" ]; then
    bash "$HOME/gallerypicker/menu.sh"
fi
