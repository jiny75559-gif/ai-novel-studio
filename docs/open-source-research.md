# 开源项目参考

检索日期：2026-10-13。星数是当日 GitHub 页面约数，不作为质量保证。参考公开文档和能够读取的核心代码；没有复制第三方实现，也没有运行第三方项目。

| 项目 | 页面显示人气 | 可参考设计 | 本项目采用 |
| --- | --- | --- | --- |
| [AI_NovelGenerator](https://github.com/YILING0013/AI_NovelGenerator) | 约 6.2k stars | 章节多阶段生成、人物状态、伏笔、前文上下文与一致性检查 | 总纲/章纲分离；人物状态和知识单独记录；主写与副审独立 |
| [ainovel-cli](https://github.com/voocel/ainovel-cli) | 约 2.2k stars | 确定性调度、步骤检查点、原文举证、相关历史章节、逐章放行 | Rust 管理流程状态；逐段 SQLite 落盘；确认闸门；核验审稿引文 |
| [Long-Novel-GPT](https://github.com/MaoXiaoYuZ/Long-Novel-GPT) | 约 1.2k stars | 大纲逐级扩写、分块与相邻上下文、针对选中部分修改 | 按场景顺序生成；携带前段结尾；所选审稿问题驱动修订 |

具体查看的代码：[Long-Novel-GPT core/writer.py](https://github.com/MaoXiaoYuZ/Long-Novel-GPT/blob/main/core/writer.py)。其 chunk 切分、相邻上下文和 review/write 流程说明了维护提纲与正文对应关系的必要性。本项目以章节事件按序分配到场景，单场景失败保留已完成部分，避免无约束全文重写。

也看了 [LunaRime/novelforge](https://github.com/LunaRime/novelforge) 的公开说明，参考了“定稿后记忆”和“旧记忆失效”思路；该项目当日约 13 stars，仅作为相关实现，并不称其为热门项目。

开发取舍：保留两个模型角色和作者确认。自动全书、多代理循环、向量服务与复杂图编排会增加自用软件的成本和故障面，先不引入。初版使用确定性章节时间过滤、已确认记忆和近期摘要，后续再加入 FTS/向量检索。

网络限制：本机直接 git clone GitHub 多次出现连接重置/空响应；改用网页和原始代码阅读。若未能读取某项目核心源码，不能声称已完成该项目的代码审计。
