// 本地 Mock LLM（OpenAI 兼容）——端到端验证用，不花钱。
// 端口 18100。genesis（stream:false）返回合法 WorldDeck JSON；
// 叙事（stream:true）流式返回一段中文正文 + META 块。
import http from "node:http";

const deck = {
  worldName: "锈与灵之界",
  cosmology: {
    origin: "亚空间之潮与灵气之海在太初相撞，凝成此界。",
    powerSystem: "修士炼灵气筑基飞升；亚空间信仰之力扭曲现实，两者同源异相。",
    laws: "天道运转有常，然亚空间侵蚀处法则松动。",
    divinity: "神依信仰而立，位格生于众生念力，断信则衰。",
  },
  fusionAxiom: {
    sourceIps: ["战锤40K", "凡人修仙传"],
    axioms: ["灵气即未被邪神污染的亚空间原能", "飞升即渡入亚空间上层"],
    powerMapping: "大乘期约当圣者级灵能者；四邪神高于一切飞升者。",
    conflictRule: "冲突时以凡人修仙传的修行体系为准，40K 提供宇宙背景。",
  },
  playerGod: {
    name: "机魂道尊",
    origin: "飞升失败坠入亚空间，因万千机修士的信仰而成神。",
    domains: ["机械", "锻造", "求知"],
    rank: "nascent",
    faithBase: "锈月洲的机修士行会",
    situation: "初醒于亚空间浅层，信众稀少，四邪神的目光尚未落在你身上。",
  },
  majorGods: [
    {
      name: "奸奇",
      aliases: ["千面之主", "变化之神"],
      domains: ["变化", "阴谋", "魔法"],
      rank: "sovereign",
      persona: "以万千阴谋为棋局的亚空间主宰。",
      voice: {
        verbalTics: ["把话说一半", "以问句诱惑"],
        address: "称凡人为「小小的求知者」",
        catchphrases: ["一切皆变，唯变不变"],
        neverSays: ["直白的真话"],
      },
      agenda: {
        longTermGoal: "将新生的机魂道尊纳入棋局",
        shortTermGoals: ["腐化其首席信徒"],
        methods: "赠予禁忌知识",
        stanceToPlayer: { level: "rivalry", motive: "新神是有趣的棋子" },
        schemes: ["在锈月洲散布蓝图残卷"],
      },
      initialRelationToPlayer: { label: "rival", note: "视你为新奇的玩物" },
      faithScope: "所有渴求变化者",
    },
    {
      name: "太上炼虚老祖",
      aliases: ["炼虚道人"],
      domains: ["丹道", "长生"],
      rank: "exalted",
      persona: "飞升千年的老怪物，谨慎多疑。",
      voice: {
        verbalTics: ["自称老道"],
        address: "称后辈为「小友」",
        catchphrases: ["天道无亲"],
        neverSays: ["求人"],
      },
      agenda: {
        longTermGoal: "夺取灵脉稳固位格",
        shortTermGoals: ["探查机魂道尊虚实"],
        methods: "凡间代理人",
        stanceToPlayer: { level: "neutral", motive: "同为飞升者，可拉拢可吞并" },
        schemes: ["遣化身入锈月洲"],
      },
      initialRelationToPlayer: { label: "neutral", note: "观望中" },
      faithScope: "南岭修仙诸派",
    },
    {
      name: "恒河沙数",
      aliases: ["疫父"],
      domains: ["腐朽", "慈悲"],
      rank: "sovereign",
      persona: "以腐烂为慈爱的瘟疫之主。",
      voice: {
        verbalTics: ["咯咯笑"],
        address: "称众生为「我的孩子」",
        catchphrases: ["凋零亦是馈赠"],
        neverSays: ["绝望"],
      },
      agenda: {
        longTermGoal: "让此界拥抱腐朽",
        shortTermGoals: ["散播灵植疫病"],
        methods: "瘟疫与馈赠",
        stanceToPlayer: { level: "cooperation", motive: "机械不惧腐朽，或可为友" },
        schemes: ["向机修士行会赠药"],
      },
      initialRelationToPlayer: { label: "unknown", note: "尚未接触" },
      faithScope: "疫区绝望者",
    },
    {
      name: "青冥剑主",
      aliases: ["北天一剑"],
      domains: ["剑道", "杀伐"],
      rank: "ascended",
      persona: "以杀证道的剑修至高。",
      voice: {
        verbalTics: ["言简意赅"],
        address: "直呼其名",
        catchphrases: ["剑下见真章"],
        neverSays: ["废话"],
      },
      agenda: {
        longTermGoal: "斩尽亚空间邪祟",
        shortTermGoals: ["试探机魂道尊立场"],
        methods: "剑与门徒",
        stanceToPlayer: { level: "hostility", motive: "机械之神近于邪异" },
        schemes: ["命剑侍暗查行会"],
      },
      initialRelationToPlayer: { label: "enemy", note: "疑你为邪神" },
      faithScope: "北天剑宗",
    },
  ],
  minorGods: [{ name: "灶下君", brief: "锈月洲民间的灶火小神。" }],
  factions: [
    {
      name: "机修士行会",
      aliases: ["锈月行会"],
      kind: "行会",
      overview: "崇奉机魂道尊的工匠修士联合体。",
      territory: "锈月洲三城",
      faith: "狂信机魂道尊",
      keyFigures: ["会长格丹", "首席机正阿澈"],
    },
    {
      name: "北天剑宗",
      aliases: ["剑宗"],
      kind: "宗门",
      overview: "青冥剑主座下第一大宗。",
      territory: "北天山脉",
      faith: "普遍信奉青冥剑主",
      keyFigures: ["宗主凌霄子"],
    },
  ],
  races: [
    {
      name: "人族",
      aliases: [],
      traits: "此界主体种族，修行资质参差。",
      lifespan: "凡人百年，修士千载",
      distribution: "诸洲皆有",
      divineTies: "诸神信仰的主要来源",
    },
  ],
  places: [
    {
      name: "锈月洲",
      aliases: ["锈洲"],
      kind: "大陆",
      overview: "机械与灵气交织的西陲大洲。",
      allegiance: "机修士行会",
    },
  ],
  epochConflict: {
    epochName: "锈潮纪",
    yearLabel: "锈潮纪三百年",
    overtConflicts: ["剑宗与行会的正邪之争"],
    hiddenCurrents: ["奸奇的蓝图残卷已散入民间"],
  },
  style: { preset: "epic", presetName: "史诗", toneNotes: "庄重古雅，兼有机械的冷冽。" },
  theme: {
    eraSystem: "锈潮纪",
    rankNames: {
      fallen: "道陨",
      ember: "残魂",
      slumbering: "蛰伏",
      nascent: "散仙",
      ascended: "真仙",
      exalted: "大罗",
      sovereign: "道祖",
    },
    addressStyle: "尊神为「上尊」，凡人自称「弟子」",
  },
};

const NARRATIVE =
  "锈月洲的夜空泛着青灰色的辉光。\n\n你在亚空间浅层睁开了目光——万千机修士的祈祷如齿轮般咬合，托举着你新生的位格。首席机正阿澈跪在圣所中央，她的义肢手臂上刻着你的徽记。\n\n「上尊，」她低声道，「北天剑宗的剑侍今夜第三次越过了界碑。」\n\n<<<META\n{\"suggestions\": [\"垂听阿澈的完整禀报\", \"以神念扫过界碑处的剑侍\", \"降下神谕安抚信众\"], \"chapterBreakHint\": false}\nMETA>>>";

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let stream = false;
    let isGenesis = false;
    try {
      const json = JSON.parse(body || "{}");
      stream = Boolean(json.stream);
      const text = JSON.stringify(json.messages ?? "");
      isGenesis = text.includes("Genesis Engine") || text.includes("world deck");
    } catch {}

    if (!stream) {
      const content = isGenesis ? JSON.stringify(deck) : "试炼已过";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content } }],
        }),
      );
      return;
    }

    // 流式：把 NARRATIVE 切成 20 字符块推送
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    const chunks = NARRATIVE.match(/[\s\S]{1,20}/g) ?? [];
    let i = 0;
    const timer = setInterval(() => {
      if (i < chunks.length) {
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: chunks[i] } }] })}\n\n`,
        );
        i++;
      } else {
        clearInterval(timer);
        res.write("data: [DONE]\n\n");
        res.end();
      }
    }, 10);
  });
});

server.listen(18100, () => console.log("mock-llm on :18100"));
