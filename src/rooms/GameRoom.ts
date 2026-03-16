import { Room, Client } from "colyseus";
import { Schema, type, MapSchema } from "@colyseus/schema";

export const PLAYERS_PER_GAME = 4;
export const RECONNECT_WINDOW_SECONDS = 300;

export class PlayerState extends Schema {
  @type("string") sessionId = "";
  @type("string") username = "";
  @type("boolean") connected = true;
}

export class GameState extends Schema {
  @type("string") roomId = "";
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type("string") phase = "waiting";
  @type("number") connectedPlayers = 0;
}

export class GameRoom extends Room<GameState> {
  maxClients = PLAYERS_PER_GAME;

  onCreate(options: any) {
    this.setState(new GameState());
    this.state.roomId = this.roomId;
    this.state.phase = "waiting";
    this.state.connectedPlayers = 0;
    console.log(`Room ${this.roomId} created (max ${this.maxClients} players)`);

    // Keep durable room data in state. Messages are only for transient events.
    this.onMessage("ping", (client) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) {
        return;
      }

      this.broadcast("playerPing", {
        sessionId: client.sessionId,
        username: player.username,
        at: Date.now(),
      });
    });
  }

  onJoin(client: Client, options: any) {
    const existingPlayer = this.state.players.get(client.sessionId);
    if (existingPlayer) {
      existingPlayer.connected = true;
      this.syncConnectedPlayers();
      this.broadcastLobbyStatus();
      return;
    }

    if (this.state.phase === "active") {
      client.leave(4001, "Game already started");
      return;
    }

    const username = options?.username ?? `Player_${client.sessionId.slice(0, 6)}`;
    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.username = username;
    player.connected = true;
    this.state.players.set(client.sessionId, player);
    this.syncConnectedPlayers();
    this.broadcastLobbyStatus();

    if (this.state.connectedPlayers >= this.maxClients) {
      this.startGame();
    }
  }

  async onLeave(client: Client, consented: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (!player) {
      return;
    }

    if (consented) {
      this.state.players.delete(client.sessionId);
      this.syncConnectedPlayers();
      this.broadcastLobbyStatus();
      return;
    }

    player.connected = false;
    this.syncConnectedPlayers();
    this.broadcastLobbyStatus();
    this.broadcast("playerDisconnected", {
      sessionId: player.sessionId,
      username: player.username,
      reconnectWindowSeconds: RECONNECT_WINDOW_SECONDS,
    });

    try {
      await this.allowReconnection(client, RECONNECT_WINDOW_SECONDS);
      player.connected = true;
      this.syncConnectedPlayers();
      this.broadcastLobbyStatus();
      this.broadcast("playerReconnected", {
        sessionId: player.sessionId,
        username: player.username,
      });
    } catch {
      this.state.players.delete(client.sessionId);
      this.syncConnectedPlayers();
      this.broadcastLobbyStatus();
      this.broadcast("playerLeft", {
        sessionId: player.sessionId,
        username: player.username,
      });
    }
  }

  onDispose() {
    console.log(`Room ${this.roomId} disposing...`);
  }

  private syncConnectedPlayers() {
    let connectedPlayers = 0;

    this.state.players.forEach((player) => {
      if (player.connected) {
        connectedPlayers += 1;
      }
    });

    this.state.connectedPlayers = connectedPlayers;
  }

  private broadcastLobbyStatus() {
    this.broadcast("lobbyStatus", {
      connected: this.state.connectedPlayers,
      reserved: this.state.players.size,
      max: this.maxClients,
      phase: this.state.phase,
    });
  }

  private startGame() {
    this.state.phase = "active";
    void this.lock();
    this.broadcast("gameStart", {
      roomId: this.roomId,
      players: Array.from(this.state.players.values()).map((player) => ({
        sessionId: player.sessionId,
        username: player.username,
      })),
    });
    console.log(`Room ${this.roomId} started with ${this.state.connectedPlayers} players`);
  }
}
