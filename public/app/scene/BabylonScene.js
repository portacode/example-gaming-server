export class BabylonScene {
  constructor({ canvas, onHeadingChange }) {
    this.canvas = canvas;
    this.onHeadingChange = onHeadingChange;
    this.engine = null;
    this.scene = null;
    this.camera = null;
    this.playerMeshes = new Map();
    this.selfPosition = null;
    this.lastHeading = null;
    this.lastHeadingSentAt = 0;
  }

  async init() {
    this.engine = new BABYLON.Engine(this.canvas, true, { preserveDrawingBuffer: true, stencil: true });
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.clearColor = new BABYLON.Color4(0.93, 0.97, 1, 1);

    await this.enablePhysics();
    this.createEnvironment();

    this.engine.runRenderLoop(() => {
      this.syncHeadingIntent();
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
      this.selfPosition = {
        x: view.self.position.x,
        y: view.self.position.y,
        z: view.self.position.z,
      };
      this.camera.setTarget(new BABYLON.Vector3(view.self.position.x, 0.5, view.self.position.z));
    } else {
      this.selfPosition = null;
      this.lastHeading = null;
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

  syncHeadingIntent() {
    if (!this.selfPosition || !this.camera) {
      return;
    }

    const cameraPosition = this.camera.position;
    const heading = Math.atan2(
      this.selfPosition.z - cameraPosition.z,
      this.selfPosition.x - cameraPosition.x,
    );
    const now = performance.now();

    if (this.lastHeading !== null) {
      const delta = Math.atan2(Math.sin(heading - this.lastHeading), Math.cos(heading - this.lastHeading));
      if (Math.abs(delta) < 0.04 && now - this.lastHeadingSentAt < 250) {
        return;
      }
    }

    this.lastHeading = heading;
    this.lastHeadingSentAt = now;
    this.onHeadingChange?.(heading);
  }
}
