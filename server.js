const express=require("express");
const http=require("http");
const {Server}=require("socket.io");
const path=require("path");

const app=express();
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:true,credentials:true}});
const rooms=new Map();

app.get("/health",(_req,res)=>res.json({ok:true,rooms:rooms.size}));
app.use(express.static(path.join(__dirname)));

function makeCode(){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do{code="";for(let i=0;i<6;i++)code+=chars[Math.floor(Math.random()*chars.length)]}
  while(rooms.has(code));
  return code;
}
function cleanName(v){return String(v||"").trim().slice(0,24)}
function cleanText(v){return String(v||"").trim().slice(0,500)}

function publicState(room,socketId){
  const question=room.questions[room.round]||"Waiting for the host to start…";
  const players=Object.values(room.players).map(p=>({name:p.name,xp:p.xp}));
  const subs=room.subs.map(s=>({player:s.player,text:s.text,correct:s.correct}));
  return {
    room:room.code,set:room.set,round:room.round,question,players,subs,
    submitted:room.subs.some(s=>s.socketId===socketId)
  };
}
function broadcast(room){
  if(!room)return;
  io.to(room.host).emit("host-state",publicState(room,room.host));
  for(const p of Object.values(room.players)){
    io.to(p.socketId).emit("player-state",publicState(room,p.socketId));
  }
}

io.on("connection",socket=>{

  socket.on("create-room",({set=0}={})=>{
    if(socket.data.room)return;
    const code=makeCode();
    const room={
      code,host:socket.id,set:Number(set)||0,round:0,
      questions:[],players:{},subs:[],last:Date.now()
    };
    rooms.set(code,room);
    socket.data.room=code;
    socket.data.role="host";
    socket.join(code);
    socket.emit("room-created",{room:code});
  });

  socket.on("host-sync",({questions}={},ack)=>{
    const room=rooms.get(socket.data.room);
    if(!room||room.host!==socket.id){
      if(typeof ack==="function")ack({ok:false,message:"Host room not found."});
      return;
    }
    if(!Array.isArray(questions)||questions.length<10){
      if(typeof ack==="function")ack({ok:false,message:"The selected set does not contain 10 questions."});
      return;
    }
    room.questions=questions.slice(0,10).map(cleanText);
    room.round=0;
    room.subs=[];
    room.last=Date.now();
    broadcast(room);
    if(typeof ack==="function")ack({ok:true,message:"Questions synced."});
  });

  socket.on("join-room",({room:roomCode,name}={})=>{
    const room=rooms.get(String(roomCode||"").trim().toUpperCase());
    const clean=cleanName(name);
    if(!room)return socket.emit("join-error",{message:"Room not found. Check the room code."});
    if(!clean)return socket.emit("join-error",{message:"Enter your player name."});
    if(Object.values(room.players).some(p=>p.name.toLowerCase()===clean.toLowerCase()))
      return socket.emit("join-error",{message:"That player name is already in the room."});
    if(Object.keys(room.players).length>=30)
      return socket.emit("join-error",{message:"This room is full."});

    room.players[socket.id]={name:clean,xp:0,socketId:socket.id};
    socket.data.room=room.code;
    socket.data.role="player";
    socket.join(room.code);

    socket.emit("joined",{state:publicState(room,socket.id)});
    broadcast(room);
  });

  socket.on("submit-answer",({text}={},ack)=>{
    const room=rooms.get(socket.data.room);
    if(!room||socket.data.role!=="player"){
      if(typeof ack==="function")ack({ok:false,message:"You are not in a game room."});
      return;
    }
    const p=room.players[socket.id];
    if(!p){
      if(typeof ack==="function")ack({ok:false,message:"Player session not found."});
      return;
    }
    const answer=cleanText(text);
    if(!answer){
      if(typeof ack==="function")ack({ok:false,message:"Answer cannot be empty."});
      return;
    }
    if(room.subs.some(s=>s.socketId===socket.id)){
      if(typeof ack==="function")ack({ok:false,message:"You already submitted an answer for this round."});
      return;
    }

    room.subs.push({
      socketId:socket.id,player:p.name,text:answer,correct:false
    });
    room.last=Date.now();
    broadcast(room);
    if(typeof ack==="function")ack({ok:true});
  });

  socket.on("award",({index}={},ack)=>{
    const room=rooms.get(socket.data.room);
    if(!room||room.host!==socket.id){
      if(typeof ack==="function")ack({ok:false,message:"Host session not found."});
      return;
    }
    const n=Number(index);
    if(!Number.isInteger(n)||n<0||n>=room.subs.length){
      if(typeof ack==="function")ack({ok:false,message:"That answer is no longer available."});
      return;
    }
    const sub=room.subs[n];
    if(!sub||sub.correct){
      if(typeof ack==="function")ack({ok:false,message:"This answer has already been awarded."});
      return;
    }

    sub.correct=true;
    if(room.players[sub.socketId])room.players[sub.socketId].xp+=200;
    room.last=Date.now();
    broadcast(room);
    if(typeof ack==="function")ack({ok:true,message:`${sub.player} received +200 XP.`});
  });

  socket.on("next-round",({},ack)=>{
    const room=rooms.get(socket.data.room);
    if(!room||room.host!==socket.id){
      if(typeof ack==="function")ack({ok:false,message:"Host session not found."});
      return;
    }
    if(room.questions.length<10){
      if(typeof ack==="function")ack({ok:false,message:"Questions are not synced yet."});
      return;
    }
    if(room.round>=9){
      if(typeof ack==="function")ack({ok:false,message:"All 10 rounds in this set are complete."});
      return;
    }

    room.round+=1;
    room.subs=[]; // every player gets a fresh answer slot
    room.last=Date.now();
    broadcast(room);

    if(typeof ack==="function")ack({
      ok:true,message:`Round ${room.round+1} question is ready.`
    });
  });

  socket.on("disconnect",()=>{
    const code=socket.data.room;
    if(!code)return;
    const room=rooms.get(code);
    if(!room)return;

    if(room.host===socket.id){
      rooms.delete(code);
      io.to(code).emit("join-error",{message:"The host has left the room."});
      return;
    }

    delete room.players[socket.id];
    room.subs=room.subs.filter(s=>s.socketId!==socket.id);
    room.last=Date.now();
    broadcast(room);
  });
});

setInterval(()=>{
  const now=Date.now();
  for(const [code,room] of rooms){
    if(now-(room.last||now)>6*60*60*1000)rooms.delete(code);
  }
},30*60*1000);

const PORT=process.env.PORT||10000;
server.listen(PORT,"0.0.0.0",()=>console.log(`MENTIONING server listening on ${PORT}`));
