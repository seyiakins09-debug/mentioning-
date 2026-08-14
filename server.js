const express=require("express");
const http=require("http");
const {Server}=require("socket.io");
const path=require("path");
const app=express(),server=http.createServer(app);
const io=new Server(server,{cors:{origin:"*",methods:["GET","POST"]}});
app.get("/health",(_,res)=>res.json({ok:true,service:"sey-gamerz-mentioning"}));
app.use(express.static(path.join(__dirname)));
const rooms=new Map();

function makeCode(){const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";let x;do{x=Array.from({length:6},()=>chars[Math.floor(Math.random()*chars.length)]).join("")}while(rooms.has(x));return x}
function clean(v,n){return String(v??"").trim().slice(0,n)}
function state(r,socketId){
 const left=Math.max(0,20-Math.floor((Date.now()-r.roundStartedAt)/1000));
 return {code:r.code,set:r.set,round:r.round,question:r.questions[r.round]||"Waiting for question...",
 timeLeft:left,roundStartedAt:r.roundStartedAt,
 players:Object.values(r.players).map(p=>({name:p.name,xp:p.xp})),
 answers:r.answers.map(a=>({player:a.player,text:a.text,correct:a.correct})),
 mySubmitted:!!r.answers.find(a=>a.socketId===socketId)};
}
function broadcast(r){
 io.to(r.code).emit("state",state(r,null));
 for(const p of Object.values(r.players))io.to(p.socketId).emit("state",state(r,p.socketId));
 io.to(r.host).emit("state",state(r,r.host));
}
io.on("connection",s=>{
 s.on("create-room",({set=0}={},cb)=>{
   const r={code:makeCode(),host:s.id,set:Number(set)||0,round:0,questions:[],answers:[],players:{},roundStartedAt:Date.now()};
   rooms.set(r.code,r);s.join(r.code);s.data.room=r.code;s.data.role="host";
   s.emit("room-created",{code:r.code});cb?.({ok:true});
 });
 s.on("sync-questions",({questions}={},cb)=>{
   const r=rooms.get(s.data.room);
   if(!r||r.host!==s.id)return cb?.({ok:false,message:"Host room not found."});
   if(!Array.isArray(questions)||questions.length<10)return cb?.({ok:false,message:"This set is missing questions."});
   r.questions=questions.slice(0,10).map(q=>clean(q,500));r.round=0;r.answers=[];r.roundStartedAt=Date.now();broadcast(r);cb?.({ok:true});
 });
 s.on("join-room",({room,name}={},cb)=>{
   const r=rooms.get(clean(room,10).toUpperCase()),n=clean(name,30);
   if(!r)return cb?.({ok:false,message:"Room not found. Check the code."});
   if(!n)return cb?.({ok:false,message:"Enter your name."});
   if(Object.values(r.players).some(p=>p.name.toLowerCase()===n.toLowerCase()))return cb?.({ok:false,message:"That name is already in the room."});
   r.players[s.id]={name:n,xp:0,socketId:s.id};s.data.room=r.code;s.data.role="player";s.join(r.code);broadcast(r);cb?.({ok:true});
 });
 s.on("submit-answer",({text}={},cb)=>{
   const r=rooms.get(s.data.room),p=r?.players[s.id],v=clean(text,500);
   if(!r||!p)return cb?.({ok:false,message:"Your player connection is not registered."});
   if(Date.now()-r.roundStartedAt>=20000)return cb?.({ok:false,message:"Time is up for this question."});
   if(!v)return cb?.({ok:false,message:"Answer cannot be empty."});
   if(r.answers.some(a=>a.socketId===s.id))return cb?.({ok:false,message:"You already submitted this round."});
   r.answers.push({socketId:s.id,player:p.name,text:v,correct:false});broadcast(r);cb?.({ok:true});
 });
 s.on("mark-correct",({index}={},cb)=>{
   const r=rooms.get(s.data.room);
   if(!r||r.host!==s.id)return cb?.({ok:false,message:"Only the host can mark answers."});
   const a=r.answers[Number(index)];
   if(!a)return cb?.({ok:false,message:"Answer not found. It may have changed."});
   if(a.correct)return cb?.({ok:false,message:"That answer is already marked correct."});
   a.correct=true;if(r.players[a.socketId])r.players[a.socketId].xp+=200;
   broadcast(r);cb?.({ok:true,message:`${a.player} received +200 XP.`});
 });
 s.on("next-round",(_,cb)=>{
   const r=rooms.get(s.data.room);
   if(!r||r.host!==s.id)return cb?.({ok:false,message:"Only the host can move to the next round."});
   if(r.questions.length<10)return cb?.({ok:false,message:"Questions are not loaded yet."});
   if(r.round>=9)return cb?.({ok:false,message:"This set already reached round 10."});
   r.round++;r.answers=[];r.roundStartedAt=Date.now();broadcast(r);cb?.({ok:true,message:`Round ${r.round+1} is ready. All players can answer again.`});
 });
 s.on("disconnect",()=>{
   const r=rooms.get(s.data.room);if(!r)return;
   if(r.host===s.id){rooms.delete(r.code);return}
   delete r.players[s.id];r.answers=r.answers.filter(a=>a.socketId!==s.id);broadcast(r);
 });
});
const PORT=process.env.PORT||10000;
server.listen(PORT,"0.0.0.0",()=>console.log("SEY GAMERZ MENTIONING running on "+PORT));
