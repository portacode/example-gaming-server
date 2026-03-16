export class GameNetworkClient {
  constructor({ onRoomState, onPlayerView, onLog, onConnectionChange }) {
    this.onRoomState = onRoomState;
    this.onPlayerView = onPlayerView;
    this.onLog = onLog;
    this.onConnectionChange = onConnectionChange;
    this.client = null;
    this.room = null;
    this.reconnectAttempts = 0;
  }

  async connect(username) {
    const endpoint = this.buildEndpoint();
    this.onLog(`Connecting to ${endpoint}...`);
    this.client = this.client || new Colyseus.Client(endpoint);
    const room = await this.client.joinOrCreate("game_room", { username });
    this.onLog(`Joined room ${room.roomId} as ${username}`);
    this.bindRoom(room);
  }

  sendAction(action) {
    if (!this.room) {
      return;
    }

    this.room.send("action", action);
  }

  leave() {
    if (!this.room) {
      return;
    }

    const room = this.room;
    this.room = null;
    room.leave();
  }

  buildEndpoint() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${location.host}`;
  }

  bindRoom(nextRoom) {
    this.room = nextRoom;
    this.reconnectAttempts = 0;
    this.onConnectionChange(true);

    nextRoom.onStateChange((state) => {
      this.onRoomState(state);
    });

    nextRoom.onMessage("playerView", (view) => {
      this.onPlayerView(view);
    });

    nextRoom.onMessage("actionError", (error) => {
      this.onLog(`Action error: ${error.message}`);
    });

    nextRoom.onLeave((code) => {
      this.onLog(`Disconnected from room (code ${code})`);
      this.onConnectionChange(false);
      const shouldReconnect = code !== 1000 && code !== 4001;
      const token = nextRoom.reconnectionToken;

      if (this.room === nextRoom) {
        this.room = null;
      }

      if (!shouldReconnect || !token || this.reconnectAttempts >= 3) {
        return;
      }

      this.reconnectAttempts += 1;
      window.setTimeout(async () => {
        try {
          this.onLog(`Attempting reconnect ${this.reconnectAttempts}/3...`);
          const rejoinedRoom = await this.client.reconnect(token);
          this.onLog(`Reconnected to room ${rejoinedRoom.roomId}`);
          this.bindRoom(rejoinedRoom);
        } catch (error) {
          this.onLog(`Reconnect failed: ${error}`);
        }
      }, this.reconnectAttempts * 1000);
    });
  }
}
