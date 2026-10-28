"use strict";

/* Shared by the command-line curator and curate.html. It deliberately uses
   deterministic rules: running it twice on the same source produces the same
   deck, and a human can always adjust the result in the UI. */
(function(root, factory){
  const api=factory();
  if(typeof module!=="undefined"&&module.exports) module.exports=api;
  else root.JapaneseCurator=api;
})(typeof globalThis!=="undefined"?globalThis:this, function(){
  const GROUPS=[
    ["食べ物・飲み物",/food|eat|drink|meal|rice|meat|fish|fruit|vegetable|cook|restaurant|味|料理|食|飲|酒|茶|菓子|肉|魚|野菜|果物|米|パン|腹/iu],
    ["人・家族",/person|people|family|mother|father|parent|child|brother|sister|friend|man|woman|human|家族|母|父|親|子供|兄|弟|姉|妹|友|人間/iu],
    ["からだ・健康",/body|head|face|hand|foot|eye|ear|mouth|heart|blood|health|ill|disease|doctor|hospital|体|頭|顔|手|足|目|耳|口|心臓|血|病|医|薬/iu],
    ["動物・植物",/animal|bird|dog|cat|horse|insect|tree|flower|grass|forest|犬|猫|鳥|馬|虫|木|花|草|林|森|動物|植物/iu],
    ["自然・天気",/nature|weather|rain|snow|wind|cloud|sky|sea|river|mountain|earth|fire|water|雨|雪|風|雲|空|海|川|山|地球|火|水|天気/iu],
    ["家・くらし",/house|home|room|door|window|furniture|clothes|bath|sleep|家|部屋|戸|窓|服|風呂|眠|寝|生活|掃除/iu],
    ["学校・ことば",/school|student|teacher|study|learn|book|read|write|word|language|question|学校|学生|先生|勉強|学ぶ|本|読む|書く|言葉|言語|質問/iu],
    ["仕事・社会",/work|job|company|office|money|business|government|law|police|仕事|会社|職|金|商売|政府|法律|警察|社会/iu],
    ["場所・交通",/place|road|street|station|train|car|bus|ship|travel|city|country|道|駅|電車|車|船|旅行|町|都市|国|場所/iu],
    ["時間・数",/time|day|week|month|year|morning|night|number|first|last|時|日|週|月|年|朝|夜|数|最初|最後/iu],
    ["気持ち・性格",/feel|emotion|happy|sad|angry|fear|love|kind|honest|気持|感情|嬉|悲|怒|怖|愛|優し|正直|性格/iu],
    ["動作",/\bto\s+[a-z]|する|行う|動く|歩く|走る|持つ|使う|作る|見る|聞く|話す/iu],
    ["文化・遊び",/music|song|movie|game|sport|art|festival|religion|音楽|歌|映画|ゲーム|スポーツ|芸術|祭|神|寺/iu],
    ["物・道具",/tool|machine|device|box|bag|paper|weapon|道具|機械|箱|袋|紙|物|品/iu]
  ];
  const FALLBACK={
    "食べ物・飲み物":["食べる","味","料理"],"人・家族":["人","関係","家族"],"からだ・健康":["体","健康","病院"],
    "動物・植物":["生き物","自然","種類"],"自然・天気":["自然","外","地球"],"家・くらし":["家","毎日","生活"],
    "学校・ことば":["勉強","学校","言葉"],"仕事・社会":["仕事","社会","会社"],"場所・交通":["場所","移動","道"],
    "時間・数":["時間","数","順番"],"気持ち・性格":["気持ち","心","人"],"動作":["動き","行動","する"],
    "文化・遊び":["文化","楽しむ","趣味"],"物・道具":["物","使う","道具"],"その他":["言葉","反対","似ている","使う","考える"]
  };
  const META=/大辞林|大辞泉|旺文社|国語辞典|新明解|第四版|第十一版|意味|ことば|読む|説明|使い方|自スル|他スル|形動|連語|接尾|接頭|文語|俗語|古語|スル|ナリ|タリ|^[\d\s\[\]①-⑳（）()―━⇔・.…-]+$/u;
  const UNSAFE=/セックス|性交|性器|陰茎|膣|精液|射精|自慰|ちんこ|まんこ|アナル|ポルノ|売春|強姦|レイプ|自殺|首吊|虐殺|拷問|覚醒剤|コカイン|ヘロイン|ガイジ|キチガイ|気違い/iu;
  /* Katakana is retained only where the Japanese coinage is meaningfully
     different from simply substituting an English word. */
  const WASEI_EIGO=new Set(["イメチェン","オーダーメイド","オフィスレディ","ガソリンスタンド","キーホルダー","クールビズ","コンセント","サラリーマン","スキンシップ","ナイター","ノートパソコン","ハイタッチ","パソコン","ペットボトル","ベビーカー","フリーター","マイカー","モーニングコール","リモコン","リヤカー","ワンピース"]);
  const WASEI_TRANSLATIONS={"クールビズ":"summer business-casual campaign","ナイター":"night baseball game","リヤカー":"two-wheeled handcart"};
  const clean=s=>String(s||"").replace(/\[[\d; ]+\]|^[①-⑳②③④⑤⑥⑦⑧⑨⑩]+/gu,"").replace(/[―━⇔]/g," ").replace(/\s+/g," ").trim();
  const reading=(word,value)=>clean(value)||[...word].map(ch=>ch>="ァ"&&ch<="ヶ"?String.fromCharCode(ch.charCodeAt(0)-0x60):ch).join("");
  function translation(card){if(WASEI_TRANSLATIONS[card.w])return WASEI_TRANSLATIONS[card.w];for(const raw of card.ng||[]){let s=clean(raw);if(!/^[A-Za-z][A-Za-z ()'.,-]{1,48}$/.test(s)||/dictionary|edition|incl\.|i\.e\.|e\.g\./i.test(s))continue;s=s.replace(/^to\s+/i,"").replace(/\s*\([^)]*\)\s*$/g,"").trim();if(s.length>=2&&s.length<=42)return s}return ""}
  function group(card){const glosses=card.ng.filter(x=>/^[A-Za-z][A-Za-z ()'.,-]{1,28}$/.test(x));const text=[card.w,...glosses].join(" ");for(const preferred of ["文化・遊び","場所・交通"]){const found=GROUPS.find(x=>x[0]===preferred);if(found[1].test(text))return preferred}for(const [name,re] of GROUPS)if(re.test(text))return name;return "その他"}
  function usableHint(raw,card){const s=clean(raw);if(!s||/[A-Za-z〔〕]/.test(s)||s===card.w||s===card.r||s.includes(card.w)||META.test(s)||UNSAFE.test(s)||s.length<2||s.length>22)return "";if(/[。！？!?☆➡]/.test(s)||(/[^\x00-\x7f]/.test(s)&&(s.length>6||/\s/.test(s)))||((s.match(/\s/g)||[]).length>3))return "";if(/^(これ|それ|ここ|そこ|だよ|はい)$/i.test(s)||/^[をがはにでとへも]|(?:ました|ください|でしょう|です|ます|だった)$/.test(s))return "";return s.trim()}
  function relevance(card,index){let n=card.c==="漢字学習"?55:card.c==="アニメカード"?25:15;n-=index/1200;const len=[...card.w].length;if(len>=2&&len<=6)n+=16;else if(len===1)n+=7;else if(len>10)n-=20;if(card.r)n+=5;if(card.ng.some(x=>/^[A-Za-z][A-Za-z -]{1,20}$/.test(x)))n+=12;if(UNSAFE.test(card.w))n-=1000;if(/[A-Za-z0-9]{3}/.test(card.w))n-=8;if(/^[ぁ-んー]{1,2}$/u.test(card.w))n-=6;return n}
  function curate(input,limit=3000){
    const normalized=input.map((x,i)=>{const w=clean(x.w);return {w,r:reading(w,x.r),e:clean(x.e)||translation(x),d:Number(x.d)||3,c:x.c||"",ng:Array.isArray(x.ng)?x.ng:[],_i:i}}).filter(x=>x.w&&x.e&&!UNSAFE.test(x.w)&&(!/^[ァ-ヶー・]+$/u.test(x.w)||WASEI_EIGO.has(x.w))&&!/^[A-Za-z][A-Za-z -]*$/.test(x.w));
    normalized.forEach(x=>{x._group=group(x);x._score=relevance(x,x._i);x._tokens=new Set(x.ng.filter(v=>/^[A-Za-z][A-Za-z -]{1,28}$/.test(v)).flatMap(v=>v.toLowerCase().replace(/\b(to|of|a|an|the|and|or|in|on|for|one|person|thing)\b/g," ").split(/[^a-z]+/)).filter(v=>v.length>2))});
    const sorted=normalized.slice().sort((a,b)=>b._score-a._score||a._i-b._i), chosen=normalized.filter(x=>x._i<1200).slice(0,limit), chosenSet=new Set(chosen), counts={};
    chosen.forEach(x=>counts[x._group]=(counts[x._group]||0)+1);
    for(const x of sorted){if(chosen.length>=limit)break;if(chosenSet.has(x))continue;const count=counts[x._group]||0;if(count>=500)continue;counts[x._group]=count+1;chosen.push(x);chosenSet.add(x)}
    if(chosen.length<limit)for(const x of sorted)if(chosen.length<limit&&!chosenSet.has(x)){chosen.push(x);chosenSet.add(x)}
    const groupWords={};for(const x of chosen)(groupWords[x._group]||=[]).push(x);
    return chosen.sort((a,b)=>a._group.localeCompare(b._group,"ja")||a._i-b._i).map((x,pos)=>{
      const hints=[],add=v=>{v=usableHint(v,x);if(v&&!hints.includes(v))hints.push(v)};
      x.ng.forEach(add);
      [...x.w].filter(ch=>/\p{Script=Han}/u.test(ch)&&x.w.length>1).forEach(add);
      const related=(groupWords[x._group]||[]).filter(y=>y!==x).map(y=>({y,score:[...x.w].filter(ch=>/\p{Script=Han}/u.test(ch)&&y.w.includes(ch)).length*3+[...x._tokens].filter(t=>y._tokens.has(t)).length*2})).filter(v=>v.score>0).sort((a,b)=>b.score-a.score||a.y._i-b.y._i).slice(0,3).map(v=>v.y);
      related.forEach(y=>add(y.w));
      (FALLBACK[x._group]||FALLBACK["その他"]).forEach(add);
      if(hints.length<5)for(const y of groupWords[x._group]||[]){if(y!==x)add(y.w);if(hints.length===5)break}
      const length=[...x.w].length,d=length<=2?2:length<=5?3:4;
      return {w:x.w,r:x.r,e:x.e,d,c:x._group,ng:hints.slice(0,5)};
    });
  }
  return {curate,group,groups:GROUPS.map(x=>x[0])};
});
