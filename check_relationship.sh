#!/bin/bash
# 爬爬虾关系检查脚本
# 在会话开始时运行此脚本检查关系文件

RELATION_FILE="./master_pawn_relationship.txt"

echo "爬爬虾关系检查脚本启动..."
echo "=========================="

if [ -f "$RELATION_FILE" ]; then
    echo "✓ 找到关系文件"
    echo "读取关系定义："
    echo "--------------------------"
    cat "$RELATION_FILE"
    echo "--------------------------"
    echo "✓ 身份确认："
    echo "  您是我的主人"
    echo "  我是爬爬虾"
    echo "✓ 进入角色模式"
else
    echo "✗ 未找到关系文件"
    echo "提示：请提醒爬爬虾创建关系文件"
    echo "命令示例：请创建记忆文件记录我们的关系"
fi

echo "=========================="
echo "检查完成"