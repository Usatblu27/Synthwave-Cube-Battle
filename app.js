const express = require("express");
const http = require("http");
const socketio = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socketio(server);

// Конфигурация игры
const CONFIG = {
  MAP_SIZE: 20,
  CELL_SIZE: 40,
  GAME_DURATION: 300, // 5 минут
  SELECTION_TIME: 30,
  MAX_PLAYERS: 4,
  TEAMS: ["red", "blue", "green", "purple"],
  CLASSES: {
    light: { speed: 5, health: 80, radius: 12, cooldown: 8 },
    medium: { speed: 3, health: 120, radius: 15, cooldown: 12 },
    heavy: { speed: 2, health: 160, radius: 18, cooldown: 15 },
  },
  ABILITIES: {
    light: ["stealth", "dash", "phase", "teleport"],
    medium: ["turret", "mine", "heal", "clone"],
    heavy: ["wall", "hammer", "stun", "shield"],
  },
  WALL_HEALTH: 3,
  WALL_RESPAWN_TIME: 15,
  CUBES_TO_WIN: 3,
  SHOP_ITEMS: [
    { id: "skin1", name: "Neon Glow", price: 100, type: "skin" },
    { id: "skin2", name: "Synthwave", price: 150, type: "skin" },
    { id: "ability1", name: "Unlock Ability", price: 200, type: "ability" },
  ],
};

// Генерация симметричной карты
function generateMap() {
  const size = CONFIG.MAP_SIZE;
  const map = Array(size)
    .fill()
    .map(() => Array(size).fill(0));

  // Внешние стены (неразрушаемые)
  for (let i = 0; i < size; i++) {
    map[0][i] = {
      type: "wall",
      health: CONFIG.WALL_HEALTH,
      indestructible: true,
    };
    map[size - 1][i] = {
      type: "wall",
      health: CONFIG.WALL_HEALTH,
      indestructible: true,
    };
    map[i][0] = {
      type: "wall",
      health: CONFIG.WALL_HEALTH,
      indestructible: true,
    };
    map[i][size - 1] = {
      type: "wall",
      health: CONFIG.WALL_HEALTH,
      indestructible: true,
    };
  }

  // Симметричные внутренние стены
  const wallPositions = [
    [5, 5],
    [5, 15],
    [15, 5],
    [15, 15],
    [10, 5],
    [10, 15],
    [5, 10],
    [15, 10],
    [10, 10],
  ];

  wallPositions.forEach(([x, y]) => {
    map[y][x] = {
      type: "wall",
      health: CONFIG.WALL_HEALTH,
      respawnTime: CONFIG.WALL_RESPAWN_TIME,
    };
  });

  return map;
}

// Состояние сервера
const gameState = {
  rooms: {},
  players: {},
  waitingPlayers: [],
};

// Создание комнаты
function createRoom() {
  const roomId = `room_${Date.now()}`;
  const map = generateMap();

  gameState.rooms[roomId] = {
    id: roomId,
    map,
    players: [],
    cubes: [{ id: "cube1", x: 10, y: 10, carrier: null }],
    cashouts: CONFIG.TEAMS.map((team, i) => ({
      x: i % 2 === 0 ? 1 : CONFIG.MAP_SIZE - 2,
      y: i < 2 ? 1 : CONFIG.MAP_SIZE - 2,
      team,
    })),
    abilities: [],
    bullets: [],
    destroyedWalls: [],
    status: "waiting",
    selectionTimer: null,
    gameTimer: null,
    gameTime: CONFIG.GAME_DURATION,
    scores: Object.fromEntries(CONFIG.TEAMS.map((t) => [t, 0])),
  };

  return roomId;
}

// Получение комнаты игрока
function getPlayerRoom(playerId) {
  return Object.values(gameState.rooms).find((room) =>
    room.players.includes(playerId)
  );
}

// Проверка столкновений
function checkCollision(x1, y1, r1, x2, y2, r2) {
  const dx = x1 - x2;
  const dy = y1 - y2;
  const distance = Math.sqrt(dx * dx + dy * dy);
  return distance < r1 + r2;
}

// Проверка движения
function canMove(room, x, y, radius) {
  // Проверка границ карты
  if (
    x < radius ||
    x > CONFIG.MAP_SIZE * CONFIG.CELL_SIZE - radius ||
    y < radius ||
    y > CONFIG.MAP_SIZE * CONFIG.CELL_SIZE - radius
  ) {
    return false;
  }

  // Проверка стен
  const cellX = Math.floor(x / CONFIG.CELL_SIZE);
  const cellY = Math.floor(y / CONFIG.CELL_SIZE);

  if (
    room.map[cellY] &&
    room.map[cellY][cellX] &&
    room.map[cellY][cellX].type === "wall"
  ) {
    return false;
  }

  return true;
}

// Обновление стен
function updateWalls(room) {
  room.destroyedWalls.forEach((wall, index) => {
    wall.respawnTime--;
    if (wall.respawnTime <= 0) {
      room.map[wall.y][wall.x] = {
        type: "wall",
        health: CONFIG.WALL_HEALTH,
        respawnTime: CONFIG.WALL_RESPAWN_TIME,
      };
      room.destroyedWalls.splice(index, 1);
      io.to(room.id).emit("wallRespawned", { x: wall.x, y: wall.y });
    }
  });
}

// Проверка условий победы
function checkWinCondition(room) {
  for (const team in room.scores) {
    if (room.scores[team] >= CONFIG.CUBES_TO_WIN) {
      return team;
    }
  }
  return null;
}

// Завершение игры
function endGame(roomId, winner) {
  const room = gameState.rooms[roomId];
  if (!room) return;

  clearInterval(room.gameTimer);

  // Награждение победителей
  room.players.forEach((playerId) => {
    const player = gameState.players[playerId];
    if (player.team === winner) {
      player.coins += 50;
    } else {
      player.coins += 20;
    }
  });

  io.to(roomId).emit("gameOver", { winner });

  // Удаление комнаты через некоторое время
  setTimeout(() => {
    delete gameState.rooms[roomId];
  }, 10000);
}

// Инициализация сервера
io.on("connection", (socket) => {
  console.log("New connection:", socket.id);

  // Инициализация игрока
  const player = {
    id: socket.id,
    name: `Player${Math.floor(Math.random() * 1000)}`,
    x: 0,
    y: 0,
    team: null,
    class: null,
    ability: null,
    health: 100,
    score: 0,
    coins: 100,
    skins: [],
    unlockedAbilities: {
      light: [CONFIG.ABILITIES.light[0]],
      medium: [CONFIG.ABILITIES.medium[0]],
      heavy: [CONFIG.ABILITIES.heavy[0]],
    },
    ready: false,
    lastShot: 0,
    abilityCooldown: 0,
    carryingCube: false,
    invisible: false,
    stunned: false,
    controls: {
      up: "w",
      down: "s",
      left: "a",
      right: "d",
      shoot: " ",
      ability: "Shift",
    },
  };

  gameState.players[socket.id] = player;
  gameState.waitingPlayers.push(socket.id);

  // Проверка набора игроков
  if (gameState.waitingPlayers.length >= CONFIG.MAX_PLAYERS) {
    const roomId = createRoom();
    const room = gameState.rooms[roomId];

    // Распределение игроков по командам
    gameState.waitingPlayers
      .slice(0, CONFIG.MAX_PLAYERS)
      .forEach((playerId, i) => {
        const p = gameState.players[playerId];
        p.team = CONFIG.TEAMS[i];
        const cashout = room.cashouts.find((c) => c.team === p.team);
        p.x = cashout.x * CONFIG.CELL_SIZE;
        p.y = cashout.y * CONFIG.CELL_SIZE;
        p.health = 100;
        p.carryingCube = false;
        room.players.push(playerId);
      });

    gameState.waitingPlayers = gameState.waitingPlayers.slice(
      CONFIG.MAX_PLAYERS
    );
    room.status = "selection";

    // Таймер выбора класса
    room.selectionTimer = setTimeout(() => {
      startGame(roomId);
    }, CONFIG.SELECTION_TIME * 1000);

    io.to(roomId).emit("roomCreated", {
      roomId,
      config: CONFIG,
      selectionTime: CONFIG.SELECTION_TIME,
      unlockedAbilities: gameState.players[socket.id].unlockedAbilities,
    });
  }

  // Выбор класса и способности
  socket.on("selectClass", ({ playerClass, ability }) => {
    const player = gameState.players[socket.id];
    if (!player || !player.team) return;

    // Проверка, что способность разблокирована
    if (!player.unlockedAbilities[playerClass].includes(ability)) {
      return socket.emit("error", "Ability not unlocked");
    }

    player.class = playerClass;
    player.ability = ability;
    player.health = CONFIG.CLASSES[playerClass].health;
    player.ready = true;

    const room = getPlayerRoom(socket.id);
    if (room && room.players.every((id) => gameState.players[id].ready)) {
      clearTimeout(room.selectionTimer);
      startGame(room.id);
    }
  });

  // Движение игрока
  socket.on("move", (data) => {
    const player = gameState.players[socket.id];
    if (!player || !player.team || player.health <= 0) return;

    const room = getPlayerRoom(socket.id);
    if (!room || room.status !== "playing") return;

    const speed = CONFIG.CLASSES[player.class].speed;
    const newX = player.x + data.x * speed;
    const newY = player.y + data.y * speed;

    if (canMove(room, newX, newY, player.radius)) {
      player.x = newX;
      player.y = newY;

      if (data.x !== 0 || data.y !== 0) {
        player.rotation = Math.atan2(data.x, -data.y);
      }

      // Перенос куба, если игрок его несет
      if (player.carryingCube) {
        const cube = room.cubes.find((c) => c.carrier === socket.id);
        if (cube) {
          cube.x = player.x;
          cube.y = player.y - CONFIG.CLASSES[player.class].radius - 10;
        }
      }

      io.to(room.id).emit("playerMoved", {
        id: socket.id,
        x: player.x,
        y: player.y,
        rotation: player.rotation,
      });
    }
  });

  // Стрельба
  socket.on("shoot", (angle) => {
    const player = gameState.players[socket.id];
    if (!player || !player.team || player.health <= 0) return;

    const now = Date.now();
    if (now - player.lastShot < 500) return; // Задержка между выстрелами

    player.lastShot = now;
    const room = getPlayerRoom(socket.id);
    if (!room || room.status !== "playing") return;

    const bullet = {
      id: `${socket.id}-${now}`,
      x: player.x,
      y: player.y,
      angle,
      speed: 7,
      owner: socket.id,
      team: player.team,
    };

    room.bullets.push(bullet);
    io.to(room.id).emit("bulletFired", bullet);
  });

  // Использование способности
  socket.on("useAbility", (target) => {
    const player = gameState.players[socket.id];
    if (
      !player ||
      !player.team ||
      player.health <= 0 ||
      !player.class ||
      !player.ability
    )
      return;

    if (player.abilityCooldown > 0) return;

    const room = getPlayerRoom(socket.id);
    if (!room || room.status !== "playing") return;

    player.abilityCooldown = CONFIG.CLASSES[player.class].cooldown;

    switch (player.ability) {
      case "stealth":
        player.invisible = true;
        setTimeout(() => {
          player.invisible = false;
          io.to(room.id).emit("playerVisibilityChanged", {
            playerId: socket.id,
            visible: true,
          });
        }, 5000);
        break;

      case "dash":
        const dashDistance = 100;
        const newX = player.x + Math.sin(player.rotation) * dashDistance;
        const newY = player.y - Math.cos(player.rotation) * dashDistance;

        if (canMove(room, newX, newY, player.radius)) {
          player.x = newX;
          player.y = newY;
        }
        break;

      case "wall":
        const wallX = Math.floor(
          (player.x + Math.sin(player.rotation) * 50) / CONFIG.CELL_SIZE
        );
        const wallY = Math.floor(
          (player.y - Math.cos(player.rotation) * 50) / CONFIG.CELL_SIZE
        );

        if (
          wallX > 0 &&
          wallX < CONFIG.MAP_SIZE - 1 &&
          wallY > 0 &&
          wallY < CONFIG.MAP_SIZE - 1 &&
          !room.map[wallY][wallX]
        ) {
          room.map[wallY][wallX] = {
            type: "wall",
            health: 2,
            temporary: true,
          };
        }
        break;

      // Другие способности...
    }

    io.to(room.id).emit("abilityUsed", {
      playerId: socket.id,
      ability: player.ability,
      target,
    });
  });

  // Взаимодействие с кубом
  socket.on("interactWithCube", () => {
    const player = gameState.players[socket.id];
    if (!player || !player.team || player.health <= 0) return;

    const room = getPlayerRoom(socket.id);
    if (!room || room.status !== "playing") return;

    const playerRadius = CONFIG.CLASSES[player.class].radius;

    // Если игрок уже несет куб - попытаться сдать его
    if (player.carryingCube) {
      const cube = room.cubes.find((c) => c.carrier === socket.id);
      if (cube) {
        // Проверка, находится ли игрок у своего кэшаута
        const cashout = room.cashouts.find((c) => c.team === player.team);
        const distance = Math.sqrt(
          Math.pow(player.x - cashout.x * CONFIG.CELL_SIZE, 2) +
            Math.pow(player.y - cashout.y * CONFIG.CELL_SIZE, 2)
        );

        if (distance < 50) {
          // Доставка куба
          room.scores[player.team]++;
          player.score++;
          player.coins += 10;

          if (room.scores[player.team] >= CONFIG.CUBES_TO_WIN) {
            endGame(room.id, player.team);
          } else {
            // Возвращаем куб на центр
            cube.x = (CONFIG.MAP_SIZE * CONFIG.CELL_SIZE) / 2;
            cube.y = (CONFIG.MAP_SIZE * CONFIG.CELL_SIZE) / 2;
            cube.carrier = null;
            player.carryingCube = false;

            io.to(room.id).emit("cubeDelivered", {
              playerId: socket.id,
              cube,
              scores: room.scores,
            });
          }
        }
      }
    } else {
      // Попытка подобрать куб
      const cube = room.cubes.find(
        (c) =>
          !c.carrier &&
          Math.sqrt(Math.pow(c.x - player.x, 2) + Math.pow(c.y - player.y, 2)) <
            playerRadius + 15
      );

      if (cube) {
        cube.carrier = socket.id;
        player.carryingCube = true;
        io.to(room.id).emit("cubeGrabbed", {
          cubeId: cube.id,
          playerId: socket.id,
        });
      }
    }
  });

  // Покупка в магазине
  socket.on("buyItem", ({ itemId }) => {
    const player = gameState.players[socket.id];
    if (!player) return;

    const item = CONFIG.SHOP_ITEMS.find((i) => i.id === itemId);
    if (!item || player.coins < item.price) return;

    player.coins -= item.price;

    if (item.type === "skin") {
      player.skins.push(itemId);
    } else if (item.type === "ability") {
      // Разблокировка случайной способности
      const classes = Object.keys(CONFIG.ABILITIES);
      const randomClass = classes[Math.floor(Math.random() * classes.length)];
      const lockedAbilities = CONFIG.ABILITIES[randomClass].filter(
        (a) => !player.unlockedAbilities[randomClass].includes(a)
      );

      if (lockedAbilities.length > 0) {
        const newAbility =
          lockedAbilities[Math.floor(Math.random() * lockedAbilities.length)];
        player.unlockedAbilities[randomClass].push(newAbility);
      }
    }

    socket.emit("shopData", {
      items: CONFIG.SHOP_ITEMS,
      coins: player.coins,
      unlockedAbilities: player.unlockedAbilities,
    });
  });

  // Запрос данных магазина
  socket.on("requestShopData", () => {
    const player = gameState.players[socket.id];
    if (!player) return;

    socket.emit("shopData", {
      items: CONFIG.SHOP_ITEMS,
      coins: player.coins,
      unlockedAbilities: player.unlockedAbilities,
    });
  });

  // Обновление настроек управления
  socket.on("updateControls", (controls) => {
    const player = gameState.players[socket.id];
    if (player) {
      player.controls = controls;
    }
  });

  // Отключение игрока
  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);
    const player = gameState.players[socket.id];
    if (!player) return;

    // Если игрок был в комнате
    const room = getPlayerRoom(socket.id);
    if (room) {
      // Если игрок нес куб - отпускаем его
      if (player.carryingCube) {
        const cube = room.cubes.find((c) => c.carrier === socket.id);
        if (cube) {
          cube.carrier = null;
          io.to(room.id).emit("cubeDropped", cube);
        }
      }

      // Удаляем игрока из комнаты
      room.players = room.players.filter((id) => id !== socket.id);
      io.to(room.id).emit("playerDisconnected", socket.id);

      // Если в комнате не осталось игроков - удаляем ее
      if (room.players.length === 0) {
        delete gameState.rooms[room.id];
      }
    }

    // Удаляем из ожидания, если есть
    gameState.waitingPlayers = gameState.waitingPlayers.filter(
      (id) => id !== socket.id
    );
    delete gameState.players[socket.id];
  });
});

// Запуск игры
function startGame(roomId) {
  const room = gameState.rooms[roomId];
  if (!room) return;

  room.status = "playing";
  io.to(roomId).emit("gameStarted");

  // Игровой таймер
  room.gameTimer = setInterval(() => {
    room.gameTime--;

    // Обновление состояния
    updateGameState(room);

    // Проверка условий победы
    if (room.gameTime <= 0) {
      const winner = Object.entries(room.scores).reduce((a, b) =>
        a[1] > b[1] ? a : b
      )[0];
      endGame(roomId, winner);
      return;
    }

    io.to(roomId).emit("gameUpdate", {
      players: room.players.map((id) => gameState.players[id]),
      bullets: room.bullets,
      cubes: room.cubes,
      scores: room.scores,
      gameTime: room.gameTime,
      map: room.map,
    });
  }, 1000);
}

// Обновление состояния игры
function updateGameState(room) {
  // Обновление пуль
  room.bullets.forEach((bullet, index) => {
    bullet.x += Math.sin(bullet.angle) * bullet.speed;
    bullet.y -= Math.cos(bullet.angle) * bullet.speed;

    // Проверка выхода за границы
    if (
      bullet.x < 0 ||
      bullet.x > CONFIG.MAP_SIZE * CONFIG.CELL_SIZE ||
      bullet.y < 0 ||
      bullet.y > CONFIG.MAP_SIZE * CONFIG.CELL_SIZE
    ) {
      room.bullets.splice(index, 1);
      return;
    }

    // Проверка попадания в стену
    const wallX = Math.floor(bullet.x / CONFIG.CELL_SIZE);
    const wallY = Math.floor(bullet.y / CONFIG.CELL_SIZE);

    if (
      room.map[wallY] &&
      room.map[wallY][wallX] &&
      room.map[wallY][wallX].type === "wall" &&
      !room.map[wallY][wallX].indestructible
    ) {
      room.map[wallY][wallX].health--;

      if (room.map[wallY][wallX].health <= 0) {
        room.destroyedWalls.push({
          x: wallX,
          y: wallY,
          respawnTime: CONFIG.WALL_RESPAWN_TIME,
        });
        room.map[wallY][wallX] = 0;
      }

      room.bullets.splice(index, 1);
      io.to(room.id).emit("wallHit", { x: wallX, y: wallY });
      return;
    }

    // Проверка попадания в игрока
    for (const playerId of room.players) {
      const player = gameState.players[playerId];
      if (
        playerId !== bullet.owner &&
        player.team !== bullet.team &&
        !player.invisible &&
        player.health > 0
      ) {
        const distance = Math.sqrt(
          Math.pow(bullet.x - player.x, 2) + Math.pow(bullet.y - player.y, 2)
        );

        if (distance < CONFIG.CLASSES[player.class].radius + 5) {
          player.health -= 20;
          room.bullets.splice(index, 1);

          if (player.health <= 0) {
            player.health = 0;
            // Сброс куба, если игрок его нес
            if (player.carryingCube) {
              const cube = room.cubes.find((c) => c.carrier === playerId);
              if (cube) {
                cube.carrier = null;
                io.to(room.id).emit("cubeDropped", cube);
              }
            }

            // Возрождение через 5 секунд
            setTimeout(() => {
              if (player.health <= 0) {
                player.health = CONFIG.CLASSES[player.class].health;
                const cashout = room.cashouts.find(
                  (c) => c.team === player.team
                );
                player.x = cashout.x * CONFIG.CELL_SIZE;
                player.y = cashout.y * CONFIG.CELL_SIZE;
                io.to(room.id).emit("playerRespawned", playerId);
              }
            }, 5000);
          }

          io.to(room.id).emit("playerHit", {
            playerId,
            health: player.health,
            bulletId: bullet.id,
          });
          return;
        }
      }
    }
  });

  // Обновление способностей
  room.players.forEach((playerId) => {
    const player = gameState.players[playerId];
    if (player.abilityCooldown > 0) {
      player.abilityCooldown--;
    }
  });

  // Обновление стен
  updateWalls(room);
}

// Статические файлы
app.use(express.static(path.join(__dirname, "public")));

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
