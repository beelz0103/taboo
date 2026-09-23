#!/usr/bin/env node
/*
  タブー — companion relay.

  Zero dependencies. Serves index.html to the phones on your Wi-Fi and relays
  messages between the game screen and the judge / buzzer / scorekeeper screens.

      node server.js            # then open the printed URL on every phone
      PORT=9000 node server.js  # if you want to choose the port yourself

  Binds IPv4 explicitly. Binding the default dual-stack address lets this
  process quietly take [::]:PORT while something else (nginx, a container)
  already holds 0.0.0.0:PORT — both "succeed" and the phones reach the other
  one. So: explicit 0.0.0.0, a real EADDRINUSE, and a hop to the next port.

  Transport is SSE down (GET /events) + POST up (POST /send), which needs no
  framing, no npm install and reconnects on its own. Rooms are in memory only:
  stop the process and everything is gone, which is the whole point.
*/
"use strict";
const http = require("http");
const fs   = require("fs");
const path = require("path");
const os   = require("os");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 7331);   /* 8080 is somebody else's port */
const HOST = process.env.HOST || "0.0.0.0";      /* never the dual-stack default */
const PORT_TRIES = 12;
const ROOT = __dirname;
const MAX_ROOMS = 200, MAX_PEERS = 16, MAX_BODY = 64 * 1024, KEEPALIVE = 25000;

/* Hosting belongs to the machine running this process — no key to type, no
   prompt to see. A guest's phone comes in over the LAN, is not this machine,
   and so the relay refuses to carry the messages only a host sends. The key
   is the escape hatch for hosting from your own phone: /?host=KEY */
const HOST_KEY = process.env.HOST_KEY || crypto.randomBytes(3).toString("hex").toUpperCase();
const HOST_ONLY = ["state", "card", "played", "afk"];
const OWNER_LOCAL = process.env.OWNER_LOCAL !== "0";
const LOOPBACK = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

function ownAddresses(){
  const out = new Set(LOOPBACK);
  for(const list of Object.values(os.networkInterfaces()))
    for(const ni of list || [])
      if(ni.family === "IPv4"){ out.add(ni.address); out.add("::ffff:"+ni.address); }
  return out;
}
/* the same machine — loopback, or one of this box's own addresses (the owner
   opening the Wi-Fi URL on the laptop that is serving it) */
function isOwner(remoteAddress, key){
  if(String(key||"").toUpperCase() === HOST_KEY) return true;
  if(!OWNER_LOCAL) return false;
  return ownAddresses().has(String(remoteAddress||""));
}
module.exports = { isOwner, HOST_KEY };

/** code -> room state. Played-card ids intentionally survive an empty room for
    the lifetime of this process, while the cards themselves remain on clients. */
const rooms = new Map();

const cleanRoom = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
const cleanId   = s => String(s || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 16);

function cors(res){
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}
function room(code){
  let r = rooms.get(code);
  if(!r){
    if(rooms.size >= MAX_ROOMS) return null;
    r = { peers: new Map(), last: null, card: null, played: new Map() };
    rooms.set(code, r);
  }
  return r;
}
function fanout(r, from, msg){
  const line = "data: " + JSON.stringify(msg) + "\n\n";
  /* msg.not lists peers this must NOT reach — the card never travels to the
     describer's own team, so their phone cannot show it however hard they try */
  const block = Array.isArray(msg && msg.not) ? msg.not : null;
  for(const [id, res] of r.peers){
    if(id === from) continue;           /* never echo to the sender */
    if(block && block.indexOf(id) >= 0) continue;
    try{ res.write(line); }catch(e){ r.peers.delete(id); }
  }
}
function announce(code){
  const r = rooms.get(code);
  if(r) fanout(r, null, { t:"peers", n:r.peers.size });
}
function cleanDay(s){
  const day = String(s || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}
function cleanCardKey(s){
  return String(s || "").replace(/[^A-Za-z0-9:_-]/g, "").slice(0, 80);
}
function rememberPlayed(r, day, key){
  day=cleanDay(day); key=cleanCardKey(key);
  if(!day || !key) return false;
  let set=r.played.get(day);
  if(!set){ set=new Set(); r.played.set(day,set); }
  set.add(key);
  /* Daily history is only useful for a short window; cap it without touching
     today's in-memory list. */
  while(r.played.size>3) r.played.delete(r.played.keys().next().value);
  return true;
}
function actionAllowed(r, msg, id){
  if(!msg || !["act","buzz","go","skip"].includes(msg.t)) return true;
  const state=r && r.last;
  if(!state || !Array.isArray(state.roster)) return false;
  const actor=state.roster.find(x=>String(x.id||"")===String(id||""));
  if(!actor) return false;
  if(msg.t==="go") return actor.i===state.judgeSeat;
  if(msg.t==="skip") return actor.i===state.turnSeat;
  const action=msg.t==="buzz" ? "buzz" : msg.a;
  if(action==="buzz"){
    const activeKey=r.card && r.card.card && r.card.card.key;
    return actor.i===state.judgeSeat && !!activeKey && msg.cardKey===activeKey;
  }
  if(action==="ok") return actor.i===state.judgeSeat;
  if(action==="pass" || action==="turn") return actor.i===state.turnSeat;
  return false;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  cors(res);

  if(req.method === "OPTIONS"){ res.writeHead(204); return res.end(); }

  /* ---- claim hosting rights ---- */
  if(req.method === "GET" && url.pathname === "/host"){
    const ok = isOwner(req.socket.remoteAddress, url.searchParams.get("key"));
    res.writeHead(ok ? 200 : 403, {"content-type":"application/json"});
    return res.end(JSON.stringify({ok}));
  }

  /* ---- the page itself, so a phone can just open this server ---- */
  if(req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")){
    return fs.readFile(path.join(ROOT, "index.html"), (err, buf) => {
      if(err){ res.writeHead(404, {"content-type":"text/plain"}); return res.end("index.html not found"); }
      res.writeHead(200, {"content-type":"text/html; charset=utf-8", "cache-control":"no-cache"});
      res.end(buf);
    });
  }
  if(req.method === "GET" && url.pathname === "/japanese-master.js"){
    return fs.readFile(path.join(ROOT, "japanese-master.js"), (err, buf) => {
      if(err){ res.writeHead(404, {"content-type":"text/plain"}); return res.end("word list not found"); }
      res.writeHead(200, {"content-type":"text/javascript; charset=utf-8", "cache-control":"no-cache"});
      res.end(buf);
    });
  }

  /* ---- a screen joins a room and listens ---- */
  if(req.method === "GET" && url.pathname === "/events"){
    const code = cleanRoom(url.searchParams.get("room"));
    const id   = cleanId(url.searchParams.get("id"));
    if(!code || !id){ res.writeHead(400); return res.end("room and id required"); }
    const r = room(code);
    if(!r){ res.writeHead(503); return res.end("too many rooms"); }
    if(r.peers.size >= MAX_PEERS && !r.peers.has(id)){ res.writeHead(503); return res.end("room full"); }

    res.writeHead(200, {
      "content-type":"text/event-stream; charset=utf-8",
      "cache-control":"no-cache, no-transform",
      "connection":"keep-alive",
      "x-accel-buffering":"no"
    });
    res.write("retry: 2000\n\n");
    r.peers.set(id, res);

    /* a screen joining mid-turn gets the current state straight away */
    for(const [day,cards] of r.played)
      res.write("data: " + JSON.stringify({t:"played", day, cards:[...cards]}) + "\n\n");
    if(r.last) res.write("data: " + JSON.stringify(r.last) + "\n\n");
    if(r.card && !(Array.isArray(r.card.not) && r.card.not.indexOf(id) >= 0))
      res.write("data: " + JSON.stringify(r.card) + "\n\n");
    res.write("data: " + JSON.stringify({ t:"peers", n:r.peers.size }) + "\n\n");
    announce(code);

    const beat = setInterval(() => { try{ res.write(": ping\n\n"); }catch(e){} }, KEEPALIVE);
    const bye = () => {
      clearInterval(beat);
      const cur = rooms.get(code);
      if(!cur) return;
      if(cur.peers.get(id) === res) cur.peers.delete(id);
      /* Keep played-card ids in memory even while everybody disconnects. */
      if(cur.peers.size === 0 && cur.played.size === 0) rooms.delete(code);
      else if(cur.peers.size) announce(code);
    };
    req.on("close", bye);
    req.on("error", bye);
    return;
  }

  /* ---- a screen says something to the room ---- */
  if(req.method === "POST" && url.pathname === "/send"){
    const code = cleanRoom(url.searchParams.get("room"));
    const id   = cleanId(url.searchParams.get("id"));
    if(!code){ res.writeHead(400); return res.end("room required"); }
    let body = "", tooBig = false;
    req.on("data", c => {
      if(tooBig) return;
      body += c;
      if(body.length > MAX_BODY){ tooBig = true; body = ""; }
    });
    req.on("end", () => {
      if(tooBig){ res.writeHead(413); return res.end("too big"); }
      let msg;
      try{ msg = JSON.parse(body); }catch(e){ res.writeHead(400); return res.end("bad json"); }
      if(msg && HOST_ONLY.indexOf(msg.t) >= 0 &&
         !isOwner(req.socket.remoteAddress, url.searchParams.get("key"))){
        res.writeHead(403, {"content-type":"application/json"});
        return res.end(JSON.stringify({error:"not_host"}));
      }
      const r = rooms.get(code);
      if(r){
        if(!actionAllowed(r,msg,id)){
          res.writeHead(403, {"content-type":"application/json"});
          return res.end(JSON.stringify({error:"not_allowed"}));
        }
        /* keep the latest game state so late joiners are not staring at nothing */
        if(msg && msg.t === "state") r.last = msg;
        if(msg && msg.t === "card")  r.card = msg;
        if(msg && msg.t === "played") rememberPlayed(r, msg.day, msg.key);
        if(msg && msg.t === "card" && msg.card && rememberPlayed(r, msg.day, msg.card.key))
          fanout(r, id, {t:"played", day:msg.day, key:msg.card.key});
        /* The relay supplies the authenticated connection id. Clients use it
           to resolve the actor's seat instead of trusting a claimed seat. */
        if(msg && typeof msg === "object") msg.from = id;
        fanout(r, id, msg);
      }
      res.writeHead(204); res.end();
    });
    return;
  }

  if(url.pathname === "/health"){
    res.writeHead(200, {"content-type":"application/json"});
    return res.end(JSON.stringify({
      ok:true, rooms:[...rooms].map(([c,r])=>({room:c, screens:r.peers.size}))
    }));
  }

  res.writeHead(404, {"content-type":"text/plain"});
  res.end("not found");
});

function lanIPs(){
  const out = [];
  for(const list of Object.values(os.networkInterfaces()))
    for(const ni of list || [])
      if(ni.family === "IPv4" && !ni.internal) out.push(ni.address);
  return out;
}

/* Make sure the thing answering on our port is actually us. If some other
   server has the address, say so plainly instead of serving a mystery page. */
function verify(port, done){
  const req = http.get({host:"127.0.0.1", port, path:"/health", timeout:2500}, res => {
    let body = "";
    res.on("data", c => body += c);
    res.on("end", () => {
      let mine = false;
      try{ mine = JSON.parse(body).ok === true; }catch(e){}
      done(mine, res.headers.server || "");
    });
  });
  req.on("timeout", () => { req.destroy(); done(false, "no answer"); });
  req.on("error", () => done(false, "no answer"));
}

function listen(port, tries){
  /* both handlers are one-shot and each clears the other: a failed attempt
     must not leave its 'listening' callback armed for the next port. */
  const onError = err => {
    server.removeAllListeners("listening");
    if(err.code === "EADDRINUSE" && tries > 0){
      console.log("  port " + port + " is taken, trying " + (port+1) + "…");
      return listen(port + 1, tries - 1);
    }
    console.error("\n  could not start: " + err.message + "\n");
    process.exit(1);
  };
  server.once("error", onError);
  server.once("listening", () => {
    server.removeListener("error", onError);
    verify(port, (mine, who) => {
      if(!mine){
        console.error("\n  Something else is answering on port " + port +
                      (who ? " (" + who + ")" : "") + ".");
        console.error("  Restart with a different one:  PORT=9000 node server.js\n");
        process.exit(1);
      }
      const ips = lanIPs();
      console.log("\n  タブー — companion relay running\n");
      console.log("  on this machine   http://localhost:" + port);
      ips.forEach(ip => console.log("  on your Wi-Fi     http://" + ip + ":" + port));
      console.log("\n  Open that on every phone — they can join. Only this machine can host.");
      console.log("\n  To host from your own phone instead, open:");
      ips.forEach(ip => console.log("    http://" + ip + ":" + port + "/?host=" + HOST_KEY));
      console.log("\n  Ctrl-C to stop. Nothing is written to disk.\n");
    });
  });
  server.listen(port, HOST);
}
if(require.main === module) listen(PORT, PORT_TRIES);
