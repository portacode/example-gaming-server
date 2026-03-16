import { Room, Client } from "colyseus";
import { Schema, type, MapSchema } from "@colyseus/schema";

export const PLAYERS_PER_GAME = 4;

export class PlayerState extends Schema {
  @type("string") sessionId = "";
  @type("string") id = "";
  @type("string") username = "";
}

export class GameState extends Schema {
  @type("string") roomId = "";
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type("boolean") started = false;
}

export class GameRoom extends Room<GameState> {
  maxClients = PLAYERS_PER_GAME;

  onCreate(options: any) {
    this.setState(new GameState());
    this.state.roomId = this.roomId;
    this.state.started = false;
    console.log(`Room ${this.roomId} created (max ${this.maxClients} players)`);

    // Handle any incoming message and broadcast as playerMessage (only if game started)
    this.onMessage("*", (client, message) => {
      if (this.state.started) {
        const player = this.state.players.get(client.sessionId);
        this.broadcast("playerMessage", {
          sessionId: client.sessionId,
          username: player ? player.username : "",
          message,
        });
      }
    });
  }

  onJoin(client: Client, options: any) {
    if (this.state.started) {
      // Game already started, inform client and do not add them
      this.send(client, { type: "error", message: "Game already started" } as any);
      return;
    }
    const username = options?.username ?? `Player_${client.sessionId.slice(0, 6)}`;
    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.id = client.id ?? "";
    player.username = username;
    this.state.players.set(client.sessionId, player);
    this.broadcast("waitingUpdate", {
      waiting: this.state.players.size,
      max: this.maxClients,
      started: this.state.started,
    });

    // If enough players, start the game
    if (this.state.players.size >= this.maxClients) {
      this.state.started = true;
      this.broadcast("gameStart", {
        message: "Enough players! Game started.",
        players: Array.from(this.state.players.values()).map(p => ({
          sessionId: p.sessionId,
          id: p.id,
          username: p.username,
        })),
      });
      console.log(`Room ${this.roomId} started with ${this.state.players.size} players`);
    }
  }

  onLeave(client: Client, consented: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      if (this.state.started) {
        // Game in progress: inform others that player left, but game continues
        this.broadcast("playerLeft", {
          sessionId: client.sessionId,
          username: player.username,
        });
        // Remove player from map
        this.state.players.delete(client.sessionId);
        // Optionally broadcast updated player list
        this.broadcast("playerListUpdate", {
          players: Array.from(this.state.players.values()).map(p => ({
            sessionId: p.sessionId,
            id: p.id,
            username: p.username,
          })),
        });
      } else {
        // Still waiting for players to start
        this.state.players.delete(client.sessionId);
        this.broadcast("waitingUpdate", {
          waiting: this.state.players.size,
          max: this.maxClients,
          started: this.state.started,
        });
      }
    }
  }

  onDispose() {
    console.log(`Room ${this.roomId} disposing...`);
  }
}