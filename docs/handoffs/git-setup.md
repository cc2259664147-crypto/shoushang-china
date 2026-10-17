# GitHub 连接交接

日期：2026-10-17。用户追加授权：创建 GitHub 仓库，并通过 Git 管理项目开发。

- 账号：cc2259664147-crypto；通过 GitHub 连接及本机 Git 凭据核验。
- 远端：https://github.com/cc2259664147-crypto/shoushang-china ，新建私有仓库。
- Git 根目录：代码根目录 shoushang-china；上级 PRD 原文件保留，不改动。
- 默认分支 main，远端 origin；初始 M01 提交为 460f138。
- Git user.name/user.email 仅设置在仓库本地，邮箱采用 GitHub noreply，不修改全局配置。
- 使用现有 Git Credential Manager 登录；凭据未打印、未写入项目文件。
- .gitignore 排除 node_modules、缓存、dist、环境文件；.gitattributes 统一文本 LF。
- 后续沿用同一仓库，各模块先检查状态、只提交授权文件，总控整合后推送；禁止 force push。

验证以实际 git push、git status 和 git ls-remote 的提交一致性为准；没有新建 PR，也未开展 M02。
