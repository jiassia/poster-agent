#!/bin/bash
# Copyright 2026 Poster Agent. Apache-2.0.
cd "$(dirname "$0")" || exit 1
export PATH="$PWD/.runtime/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo "请先安装 Node.js 22.12 或更新版本，再双击此文件。"
  read -r -p "按回车关闭…"; exit 1
fi
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)'; then
  echo "当前 Node.js 版本过低，请安装 22.12 或更新版本。"
  read -r -p "按回车关闭…"; exit 1
fi
if [ ! -d skills/poster-agent/scripts/node_modules ]; then
  echo "首次使用请在此目录运行 ./dev.sh setup 安装依赖，然后重新双击。"
  read -r -p "按回车关闭…"; exit 1
fi
node app/launch.mjs
status=$?
if [ "$status" -ne 0 ]; then read -r -p "启动未完成，按回车关闭…"; fi
exit "$status"
