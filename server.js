const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });
const rooms = new Map();

app.get("/health", (_req,res)=>res.json({ok:true,rooms:rooms.size}));
app.use(express.static(path.join(__dirname)));

function makeCode(){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code="";
  do { code=""; for(let i=0;i<6;i++) code+=chars[Math.floor(Math.random()*chars.length)]; } while(rooms.has(code));
  return code;
}
function cleanName(v){return String(v||"").trim().slice(0,24)}
function cleanText(v){return String(v||"").trim().slice(0,500)}
function publicState(room, socketId){
  const question = room.questions[room.round] || "Waiting for the host to start…";
  const players = Object.values(room.players).map(p=>({name:p.name,xp:p.xp}));
  const subs = room.subs.map(s=>({player:s.player,text:s.text,correct:s.correct}));
  return {room:room.code,set:room.set,round:room.round,question,players,subs,submitted:room.subs.some(s=>s.socketId===socketId)};
}
function broadcast(room){
  io.to(room.code).emit("host-state", publicState(room, room.host));
  for(const p of Object.values(room.players)) io.to(p.socketId).emit("player-state", publicState(room,p.socketId));
}
function sendHost(room){io.to(room.host).emit("host-state", publicState(room,room.host));}

io.on("connection", socket=>{
  socket.on("create-room", ({set=0}={})=>{
    if(socket.data.room) return;
    const code=makeCode();
    // DATA lives in the browser; the server only tracks the round number and
    // receives the current question list from the client indirectly. For a
    // central server, store the question text by reading it from the host.
    rooms.set(code,{code,host:socket.id,set:Number(set)||0,round:0,questions:[],players:{},subs:[]});
    socket.data.room=code;socket.data.role="host";
    socket.emit("room-created",{room:code,state:{room:code,set:Number(set)||0,round:0,question:"Waiting for the first question…",players:[],subs:[]}});
  });

  socket.on("host-sync",({questions}={})=>{
    const room=rooms.get(socket.data.room); if(!room||room.host!==socket.id)return;
    if(Array.isArray(questions)&&questions.length>=10) room.questions=questions.slice(0,10).map(cleanText);
    broadcast(room);
  });

  socket.on("join-room",({room,name}={})=>{
    room=rooms.get(String(room||"").trim().toUpperCase());
    name=cleanName(name);
    if(!room)return socket.emit("join-error",{message:"Room not found. Make sure the host created the room and is still online."});
    if(!name)return socket.emit("join-error",{message:"Enter your player name."});
    if(Object.values(room.players).some(p=>p.name.toLowerCase()===name.toLowerCase()))return socket.emit("join-error",{message:"That player name is already in the room."});
    if(Object.keys(room.players).length>=30)return socket.emit("join-error",{message:"This room is full."});
    room.players[socket.id]={name,xp:0,socketId:socket.id};socket.data.room=room.code;socket.data.role="player";
    socket.join(room.code);
    if(room.questions.length===0){
      // The host will immediately sync questions after creation.
    }
    socket.emit("joined",{state:publicState(room,socket.id)});
    sendHost(room);
  });

  socket.on("submit-answer",({text}={})=>{
    const room=rooms.get(socket.data.room); if(!room||socket.data.role!=="player")return;
    const p=room.players[socket.id]; if(!p)return;
    text=cleanText(text);if(!text)return;
    if(room.subs.some(s=>s.socketId===socket.id))return socket.emit("answer-error",{message:"You already submitted an answer for this round."});
    room.subs.push({socketId:socket.id,player:p.name,text,correct:false});
    broadcast(room);
  });

  socket.on("award",({index}={})=>{
    const room=rooms.get(socket.data.room); if(!room||room.host!==socket.id)return;
    const s=room.subs[Number(index)];if(!s||s.correct)return;
    s.correct=true;if(room.players[s.socketId])room.players[s.socketId].xp+=200;
    broadcast(room);
  });

  socket.on("next-round",()=>{
    const room=rooms.get(socket.data.room);if(!room||room.host!==socket.id)return;
    if(room.round>=9)return;
    room.round++;room.subs=[];broadcast(room);
  });

  socket.on("disconnect",()=>{
    const code=socket.data.room;if(!code)return;const room=rooms.get(code);if(!room)return;
    if(room.host===socket.id){rooms.delete(code);io.to(code).emit("join-error",{message:"The host has left the room."});return;}
    delete room.players[socket.id];room.subs=room.subs.filter(s=>s.socketId!==socket.id);broadcast(room);
  });
});

setInterval(()=>{for(const [code,r] of rooms){if(Date.now()-(r.last||Date.now())>1000*60*60*6)rooms.delete(code)}},30*60*1000);
const PORT=process.env.PORT||10000;
server.listen(PORT,"0.0.0.0",()=>console.log(`MENTIONING LIVE server listening on ${PORT}`));
