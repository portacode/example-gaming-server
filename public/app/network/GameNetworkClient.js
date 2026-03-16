export class GameNetworkClient {
  constructor({ onRoomState, onPlayerView, onLog, onConnectionChange }) {
    this.onRoomState = onRoomState;
    this.onPlayerView = onPlayerView;
    this.onLog = onLog;
    this.onConnectionChange = onConnectionChange;
    this.client = null;
    this.room = null;
    this.reconnectAttempts = 0;
    this.manualLeave = false;
  }

  async connect(username) {
    const endpoint = this.buildEndpoint();
    this.manualLeave = false;
    this.onConnectionChange({ state: "connecting" });
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

    this.manualLeave = true;
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
    this.manualLeave = false;
    this.reconnectAttempts = 0;
    this.onConnectionChange({ state: "connected", roomId: nextRoom.roomId });

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
      const shouldReconnect = !this.manualLeave && code !== 1000 && code !== 4001;
      const token = nextRoom.reconnectionToken;

      if (this.room === nextRoom) {
        this.room = null;
      }

      if (!shouldReconnect || !token || this.reconnectAttempts >= 3) {
        this.onConnectionChange({
          state: "disconnected",
          reason: this.manualLeave ? "left" : code === 4001 ? "rejected" : "closed",
        });
        this.manualLeave = false;
        return;
      }

      this.reconnectAttempts += 1;
      this.scheduleReconnect(token);
    });
  }

  scheduleReconnect(token) {
    this.onConnectionChange({
      state: "reconnecting",
      attempt: this.reconnectAttempts,
      maxAttempts: 3,
    });

    window.setTimeout(async () => {
      try {
        this.onLog(`Attempting reconnect ${this.reconnectAttempts}/3...`);
        const rejoinedRoom = await this.client.reconnect(token);
        this.onLog(`Reconnected to room ${rejoinedRoom.roomId}`);
        this.bindRoom(rejoinedRoom);
      } catch (error) {
        this.onLog(`Reconnect failed: ${error}`);
        const message = String(error);
        const terminal = /invalid or expired/i.test(message);

        if (terminal || this.reconnectAttempts >= 3) {
          this.onConnectionChange({
            state: "disconnected",
            reason: terminal ? "token_expired" : "reconnect_failed",
          });
          return;
        }

        this.reconnectAttempts += 1;
        this.scheduleReconnect(token);
      }
    }, this.reconnectAttempts * 1000);
  }
}
