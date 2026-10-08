import { initializeApp }
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getDatabase,
  ref,
  set,
  update,
  onValue,
  runTransaction,
  onDisconnect,
  get
}
from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";


/* =========================
   FIREBASE
========================= */

const firebaseConfig = {
  apiKey: "AIzaSyBreTSe1m0-xlbF4aupnU5isRZCihR25IE",
  authDomain: "formwheel.firebaseapp.com",
  databaseURL: "https://formwheel-default-rtdb.firebaseio.com",
  projectId: "formwheel",
  storageBucket: "formwheel.firebasestorage.app",
  messagingSenderId: "431583088241",
  appId: "1:431583088241:web:74e0e34ea1e3e1170c55d0",
  measurementId: "G-T372YXDF8D"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);


/* =========================
   CONSTANTS
========================= */

const MAX_PLAYERS = 4;
const MAX_ROUNDS = 10;

const ACTIONS = {
  attack:"attack",
  defend:"defend",
  greed:"greed",
  swap:"swap",
  random:"random"
};


/* =========================
   STATE
========================= */

let roomId = "";
let playerId = "";
let isHost = false;

let selectedAction = null;
let localState = null;

const nicknameEl = document.getElementById("nickname");


/* =========================
   HELPERS
========================= */

function randomId(){
  return Math.random().toString(36).slice(2,10);
}

function roomCode(){
  return String(Math.floor(1000 + Math.random()*9000));
}

function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function playerRef(){
  return ref(db,`balance/${roomId}/players/${playerId}`);
}

function gameRef(){
  return ref(db,`balance/${roomId}`);
}

function getPlayers(state){
  return Object.values(state.players || {});
}

function show(el){
  el.style.display="block";
}

function hide(el){
  el.style.display="none";
}


/* =========================
   SETUP
========================= */

document.getElementById("createBtn").onclick = async ()=>{

  const name = nicknameEl.value.trim();

  if(!name){
    alert("닉네임을 입력해주세요.");
    return;
  }

  playerId = randomId();
  roomId = roomCode();
  isHost = true;

  const data = {

    meta:{
      host:playerId,
      started:false,
      round:0,
      maxRounds:MAX_ROUNDS
    },

    players:{
      [playerId]:{
        id:playerId,
        name:name.slice(0,12),
        score:0,
        risk:0,
        action:null,
        ready:false
      }
    }

  };

  await set(gameRef(),data);

  enterLobby();
  listenRoom();
};


document.getElementById("joinBtn").onclick = ()=>{
  const area = document.getElementById("joinArea");

  area.style.display =
    area.style.display === "none"
    ? "block"
    : "none";
};


document.getElementById("joinConfirm").onclick = async ()=>{

  const name = nicknameEl.value.trim();
  const code = document.getElementById("roomInput").value.trim();

  if(!name){
    alert("닉네임을 입력해주세요.");
    return;
  }

  if(!/^\d{4}$/.test(code)){
    alert("4자리 방 코드를 입력해주세요.");
    return;
  }

  roomId = code;

  const snap = await get(ref(db,`balance/${roomId}`));

  if(!snap.exists()){
    alert("존재하지 않는 방입니다.");
    return;
  }

  const state = snap.val();
  const players = getPlayers(state);

  if(players.length >= MAX_PLAYERS){
    alert("방이 가득 찼습니다.");
    return;
  }

  if(state.meta.started){
    alert("이미 시작된 게임입니다.");
    return;
  }

  playerId = randomId();
  isHost = false;

  await set(
    ref(db,`balance/${roomId}/players/${playerId}`),
    {
      id:playerId,
      name:name.slice(0,12),
      score:0,
      risk:0,
      action:null,
      ready:false
    }
  );

  enterLobby();
  listenRoom();
};


function enterLobby(){

  show(document.getElementById("setup"));
  hide(nicknameEl);
  hide(document.getElementById("createBtn").parentElement);
  hide(document.getElementById("joinArea"));
  show(document.getElementById("roomInfo"));

  document.getElementById("roomCode").textContent = roomId;

  if(isHost){
    show(document.getElementById("startBtn"));
  }
}


/* =========================
   COPY
========================= */

document.getElementById("copyBtn").onclick = async ()=>{

  try{
    await navigator.clipboard.writeText(roomId);
    document.getElementById("copyBtn").textContent="복사 완료!";
    setTimeout(()=>{
      document.getElementById("copyBtn").textContent="방 코드 복사";
    },1200);
  }catch{
    alert("방 코드: "+roomId);
  }

};


/* =========================
   ROOM LISTENER
========================= */

let balanceUnsubscribe=null;
function listenRoom(){
  if(balanceUnsubscribe)balanceUnsubscribe();
  onDisconnect(playerRef()).remove().catch(()=>{});
  balanceUnsubscribe=onValue(gameRef(),snap=>{

    if(!snap.exists()){
      return;
    }

    const state = snap.val();

    const previousRound=localState?.meta?.round;
    localState = state;
    if(!state.players?.[state.meta.host] || (state.meta.started && getPlayers(state).length<2 && !state.meta.finished)){
      runTransaction(gameRef(),current=>{
        if(!current)return;const ids=Object.keys(current.players||{});let changed=false;
        if(!current.players?.[current.meta.host]){current.meta.host=ids[0]||"";changed=true;}
        if(current.meta.started&&ids.length<2&&!current.meta.finished){current.meta.finished=true;changed=true;}
        return changed?current:undefined;
      },{applyLocally:false}).catch(()=>{});
    }
    if(previousRound!==state.meta.round){selectedAction=null;document.querySelectorAll(".action").forEach(x=>x.classList.remove("selected"));}
    if(state.meta.started&&!state.meta.finished&&getPlayers(state).every(p=>p.ready)&&state.meta.host===playerId)resolveRound(state);

    renderLobby(state);

    if(state.meta?.started){
      hide(document.getElementById("setup"));
      show(document.getElementById("game"));
      renderGame(state);
    }

  });

}


/* =========================
   LOBBY
========================= */

function renderLobby(state){

  const container = document.getElementById("players");

  container.innerHTML="";

  const players = getPlayers(state);

  for(let i=0;i<MAX_PLAYERS;i++){

    const p = players[i];

    const box = document.createElement("div");
    box.className="playerBox";

    if(p && p.id===state.meta.host){
      box.classList.add("host");
    }

    if(p){

      box.innerHTML=`
        <div class="playerName">
          ${escapeHtml(p.name)}
        </div>
        <div class="playerStatus">
          ${p.id===state.meta.host ? "👑 호스트" : "플레이어"}
        </div>
      `;

    }else{

      box.innerHTML=`
        <div class="playerName">빈 자리</div>
        <div class="playerStatus">대기 중</div>
      `;

    }

    container.appendChild(box);
  }

  const start = document.getElementById("startBtn");

  isHost = state.meta.host === playerId;
  start.style.display = isHost ? "block" : "none";
  if(isHost){
    start.style.display="block";
    start.disabled = players.length < 2;
    start.textContent =
      players.length < 2
      ? `플레이어 대기 중 (${players.length}/2)`
      : `게임 시작 (${players.length}명)`;
  }

}


/* =========================
   START GAME
========================= */

document.getElementById("startBtn").onclick = async ()=>{

  if(!isHost) return;

  const snap = await get(gameRef());

  if(!snap.exists()) return;

  const state = snap.val();
  const players = getPlayers(state);

  if(players.length < 2){
    alert("최소 2명이 필요합니다.");
    return;
  }

  const updates = {
    "meta/started":true,
    "meta/round":1
  };

  for(const p of players){

    updates[`players/${p.id}/score`] = 0;
    updates[`players/${p.id}/risk`] = 0;
    updates[`players/${p.id}/action`] = null;
    updates[`players/${p.id}/ready`] = false;

  }

  await update(gameRef(),updates);

};


/* =========================
   ACTION BUTTONS
========================= */

document.querySelectorAll(".action").forEach(btn=>{

  btn.onclick = async ()=>{

    if(!localState?.meta?.started){
      return;
    }

    if(selectedAction){
      return;
    }

    selectedAction = btn.dataset.action;

    document.querySelectorAll(".action")
      .forEach(x=>x.classList.remove("selected"));

    btn.classList.add("selected");

    document.getElementById("waiting").textContent =
      "선택 완료! 다른 플레이어를 기다리는 중...";

    await update(playerRef(),{
      action:selectedAction,
      ready:true
    });

    checkRoundReady();

  };

});


/* =========================
   CHECK ROUND
========================= */

async function checkRoundReady(){

  const snap = await get(gameRef());

  if(!snap.exists()) return;

  const state = snap.val();

  const players = getPlayers(state);

  if(players.length < 2) return;

  const ready = players.filter(p=>p.ready);

  if(ready.length !== players.length){
    return;
  }

  if(state.meta.host !== playerId){
    return;
  }

  resolveRound(state);

}


/* =========================
   ROUND LOGIC
========================= */

function calculateBalanceRound(state, random=Math.random){

  const players = getPlayers(state);

  const results = {};

  players.forEach(p=>{
    results[p.id]={
      score:p.score || 0,
      risk:p.risk || 0,
      action:p.action
    };
  });


  /* -------------------------
     ACTIONS
  ------------------------- */

  for(const p of players){

    const action = p.action;

    if(action==="defend"){

      results[p.id].risk =
        Math.max(0,results[p.id].risk - 12);

      results[p.id].score += 2;

    }

    if(action==="greed"){

      results[p.id].score += 30;
      results[p.id].risk += 10;

    }

    if(action==="attack"){

      results[p.id].score += 5;
      results[p.id].risk += 1;

    }

    if(action==="random"){

      const roll = Math.floor(random()*100);

      if(roll < 25){

        results[p.id].score += 35;
        results[p.id].risk += 15;

      }else if(roll < 50){

        results[p.id].score += 10;
        results[p.id].risk += 5;

      }else if(roll < 75){

        results[p.id].score -= 15;
        results[p.id].risk += 8;

      }else{

        results[p.id].score += 5;
        results[p.id].risk -= 10;

      }

    }

  }


  /* -------------------------
     ATTACK
  ------------------------- */

  const attackers =
    players.filter(p=>p.action==="attack");

  for(const attacker of attackers){

    const others =
      players.filter(p=>p.id!==attacker.id);

    if(!others.length) continue;

    const target =
      others[Math.floor(random()*others.length)];

    results[target.id].score -= 8;
    results[target.id].risk += 4;

  }


  /* -------------------------
     SWAP
  ------------------------- */

  const swappers =
    players.filter(p=>p.action==="swap");

  for(const p of swappers){

    const others =
      players.filter(x=>x.id!==p.id);

    if(!others.length) continue;

    const target =
      others[Math.floor(random()*others.length)];

    const tempScore = results[p.id].score;

    results[p.id].score =
      results[target.id].score;

    results[target.id].score =
      tempScore;

  }


  /* -------------------------
     NATURAL RISK
  ------------------------- */

  for(const p of players){

    results[p.id].risk =
      Math.max(
        0,
        Math.min(100,results[p.id].risk)
      );

  }


  /* -------------------------
     SPECIAL EVENTS
  ------------------------- */

  const events=[];

  for(const p of players){

    if(results[p.id].risk >= 100){

      const event =
        Math.floor(random()*5);

      if(event===0){

        results[p.id].score += 50;

        events.push({
          icon:"💎",
          title:"대박!",
          text:`${p.name}의 위험이 폭발하며 +50점을 얻었습니다!`
        });

      }

      else if(event===1){

        results[p.id].score -= 40;

        events.push({
          icon:"💥",
          title:"균형 붕괴!",
          text:`${p.name}의 욕심이 너무 커져 -40점을 잃었습니다.`
        });

      }

      else if(event===2){

        results[p.id].score *= -1;

        events.push({
          icon:"🔄",
          title:"점수 반전!",
          text:`${p.name}의 점수가 반전되었습니다.`
        });

      }

      else if(event===3){

        results[p.id].score += 20;

        for(const q of players){

          if(q.id!==p.id){
            results[q.id].score -= 10;
          }

        }

        events.push({
          icon:"⚡",
          title:"폭주!",
          text:`${p.name}이 폭주했습니다! 본인 +20 / 다른 플레이어 -10`
        });

      }

      else{

        results[p.id].score = 0;

        events.push({
          icon:"🌀",
          title:"초기화!",
          text:`${p.name}의 점수가 0으로 초기화되었습니다.`
        });

      }

      results[p.id].risk = 35;

    }

  }


  /* -------------------------
     APPLY
  ------------------------- */

  const updates={};

  for(const p of players){

    updates[`players/${p.id}/score`] =
      Math.round(results[p.id].score);

    updates[`players/${p.id}/risk`] =
      Math.round(results[p.id].risk);

    updates[`players/${p.id}/action`] = null;
    updates[`players/${p.id}/ready`] = false;

  }


  const round = state.meta.round;

  if(round >= MAX_ROUNDS){

    updates["meta/finished"]=true;

  }else{

    updates["meta/round"]=round+1;

  }


  return {updates,events};
}

async function resolveRound(expected){
 const seed=Math.floor(Math.random()*4294967296);
 let events=[];
 const result=await runTransaction(gameRef(),state=>{
   if(!state||state.meta?.host!==playerId||!state.meta.started||state.meta.finished||state.meta.round!==expected.meta.round)return;
   const players=getPlayers(state);if(players.length<2||!players.every(p=>p.ready))return;
   let randomState=seed;
   const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296};
   const computed=calculateBalanceRound(state,random);events=computed.events;
   for(const [path,value] of Object.entries(computed.updates)){
     const parts=path.split('/');let target=state;for(const k of parts.slice(0,-1))target=target[k]||(target[k]={});target[parts.at(-1)]=value;
   }
   state.meta.lastEvents=events;state.meta.lastResolvedRound=expected.meta.round;return state;
 },{applyLocally:false});
 if(!result.committed)return;

  selectedAction=null;

  document.querySelectorAll(".action")
    .forEach(x=>x.classList.remove("selected"));

  document.getElementById("waiting").textContent =
    "다음 라운드의 행동을 선택하세요.";

  if(events.length){
    showEvent(events[0]);
  }

}


/* =========================
   GAME RENDER
========================= */

function renderGame(state){

  const players = getPlayers(state);

  const me = state.players[playerId];

  if(!me) return;

  const round =
    state.meta.finished
    ? MAX_ROUNDS
    : state.meta.round;

  document.getElementById("roundDisplay").textContent =
    `${round} / ${MAX_ROUNDS}`;

  document.getElementById("myName").textContent =
    me.name;

  document.getElementById("myScore").textContent =
    me.score;

  document.getElementById("bigScore").textContent =
    me.score;

  const risk =
    Math.max(0,Math.min(100,me.risk || 0));

  document.getElementById("riskText").textContent =
    `${risk} / 100`;

  document.getElementById("riskFill").style.width =
    `${risk}%`;


  if(me.ready){

    document.getElementById("waiting").textContent =
      "선택 완료! 다른 플레이어를 기다리는 중...";

  }else{

    document.getElementById("waiting").textContent =
      "행동을 선택하세요.";

  }


  renderPlayers(players,me.id);


  if(state.meta.finished){

    showResult(players);

  }

}


/* =========================
   PLAYER LIST
========================= */

function renderPlayers(players,myId){

  const box =
    document.getElementById("allPlayers");

  box.innerHTML="";

  players
    .sort((a,b)=>(b.score||0)-(a.score||0))
    .forEach(p=>{

      if(p.id===myId) return;

      const risk =
        Math.max(0,Math.min(100,p.risk||0));

      const card =
        document.createElement("div");

      card.className="card otherCard";

      card.innerHTML=`

        <div class="otherTop">

          <div>
            <div style="font-size:12px;color:#858893">
              ${p.ready ? "✅ 선택 완료" : "⏳ 선택 중"}
            </div>

            <div style="font-weight:900;margin-top:3px">
              ${escapeHtml(p.name)}
            </div>
          </div>

          <div class="otherScore">
            ${p.score}
          </div>

        </div>

        <div class="miniRisk">
          <div style="width:${risk}%"></div>
        </div>

        <div style="
          margin-top:6px;
          color:#858893;
          font-size:11px;
          text-align:right;
        ">
          위험도 ${risk}
        </div>

      `;

      box.appendChild(card);

    });

}


/* =========================
   EVENT
========================= */

function showEvent(event){

  document.getElementById("eventIcon").textContent =
    event.icon;

  document.getElementById("eventTitle").textContent =
    event.title;

  document.getElementById("eventText").textContent =
    event.text;

  document.getElementById("eventModal").style.display =
    "flex";

}

document.getElementById("eventClose").onclick = ()=>{
  hide(document.getElementById("eventModal"));
};


/* =========================
   RESULT
========================= */

function showResult(players){

  const list =
    document.getElementById("resultList");

  list.innerHTML="";

  const sorted =
    [...players]
      .sort((a,b)=>(b.score||0)-(a.score||0));

  sorted.forEach((p,index)=>{

    const row =
      document.createElement("div");

    row.className="resultRow";

    row.innerHTML=`
      <span>
        ${index===0 ? "🏆 " : ""}
        ${escapeHtml(p.name)}
      </span>

      <span>${p.score}점</span>
    `;

    list.appendChild(row);

  });

  document.getElementById("resultModal").style.display =
    "flex";

}


/* =========================
   BACK HOME
========================= */

document.getElementById("backHome").onclick = ()=>{
  location.href="https://semicolonxss.github.io/Formwheel/";
};
