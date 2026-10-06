#!/usr/bin/env node
"use strict";

/* Generate the browser-ready Japanese master list from the three Anki decks.
   Usage: node tools/import-anki-words.js collection.anki2 japanese-master.js */
const {execFileSync}=require("child_process");
const fs=require("fs");

const db=process.argv[2], out=process.argv[3]||"japanese-master.js";
if(!db) throw new Error("collection.anki2 path required");
const deckIds=[
  1620721486696,1631596601155,                 // Japanese Self-Study, Anime Cards
  1620298595076,1620298595077,1620298595081,  // Kanji Writing children
  1620298595089,1620298595100,1620298595111,
  1620298595122,1620298595133,1620298595186,
  1642910218873,1642910324138,1739625377038
];
const sql=`select distinct n.id,c.did,n.mid,hex(n.flds) from notes n join cards c on c.nid=n.id where c.did in (${deckIds.join(",")}) order by n.id`;
const raw=execFileSync("sqlite3",["-separator","\t",db,sql],{encoding:"utf8",maxBuffer:100*1024*1024});
const unhtml=s=>String(s||"")
  .replace(/\[(?:sound|anki:play):[^\]]*\]/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ")
  .replace(/<svg[\s\S]*?<\/svg>/gi," ").replace(/<[^>]+>/g," ")
  .replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"')
  .replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">")
  .replace(/\s+/g," ").trim();
const fields=hex=>Buffer.from(hex,"hex").toString("utf8").split("\x1f");
/* The source decks are personal study decks and contain adult, sexual, and
   vulgar vocabulary that is a poor fit for a mixed-age party game. Keep this
   explicit so regenerating the master list cannot silently add it back. */
const familyBlocked=new Set([
  "風俗","性癖","乳房","裸","陰茎","痴漢","童貞","不倫","淫ら","淫夢","尻","勃起",
  "変態","肛門","半ケツ","処女","卑猥","娼館","娼婦","視姦","性具","性器","避妊具",
  "猥褻","女犯","ビッチ","淫売","淫靡","接吻","ニケツ","両性具有","淫猥","貧乳",
  "性風俗店","原作レイプ","排泄","美乳","相姦","男の性","おっぱい","下着ドロ","巨乳",
  "おっぱい星人","プリケツ","ハーフカップブラ","下乳","淫行","便器","野糞","下着",
  "野郎","馬鹿","ぼろくそ","胸糞が悪い","自棄糞","糞食らえ","クソリプ","罰糞",
  "何糞","金魚の糞","おもっくそ","こなくそ"
  ,"売女","三角木馬","同伴出勤","児ポ法","ザーメン","にゃんにゃん","パイオツ",
  "男根","騎乗位","筆下ろし","先走り汁","ヤリ逃げ","おぼこ","早漏","絶倫",
  "官能","むっつりスケベ","浮気症","妊娠","堕胎","中絶","避妊","コンドーム",
  "睾丸","精巣","陰嚢","陰囊","アヘ顔ダブルピース","インキュバス","おめでた",
  "カウパー液","しけ込む","ダッチワイフ","タマヒュン","ちっぱい","ちんちん",
  "できちゃった結婚","ムフフ","もっこり","懐妊","去勢","賢者タイム","死産",
  "雌雄同体","痔","手篭め","酒池肉林","身重","身請け","身籠る","人工授精",
  "腎虚","前戯","前立腺","脱肛","男色","妊婦","濡れ場","破瓜","不感症",
  "包茎","乱パ","両刀","孕む","猥談","女衒","生娘","遊女","誘い受け","爛れた関係"
]);
const partyBlocked=new Set([
  /* self-harm and graphic violence */
  "自害","心中","首吊り","練炭自殺","死体","殺す","虐待","死刑","絞殺","拷問",
  "流血","処刑","切腹","遺体","暴行","公開処刑","虐殺","轢き殺す","惨殺","斬首",
  "縊り殺す","撲殺","絞殺す","刺殺","射殺","死体蹴り","リスカ","自刃","火炙り",
  "嬲り殺し","縛り首","打ち首獄門",
  /* slurs, harsh insults, and remaining sexual slang */
  "マジキチ","ネ釜","ブス専","チンカス","ショタ","ガイジ","キチガイ","気違い",
  "カタワ","土人","知恵遅れ","池沼","おかま","オカマ",
  /* hard drugs and severe diagnoses */
  "麻薬","覚醒剤","大麻","コカイン","ヘロイン","統合失調症","癌腫","胃癌"
]);
const clearlyAdult=/セックス|性交|性行為|膣|精液|射精|自慰|オナニ|マスターベーション|ちん(?:こ|ぽ)|まんこ|アナル|フェラ|クンニ|ポルノ|売春|買春|援助交際|強姦|レイプ/i;
const adultContent=/セックス|性交|性行為|性器|生殖器|陰茎|男根|睾丸|精巣|陰[嚢囊]|膣|精液|射精|早漏|勃起|自慰|オナニ|マスターベーション|ちん(?:こ|ぽ)|まんこ|おっぱい|乳房|アナル|肛門|フェラ|クンニ|ポルノ|猥褻|卑猥|痴漢|強姦|レイプ|売春|買春|援助交際|風俗店|娼婦|淫売|童貞|処女|ビッチ|絶倫|性欲|欲情|発情|交尾|媚薬|好色|情事|色事|スケベ|妊娠|堕胎|中絶|避妊|コンドーム|sexual|ejaculat|erecti|genital|intercourse|porn|prostitut|virgin|breast|penis|vagina|testicle|scrot|masturbat|contracept|condom|lewd|obscene|lust|libido|incest|orgasm|impoten|promiscuous|pregnan|abortion/i;
const vulgarContent=/胸糞|自棄糞|糞食らえ|クソリプ|罰糞|金魚の糞|野糞|ぼろくそ|こなくそ/i;
const partyContent=/自殺|自害|自傷|首吊|首つり|練炭|リストカット|リスカ|死体|殺人|殺害|虐殺|拷問|斬首|首切|処刑|死刑|切腹|流血|血まみれ|惨殺|絞殺|撲殺|轢き殺|刺殺|射殺|虐待|麻薬|覚醒剤|大麻|コカイン|ヘロイン|薬物|MDMA|LSD|シャブ|ヤク中|ガイジ|キチガイ|気違い|カタワ|土人|知恵遅れ|池沼|マジキチ|チンカス|ロリコン|ショタコン|セフレ|寝取られ|１８禁|18禁|エッチな|エロい/i;
const blockedHeads=new Set([...familyBlocked,...partyBlocked]);
const containsBlocked=s=>[...blockedHeads].some(term=>term.length>1 ? s.includes(term) : s===term);
const useful=(s,w,r)=>{
  s=unhtml(s).replace(w," ").replace(r," ");
  const bits=s.split(/(?:とは|という|こと|もの|ため|ので|から|まで|より|[\n\r,，、。;；:：!?！？/／|・⇀⇿（）()【】「」『』])/u);
  const en=s.match(/[A-Za-z][A-Za-z -]{1,24}/g)||[];
  return bits.concat(en).map(x=>x.replace(/^[\d\s._-]+|[\d\s._-]+$/g,"").trim())
    .filter(x=>x.length>=2&&x.length<=18&&!x.includes(w)&&x!==r);
};
const seen=new Set(), cards=[], rejected=[];
for(const line of raw.trim().split("\n")){
  if(!line) continue;
  const [,didS,midS,hex]=line.split("\t"), did=Number(didS), mid=Number(midS), f=fields(hex);
  let w="",r="",sources=[];
  if(mid===1539733671969){ w=unhtml(f[0]); r=unhtml(f[1]); sources=[f[7],f[2],f[3]]; }
  else if(mid===1759554738508){ w=unhtml(f[0]); r=unhtml(f[2]); sources=[f[11],f[7],f[5]]; }
  else if(mid===1645334669092){ w=unhtml(f[0]); r=unhtml(f[1]); sources=[f[2],f[3],f[7]]; }
  else continue;
  if(!w||w.length>30||seen.has(w)) continue;
  /* Filter the headword itself. Definitions often contain unrelated secondary
     senses, so they are sanitized hint-by-hint below instead of causing an
     innocent headword to be dropped. */
  if(blockedHeads.has(w)||clearlyAdult.test(w)||adultContent.test(w)||partyContent.test(w)){ rejected.push(w); continue; }
  seen.add(w);
  const ng=[];
  const add=x=>{
    x=unhtml(x);
    if(x&&x!==w&&!containsBlocked(x)&&!adultContent.test(x)&&!partyContent.test(x)&&!vulgarContent.test(x)&&!ng.includes(x)&&x.length<=18) ng.push(x);
  };
  if(r&&r!==w) add(r);
  sources.flatMap(x=>useful(x,w,r)).forEach(add);
  [...w].filter(ch=>/\p{Script=Han}/u.test(ch)).forEach(add);
  ["意味","ことば","読む","説明","使い方"].forEach(add);
  const category=did===1631596601155?"アニメカード":(mid===1539733671969?"漢字学習":"自習カード");
  cards.push({w,r:r===w?"":r,d:3,c:category,ng:ng.slice(0,5)});
}
const body="/* Generated from Anime Cards, Japanese Self-Study, and Kanji Writing. */\n"+
  "window.ANKI_DECK_JA=[\n"+cards.map(x=>JSON.stringify(x)).join(",\n")+"\n];\n";
fs.writeFileSync(out,body);
process.stdout.write(`wrote ${cards.length} unique Japanese words to ${out}\n`);
process.stdout.write(`filtered ${rejected.length} family-unfriendly words\n`);
