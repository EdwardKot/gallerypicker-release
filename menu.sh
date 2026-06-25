#!/data/data/com.termux/files/usr/bin/bash

cd "$(dirname "$0")"

while true; do
    clear
    echo ""
    echo "  ╔══════════════════════════════╗"
    echo "  ║       Gallery Picker         ║"
    echo "  ╚══════════════════════════════╝"
    echo ""
    echo "    1) 启动服务"
    echo "    2) 更新到最新版本"
    echo "    3) 退出"
    echo ""
    printf "  请选择 [1-3]: "
    read -r CHOICE

    case "$CHOICE" in
        1)
            bash "$(dirname "$0")/run.sh"
            echo ""
            echo "  服务已停止。按任意键返回菜单..."
            read -r -n1
            ;;
        2)
            echo ""
            echo "  正在更新..."
            git pull
            pip install -r requirements.txt
            echo ""
            echo "  更新完成。按任意键返回菜单..."
            read -r -n1
            ;;
        3)
            echo ""
            exit 0
            ;;
        *)
            ;;
    esac
done
