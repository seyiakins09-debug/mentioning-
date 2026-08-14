SEY GAMERZ MENTIONING — NEW STRUCTURE v3

Upload ALL THREE files:
index.html
server.js
package.json

Render:
Build Command: npm install
Start Command: npm start

This is a fresh multiplayer structure. Do not mix old server.js or package.json with it.

Flow:
HOST -> Create Room -> share code
PLAYER -> Join Room
HOST -> question is already loaded
PLAYER -> submits one answer per round
HOST -> clicks CORRECT +200 XP on any answer
HOST -> clicks NEXT ROUND
PLAYER -> automatically gets a fresh answer slot and can submit again

The server is authoritative for rooms, answers, XP, rounds and player sessions.
