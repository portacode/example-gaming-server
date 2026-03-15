import express from "express";
import { Server } from "colyseus";
import { AbstractRoom } from "./rooms/AbstractRoom";
import path from "path";

const port = Number(process.env.PORT || 5000);
const app = express();

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '..', 'public')));

const gameServer = new Server({
  server: require("http").createServer(app),
});

// register your room handlers
gameServer.define("abstract_room", AbstractRoom).enableRealtimeListing();

// serve index.html on root
app.get("/", (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

gameServer.listen(port);
console.log(`🚀 Colyseus server is listening on port ${port}`);