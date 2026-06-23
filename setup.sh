#!/bin/bash
# Termux Gallery Picker 一键配置脚本

echo "=== 1. 申请存储卡权限 (请在手机弹窗中点击 允许) ==="
termux-setup-storage

echo "=== 2. 安装系统依赖 (python, pillow, zip) ==="
pkg update && pkg upgrade -y
pkg install python python-pillow zip -y

echo "=== 3. 配置 Python 虚拟环境 ==="
python -m venv .venv
source .venv/bin/activate

echo "=== 4. 安装 Python 依赖包 ==="
pip install --upgrade pip
pip install -r requirements.txt

# 赋予运行脚本权限
chmod +x run.sh

echo ""
echo "================================================="
echo " 🎉 配置完成！"
echo " 现在您只需要输入以下命令即可启动服务："
echo " bash run.sh"
echo "================================================="
