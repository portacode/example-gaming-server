import express from "express";
import { Server } from "colyseus";
import { AbstractRoom } from "./rooms/AbstractRoom";

const port = Number(process.env.PORT || 5000);
const app = express();

const gameServer = new Server({
  server: require("http").createServer(app),
});

// register your room handlers
gameServer.define("abstract_room", AbstractRoom).enableRealtimeListing();

// serve static files (optional)
app.get("/", (req, res) => res.send("Colyseus server is running"));

gameServer.listen(port);
console.log(`🚀 Colyseus server is listening on port ${port}`);