
const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const MAX = 5;
const rooms = new Map();

const SUITS = [
  {s:"♠", code:"S", copies:2},
  {s:"♥", code:"H", copies:1},
  {s:"♦", code:"D", copies:1},
  {s:"♣", code:"C", copies:1}
];
const RANKS = ["2","3","4","5","6","7","8","9","10","J","Q","K","A"];
const RV = {2:2,3:3,4:4,5:5,6:6,7:7,8:8,9:9,10:10,J:11,Q:12,K:13,A:14};

function deck65() {
  const d=[]; let id=0;
  for (const x of SUITS) {
    for (let copy=0; copy<x.copies; copy++) {
      for (const r of RANKS) d.push({id:id++, s:x.s, code:x.code, r, copy});
    }
  }
  return d;
}
function shuffle(a) {
  for (let i=a.length-1;i>0;i--) {
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
function rankValue(r){ return RV[r]; }
function straightHigh(vals){
  const u=[...new Set(vals)].sort((a,b)=>b-a);
  if(u.length!==5) return 0;
  if(u[0]===14 && u[1]===5 && u[2]===4 && u[3]===3 && u[4]===2) return 5;
  if(u[0]-u[4]===4) return u[0];
  return 0;
}
function eval5(cards){
  const vals=cards.map(c=>rankValue(c.r));
  const counts={}; vals.forEach(v=>counts[v]=(counts[v]||0)+1);
  const groups=Object.entries(counts).map(([v,c])=>({v:+v,c}))
    .sort((a,b)=>b.c-a.c||b.v-a.v);
  const flush=cards.every(c=>c.s===cards[0].s);
  const sh=straightHigh(vals);
  const desc=[...vals].sort((a,b)=>b-a);
  const pairs=groups.filter(g=>g.c===2).sort((a,b)=>b.v-a.v);

  if(groups[0]?.c===5) return {cat:11,name:"五雷",key:[11,groups[0].v]};
  if(flush && sh) return {cat:10,name:"同花順",key:[10,sh]};
  if(groups[0]?.c===4) return {cat:9,name:"鐵支",key:[9,groups[0].v,groups[1].v]};
  if(groups[0]?.c===3 && groups[1]?.c===2) return {cat:8,name:"葫蘆",key:[8,groups[0].v,groups[1].v]};
  if(flush && pairs.length===2)
    return {cat:7,name:"同花兩對子",key:[7,pairs[0].v,pairs[1].v,groups.find(g=>g.c===1)?.v||0]};
  if(flush && pairs.length===1)
    return {cat:6,name:"同花對子",key:[6,pairs[0].v,...desc.filter(v=>v!==pairs[0].v)]};
  if(flush) return {cat:5,name:"同花",key:[5,...desc]};
  if(sh) return {cat:4,name:"順子",key:[4,sh]};
  if(groups[0]?.c===3) return {cat:3,name:"三條",key:[3,groups[0].v,...desc.filter(v=>v!==groups[0].v)]};
  if(pairs.length===2) return {cat:2,name:"兩對",key:[2,pairs[0].v,pairs[1].v,groups.find(g=>g.c===1)?.v||0]};
  if(pairs.length===1) return {cat:1,name:"一對",key:[1,pairs[0].v,...desc.filter(v=>v!==pairs[0].v)]};
  return {cat:0,name:"散牌",key:[0,...desc]};
}
function eval3(cards){
  const vals=cards.map(c=>rankValue(c.r)).sort((a,b)=>b-a);
  const cnt={}; vals.forEach(v=>cnt[v]=(cnt[v]||0)+1);
  const gs=Object.entries(cnt).map(([v,c])=>({v:+v,c}))
    .sort((a,b)=>b.c-a.c||b.v-a.v);
  if(gs[0].c===3) return {cat:3,name:"三條",key:[3,gs[0].v]};
  if(gs[0].c===2) return {cat:1,name:"一對",key:[1,gs[0].v,...vals.filter(v=>v!==gs[0].v)]};
  return {cat:0,name:"散牌",key:[0,...vals]};
}
function evalHand(cards){ return cards.length===3 ? eval3(cards) : eval5(cards); }
function cmp(a,b){
  for(let i=0;i<Math.max(a.key.length,b.key.length);i++){
    const x=a.key[i]||0, y=b.key[i]||0;
    if(x>y) return 1; if(x<y) return -1;
  }
  return 0;
}
function legal(z){
  if(!z || z.head?.length!==3 || z.middle?.length!==5 || z.tail?.length!==5)
    return {ok:false,text:"請完成頭3、中5、尾5。"};
  const h=eval3(z.head), m=eval5(z.middle), t=eval5(z.tail);
  if(cmp(t,m)<=0) return {ok:false,text:`倒水：尾墩「${t.name}」牌力必須大於中墩「${m.name}」。`};
  if(cmp(m,h)<=0) return {ok:false,text:`倒水：中墩「${m.name}」牌力必須大於頭墩「${h.name}」。`};
  return {ok:true,text:`合法：頭 ${h.name}｜中 ${m.name}｜尾 ${t.name}`};
}
function comparePlayers(a,b){
  let wins=0;
  for(const z of ["head","middle","tail"]){
    const c=cmp(evalHand(a[z]),evalHand(b[z]));
    if(c>0) wins++; else if(c<0) wins--;
  }
  return wins===3 ? 1 : wins===-3 ? -1 : 0;
}
function scoreRound(sets){
  const delta=Array(sets.length).fill(0);
  for(let i=0;i<sets.length;i++) for(let j=i+1;j<sets.length;j++){
    const c=comparePlayers(sets[i],sets[j]);
    if(c===1){delta[i]+=100;delta[j]-=100;}
    else if(c===-1){delta[i]-=100;delta[j]+=100;}
  }
  return delta;
}
function publicRoom(room){
  return {
    code:room.code,
    phase:room.phase,
    players:room.players.map(p=>({id:p.id,name:p.name,ready:p.ready,submitted:!!p.submitted})),
    submittedCount:room.players.filter(p=>p.submitted).length
  };
}
function broadcast(room){
  io.to(room.code).emit("roomState", publicRoom(room));
  for(const p of room.players){
    io.to(p.id).emit("privateState", {
      phase:room.phase,
      hand:p.hand || [],
      z:p.submitted || {head:[],middle:[],tail:[]},
      scores:p.score
    });
  }
}
function roomCode(){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c;
  do { c=Array.from({length:5},()=>chars[Math.floor(Math.random()*chars.length)]).join(""); } while(rooms.has(c));
  return c;
}
function startGame(room){
  if(room.players.length<2) return false;
  const d=shuffle(deck65());
  room.phase="playing";
  room.players.forEach(p=>{p.hand=[];p.submitted=null;});
  d.forEach((card,i)=>room.players[i%room.players.length].hand.push(card));
  broadcast(room);
  return true;
}

io.on("connection", socket=>{
  socket.on("createRoom", ({name}, cb)=>{
    name=String(name||"玩家").trim().slice(0,16)||"玩家";
    const code=roomCode();
    const room={code,phase:"lobby",players:[],hostId:socket.id};
    rooms.set(code,room);
    room.players.push({id:socket.id,name,score:0,ready:false,hand:[],submitted:null});
    socket.join(code);
    cb({ok:true,code});
    broadcast(room);
  });

  socket.on("joinRoom", ({code,name}, cb)=>{
    code=String(code||"").trim().toUpperCase();
    name=String(name||"玩家").trim().slice(0,16)||"玩家";
    const room=rooms.get(code);
    if(!room) return cb({ok:false,error:"找不到房間。"});
    if(room.phase!=="lobby") return cb({ok:false,error:"遊戲已經開始。"});
    if(room.players.length>=MAX) return cb({ok:false,error:"房間已滿，最多 5 人。"});
    room.players.push({id:socket.id,name,score:0,ready:false,hand:[],submitted:null});
    socket.join(code);
    cb({ok:true,code});
    broadcast(room);
  });

  socket.on("startGame", ({code}, cb)=>{
    const room=rooms.get(code);
    if(!room) return cb?.({ok:false,error:"房間不存在。"});
    if(room.hostId!==socket.id) return cb?.({ok:false,error:"只有房主可以開始。"});
    if(room.players.length<2) return cb?.({ok:false,error:"至少需要 2 人。"});
    startGame(room);
    cb?.({ok:true});
  });

  socket.on("submitHand", ({code,z}, cb)=>{
    const room=rooms.get(code);
    if(!room || room.phase!=="playing") return cb({ok:false,error:"目前不能提交。"});
    const p=room.players.find(x=>x.id===socket.id);
    if(!p) return cb({ok:false,error:"玩家不存在。"});
    const ids=[...(z.head||[]),...(z.middle||[]),...(z.tail||[])].map(Number);
    if(ids.length!==13 || new Set(ids).size!==13) return cb({ok:false,error:"牌組數量不正確。"});
    const owned=new Set(p.hand.map(c=>c.id));
    if(ids.some(id=>!owned.has(id))) return cb({ok:false,error:"包含不屬於你的牌。"});
    const map=new Map(p.hand.map(c=>[c.id,c]));
    const real={head:(z.head||[]).map(id=>map.get(Number(id))),middle:(z.middle||[]).map(id=>map.get(Number(id))),tail:(z.tail||[]).map(id=>map.get(Number(id)))};
    const l=legal(real);
    if(!l.ok) return cb({ok:false,error:l.text});
    p.submitted={head:real.head,middle:real.middle,tail:real.tail};
    cb({ok:true});
    broadcast(room);
    if(room.players.every(x=>x.submitted)){
      const delta=scoreRound(room.players.map(x=>x.submitted));
      room.players.forEach((p,i)=>p.score+=delta[i]);
      room.phase="result";
      io.to(room.code).emit("roundResult", {
        delta,
        totals:room.players.map(p=>p.score),
        names:room.players.map(p=>p.name),
        sets:room.players.map(p=>p.submitted)
      });
      broadcast(room);
    }
  });

  socket.on("nextRound", ({code}, cb)=>{
    const room=rooms.get(code);
    if(!room) return cb?.({ok:false,error:"房間不存在。"});
    if(room.hostId!==socket.id) return cb?.({ok:false,error:"只有房主可以開下一局。"});
    startGame(room);
    cb?.({ok:true});
  });

  socket.on("disconnect", ()=>{
    for(const [code,room] of rooms){
      const idx=room.players.findIndex(p=>p.id===socket.id);
      if(idx<0) continue;
      room.players.splice(idx,1);
      if(room.players.length===0){rooms.delete(code);continue;}
      if(room.hostId===socket.id) room.hostId=room.players[0].id;
      if(room.phase==="playing" || room.phase==="result"){
        room.phase="lobby";
        room.players.forEach(p=>{p.hand=[];p.submitted=null;});
      }
      broadcast(room);
    }
  });
});

server.listen(PORT,()=>console.log(`13zhi online server listening on ${PORT}`));
