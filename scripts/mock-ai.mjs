import http from "node:http";
const port = Number(process.env.MOCK_PORT || 8787);
let calls = 0;
const visualRequests = [];
const writingRequests = [];
const server = http.createServer(async (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200);
    res.end("OK");
    return;
  }
  if (req.url === "/stats") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ calls, visualRequests, writingRequests }));
    return;
  }
  if (req.method === "GET" && req.url === "/v1/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: ["mock-writer", "mock-reviewer"].map(id => ({ id })) }));
    return;
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const input = JSON.parse(raw || "{}");
  if (req.headers.authorization === "Bearer invalid") {
    res.writeHead(401);
    res.end("{}");
    return;
  }
  calls++;
  writingRequests.push({ body: input, hasAuthorization: Boolean(req.headers.authorization) });
  const text = JSON.stringify(input.messages);
  const user =
    input.messages
      ?.filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n") || "";
  let content = "OK";
  if (text.includes("VISUAL_CHARACTERS_JSON")) {
    const material = JSON.parse(user);
    visualRequests.push(material);
    const profiles = [];
    const changes = [];
    for (const source of material.chapters) {
      const person = material.characters.find((c) => c.name === "林舟");
      const excerpt = "林舟留着黑色短发，左眉有一道浅疤，穿深灰色外套。";
      if (person && source.text.includes(excerpt))
        profiles.push({
          characterId: person.id,
          name: person.name,
          appearance: "黑色短发，左眉浅疤，深灰色外套",
          evidence: [
            {
              chapterId: source.id,
              excerpt:
                input.model === "mock-invalid-visual"
                  ? "原文没有写的银色长发。"
                  : excerpt,
            },
          ],
        });
      if (
        !material.onlyCharacterId &&
        source.text.includes("顾青戴着银框眼镜。")
      )
        profiles.push({
          characterId: "",
          name: "顾青",
          appearance: "银框眼镜",
          evidence: [{ chapterId: source.id, excerpt: "顾青戴着银框眼镜。" }],
        });
      const other = material.characters.find((c) => c.name === "叶岚");
      if (
        person &&
        source.id === material.currentChapterId &&
        source.text.includes("林舟换上了深蓝色外套。")
      )
        changes.push({
          characterId: person.id,
          description: "深蓝色外套",
          evidence: { chapterId: source.id, excerpt: "林舟换上了深蓝色外套。" },
        });
      if (
        other &&
        source.id === material.currentChapterId &&
        source.text.includes("叶岚剪短了头发，换上蓝色外套。")
      )
        changes.push({
          characterId: other.id,
          description: "短发，蓝色外套",
          evidence: {
            chapterId: source.id,
            excerpt: "叶岚剪短了头发，换上蓝色外套。",
          },
        });
    }
    content = JSON.stringify({ profiles, changes });
  } else if (text.includes("ILLUSTRATION_JSON")) {
    const material = JSON.parse(user);
    content = JSON.stringify({
      scene: "灯下的人物，朦胧雨雾，古老的庭院。",
      excerpt: material.chapter.slice(0, 20),
      characterIds: material.characters.slice(0, 1).map((c) => c.id),
    });
  } else if (text.includes("REVIEW_JSON")) {
    const version = user.match(/"chapterVersionId":"([^"]+)"/)?.[1] || "";
    const draft = user.match(/<draft>([\s\S]*?)<\/draft>/)?.[1] || "";
    const start = user.indexOf("本次可引用来源：") + "本次可引用来源：".length;
    const end = user.indexOf("\n待审正文：");
    let sources = [];
    try {
      sources = JSON.parse(user.slice(start, end));
    } catch {
      /* fixture only */
    }
    const rule = sources.find((s) => s.label === "灯塔限制");
    const character = sources.find((s) => s.label === "人物 · 林舟");
    const issues = [];
    if (draft.includes("灯塔立刻重燃。") && rule)
      issues.push({
        issueId: "rule",
        kind: "canon",
        severity: "blocker",
        claim: "灯塔在冷却期内重燃，与作者锁定规则冲突。",
        quote: "灯塔立刻重燃。",
        conflictEvidence: {
          sourceId: rule.id,
          sourceVersionId: rule.versionId,
          quote: "灯塔熄灭后的 24 小时内不能重燃。",
        },
        suggestion: "保持灯塔熄灭，让两人寻找其他照明。",
        confidence: "high",
      });
    if (draft.includes("林舟直接知道钥匙藏处。") && character)
      issues.push({
        issueId: "knowledge",
        kind: "knowledge",
        severity: "blocker",
        claim: "林舟在没有获知过程时使用了未知信息。",
        quote: "林舟直接知道钥匙藏处。",
        conflictEvidence: {
          sourceId: character.id,
          sourceVersionId: character.versionId,
          quote: "不知道铜钥匙的藏处",
        },
        suggestion: "由叶岚指引并交代获知过程。",
        confidence: "high",
      });
    content = JSON.stringify({
      chapterVersionId: version,
      summary: issues.length
        ? "发现需要核实的连续性问题。"
        : "未发现有证据支持的明显冲突。仍由作者确认。",
      issues,
    });
  } else if (text.includes("MEMORY_JSON")) {
    const draft = user.match(/<chapter>([\s\S]*?)<\/chapter>/)?.[1] || "";
    content = JSON.stringify({
      summary:
        "灯塔在暴雨中熄灭。林舟左臂受伤，叶岚保管铜钥匙。两人决定沿堤岸离开雾港；蓝光的来历仍未知。",
      facts: [
        {
          category: "timeline",
          predicate: "离开灯塔",
          value: "两人准备沿堤岸离开雾港。",
          certainty: "confirmed",
          visibility: "reader_known",
          startOrder: 0,
          endOrder: null,
          excerpt: draft.includes("两人走向雾中的堤岸。")
            ? "两人走向雾中的堤岸。"
            : draft.slice(0, 20),
        },
      ],
    });
  } else if (text.includes("STYLE_JSON")) {
    content = JSON.stringify({
      preset: "参考文风",
      perspective: "第三人称限知",
      rhythm: "短句推进冲突，关键处留白。",
      dialogue: "对话简短，承载行动意图。",
      description: "少量环境细节映衬人物处境。",
      tone: "克制、清晰，带轻微悬念。",
      avoid: "不长篇解释设定，不照搬参考文本原句。",
    });
  } else if (text.includes("REVISION_JSON")) {
    content = JSON.stringify({
      edits: [
        {
          quote: "灯塔立刻重燃。",
          replacement: "灯塔依然漆黑，距离能够重燃还要等满二十四小时。",
        },
      ],
    });
  } else if (text.includes("WRITE_SCENE")) {
    const target = Number(user.match(/目标约 (\d+) 汉字/)?.[1] || 1000);
    const paragraphs = [
      "雨水沿着灯塔的铁阶往下流。林舟按住左臂，指缝里露出一线暗红。他没有去碰失去光亮的灯室，只侧耳听着雾港的潮声。",
      "叶岚站在门边，铜钥匙仍紧握在她掌心。她看了一眼封锁的港口，把衣领拉高。风从石墙的裂缝里吹过，两人的影子被微弱的灯火拖向身后。",
      "林舟问她还有没有别的路。叶岚沉默片刻，指向堤岸尽头的旧船厂。他不知道她藏着什么，但此刻他们只能继续向前。",
      "一道蓝光在远处闪过，随即隐入浓雾。林舟停下脚步，叶岚拉住他的衣角。谁都没有为那道光下结论。",
    ];
    let parts = [];
    let count = 0;
    while (count < target) {
      const paragraph = paragraphs[parts.length % paragraphs.length];
      parts.push(paragraph);
      count += [...paragraph].filter((c) => /\p{Script=Han}/u.test(c)).length;
    }
    content = parts.join("\n\n") + "\n\n两人走向雾中的堤岸。";
  }
  const reason = input.model === "mock-truncated" ? "length" : "stop";
  if (
    (input.model === "mock-timeout" && calls % 2 === 0) ||
    (input.model === "mock-scene2-timeout" &&
      user.includes("现在写第 2 个场景"))
  ) {
    await new Promise((r) => setTimeout(r, 20000));
  }
  if (input.model === "mock-slow") {
    await new Promise((r) => setTimeout(r, 3000));
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      id: `mock-${calls}`,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content },
          finish_reason: reason,
        },
      ],
      usage: { prompt_tokens: 300, completion_tokens: content.length },
    }),
  );
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Mock AI listening at http://127.0.0.1:${port}/v1 (test only)`),
);
