export class BabylonScene {
  constructor({ canvas, onMove }) {
    this.canvas = canvas;
    this.onMove = onMove;
    this.engine = null;
    this.scene = null;
    this.camera = null;
    this.playerMeshes = new Map();
    this.keys = new Set();
    this.moveTimer = null;
  }

  async init() {
    this.engine = new BABYLON.Engine(this.canvas, true, { preserveDrawingBuffer: true, stencil: true });
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.clearColor = new BABYLON.Color4(0.93, 0.97, 1, 1);

    await this.enablePhysics();
    this.createEnvironment();
    this.attachControls();

    this.engine.runRenderLoop(() => {
      this.scene.render();
    });

    window.addEventListener("resize", () => {
      this.engine.resize();
    });
  }

  applyView(view) {
    if (!this.scene) {
      return;
    }

    const visibleIds = new Set(view.visiblePlayers.map((player) => player.sessionId));

    for (const [sessionId, mesh] of this.playerMeshes.entries()) {
      if (!visibleIds.has(sessionId)) {
        mesh.dispose(false, true);
        this.playerMeshes.delete(sessionId);
      }
    }

    view.visiblePlayers.forEach((player) => {
      let mesh = this.playerMeshes.get(player.sessionId);
      if (!mesh) {
        mesh = this.createPlayerMesh(player.sessionId === view.self?.sessionId);
        this.playerMeshes.set(player.sessionId, mesh);
      }

      mesh.position.set(player.position.x, player.position.y, player.position.z);
    });

    if (view.self && this.camera) {
      this.camera.setTarget(new BABYLON.Vector3(view.self.position.x, 0.5, view.self.position.z));
    }
  }

  async enablePhysics() {
    const havok = await HavokPhysics();
    const plugin = new BABYLON.HavokPlugin(true, havok);
    this.scene.enablePhysics(new BABYLON.Vector3(0, -9.81, 0), plugin);
  }

  createEnvironment() {
    this.camera = new BABYLON.ArcRotateCamera(
      "camera",
      -Math.PI / 2,
      1.1,
      24,
      new BABYLON.Vector3(0, 0, 0),
      this.scene,
    );
    this.camera.attachControl(this.canvas, true);
    this.camera.lowerRadiusLimit = 10;
    this.camera.upperRadiusLimit = 32;

    const hemi = new BABYLON.HemisphericLight("hemi", new BABYLON.Vector3(0, 1, 0), this.scene);
    hemi.intensity = 0.85;

    const sun = new BABYLON.DirectionalLight("sun", new BABYLON.Vector3(-0.6, -1, -0.4), this.scene);
    sun.position = new BABYLON.Vector3(8, 18, 8);
    sun.intensity = 1.2;

    const shadowGenerator = new BABYLON.ShadowGenerator(1024, sun);
    shadowGenerator.useBlurExponentialShadowMap = true;
    shadowGenerator.blurKernel = 24;

    const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 36, height: 36 }, this.scene);
    ground.receiveShadows = true;
    const groundMaterial = new BABYLON.StandardMaterial("ground-material", this.scene);
    groundMaterial.diffuseColor = new BABYLON.Color3(0.78, 0.83, 0.74);
    groundMaterial.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);
    ground.material = groundMaterial;
    new BABYLON.PhysicsAggregate(ground, BABYLON.PhysicsShapeType.BOX, { mass: 0, restitution: 0.1 }, this.scene);

    const platform = BABYLON.MeshBuilder.CreateBox("platform", { width: 8, height: 1, depth: 8 }, this.scene);
    platform.position.y = 0.5;
    platform.position.x = -10;
    platform.position.z = -10;
    platform.receiveShadows = true;
    const platformMaterial = new BABYLON.StandardMaterial("platform-material", this.scene);
    platformMaterial.diffuseColor = new BABYLON.Color3(0.87, 0.7, 0.52);
    platform.material = platformMaterial;
    new BABYLON.PhysicsAggregate(platform, BABYLON.PhysicsShapeType.BOX, { mass: 0 }, this.scene);

    for (let i = 0; i < 6; i += 1) {
      const crate = BABYLON.MeshBuilder.CreateBox(`crate-${i}`, { size: 1.4 }, this.scene);
      crate.position = new BABYLON.Vector3(-10 + (i % 2) * 1.6, 2 + i * 1.2, -10 + Math.floor(i / 2) * 1.6);
      crate.receiveShadows = true;
      shadowGenerator.addShadowCaster(crate);
      const material = new BABYLON.StandardMaterial(`crate-material-${i}`, this.scene);
      material.diffuseColor = new BABYLON.Color3(0.65, 0.42, 0.25);
      crate.material = material;
      new BABYLON.PhysicsAggregate(crate, BABYLON.PhysicsShapeType.BOX, { mass: 1, restitution: 0.2 }, this.scene);
    }
  }

  createPlayerMesh(isSelf) {
    const mesh = BABYLON.MeshBuilder.CreateCapsule(`player-${this.playerMeshes.size}`, { radius: 0.65, height: 2.2 }, this.scene);
    const material = new BABYLON.StandardMaterial(`player-material-${this.playerMeshes.size}`, this.scene);
    material.diffuseColor = isSelf ? new BABYLON.Color3(0.19, 0.53, 0.95) : new BABYLON.Color3(0.91, 0.37, 0.2);
    material.emissiveColor = isSelf ? new BABYLON.Color3(0.03, 0.08, 0.18) : new BABYLON.Color3(0.15, 0.06, 0.02);
    mesh.material = material;
    mesh.receiveShadows = true;
    return mesh;
  }

  attachControls() {
    window.addEventListener("keydown", (event) => {
      this.keys.add(event.key.toLowerCase());
    });

    window.addEventListener("keyup", (event) => {
      this.keys.delete(event.key.toLowerCase());
    });

    this.moveTimer = window.setInterval(() => {
      let x = 0;
      let z = 0;

      if (this.keys.has("a") || this.keys.has("arrowleft")) {
        x -= 1;
      }
      if (this.keys.has("d") || this.keys.has("arrowright")) {
        x += 1;
      }
      if (this.keys.has("w") || this.keys.has("arrowup")) {
        z += 1;
      }
      if (this.keys.has("s") || this.keys.has("arrowdown")) {
        z -= 1;
      }

      if (x !== 0 || z !== 0) {
        this.onMove({ x, z });
      }
    }, 120);
  }
}
