class GameClient {
  constructor() {
    this.socket = io();
    this.canvas = document.getElementById("gameCanvas");
    this.ctx = this.canvas.getContext("2d");
    this.gameState = {
      playerId: null,
      roomId: null,
      players: {},
      map: [],
      bullets: [],
      cubes: [],
      abilities: [],
      status: "loading",
      gameTime: 300,
      selectionTime: 30,
      unlockedAbilities: {
        light: ["stealth"],
        medium: ["turret"],
        heavy: ["wall"],
      },
      mouse: { x: 0, y: 0, shooting: false },
    };

    this.ui = new GameUI(this);
    this.controls = new GameControls(this);
    this.renderer = new GameRenderer(this);
    this.settings = new SettingsManager(this);

    this.setupSocketEvents();
    this.setupEventListeners();
    this.init();
  }

  init() {
    this.resizeCanvas();
    this.ui.showMainMenu();
    this.gameLoop();
  }

  setupSocketEvents() {
    this.socket.on("connect", () => {
      console.log("Connected to server");
      this.gameState.playerId = this.socket.id;
      this.gameState.status = "menu";
    });

    this.socket.on("roomCreated", (data) => {
      this.gameState.roomId = data.roomId;
      this.gameState.unlockedAbilities = data.unlockedAbilities;
      this.gameState.selectionTime = data.selectionTime;
      this.ui.showClassSelection();
    });

    this.socket.on("gameUpdate", (data) => {
      Object.assign(this.gameState, data);
    });

    this.socket.on("gameStarted", () => {
      this.gameState.status = "playing";
      this.ui.showGameScreen();
      this.controls.setupMobileControls();
    });

    this.socket.on("playerHit", (data) => {
      // Эффект попадания
    });

    this.socket.on("abilityUsed", (data) => {
      // Эффект использования способности
    });

    this.socket.on("cubeGrabbed", (data) => {
      // Обновление состояния куба
    });

    this.socket.on("wallHit", (data) => {
      // Эффект попадания в стену
    });

    this.socket.on("gameOver", (data) => {
      // Обработка окончания игры
    });

    this.socket.on("shopData", (data) => {
      this.ui.showShop(data.items, data.coins);
    });
  }

  setupEventListeners() {
    // Кнопки меню
    document.querySelector(".play-btn").addEventListener("click", () => {
      this.socket.emit("join", {
        name: `Player${Math.floor(Math.random() * 1000)}`,
      });
      this.ui.showRoomSelection();
    });

    document.querySelector(".shop-btn").addEventListener("click", () => {
      this.socket.emit("requestShopData");
    });

    document.querySelector(".settings-btn").addEventListener("click", () => {
      this.ui.showSettings();
    });

    // Выбор класса
    document.querySelectorAll(".class-option").forEach((option) => {
      option.addEventListener("click", () => {
        document
          .querySelectorAll(".class-option")
          .forEach((opt) => opt.classList.remove("selected"));
        option.classList.add("selected");

        const playerClass = option.dataset.class;
        this.ui.showAbilities(playerClass);
      });
    });

    // Выбор способности
    document.addEventListener("click", (e) => {
      if (e.target.classList.contains("ability-option")) {
        document
          .querySelectorAll(".ability-option")
          .forEach((opt) => opt.classList.remove("selected"));
        e.target.classList.add("selected");
      }
    });

    // Покупка в магазине
    document.addEventListener("click", (e) => {
      if (e.target.classList.contains("buy-btn")) {
        const itemId = e.target.closest(".shop-item").dataset.id;
        this.socket.emit("buyItem", { itemId });
      }
    });

    // Изменение размера окна
    window.addEventListener("resize", () => {
      this.resizeCanvas();
    });

    // Позиция мыши
    window.addEventListener("mousemove", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.gameState.mouse.x = e.clientX - rect.left;
      this.gameState.mouse.y = e.clientY - rect.top;
    });

    window.addEventListener("mousedown", () => {
      this.gameState.mouse.shooting = true;
    });

    window.addEventListener("mouseup", () => {
      this.gameState.mouse.shooting = false;
    });
  }

  resizeCanvas() {
    const size = Math.min(window.innerWidth, window.innerHeight);
    this.canvas.width = size;
    this.canvas.height = size;
  }

  gameLoop() {
    this.update();
    this.renderer.render();
    requestAnimationFrame(() => this.gameLoop());
  }

  update() {
    if (this.gameState.status !== "playing") return;

    // Обновление движения
    const moveInput = this.controls.getMoveInput();
    if (moveInput.x !== 0 || moveInput.y !== 0) {
      this.socket.emit("move", moveInput);
    }

    // Обновление стрельбы
    if (this.controls.shouldShoot()) {
      const angle = this.controls.getShootAngle();
      this.socket.emit("shoot", angle);
    }
  }
}

class GameUI {
  constructor(game) {
    this.game = game;
    this.elements = {
      loadingScreen: document.querySelector(".loading-screen"),
      mainMenu: document.querySelector(".main-menu"),
      roomSelection: document.querySelector(".room-selection"),
      classSelection: document.querySelector(".class-selection"),
      gameScreen: document.querySelector(".game-screen"),
      shopScreen: document.querySelector(".shop-screen"),
      settingsScreen: document.querySelector(".settings-screen"),
      selectionTimer: document.querySelector(".selection-timer"),
      abilityOptions: document.querySelector(".ability-options"),
      healthFill: document.querySelector(".health-fill"),
      abilityCooldown: document.querySelector(".ability-cooldown"),
      gameTimer: document.querySelector(".game-timer"),
      coinsDisplay: document.querySelector(".coins-display"),
      shopItems: document.querySelector(".shop-items"),
    };
  }

  showScreen(screenName) {
    this.hideAllScreens();
    this.elements[screenName].style.display = "flex";
  }

  hideAllScreens() {
    Object.values(this.elements).forEach((el) => {
      if (el instanceof HTMLElement) el.style.display = "none";
    });
  }

  showMainMenu() {
    this.showScreen("mainMenu");
  }

  showRoomSelection() {
    this.showScreen("roomSelection");
  }

  showClassSelection() {
    this.showScreen("classSelection");

    // Таймер выбора
    let timeLeft = this.game.gameState.selectionTime;
    const timer = setInterval(() => {
      timeLeft--;
      this.elements.selectionTimer.textContent = timeLeft;

      if (timeLeft <= 0) {
        clearInterval(timer);
      }
    }, 1000);
  }

  showAbilities(playerClass) {
    this.elements.abilityOptions.innerHTML =
      this.game.gameState.unlockedAbilities[playerClass]
        .map(
          (ability) => `
                <div class="ability-option" data-ability="${ability}">
                    <h4>${ability.toUpperCase()}</h4>
                    <p>${this.getAbilityDescription(ability)}</p>
                </div>
            `
        )
        .join("");
  }

  getAbilityDescription(ability) {
    const descriptions = {
      stealth: "Become invisible for 5 seconds",
      dash: "Dash forward quickly",
      wall: "Place a temporary wall",
      turret: "Deploy an auto-turret",
      heal: "Restore health to full",
    };
    return descriptions[ability] || "No description available";
  }

  showGameScreen() {
    this.showScreen("gameScreen");
  }

  showShop(items, coins) {
    this.showScreen("shopScreen");
    this.elements.coinsDisplay.textContent = coins;

    this.elements.shopItems.innerHTML = items
      .map(
        (item) => `
            <div class="shop-item" data-id="${item.id}">
                <h4>${item.name}</h4>
                <p>${item.price} coins</p>
                <button class="buy-btn">BUY</button>
            </div>
        `
      )
      .join("");
  }

  showSettings() {
    this.showScreen("settingsScreen");
  }

  updateHealthBar(percent) {
    this.elements.healthFill.style.width = `${percent * 100}%`;
  }

  updateAbilityCooldown(percent) {
    this.elements.abilityCooldown.style.width = `${percent * 100}%`;
  }

  updateGameTimer(time) {
    const minutes = Math.floor(time / 60);
    const seconds = time % 60;
    this.elements.gameTimer.textContent = `${minutes}:${
      seconds < 10 ? "0" : ""
    }${seconds}`;
  }
}

class GameControls {
  constructor(game) {
    this.game = game;
    this.keys = {};
    this.moveJoystick = null;
    this.shootJoystick = null;

    window.addEventListener("keydown", (e) => (this.keys[e.key] = true));
    window.addEventListener("keyup", (e) => (this.keys[e.key] = false));
  }

  setupMobileControls() {
    if (window.innerWidth <= 768) {
      // Инициализация виртуальных джойстиков
      this.moveJoystick = new VirtualJoystick({
        container: document.getElementById("moveJoystick"),
        radius: 50,
      });

      this.shootJoystick = new VirtualJoystick({
        container: document.getElementById("shootJoystick"),
        radius: 40,
      });

      document
        .getElementById("ability-button")
        .addEventListener("touchstart", () => {
          this.game.socket.emit("useAbility");
        });
    }
  }

  getMoveInput() {
    let x = 0,
      y = 0;

    if (this.moveJoystick && this.moveJoystick.active) {
      x = this.moveJoystick.positionX / 50;
      y = this.moveJoystick.positionY / 50;
    } else {
      if (this.keys["w"] || this.keys["ArrowUp"]) y = -1;
      if (this.keys["s"] || this.keys["ArrowDown"]) y = 1;
      if (this.keys["a"] || this.keys["ArrowLeft"]) x = -1;
      if (this.keys["d"] || this.keys["ArrowRight"]) x = 1;
    }

    // Нормализация диагонального движения
    if (x !== 0 && y !== 0) {
      const length = Math.sqrt(x * x + y * y);
      x /= length;
      y /= length;
    }

    return { x, y };
  }

  shouldShoot() {
    return (
      (this.shootJoystick && this.shootJoystick.active) ||
      this.game.gameState.mouse.shooting
    );
  }

  getShootAngle() {
    if (this.shootJoystick && this.shootJoystick.active) {
      return Math.atan2(
        this.shootJoystick.positionX,
        -this.shootJoystick.positionY
      );
    } else {
      const rect = this.game.canvas.getBoundingClientRect();
      return Math.atan2(
        this.game.gameState.mouse.x - this.game.canvas.width / 2,
        this.game.gameState.mouse.y - this.game.canvas.height / 2
      );
    }
  }
}

class GameRenderer {
  constructor(game) {
    this.game = game;
    this.canvas = game.canvas;
    this.ctx = game.ctx;
    this.cellSize = 0;
  }

  render() {
    this.clearCanvas();

    switch (this.game.gameState.status) {
      case "playing":
        this.renderGame();
        break;
    }
  }

  renderGame() {
    this.renderMap();
    this.renderCubes();
    this.renderBullets();
    this.renderPlayers();
    this.renderUI();
  }

  renderMap() {
    if (!this.game.gameState.map.length) return;

    this.cellSize = this.canvas.width / this.game.gameState.map.length;

    this.game.gameState.map.forEach((row, y) => {
      row.forEach((cell, x) => {
        if (!cell) return;

        if (cell.type === "wall") {
          this.ctx.fillStyle = cell.indestructible ? "#2a1a5e" : "#3d2b7a";
          this.ctx.fillRect(
            x * this.cellSize,
            y * this.cellSize,
            this.cellSize,
            this.cellSize
          );

          // Эффект сетки
          this.ctx.strokeStyle = "rgba(5, 217, 232, 0.2)";
          this.ctx.strokeRect(
            x * this.cellSize,
            y * this.cellSize,
            this.cellSize,
            this.cellSize
          );
        }
      });
    });
  }

  renderPlayers() {
    Object.values(this.game.gameState.players).forEach((player) => {
      if (
        !player.class ||
        (player.invisible && player.id !== this.game.gameState.playerId)
      )
        return;

      const classConfig = this.game.gameState.config.CLASSES[player.class];
      const size = classConfig.radius;

      // Тело игрока
      this.ctx.beginPath();
      this.ctx.arc(player.x, player.y, size, 0, Math.PI * 2);

      // Цвет по команде
      switch (player.team) {
        case "red":
          this.ctx.fillStyle = "#ff2a6d";
          break;
        case "blue":
          this.ctx.fillStyle = "#05d9e8";
          break;
        case "green":
          this.ctx.fillStyle = "#00ff87";
          break;
        case "purple":
          this.ctx.fillStyle = "#d300c5";
          break;
      }

      // Эффект при переносе куба
      if (player.carryingCube) {
        this.ctx.fillStyle = "#ffffff";
        this.ctx.fillRect(player.x - 10, player.y - size - 15, 20, 10);
      }

      this.ctx.fill();

      // Индикатор направления
      if (player.id === this.game.gameState.playerId) {
        const noseX = player.x + Math.sin(player.rotation) * size;
        const noseY = player.y - Math.cos(player.rotation) * size;

        this.ctx.beginPath();
        this.ctx.moveTo(player.x, player.y);
        this.ctx.lineTo(noseX, noseY);
        this.ctx.strokeStyle = "#ffffff";
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
      }

      // Индикатор здоровья
      if (player.health < classConfig.health) {
        this.ctx.beginPath();
        this.ctx.arc(
          player.x,
          player.y,
          size + 3,
          0,
          Math.PI * 2 * (player.health / classConfig.health)
        );
        this.ctx.strokeStyle = "#ffffff";
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
      }

      // Имя игрока (счет)
      this.ctx.fillStyle = "#ffffff";
      this.ctx.font = "12px Arial";
      this.ctx.textAlign = "center";
      this.ctx.fillText(
        player.name || "Player",
        player.x,
        player.y + size + 15
      );
    });
  }

  renderBullets() {
    this.game.gameState.bullets.forEach((bullet) => {
      this.ctx.beginPath();
      this.ctx.arc(bullet.x, bullet.y, 5, 0, Math.PI * 2);

      // Цвет пули по команде
      const owner = this.game.gameState.players[bullet.owner];
      if (owner) {
        switch (owner.team) {
          case "red":
            this.ctx.fillStyle = "#ff2a6d";
            break;
          case "blue":
            this.ctx.fillStyle = "#05d9e8";
            break;
          case "green":
            this.ctx.fillStyle = "#00ff87";
            break;
          case "purple":
            this.ctx.fillStyle = "#d300c5";
            break;
        }
      } else {
        this.ctx.fillStyle = "#ffffff";
      }

      this.ctx.fill();

      // Эффект свечения
      this.ctx.shadowColor = this.ctx.fillStyle;
      this.ctx.shadowBlur = 10;
      this.ctx.fill();
      this.ctx.shadowBlur = 0;
    });
  }

  renderCubes() {
    this.game.gameState.cubes.forEach((cube) => {
      if (cube.carrier) return;

      this.ctx.fillStyle = "#ffffff";
      this.ctx.fillRect(cube.x - 10, cube.y - 10, 20, 20);
      this.ctx.strokeStyle = "#05d9e8";
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(cube.x - 10, cube.y - 10, 20, 20);
    });
  }

  renderUI() {
    const player = this.game.gameState.players[this.game.gameState.playerId];
    if (!player) return;

    // Полоса здоровья
    const healthPercent =
      player.health / this.game.gameState.config.CLASSES[player.class].health;
    this.game.ui.updateHealthBar(healthPercent);

    // Таймер способности
    if (player.abilityCooldown > 0) {
      const cooldownPercent =
        1 -
        player.abilityCooldown /
          this.game.gameState.config.CLASSES[player.class].cooldown;
      this.game.ui.updateAbilityCooldown(cooldownPercent);
    }

    // Таймер игры
    this.game.ui.updateGameTimer(this.game.gameState.gameTime);
  }

  clearCanvas() {
    this.ctx.fillStyle = "#0d0221";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Сетка в стиле Synthwave
    this.ctx.strokeStyle = "rgba(5, 217, 232, 0.1)";
    this.ctx.lineWidth = 1;

    const gridSize = 40;
    for (let x = 0; x < this.canvas.width; x += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.canvas.height);
      this.ctx.stroke();
    }

    for (let y = 0; y < this.canvas.height; y += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.canvas.width, y);
      this.ctx.stroke();
    }
  }
}

class SettingsManager {
  constructor(game) {
    this.game = game;
    this.controls = {
      up: "w",
      down: "s",
      left: "a",
      right: "d",
      shoot: " ",
      ability: "Shift",
    };

    this.loadSettings();
    this.setupUI();
  }

  loadSettings() {
    const saved = localStorage.getItem("gameControls");
    if (saved) this.controls = JSON.parse(saved);
  }

  saveSettings() {
    localStorage.setItem("gameControls", JSON.stringify(this.controls));
    this.game.socket.emit("updateControls", this.controls);
  }

  setupUI() {
    document.querySelectorAll(".control-input").forEach((input) => {
      const action = input.dataset.action;
      input.value = this.controls[action];

      input.addEventListener("keydown", (e) => {
        this.controls[action] = e.key;
        this.saveSettings();
        input.value = e.key;
        e.preventDefault();
      });
    });
  }
}

// Запуск игры при загрузке страницы
window.onload = () => {
  // Имитация загрузки
  const progress = document.querySelector(".progress");
  let width = 0;
  const loadingInterval = setInterval(() => {
    width += 2;
    progress.style.width = `${width}%`;

    if (width >= 100) {
      clearInterval(loadingInterval);
      new GameClient();
    }
  }, 50);
};

// Простая реализация виртуального джойстика для мобильных устройств
class VirtualJoystick {
  constructor(options) {
    this.container = options.container;
    this.radius = options.radius;
    this.positionX = 0;
    this.positionY = 0;
    this.active = false;

    this.joystick =
      this.container.querySelector(".joystick") ||
      this.container.querySelector(".shoot-button");

    this.setupEventListeners();
  }

  setupEventListeners() {
    this.container.addEventListener(
      "touchstart",
      this.handleTouchStart.bind(this)
    );
    document.addEventListener("touchmove", this.handleTouchMove.bind(this));
    document.addEventListener("touchend", this.handleTouchEnd.bind(this));
  }

  handleTouchStart(e) {
    this.active = true;
    this.container.style.backgroundColor = "rgba(255, 255, 255, 0.3)";
    this.updatePosition(e);
  }

  handleTouchMove(e) {
    if (!this.active) return;
    this.updatePosition(e);
  }

  handleTouchEnd() {
    this.active = false;
    this.positionX = 0;
    this.positionY = 0;
    this.container.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
    this.joystick.style.transform = "translate(30px, 30px)";
  }

  updatePosition(e) {
    const rect = this.container.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const touch = e.touches[0];
    const touchX = touch.clientX - centerX;
    const touchY = touch.clientY - centerY;

    const distance = Math.sqrt(touchX * touchX + touchY * touchY);
    const angle = Math.atan2(touchY, touchX);

    if (distance > this.radius) {
      this.positionX = Math.cos(angle) * this.radius;
      this.positionY = Math.sin(angle) * this.radius;
    } else {
      this.positionX = touchX;
      this.positionY = touchY;
    }

    this.joystick.style.transform = `translate(${this.positionX + 30}px, ${
      this.positionY + 30
    }px)`;
  }
}
