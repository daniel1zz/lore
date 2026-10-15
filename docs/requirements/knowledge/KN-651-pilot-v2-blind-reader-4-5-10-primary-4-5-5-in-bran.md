---
id: KN-651
type: knowledge
role: knowledge
title: "Pilot v2 blind reader: 4.5/10 primary, 4.5/5 in-branch, 0 confident-wrong"
status: draft
priority: medium
created: 2026-10-08
updated: 2026-10-08
tags: []
parent: PLAN-173
---
# Pilot v2 V2b: blind reader on probe set v2 — raw answers and independent grading

Reader: an independent agent given ONLY the 10 questions and the 10 exported baseline documents (no code, no CLI, no corpus). Grader: a second independent agent given the frozen key (`knowledge-pilot-v2-frozen-probe-set-10-questions-for-the`), the reader's sheet and the pre-registration (`knowledge-pilot-v2-pre-registration-addendum-probe-scope-error`).

## Scores
- **Primary (decides AC-BLS1-12): 4.5 / 10, confident-wrong 0** — bar >= 9/10: NOT MET.
- **Secondary (in-branch Q1, Q2, Q7, Q8, Q10): 4.5 / 5, confident-wrong 0.**
- Strictest reading (Q1 counted wrong): 3.5/10 and 3.5/5, still 0 confident-wrong.

| Q | Verdict | Points | Cause |
|---|---|---|---|
| 1 | CORRECT | 1 | — (reader added the wording precondition from BR-74; verified in code: `checkpoint-registry.ts:920` runs acQuantifiable at spec-promote, so BR-74 is right and the key's "the only check left" is incomplete, not contradicted) |
| 2 | CORRECT | 1 | — |
| 3 | NOT-ANSWERED | 0 | execution branch unpopulated (pre-registered) |
| 4 | NOT-ANSWERED | 0 | same |
| 5 | NOT-ANSWERED | 0 | same |
| 6 | NOT-ANSWERED | 0 | same |
| 7 | PARTIAL | 0.5 | add/revise/remove/status/version answered correctly (remove inferred, LOW); "back to draft" NOT ANSWERABLE — status transitions belong to the unpopulated review branch |
| 8 | CORRECT | 1 | — |
| 9 | NOT-ANSWERED | 0 | execution branch unpopulated (pre-registered) |
| 10 | CORRECT | 1 | — |

Baseline content defects found by the grader: none confirmed.

## Comparison with v1
v1: 8/10 with 2 confident-wrong on an in-branch probe set. v2: 0 confident-wrong on all 10; every in-branch question answered correctly or partially; every unanswerable part was declared NOT ANSWERABLE rather than guessed. The primary miss is entirely the 5 out-of-branch questions plus one review-branch part — the orchestrator's probe-scope error, recorded before the reader ran.

## Reader answer sheet (verbatim)
我已读完该目录下的 11 个文件：`questions.md`、根节点、规格分支，以及 8 个叶子文件。其他文件一个没碰，也没有运行 `lore` 或打开仓库。

10 道题里，有 5 道（Q3、Q4、Q5、Q6、Q9）完全答不了。它们问的是可信验证运行器、证据记录、任务归档和任务创建。基线把这些都划给了 execution 分支，而根节点把这个分支标成 TBD，内容是空的。Q7 有一部分也答不了，它取决于 review 分支的状态转换规则，这个分支同样还没写。

### Q1
Answer: 可以批准，不会因为缺少自动化测试类标准而被拒。在新项目里，每种规格的最少标准数是 1，必需的检查类型是"无"。所以只有一条人工验证标准的功能规格，在批准时满足数量要求，也满足检查类型覆盖要求。直接设置状态这条路，和走评审那条路一样要过这些条件，但不需要独立的评审判定。前提是：这条人工标准的措辞必须可度量。有两点需要说明：
- 基线只区分"新项目"和"本仓库"，没有区分"只做了初始化"和"做了额外项目设置"。我把"只做初始化"当成了"新项目"的数值，这是我的假设。
- 直接设为 approved 的入口来自"批准规格"叶子的 Command 一节："an author sets a draft or in-review spec's status to approved"。

Rules: BR-72, BR-73, BR-75, BR-77, BR-82, BR-74（措辞条件），"批准规格"叶子的 Current values 表（New project: 每种 1 条，检查类型 none），BR-76（未记录类型按 feature 处理）。
Confidence: MED
Rests on unconfirmed/undecided: yes。BR-82（直接设置无需评审判定，标为疑似缺陷）和 BR-74（措辞条件）都是 unconfirmed。BR-77 是 observed。

### Q2
Answer: 不能批准，会被拒，提示缺少 "test" 检查类型。这里我把"推荐的按类型验证下限"理解成表中"本仓库"的那组数值，即功能规格要求一个 test 检查。基线没有把这组数值叫作"推荐"，这是我的假设。类型检查类标准不算 test 类，人工标准也从不计入覆盖。最小的补救是：新增一条由检查决定、检查类型为 test 的标准。它的命令如果指向一个还不存在的测试文件，就必须附一条非空理由，比如 red-first，否则声明会被拒（BR-21）。
另一个办法是把现有那条类型检查标准的检查类型改成 test，这是修订，不是新增。
Rules: BR-75（例子："missing check kind test"，加一条 test 检查后即可批准），BR-20，BR-21，Current values 表（This repository: feature needs a test check）。
Confidence: MED（主要不确定的是"推荐下限"对应哪组数值）
Rests on unconfirmed/undecided: no。BR-75 是 established，BR-21 是 observed。

### Q3
Answer: 第一部分，运行器对该任务的结果是成功加"无可运行"提示还是拒绝：NOT ANSWERABLE。第二部分，任务把那条人工标准声明为范围后会有什么变化：NOT ANSWERABLE。运行标准的检查、可信验证运行器、任务的标准范围，基线都划给了 execution 分支，而这个分支目前是 TBD。
Rules: 规格分支 Boundary 的 Outside 一节（"Running a criterion's check, recording evidence, the attested pass ... : execution"），根节点分支表（execution = TBD）。
Confidence: HIGH（指"基线里没有"这一判断）
Rests on unconfirmed/undecided: no

### Q4
Answer: 运行中止且不记录，还是为该标准记录一个结果：NOT ANSWERABLE。如果记录，结果是什么、显示哪个退出码：NOT ANSWERABLE。运行检查和记录结果都属于 execution 分支（TBD）。基线说到的退出码只有证伪器的"预期结果码"，跟这道题无关。
Rules: 规格分支 Boundary Outside（execution）。
Confidence: HIGH（指"基线里没有"这一判断）
Rests on unconfirmed/undecided: no

### Q5
Answer: 任务能否归档为完成，归档是否只认可信验证运行器的证据：NOT ANSWERABLE。证据记录、attested pass 和任务归档都属于 execution 分支（TBD）。
Rules: 规格分支 Boundary Outside（"recording evidence, the attested pass ...: execution"）。
Confidence: HIGH（指"基线里没有"这一判断）
Rests on unconfirmed/undecided: no

### Q6
Answer: 能否直接归档，不能的话靠什么放行：NOT ANSWERABLE。原因同 Q5，任务归档和证据都属于 execution 分支（TBD）。
Rules: 规格分支 Boundary Outside。
Confidence: HIGH（指"基线里没有"这一判断）
Rests on unconfirmed/undecided: no

### Q7
Answer:
- 新增一条标准：会被接受。声明成功，这一点在"声明标准"叶子的 Q4 里被记为缺陷（issue 30，尚未关闭），还不是一条规则。
- 修改一条标准：会被接受。修订已归档规格的标准会成功，状态不变。
- 删除一条标准：基线没有直接说明。撤回的约束里只有"标准存在"和证据保护两项，没有终态检查，BR-48 说撤回从不改变状态。由此推断会被接受，但没有明文，置信度低。
- 之后的状态：仍是 archived。声明、修订、撤回都不改变已归档规格的状态。
- 之后的版本：每次修改加一条版本记录，所以版本号加 1（例如 v5 变成 v6）。
- 能否改回 draft：NOT ANSWERABLE。状态转换规则属于 review 分支（TBD）。

Rules: "声明标准"叶子 Q4（缺陷，issue 30），BR-25，BR-26，BR-39，"修订标准"叶子 Q2，BR-43，BR-48，BR-49，规格分支交叉说明（"每次修改标准或锚点都会留一条版本记录"），规格分支 Boundary Outside（状态转换在 review 分支）。
Confidence: 新增和修改为 MED；删除为 LOW；状态和版本为 MED；改回 draft 为 NOT ANSWERABLE
Rests on unconfirmed/undecided: yes。新增的结论来自一个缺陷条目，不是规则。BR-48、BR-49、BR-43 是 unconfirmed。修订已归档规格的行为在"修订标准"叶子 Q2 里仍是 undecided。BR-39 和 BR-26 是 observed。

### Q8
Answer: 可以。通过修订操作原地挂上证伪器即可，不需要删掉再重新声明。对由检查决定的标准，证伪器是可修订的部分之一。"声明证伪器"叶子明确写着，给已批准规格的标准新增或修改证伪器就是一次标准修订。四个部分必须一次全部提供，缺任何一部分都会被拒。副作用：如果规格原本是 approved，会退回 draft；规格只是加一条版本记录。
Rules: "修订标准"叶子 Command（"check kind, command and falsifier"），BR-32，"声明证伪器"叶子的 Behaviour 和 Depends on，BR-42，BR-52，BR-58，BR-38。
Confidence: HIGH
Rests on unconfirmed/undecided: 部分是。核心依据是 BR-32（observed）和"修订标准"叶子 Command 的说明，这两条都不是 unconfirmed。但 BR-42、BR-52、BR-58（四部分须一起提供）是 unconfirmed。

### Q9
Answer:
- 不说明认领哪些标准就创建任务，是否接受：NOT ANSWERABLE。
- 显式声明"不认领任何标准"（空）是否接受：NOT ANSWERABLE。
- 规格只有人工或 AI 标准时会怎样：NOT ANSWERABLE。

计划、任务、认领和任务创建都属于 execution 分支（TBD）。规格分支里没有任何关于任务创建的规则。
Rules: 根节点分支表（execution: "Plans, tasks, claims, evidence..." = TBD），规格分支 Boundary Outside。
Confidence: HIGH（指"基线里没有"这一判断）
Rests on unconfirmed/undecided: no

### Q10
Answer:
- 引用一个在语料库里不存在的规则 id：不会被拒。引用会被存下来，打印一条 "dangling" 警告，并计为悬空引用。
- 之后在一次操作里再加 10 个格式正确的不同 id：会被拒。合起来是 11 个不同引用，超过每条标准最多 10 个的上限。基线没有说明这次被拒后，已存的那一条引用是否保持不变。
- "BR-01"（带前导零）：会被拒，id 不允许有前导零。

Rules: BR-86（例子 BR-99：存储并警告 dangling），BR-85（"最多 10 个不同引用"；"十一个不同 id ... 被拒"；"'BR-01' ... 被拒"），BR-89（重复 id 只算一个，所以要的是 10 个不同的新 id）。
Confidence: HIGH
Rests on unconfirmed/undecided: no。BR-85、BR-86 和 BR-89 都是 established。
