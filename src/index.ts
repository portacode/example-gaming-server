import express from "express";
import { Server } from "colyseus";
import { createServer } from "http";
import path from "path";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GameRoom } from "./rooms/GameRoom";

const port = Number(process.env.PORT || 5000);
const app = express();
const server = createServer(app);

app.use(express.static(path.join(__dirname, "..", "public")));

const gameServer = new Server({
  transport: new WebSocketTransport({
    server,
  }),
});

gameServer.define("game_room", GameRoom).enableRealtimeListing();

app.get("/", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "index.html")));

server.listen(port);
console.log(`Colyseus server is listening on port ${port}`);
