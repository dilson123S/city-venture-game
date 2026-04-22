(function () {
  const PLAYER_TOKEN_KEY = "city-venture-player-token";
  const BACKEND_URL_KEY = "city-venture-backend-url";
  const app = document.querySelector("#app");
  const backendUrl = resolveBackendUrl();
  const socket = window.io(backendUrl, {
    transports: ["websocket", "polling"],
  });

  const state = {
    view: null,
    toasts: [],
    showHandModal: false,
    dice: {
      face: 1,
      spinning: false,
      spinSeed: 0,
      pendingFace: null,
    },
  };
  let diceSpinTimer = null;

  // Render agrupado para evitar parpadeos
  let renderScheduled = false;
  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    window.requestAnimationFrame(() => {
      renderScheduled = false;
      render();
    });
  }

  const uiClock = window.setInterval(() => {
    if (state.view?.session?.turn?.negotiationEndsAt) {
      scheduleRender();
    }
  }, 1000);

  socket.on("connect", bootstrapAuth);
  socket.on("state:update", (view) => {
    state.view = view;
    syncDiceFaceFromView(view);
    scheduleRender();
  });
  socket.on("session:created", () => {
    pushToast("Sesion host creada.", "success");
  });
  socket.on("joined", ({ joinToken }) => {
    window.localStorage.setItem(PLAYER_TOKEN_KEY, joinToken);
  });
  socket.on("toast", (toast) => {
    pushToast(toast.message, toast.type || "error");
  });

  app.addEventListener("click", handleClick);
  app.addEventListener("submit", handleSubmit);
  app.addEventListener("change", handleChange);

  render();

  function bootstrapAuth() {
    const query = new URLSearchParams(window.location.search);
    const joinToken = query.get("join");
    const savedPlayerToken = window.localStorage.getItem(PLAYER_TOKEN_KEY);

    if (joinToken) {
      socket.emit("player:join", { joinToken });
      return;
    }
    if (savedPlayerToken) {
      socket.emit("player:join", { joinToken: savedPlayerToken });
    }
  }

  function handleClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) {
      return;
    }
    const action = button.dataset.action;

    switch (action) {
      case "host-logout":
        socket.emit("host:logout");
        return;
      case "host-start-game":
        socket.emit("host:start-game");
        return;
      case "host-reset-session":
        if (window.confirm("Se reiniciara toda la sesion actual.")) {
          socket.emit("host:reset-session");
          window.localStorage.removeItem(PLAYER_TOKEN_KEY);
        }
        return;
      case "copy-link": {
        const text = button.dataset.url || "";
        const fallbackCopy = () => {
          const textArea = document.createElement("textarea");
          textArea.value = text;
          textArea.style.position = "fixed";
          textArea.style.opacity = "0";
          document.body.appendChild(textArea);
          textArea.select();
          try {
            if (document.execCommand("copy")) {
              pushToast("Enlace copiado.", "success");
            } else {
              throw new Error("fail");
            }
          } catch (e) {
            pushToast("No se pudo copiar automáticamente. Por favor mantén presionado el enlace arriba y cópialo manualmente.", "error");
          }
          document.body.removeChild(textArea);
        };

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(() => {
            pushToast("Enlace copiado.", "success");
          }).catch(() => fallbackCopy());
        } else {
          fallbackCopy();
        }
        return;
      }
      case "clear-player-link":
        window.localStorage.removeItem(PLAYER_TOKEN_KEY);
        pushToast("Vinculo de jugador borrado en este dispositivo.", "success");
        render();
        return;
      case "clear-token-image":
        emitProfileUpdate({ tokenImage: "" });
        return;
      case "pick-color":
        emitProfileUpdate({ color: button.dataset.value });
        return;
      case "pick-badge":
        emitProfileUpdate({ tokenBadge: button.dataset.value });
        return;
      case "pick-avatar":
        emitProfileUpdate({ avatarId: button.dataset.value });
        return;
      case "accept-contract":
        socket.emit("contract:respond", { contractId: button.dataset.contractId, accept: true });
        return;
      case "reject-contract":
        socket.emit("contract:respond", { contractId: button.dataset.contractId, accept: false });
        return;
      case "do-action": {
        const payload = { ...button.dataset };
        delete payload.action;
        if (payload.command === "roll-die") {
          startDiceSpin();
        }
        socket.emit("player:action", {
          action: payload.command,
          payload: normalizePayload(payload),
        });
        return;
      }
      case "toggle-hand":
        state.showHandModal = !state.showHandModal;
        render();
        return;
      case "close-hand":
        state.showHandModal = false;
        render();
        return;
      default:
    }
  }

  function handleSubmit(event) {
    const form = event.target;
    const formType = form.dataset.form;
    if (!formType) {
      return;
    }
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());

    switch (formType) {
      case "create-session":
        socket.emit("host:create-session", { playerCount: Number(data.playerCount) });
        return;
      case "host-login":
        socket.emit("host:login", {
          username: String(data.username || "").trim(),
          password: String(data.password || ""),
        });
        form.reset();
        return;
      case "set-backend-url": {
        const nextBackendUrl = normalizeBaseUrl(data.backendUrl);
        if (!nextBackendUrl) {
          window.localStorage.removeItem(BACKEND_URL_KEY);
          pushToast("Backend limpiado. Se usara el valor por defecto.", "success");
          window.location.reload();
          return;
        }
        if (!/^https?:\/\//i.test(nextBackendUrl)) {
          pushToast("Debes ingresar una URL valida que empiece por http o https.", "error");
          return;
        }
        window.localStorage.setItem(BACKEND_URL_KEY, nextBackendUrl);
        pushToast("Backend guardado. Reconectando...", "success");
        window.location.reload();
        return;
      }
      case "profile":
        emitProfileUpdate(data);
        return;
      case "turn-action":
        if (data.command === "roll-die") {
          startDiceSpin();
        }
        socket.emit("player:action", {
          action: data.command,
          payload: normalizePayload(data),
        });
        return;
      case "contract":
        socket.emit("contract:propose", normalizePayload(data));
        form.reset();
        return;
      case "card-play":
        socket.emit("player:action", {
          action: "play-card",
          payload: normalizePayload(data),
        });
        state.showHandModal = false;
        render();
        return;
      default:
    }
  }

  function handleChange(event) {
    const input = event.target;
    if (input.matches("[data-upload='token-image']")) {
      const file = input.files?.[0];
      if (!file) {
        return;
      }
      compressImage(file)
        .then((dataUrl) => emitProfileUpdate({ tokenImage: dataUrl }))
        .catch(() => pushToast("No pude procesar la imagen elegida.", "error"));
      return;
    }
  }

  function emitProfileUpdate(rawData) {
    const payload = {};
    if (typeof rawData.name === "string") {
      payload.name = rawData.name.trim();
    }
    if (typeof rawData.color === "string") {
      payload.color = rawData.color;
    }
    if (typeof rawData.tokenBadge === "string") {
      payload.tokenBadge = rawData.tokenBadge;
    }
    if (typeof rawData.avatarId === "string") {
      payload.avatarId = rawData.avatarId;
    }
    if (typeof rawData.roleId === "string") {
      payload.roleId = rawData.roleId;
    }
    if (typeof rawData.tokenImage === "string") {
      payload.tokenImage = rawData.tokenImage;
    }
    socket.emit("player:update-profile", payload);
  }

  function normalizePayload(data) {
    const next = { ...data };
    [
      "playerCount",
      "riggedRoll",
      "delta",
      "offerCredits",
      "requestCredits",
      "noAttackTurns",
      "discardIndex",
    ].forEach((key) => {
      if (key in next && next[key] !== "") {
        next[key] = Number(next[key]);
      }
    });
    delete next.form;
    return next;
  }

  function pushToast(message, type) {
    const toast = {
      id: cryptoRandom(),
      message,
      type,
    };
    state.toasts = [toast, ...state.toasts].slice(0, 4);
    scheduleRender();
    window.setTimeout(() => {
      state.toasts = state.toasts.filter((entry) => entry.id !== toast.id);
      scheduleRender();
    }, 2800);
  }

  function render() {
    const view = state.view;
    app.innerHTML = `
      ${renderToasts()}
      ${!view ? renderLoading() : renderMode(view)}
      ${state.showHandModal && view && view.self && view.self.hand ? renderHandModal(view) : ""}
    `;
    syncQueryState();
  }

  function renderMode(view) {
    if (!view.session) {
      return renderLanding(view);
    }
    if (view.mode === "host") {
      return renderHost(view);
    }
    if (view.mode === "player") {
      return renderPlayer(view);
    }
    return renderGuest(view);
  }

  function renderLoading() {
    const query = new URLSearchParams(window.location.search);
    const hasJoinLink = Boolean(query.get("join"));
    return `
      <section class="auth-shell">
        <div class="auth-card-wrap">
          <article class="login-auth-card">
            <p class="eyebrow">${hasJoinLink ? "Conectando jugador" : "Conectando"}</p>
            <h2 class="section-title">City Venture</h2>
            <p class="section-copy">${
              hasJoinLink
                ? "Validando tu enlace de jugador y cargando el lobby."
                : "Conectando con el servidor realtime."
            }</p>
          </article>
        </div>
      </section>
    `;
  }

  function renderLanding(view) {
    const hostAuthenticated = view.mode === "host";
    if (!hostAuthenticated) {
      return renderLoginScreen(view);
    }
    return `
      <section class="shell landing-shell">
        <div class="poster">
          <article class="hero-plane">
            <p class="eyebrow">Multiplayer CEO Control</p>
            <h1 class="poster-title">City Venture <span>Board + Mobile Command</span></h1>
            <p class="poster-copy">
              Host en el computador, informacion privada en cada celular, contratos con respuesta en vivo y fichas personalizadas con foto.
            </p>
            <div class="poster-grid">
              <article>
                <h3>Host central</h3>
                <p>El tablero vive en el PC y muestra el mercado, turnos, fichas y actividad general.</p>
              </article>
              <article>
                <h3>Moviles privados</h3>
                <p>Cada CEO abre su enlace para ver cartas, rol, perfil, acciones y contratos entrantes.</p>
              </article>
              <article>
                <h3>Sesion local</h3>
                <p>Comparte enlaces en la misma red WiFi y juega desde varios dispositivos al mismo tiempo.</p>
              </article>
            </div>
          </article>
          <aside class="side-plane">
            <div>
              <p class="eyebrow">Crear sesion</p>
              <h2 class="section-title">Levanta una nueva mesa</h2>
              <p class="section-copy">El host genera los enlaces y despues inicia la partida cuando todos entren.</p>
            </div>
            <form data-form="create-session" class="field">
              <label for="playerCount">Numero de jugadores</label>
              <select id="playerCount" name="playerCount">
                ${[2, 3, 4, 5, 6].map((count) => `<option value="${count}">${count} jugadores</option>`).join("")}
              </select>
              <button class="primary" type="submit">Crear sesion host</button>
            </form>
            <div class="button-row">
              <button data-action="host-logout" class="ghost" type="button">Cerrar sesion host</button>
            </div>
          </aside>
        </div>
      </section>
    `;
  }

  function renderGuest(view) {
    return renderLoginScreen(view);
  }

  function renderLoginScreen(view) {
    return `
      <section class="auth-shell">
        <div class="auth-card-wrap">
          <h1 class="auth-title">City Venture</h1>
          ${renderHostLoginCard(view, "auth")}
        </div>
      </section>
    `;
  }

  // ─── MARKET INDEX WIDGET ─────────────────────────────────
  function renderMarketIndexWidget(session) {
    const mi = session.marketIndex || { id: "stable", name: "Estable", multiplier: 1.0, roll: null };
    const icons = { recession: "📉", stable: "📊", boom: "📈" };
    const icon = icons[mi.id] || "📊";
    return `
      <div class="market-index-bar ${escapeAttribute(mi.id)}">
        <div class="market-index-icon">${icon}</div>
        <div class="market-index-info">
          <strong>Mercado: ${escapeHtml(mi.name)}</strong>
          <span>Rentas x${mi.multiplier} ${mi.roll ? `(dado: ${mi.roll})` : ""}</span>
        </div>
      </div>
    `;
  }

  // ─── VP TRACKER WIDGET ───────────────────────────────────
  function renderVPTracker(player) {
    const vp = player.venturePoints || 0;
    const maxVP = 10;
    const pct = Math.min(100, (vp / maxVP) * 100);
    const nearVictory = vp >= 8;
    const bd = player.vpBreakdown || {};
    const badges = [];
    if (bd.credits) badges.push(`💰${bd.credits}`);
    if (bd.connections) badges.push(`🔗${bd.connections}`);
    if (bd.sectors) badges.push(`🏢${bd.sectors}`);
    if (bd.rivalry) badges.push(`⚔️${bd.rivalry}`);
    if (bd.b2b) badges.push(`🤝${bd.b2b}`);

    return `
      <div class="vp-tracker">
        <div class="vp-tracker-label">
          <span>Venture Points</span>
          <span class="vp-tracker-value">${vp} / ${maxVP}</span>
        </div>
        <div class="vp-bar-track">
          <div class="vp-bar-fill ${nearVictory ? "near-victory" : ""}" style="width:${pct}%"></div>
        </div>
        ${badges.length ? `<div class="vp-breakdown">${badges.map((b) => `<span class="vp-badge">${b}</span>`).join("")}</div>` : ""}
      </div>
    `;
  }

  // ─── SECTOR DOMINATION BADGES ────────────────────────────
  function renderSectorBadges(dominatedSectors) {
    if (!dominatedSectors || !dominatedSectors.length) return "";
    return `
      <div class="sector-badges">
        ${dominatedSectors.map((s) => `<span class="sector-badge ${escapeAttribute(s.toLowerCase())}">👑 ${escapeHtml(s)}</span>`).join("")}
      </div>
    `;
  }

  // ─── RIVALRY BADGE ───────────────────────────────────────
  function renderRivalryBadge(view, player) {
    if (!player.rivalRevealed || !player.rivalId) return "";
    const rival = getPublicPlayer(view, player.rivalId);
    if (!rival) return "";
    const cls = player.rivalDefeated ? "defeated" : "";
    return `<span class="rivalry-badge ${cls}">${player.rivalDefeated ? "✅" : "⚔️"} Rival: ${escapeHtml(rival.name)}</span>`;
  }

  // ─── HOST VIEW ───────────────────────────────────────────
  function renderHost(view) {
    const currentPlayer = getPublicPlayer(view, view.session.currentPlayerId);
    const inLobby = view.session.status === "lobby";
    const joinedCount = countJoinedPlayers(view);
    const totalPlayers = view.session.players.length;
    const everyoneJoined = joinedCount === totalPlayers;
    const session = view.session;
    return `
      <section class="host-shell">
        <section class="board-panel">
          <div class="board-header">
            <div>
              <p class="eyebrow">Host Console</p>
              <h1 class="board-title">City Venture <span>Live Session ${escapeHtml(session.id)}</span></h1>
              <p class="section-copy">${escapeHtml(session.turn.message || "")}</p>
            </div>
            <div class="toolbar">
              ${
                inLobby
                  ? `<button data-action="host-start-game" class="primary" type="button" ${
                      everyoneJoined ? "" : "disabled"
                    }>Iniciar partida</button>`
                  : ""
              }
              <button data-action="host-reset-session" class="danger" type="button">Reiniciar sesion</button>
              <button data-action="host-logout" class="ghost" type="button">Cerrar sesion host</button>
            </div>
          </div>

          ${inLobby ? renderHostLobbySetup(view, { joinedCount, totalPlayers, everyoneJoined }) : ""}

          ${!inLobby || everyoneJoined ? renderBoard(view, "host") : ""}

          ${
            !inLobby || everyoneJoined
              ? `
                ${renderMarketIndexWidget(session)}

                <div class="status-grid-4">
                  <article class="stat-strip">
                    <p class="muted">Turno actual</p>
                    <div class="stat-value">${escapeHtml(currentPlayer?.name || "Sin turno")}</div>
                  </article>
                  <article class="stat-strip">
                    <p class="muted">Ronda</p>
                    <div class="stat-value">${session.round}</div>
                  </article>
                  <article class="stat-strip">
                    <p class="muted">Indice de Mercado</p>
                    <div class="stat-value">${escapeHtml(session.marketIndex?.name || "Estable")}</div>
                  </article>
                  <article class="stat-strip">
                    <p class="muted">Evento global</p>
                    <div class="stat-value">${escapeHtml(session.activeEvent?.name || "Sin evento")}</div>
                  </article>
                </div>

                ${renderSectorDomainsPanel(session)}

                <div class="panel-grid">
                  <article class="panel">
                    <p class="eyebrow">Empresas</p>
                    <div class="players-grid">${session.players
                      .map((player) => renderPublicPlayerCard(view, player))
                      .join("")}</div>
                  </article>
                  <article class="panel">
                    <p class="eyebrow">Bitacora</p>
                    <div class="timeline">${session.log
                      .map((entry) => `<article class="timeline-item"><p>${escapeHtml(entry)}</p></article>`)
                      .join("")}</div>
                  </article>
                </div>
              `
              : ""
          }
        </section>
      </section>
    `;
  }

  function renderSectorDomainsPanel(session) {
    const domains = session.sectorDomains || {};
    const entries = Object.entries(domains);
    if (!entries.length) return "";
    return `
      <article class="panel">
        <p class="eyebrow">Dominios de Sector Activos</p>
        <div class="sector-badges">
          ${entries.map(([sector, ownerId]) => {
            const owner = session.players.find((p) => p.id === ownerId);
            return `<span class="sector-badge ${escapeAttribute(sector.toLowerCase())}">👑 ${escapeHtml(sector)}: ${escapeHtml(owner?.name || "?")}</span>`;
          }).join("")}
        </div>
      </article>
    `;
  }

  function renderHostLobbySetup(view, progress) {
    return `
      <section class="panel">
        <p class="eyebrow">Lobby de jugadores</p>
        <p class="section-copy">Jugadores conectados: <strong>${progress.joinedCount}/${progress.totalPlayers}</strong></p>
        <h2 class="section-title">Invitaciones para celulares</h2>
        <p class="section-copy">Comparte estos enlaces. En celular no se requiere autenticacion: solo abrir el link para entrar.</p>
        <div class="invite-grid">
          ${(view.host.joinLinks || []).map((invite) => renderInviteCard(invite, view)).join("")}
        </div>
        <div class="empty-state">${
          progress.everyoneJoined
            ? "Todos entraron por su enlace. Ya puedes iniciar la partida y se mostrara el tablero completo."
            : "Espera a que entren todos por su enlace para mostrar el tablero e iniciar la partida."
        }</div>
      </section>
    `;
  }

  // ─── PLAYER VIEW ─────────────────────────────────────────
  function renderPlayer(view) {
    // Rivalry declaration phase
    if (view.session.status === "playing" && view.session.turn.phase === "declare_rival") {
      return renderRivalDeclaration(view);
    }

    if (view.session.status === "lobby") {
      return renderPlayerLobby(view);
    }

    const self = view.self;
    const publicSelf = getPublicPlayer(view, self.id);
    const currentPlayer = getPublicPlayer(view, view.session.currentPlayerId);
    const currentTile = getTileByPosition(view, publicSelf.position);
    const canRoll = self.isCurrentPlayer && ["await_roll", "victory_ready"].includes(view.session.turn.phase);
    const incomingContracts = (self.incomingContracts || []).length;
    const outgoingContracts = (self.outgoingContracts || []).length;
    const propertyNames = self.properties.length
      ? self.properties.map((tile) => tile.name).join(", ")
      : "Sin propiedades";
    const quickActions = renderHudQuickActions(view, { currentTile });
    const rightTopLabel = currentPlayer?.roleName || currentPlayer?.name || "Sin turno";

    return `
      <section class="player-hud-shell">
        <section class="player-hud-canvas">
          <header class="hud-topbar">
            <div class="hud-role-chip">${escapeHtml(self.role.name)}</div>
            <div class="hud-heading">
              <h1 class="hud-title">City Venture</h1>
              <p class="hud-subtitle">B2B Connect</p>
            </div>
            <div class="hud-role-chip">${escapeHtml(rightTopLabel)}</div>
          </header>

          <div class="player-hud-grid">
            <section class="hud-panel hud-left">
              <p class="eyebrow">CEO Panel</p>
              <div class="hud-stat-list">
                ${renderVPTracker(publicSelf)}
                ${renderMarketIndexWidget(view.session)}
                <article class="hud-stat">
                  <span>Creditos</span>
                  <strong>${formatCredits(publicSelf.credits || 0)}</strong>
                </article>
                <article class="hud-stat">
                  <span>Conexiones</span>
                  <strong>${publicSelf.connections || 0}</strong>
                </article>
                <button data-action="toggle-hand" class="primary" type="button" style="padding: 16px 12px; font-size: 1.1rem; box-shadow: 0 0 20px rgba(85,239,255,0.2); margin: 6px 0; border-radius:12px;">
                  🎴 Cartas (${self.hand.length})
                </button>
                <article class="hud-stat">
                  <span>Propiedades</span>
                  <strong>${escapeHtml(propertyNames)}</strong>
                </article>
                ${renderSectorBadges(publicSelf.dominatedSectors)}
                ${renderRivalryBadge(view, publicSelf)}
                ${renderLoanBadges(self)}
                <article class="hud-stat">
                  <span>Habilidad de Rol</span>
                  <strong>${getRoleAbilityDescription(self.role.id)}</strong>
                </article>
              </div>
            </section>

            <section class="hud-center">
              <div class="dice-stage">
                ${renderHudDice()}
                <button data-action="do-action" data-command="roll-die" class="primary hud-roll-btn" type="button" ${
                  canRoll ? "" : "disabled"
                }>Lanzar Dado</button>
                <p class="section-copy hud-helper">${escapeHtml(
                  canRoll
                    ? "Tu turno esta listo. Pulsa Lanzar Dado para avanzar."
                    : view.session.turn.message || "Espera la siguiente fase para continuar.",
                )}</p>
                <div class="hud-action-zone">${quickActions}</div>
              </div>
            </section>

            <section class="hud-panel hud-right">
              <p class="eyebrow">Estado del juego</p>
              <div class="hud-stat-list">
                <article class="hud-stat">
                  <span>Turno actual</span>
                  <strong>${escapeHtml(view.session.currentPlayerName || "Sin turno")}</strong>
                </article>
                <article class="hud-stat">
                  <span>Ronda</span>
                  <strong>${view.session.round}</strong>
                </article>
                <article class="hud-stat">
                  <span>Posicion</span>
                  <strong>${escapeHtml(currentTile?.name || "Sin casilla")}</strong>
                </article>
                <article class="hud-stat">
                  <span>Contratos</span>
                  <strong>${incomingContracts} recibidos / ${outgoingContracts} enviados</strong>
                </article>
                <article class="hud-stat">
                  <span>Contratos B2B cerrados</span>
                  <strong>${self.acceptedContracts || 0}</strong>
                </article>
              </div>
            </section>
          </div>
        </section>
      </section>
    `;
  }

  function renderLoanBadges(self) {
    const loans = self.loans || [];
    const collaterals = self.collaterals || [];
    if (!loans.length && !collaterals.length) return "";
    let html = "";
    loans.forEach((loan) => {
      if (loan.active) {
        html += `<span class="loan-badge">🏦 Prestamo: ${loan.amount} (int: ${loan.interest}/ronda)</span>`;
      }
    });
    collaterals.forEach((col) => {
      if (col.active) {
        html += `<span class="loan-badge">📄 Garantia: ${col.turnsRemaining} turnos</span>`;
      }
    });
    return html;
  }

  // ─── RIVAL DECLARATION ───────────────────────────────────
  function renderRivalDeclaration(view) {
    const self = view.self;
    const publicSelf = getPublicPlayer(view, self.id);
    const hasDeclared = publicSelf.hasRivalDeclared;
    const otherPlayers = view.session.players.filter((p) => p.id !== self.id);

    return `
      <section class="player-hud-shell">
        <section class="player-hud-canvas" style="aspect-ratio:auto;min-height:auto;padding:24px;">
          <header class="hud-topbar">
            <div class="hud-role-chip">${escapeHtml(self.role.name)}</div>
            <div class="hud-heading">
              <h1 class="hud-title">Declarar Rival</h1>
              <p class="hud-subtitle">Sistema de Rivalidad</p>
            </div>
            <div class="hud-role-chip">${escapeHtml(publicSelf.name)}</div>
          </header>

          ${hasDeclared
            ? `<div class="empty-state" style="text-align:center;margin-top:16px;">✅ Ya declaraste tu rival secreto. Esperando a los demas jugadores...</div>`
            : `
              <p class="section-copy" style="text-align:center;margin:16px 0;">Elige un rival secreto. Si lo superas en creditos al final de ronda, ganas +1 conexion. Si caes en su propiedad, el dado de mercado te penaliza.</p>
              <div class="rival-select-grid">
                ${otherPlayers.map((p) => `
                  <button class="rival-select-card" data-action="do-action" data-command="declare-rival" data-target-player-id="${escapeAttribute(p.id)}" type="button">
                    <div class="rival-name">${escapeHtml(p.name)}</div>
                    <div class="rival-role">${escapeHtml(p.roleName)}</div>
                  </button>
                `).join("")}
              </div>
              <div style="text-align:center;margin-top:12px;">
                <button data-action="do-action" data-command="skip-rival" class="ghost" type="button">No quiero rival</button>
              </div>
            `
          }
        </section>
      </section>
    `;
  }

  function getRoleAbilityDescription(roleId) {
    const abilities = {
      energy: "Mitad de renta 1 vez por ronda",
      software: "Inmune a 1ra carta de ataque",
      logistics: "Siempre avanzas +1 casilla",
      creative: "+20 creditos por negociacion exitosa",
      financial: "+10% ingresos / Duplicar 1 ingreso",
      strategic: "Ver siguiente carta / Cambiar dado 1 vez",
      relations: "Empiezas con +2 conexiones",
      industrial: "20% descuento en propiedades / Compra remota"
    };
    return abilities[roleId] || "Habilidad no definida";
  }

  function renderHudQuickActions(view, context = {}) {
    const self = view.self;
    const publicSelf = getPublicPlayer(view, self.id);
    const turn = view.session.turn;
    const currentTile =
      context.currentTile ||
      (turn.tileId ? getTile(view, turn.tileId) : getTileByPosition(view, publicSelf.position));
    const freeProperties = getFreeProperties(view);

    if (view.session.status === "finished") {
      return '<div class="hud-action-note">La partida termino. Revisa el resultado en el tablero principal.</div>';
    }

    if (!self.isCurrentPlayer) {
      // Non-current players can still take loans
      let body = `<div class="hud-action-note">Esperando el turno de ${escapeHtml(view.session.currentPlayerName || "otro CEO")}.</div>`;
      if (publicSelf.credits <= 100) {
        body += `
          <div class="hud-action-row">
            <button data-action="do-action" data-command="take-loan" class="ghost" type="button">🏦 Pedir prestamo (200 cr)</button>
          </div>
        `;
      }
      return body;
    }

    let body = "";
    switch (turn.phase) {
      case "await_roll":
      case "victory_ready":
        body = '<div class="hud-action-note">Lanza el dado central para continuar el turno.</div>';
        if (turn.phase === "victory_ready" && self.canBuildTower) {
          body += `
            <div class="hud-action-row">
              <button data-action="do-action" data-command="roll-die" data-force-build="true" class="secondary" type="button">🏗️ Construir Venture Tower</button>
            </div>
          `;
        }
        break;
      case "movement_adjust":
        body = `
          <div class="hud-action-row">
            <button data-action="do-action" data-command="adjust-route" data-delta="-1" class="ghost" type="button">← Retroceder 1</button>
            <button data-action="do-action" data-command="adjust-route" data-delta="0" class="secondary" type="button">Mantener</button>
            <button data-action="do-action" data-command="adjust-route" data-delta="1" class="primary" type="button">Avanzar 1 →</button>
          </div>
        `;
        break;
      case "property_offer":
        body = `
          <div class="hud-action-row">
            <button data-action="do-action" data-command="buy-property" class="primary" type="button">Comprar ${formatCredits(currentTile?.price || 0)}</button>
            <button data-action="do-action" data-command="skip-property" class="ghost" type="button">Dejar libre</button>
          </div>
        `;
        break;
      case "market_roll":
        if (!turn.marketRoll) {
          body = `
            <div class="hud-action-row">
              <button data-action="do-action" data-command="roll-market" class="primary" type="button">🎲 Lanzar dado de mercado</button>
            </div>
          `;
          break;
        }

        body = `
          <div class="hud-action-note">
            Mercado ${turn.marketRoll} - ${escapeHtml(turn.rentPreview?.marketLabel || "normal")}.
            Renta: ${formatCredits(turn.rentPreview?.total || 0)}
          </div>
          <div class="hud-action-row">
            <button data-action="do-action" data-command="pay-rent" class="primary" type="button">Pagar renta</button>
            <button data-action="do-action" data-command="reroll-market" class="ghost" type="button">Repetir dado</button>
          </div>
        `;
        if (publicSelf.connections >= 5) {
          body += `
            <div class="hud-action-row">
              <button data-action="do-action" data-command="skip-rent-with-connections" class="secondary" type="button">Usar 5 conexiones</button>
            </div>
          `;
        }
        if (self.role.id === "energy" && publicSelf.energyRentDiscountReady) {
          body += `
            <div class="hud-action-row">
              <button data-action="do-action" data-command="energy-rent-discount" class="ghost" type="button">Mitad de renta</button>
            </div>
          `;
        }
        break;
      case "negotiation":
        body = '<div class="hud-action-note">Fase B2B activa (45s). Cierra cuando termines de negociar.</div>';
        if (self.role.id === "creative" && publicSelf.creativeExtendReady !== false) {
          body += `
            <div class="hud-action-row">
              <button data-action="do-action" data-command="extend-negotiation" class="secondary" type="button">Extender +30s</button>
            </div>
          `;
        }
        body += `
          <div class="hud-action-row">
            <button data-action="do-action" data-command="end-turn" class="primary" type="button">Terminar turno</button>
          </div>
        `;
        break;
      case "skip_turn":
        body = `
          <div class="hud-action-row">
            <button data-action="do-action" data-command="end-turn" class="primary" type="button">Cerrar turno bloqueado</button>
          </div>
        `;
        break;
      default:
        body = '<div class="hud-action-note">Esperando la siguiente accion del servidor.</div>';
    }

    // Role-specific abilities
    if (self.role.id === "financial" && publicSelf.financialDoubleReady) {
      body += `
        <div class="hud-action-row">
          <button data-action="do-action" data-command="arm-financial-double" class="ghost" type="button">💰 Doblar proximo ingreso</button>
        </div>
      `;
    }

    if (self.role.id === "relations" && publicSelf.networkingExtraReady) {
      body += `
        <div class="hud-action-row">
          <button data-action="do-action" data-command="arm-networking-bonus" class="ghost" type="button">🔗 Armar conexion extra</button>
        </div>
      `;
    }

    // Loan option
    if (publicSelf.credits <= 100) {
      body += `
        <div class="hud-action-row">
          <button data-action="do-action" data-command="take-loan" class="ghost" type="button">🏦 Pedir prestamo (200 cr)</button>
        </div>
      `;
    }

    if (self.role.id === "industrial" && freeProperties.length && !publicSelf.industrialRemoteBuyUsed) {
      body += `
        <form data-form="turn-action" class="field hud-inline-form">
          <input type="hidden" name="command" value="remote-buy-property" />
          <label for="hud-remote-buy">Compra remota</label>
          <select id="hud-remote-buy" name="tileId">
            ${freeProperties
              .map((tile) => `<option value="${escapeAttribute(tile.id)}">${escapeHtml(tile.name)} - ${formatCredits(tile.price)}</option>`)
              .join("")}
          </select>
          <button class="ghost" type="submit">Comprar</button>
        </form>
      `;
    }

    return body;
  }

  function renderPlayerLobby(view) {
    const self = view.self;
    const publicSelf = getPublicPlayer(view, self.id);
    return `
      <section class="player-shell">
        <section class="mobile-panel">
          <div class="player-topbar">
            <div>
              <p class="eyebrow">Lobby de jugador</p>
              <h1 class="section-title">${escapeHtml(publicSelf?.name || "CEO")}</h1>
              <p class="section-copy">Ya estas dentro. Personaliza tu perfil y espera a que el host inicie la partida.</p>
            </div>
            <div class="chip-row">
              <span class="chip">Sesion ${escapeHtml(view.session.id)}</span>
              <span class="chip">${escapeHtml(self.role.name)}</span>
              <span class="chip">Esperando inicio</span>
            </div>
          </div>

          <section class="panel">
            <p class="eyebrow">Identidad del CEO</p>
            ${renderIdentityEditor(view)}
          </section>

          <section class="panel">
            <p class="eyebrow">Estado del lobby</p>
            <div class="players-grid">${view.session.players.map((player) => renderPublicPlayerCard(view, player)).join("")}</div>
          </section>

          <div class="empty-state">Esta pantalla se mantiene en tu celular mientras el host prepara la mesa.</div>
        </section>
      </section>
    `;
  }

  function renderInviteCard(invite, view) {
    const player = getPublicPlayer(view, invite.playerId);
    return `
      <article class="invite-card">
        <p class="eyebrow">Asiento ${invite.seatNumber}</p>
        <h3 class="section-title">${escapeHtml(player?.name || `CEO ${invite.seatNumber}`)}</h3>
        <p class="section-copy">${escapeHtml(player?.roleName || "")}</p>
        <a class="invite-link mono" href="${escapeAttribute(invite.url)}">${escapeHtml(invite.url)}</a>
        <div class="button-row">
          <button data-action="copy-link" data-url="${escapeAttribute(invite.url)}" class="secondary" type="button">Copiar enlace</button>
        </div>
      </article>
    `;
  }

  function renderHostLoginCard(view, variant) {
    const idSuffix = variant || "login";
    return `
      <article class="login-auth-card">
        <p class="eyebrow">Login</p>
        <h2 class="section-title">Acceso</h2>
        <p class="section-copy">
          Usuario predeterminado: <strong>${escapeHtml(view.host?.defaultUsername || "admin")}</strong>
        </p>
        <form data-form="host-login" class="field">
          <label for="host-user-${idSuffix}">Usuario</label>
          <input id="host-user-${idSuffix}" name="username" value="${escapeAttribute(view.host?.defaultUsername || "admin")}" autocomplete="username" />
          <label for="host-pass-${idSuffix}">Contrasena</label>
          <input id="host-pass-${idSuffix}" name="password" type="password" autocomplete="current-password" placeholder="Ingresa la contrasena" />
          <button class="primary" type="submit">Iniciar sesion</button>
        </form>
      </article>
    `;
  }

  function renderSeatCard(player, view) {
    const roleLocked = !player.connected;
    return `
      <article class="seat-card">
        <p class="eyebrow">Seat ${player.seatNumber}</p>
        <h3 class="section-title">${escapeHtml(player.name)}</h3>
        <p class="section-copy">${player.connected ? "Conectado" : "Aun no entra"}</p>
        <form data-form="seat-role" class="field">
          <input type="hidden" name="playerId" value="${escapeAttribute(player.id)}" />
          <label for="role-${escapeAttribute(player.id)}">Rol</label>
          <select id="role-${escapeAttribute(player.id)}" name="roleId" ${roleLocked ? "disabled" : ""}>
            ${view.catalog.roles
              .map(
                (role) =>
                  `<option value="${escapeAttribute(role.id)}" ${role.id === findRoleId(view, player.id) ? "selected" : ""}>${escapeHtml(role.name)}</option>`,
              )
              .join("")}
          </select>
          <button class="ghost" type="submit" ${roleLocked ? "disabled" : ""}>Guardar rol</button>
          <p class="section-copy">${roleLocked ? "Disponible cuando el jugador abra su enlace." : "El jugador ya puede editar nombre y perfil en su celular."}</p>
        </form>
      </article>
    `;
  }

  function renderPublicPlayerCard(view, player) {
    const propertyList = player.propertyIds.length
      ? player.propertyIds
          .map((tileId) => getTile(view, tileId)?.name || tileId)
          .join(", ")
      : "Sin propiedades";
    return `
      <article class="detail-card">
        <div class="chip-row">
          <span class="chip">Seat ${player.seatNumber}</span>
          <span class="chip">${player.connected ? "online" : "offline"}</span>
          <span class="chip">${player.venturePoints || 0} VP</span>
        </div>
        <h3 class="section-title">${escapeHtml(player.name)}</h3>
        ${renderVPTracker(player)}
        <p><strong>Rol:</strong> ${escapeHtml(player.roleName)}</p>
        <p><strong>Creditos:</strong> ${formatCredits(player.credits)}</p>
        <p><strong>Conexiones:</strong> ${player.connections}</p>
        <p><strong>Propiedades:</strong> ${escapeHtml(propertyList)}</p>
        ${renderSectorBadges(player.dominatedSectors)}
        ${renderRivalryBadge(view, player)}
      </article>
    `;
  }

  function renderActionPanel(view) {
    const self = view.self;
    const publicSelf = getPublicPlayer(view, self.id);
    const turn = view.session.turn;
    const currentTile = turn.tileId ? getTile(view, turn.tileId) : getTileByPosition(view, publicSelf.position);
    const negotiationSeconds = getNegotiationSeconds(turn.negotiationEndsAt);
    const freeProperties = getFreeProperties(view);

    let body = `
      <h2 class="section-title">${self.isCurrentPlayer ? "Tus acciones" : "Esperando turno"}</h2>
      <p class="section-copy">${escapeHtml(turn.message || "")}</p>
      <div class="chip-row">
        <span class="chip">Casilla ${escapeHtml(currentTile?.name || "Sin mover")}</span>
        <span class="chip">Ronda ${view.session.round}</span>
        ${
          turn.negotiationEndsAt
            ? `<span class="chip">Ventana B2B ${formatCountdown(negotiationSeconds)}</span>`
            : ""
        }
      </div>
    `;

    if (!self.isCurrentPlayer && view.session.status !== "finished") {
      return body + `<div class="empty-state">Tus cartas, contratos y perfil siguen disponibles aunque no sea tu turno.</div>`;
    }

    if (view.session.status === "finished") {
      return body + `<div class="empty-state">La partida ya termino. Puedes seguir revisando tu mano, contratos y perfil.</div>`;
    }

    switch (turn.phase) {
      case "await_roll":
      case "victory_ready":
        body += renderRollActions(view);
        break;
      case "movement_adjust":
        body += `
          <div class="button-row">
            <button data-action="do-action" data-command="adjust-route" data-delta="-1" class="ghost" type="button">Retroceder 1</button>
            <button data-action="do-action" data-command="adjust-route" data-delta="0" class="secondary" type="button">Mantener</button>
            <button data-action="do-action" data-command="adjust-route" data-delta="1" class="primary" type="button">Avanzar 1</button>
          </div>
        `;
        break;
      case "property_offer":
        body += `
          <div class="button-row">
            <button data-action="do-action" data-command="buy-property" class="primary" type="button">Comprar ${formatCredits(currentTile.price)}</button>
            <button data-action="do-action" data-command="skip-property" class="ghost" type="button">Dejar libre</button>
          </div>
        `;
        break;
      case "market_roll":
        body += renderMarketActions(view, currentTile);
        break;
      case "negotiation":
        body += `
          <div class="button-row">
            ${
              self.role.id === "creative" && publicSelf.creativeExtendReady !== false
                ? '<button data-action="do-action" data-command="extend-negotiation" class="secondary" type="button">Extender fase B2B +30s</button>'
                : ""
            }
            <button data-action="do-action" data-command="end-turn" class="primary" type="button">Terminar turno</button>
          </div>
        `;
        break;
      case "skip_turn":
        body += `
          <div class="button-row">
            <button data-action="do-action" data-command="end-turn" class="primary" type="button">Cerrar turno bloqueado</button>
          </div>
        `;
        break;
      default:
        body += `<div class="empty-state">La consola espera la siguiente accion del servidor.</div>`;
    }

    if (self.role.id === "financial" && publicSelf.financialDoubleReady) {
      body += `
        <div class="button-row">
          <button data-action="do-action" data-command="arm-financial-double" class="ghost" type="button">Doblar proximo ingreso</button>
        </div>
      `;
    }

    if (self.role.id === "relations" && publicSelf.networkingExtraReady) {
      body += `
        <div class="button-row">
          <button data-action="do-action" data-command="arm-networking-bonus" class="ghost" type="button">Armar conexion extra</button>
        </div>
      `;
    }

    if (self.role.id === "industrial" && freeProperties.length && !publicSelf.industrialRemoteBuyUsed) {
      body += `
        <form data-form="turn-action" class="field">
          <input type="hidden" name="command" value="remote-buy-property" />
          <label for="remote-buy">Compra remota</label>
          <select id="remote-buy" name="tileId">
            ${freeProperties
              .map((tile) => `<option value="${escapeAttribute(tile.id)}">${escapeHtml(tile.name)} - ${formatCredits(tile.price)}</option>`)
              .join("")}
          </select>
          <button class="ghost" type="submit">Comprar desde cualquier casilla</button>
        </form>
      `;
    }

    return body;
  }

  function renderRollActions(view) {
    const self = view.self;
    const publicSelf = getPublicPlayer(view, self.id);
    return `
      <form data-form="turn-action" class="field-inline">
        <input type="hidden" name="command" value="roll-die" />
        ${
          self.role.id === "strategic" && !publicSelf.strategicDiceUsed
            ? `
              <div class="field">
                <label for="riggedRoll">Dado estrategico</label>
                <select id="riggedRoll" name="riggedRoll">
                  <option value="">Aleatorio</option>
                  ${[1, 2, 3, 4, 5, 6].map((value) => `<option value="${value}">${value}</option>`).join("")}
                </select>
              </div>
            `
            : "<div></div>"
        }
        <div class="field">
          <label>&nbsp;</label>
          <button class="primary" type="submit">Lanzar dado</button>
        </div>
      </form>
      ${
        self.canBuildTower
          ? `
            <div class="button-row">
              <button data-action="do-action" data-command="roll-die" data-force-build="true" class="secondary" type="button">
                Construir Venture Tower
              </button>
            </div>
          `
          : ""
      }
      ${self.previewCard ? `<div class="detail-card"><p><strong>Vista estrategica:</strong> ${escapeHtml(self.previewCard.title)}</p></div>` : ""}
    `;
  }

  function renderMarketActions(view, currentTile) {
    const self = view.self;
    const publicSelf = getPublicPlayer(view, self.id);
    const turn = view.session.turn;

    if (!turn.marketRoll) {
      return `
        <div class="button-row">
          <button data-action="do-action" data-command="roll-market" class="primary" type="button">Lanzar dado de mercado</button>
        </div>
      `;
    }

    return `
      <div class="detail-card">
        <p><strong>Propiedad:</strong> ${escapeHtml(currentTile.name)}</p>
        <p><strong>Mercado:</strong> ${turn.marketRoll} - ${escapeHtml(turn.rentPreview.marketLabel)}</p>
        <p><strong>Renta actual:</strong> ${formatCredits(turn.rentPreview.total)}</p>
      </div>
      <div class="button-row">
        <button data-action="do-action" data-command="pay-rent" class="primary" type="button">Pagar renta</button>
        <button data-action="do-action" data-command="reroll-market" class="ghost" type="button">Repetir dado por 50</button>
        ${
          publicSelf.connections >= 5
            ? '<button data-action="do-action" data-command="skip-rent-with-connections" class="secondary" type="button">Usar 5 conexiones</button>'
            : ""
        }
        ${
          self.role.id === "energy" && publicSelf.energyRentDiscountReady
            ? '<button data-action="do-action" data-command="energy-rent-discount" class="ghost" type="button">Mitad de renta</button>'
            : ""
        }
      </div>
    `;
  }

  function renderMiniBoard(view) {
    const selfPlayer = getPublicPlayer(view, view.self.id);
    const tile = getTileByPosition(view, selfPlayer.position);
    return `
      <div class="detail-card">
        <p><strong>Tu posicion:</strong> ${escapeHtml(tile?.name || "Sin casilla")}</p>
        <p><strong>Evento:</strong> ${escapeHtml(view.session.activeEvent?.name || "Sin evento")}</p>
        <p><strong>Turno:</strong> ${escapeHtml(view.session.currentPlayerName || "Sin turno")}</p>
      </div>
    `;
  }

  function renderIdentityEditor(view) {
    const self = view.self;
    const publicSelf = getPublicPlayer(view, self.id);
    const avatar = view.catalog.avatars.find((entry) => entry.id === publicSelf.avatarId) || view.catalog.avatars[0];

    return `
      <div class="identity-grid">
        <article class="avatar-preview">
          <div class="avatar-badge" style="background:${escapeAttribute(avatar.accent)}22;border-color:${escapeAttribute(avatar.accent)}44;">
            ${escapeHtml(avatar.badge)}
          </div>
          <h3 class="section-title">${escapeHtml(avatar.name)}</h3>
          <p class="section-copy">${escapeHtml(publicSelf.name)}</p>
        </article>
        <div class="identity-card">
          <form data-form="profile" class="field">
            <label for="playerName">Nombre visible</label>
            <input id="playerName" name="name" maxlength="24" value="${escapeAttribute(publicSelf.name)}" />
            ${
              view.session.status === "lobby"
                ? `
                  <label for="playerRole">Tipo de CEO (rol)</label>
                  <select id="playerRole" name="roleId">
                    ${view.catalog.roles
                      .map(
                        (role) =>
                          `<option value="${escapeAttribute(role.id)}" ${
                            role.id === publicSelf.roleId ? "selected" : ""
                          }>${escapeHtml(role.name)}</option>`,
                      )
                      .join("")}
                  </select>
                `
                : ""
            }
            <button class="secondary" type="submit">${
              view.session.status === "lobby" ? "Guardar perfil" : "Guardar nombre"
            }</button>
          </form>
          <div class="field">
            <label>Color de la ficha</label>
            <div class="swatch-row">
              ${["#55efff", "#44f0c7", "#86a8ff", "#ff99bf", "#ffc968", "#ff7d78", "#d3ff8e", "#9ce9ff"]
                .map(
                  (color) => `
                    <button
                      data-action="pick-color"
                      data-value="${escapeAttribute(color)}"
                      class="swatch ${publicSelf.color === color ? "active" : ""}"
                      style="background:${escapeAttribute(color)}"
                      type="button"
                    ></button>
                  `,
                )
                .join("")}
            </div>
          </div>
          <div class="field">
            <label>Badge de ficha</label>
            <div class="badge-row">
              ${view.catalog.tokenBadges
                .map(
                  (badge) => `
                    <button
                      data-action="pick-badge"
                      data-value="${escapeAttribute(badge)}"
                      class="badge-pill ${publicSelf.tokenBadge === badge ? "active" : ""}"
                      type="button"
                    >${escapeHtml(badge)}</button>
                  `,
                )
                .join("")}
            </div>
          </div>
          <div class="field">
            <label>Avatar de CEO</label>
            <div class="avatar-grid">
              ${view.catalog.avatars
                .map(
                  (entry) => `
                    <button
                      data-action="pick-avatar"
                      data-value="${escapeAttribute(entry.id)}"
                      class="avatar-choice ${publicSelf.avatarId === entry.id ? "active" : ""}"
                      type="button"
                    >
                      <strong>${escapeHtml(entry.name)}</strong>
                      <span class="muted">${escapeHtml(entry.badge)}</span>
                    </button>
                  `,
                )
                .join("")}
            </div>
          </div>
          <div class="upload-box">
            <label for="tokenImage">Foto para la ficha</label>
            <input id="tokenImage" data-upload="token-image" type="file" accept="image/*" />
            <div class="button-row">
              <button class="ghost" type="button" data-action="clear-token-image">Quitar foto</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderContractComposer(view) {
    const self = view.self;
    if (!self.isCurrentPlayer || !["negotiation", "victory_ready"].includes(view.session.turn.phase)) {
      return `<div class="contract-composer empty-state">Podras proponer contratos en la fase B2B de tu turno.</div>`;
    }

    const otherPlayers = view.session.players.filter((player) => player.id !== self.id);
    const requestedProperties = otherPlayers.flatMap((player) =>
      player.propertyIds.map((tileId) => ({
        ownerId: player.id,
        tileId,
        ownerName: player.name,
      })),
    );
    const b2bTypes = view.session.b2bOfferTypes || [];

    return `
      <form data-form="contract" class="contract-composer">
        <p class="eyebrow">Nuevo contrato</p>
        <div class="field-inline">
          <div class="field">
            <label for="targetPlayerId">Enviar a</label>
            <select id="targetPlayerId" name="targetPlayerId">
              ${otherPlayers.map((player) => `<option value="${escapeAttribute(player.id)}">${escapeHtml(player.name)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label for="contractType">Tipo de oferta</label>
            <select id="contractType" name="type">
              ${b2bTypes.length
                ? b2bTypes.map((t) => `<option value="${escapeAttribute(t.name)}">${escapeHtml(t.name)}</option>`).join("")
                : `
                  <option>Acuerdo Comercial</option>
                  <option>Pacto de Propiedad</option>
                  <option>Alianza de Red</option>
                  <option>Contrato a Plazo</option>
                `
              }
            </select>
          </div>
        </div>
        <div class="field-inline">
          <div class="field">
            <label for="offerCredits">Tus creditos ofrecidos</label>
            <input id="offerCredits" name="offerCredits" type="number" min="0" step="10" value="0" />
          </div>
          <div class="field">
            <label for="requestCredits">Creditos que pides</label>
            <input id="requestCredits" name="requestCredits" type="number" min="0" step="10" value="0" />
          </div>
        </div>
        <div class="field-inline">
          <div class="field">
            <label for="offerPropertyId">Propiedad que ofreces</label>
            <select id="offerPropertyId" name="offerPropertyId">
              <option value="">Sin propiedad</option>
              ${self.soloProperties.map((tile) => `<option value="${escapeAttribute(tile.id)}">${escapeHtml(tile.name)}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label for="requestPropertyId">Propiedad que solicitas</label>
            <select id="requestPropertyId" name="requestPropertyId">
              <option value="">Sin propiedad</option>
              ${requestedProperties
                .map(
                  (entry) =>
                    `<option value="${escapeAttribute(entry.tileId)}">${escapeHtml(entry.ownerName)} - ${escapeHtml(getTile(view, entry.tileId).name)}</option>`,
                )
                .join("")}
            </select>
          </div>
        </div>
        <div class="field">
          <label for="contractMessage">Mensaje</label>
          <textarea id="contractMessage" name="message" placeholder="Describe el acuerdo, plazo o contexto del trato."></textarea>
        </div>
        <button class="primary" type="submit">Enviar contrato al otro dispositivo</button>
      </form>
    `;
  }

  function renderContractsInbox(view) {
    const self = view.self;
    const incoming = self.incomingContracts || [];
    const outgoing = self.outgoingContracts || [];

    return `
      <div class="panel">
        <p class="eyebrow">Bandeja de contratos</p>
        ${
          !incoming.length && !outgoing.length
            ? '<div class="empty-state">No hay contratos pendientes en este momento.</div>'
            : ""
        }
        <div class="contracts-grid">
          ${incoming.map((contract) => renderContractCard(view, contract, true)).join("")}
          ${outgoing.map((contract) => renderContractCard(view, contract, false)).join("")}
        </div>
      </div>
    `;
  }

  function renderContractCard(view, contract, incoming) {
    const from = getPublicPlayer(view, contract.fromPlayerId);
    const to = getPublicPlayer(view, contract.toPlayerId);
    return `
      <article class="contract-card ${escapeAttribute(contract.status || "pending")}">
        <p class="eyebrow">${incoming ? "Recibido" : "Enviado"}</p>
        <h3 class="section-title">${escapeHtml(contract.type)}</h3>
        <p><strong>De:</strong> ${escapeHtml(from?.name || "-")}</p>
        <p><strong>Para:</strong> ${escapeHtml(to?.name || "-")}</p>
        <p><strong>Ofrece:</strong> ${formatCredits(contract.offerCredits || 0)} ${contract.offerPropertyId ? ` + ${escapeHtml(getTile(view, contract.offerPropertyId)?.name || "")}` : ""}</p>
        <p><strong>Pide:</strong> ${formatCredits(contract.requestCredits || 0)} ${contract.requestPropertyId ? ` + ${escapeHtml(getTile(view, contract.requestPropertyId)?.name || "")}` : ""}</p>
        <p>${escapeHtml(contract.message || "Sin mensaje adicional.")}</p>
        ${
          incoming
            ? `
              <div class="button-row">
                <button data-action="accept-contract" data-contract-id="${escapeAttribute(contract.id)}" class="primary" type="button">Aceptar</button>
                <button data-action="reject-contract" data-contract-id="${escapeAttribute(contract.id)}" class="danger" type="button">Rechazar</button>
              </div>
            `
            : '<p class="muted">Pendiente de respuesta en el otro dispositivo.</p>'
        }
      </article>
    `;
  }

  function renderHandCard(view, card) {
    const self = view.self;
    const options = getCardOptions(view, card);
    return `
      <article class="card-surface">
        <div class="card-topline">
          <h3 class="section-title">${escapeHtml(card.title)}</h3>
          <span class="card-tag">${escapeHtml(card.category)}</span>
        </div>
        <p>${escapeHtml(card.text)}</p>
        ${
          !self.isCurrentPlayer || !["negotiation", "victory_ready"].includes(view.session.turn.phase)
            ? '<div class="empty-state">Las cartas se juegan en la fase B2B de tu turno.</div>'
            : options.disabled
              ? `<div class="empty-state">${escapeHtml(options.reason)}</div>`
              : `
                <form data-form="card-play" class="field">
                  <input type="hidden" name="instanceId" value="${escapeAttribute(card.instanceId)}" />
                  ${options.fields}
                  <button class="secondary" type="submit">Jugar carta</button>
                </form>
              `
        }
      </article>
    `;
  }

  function getCardOptions(view, card) {
    const self = view.self;
    const otherPlayers = view.session.players.filter((player) => player.id !== self.id);
    const freeProperties = getFreeProperties(view);
    const ownedProperties = self.properties;
    const soloProperties = self.soloProperties;

    const playerOptions = otherPlayers
      .map((player) => `<option value="${escapeAttribute(player.id)}">${escapeHtml(player.name)}</option>`)
      .join("");
    const ownedPropertyOptions = ownedProperties
      .map((tile) => `<option value="${escapeAttribute(tile.id)}">${escapeHtml(tile.name)}</option>`)
      .join("");
    const soloPropertyOptions = soloProperties
      .map((tile) => `<option value="${escapeAttribute(tile.id)}">${escapeHtml(tile.name)}</option>`)
      .join("");
    const freePropertyOptions = freeProperties
      .map((tile) => `<option value="${escapeAttribute(tile.id)}">${escapeHtml(tile.name)} - ${formatCredits(tile.price)}</option>`)
      .join("");
    const higherFreeOptions = freeProperties
      .filter((tile) => soloProperties.some((owned) => tile.price > owned.price))
      .map((tile) => `<option value="${escapeAttribute(tile.id)}">${escapeHtml(tile.name)} - ${formatCredits(tile.price)}</option>`)
      .join("");

    const sectorOptions = Object.keys(view.session.sectors || {})
      .map((s) => `<option value="${escapeAttribute(s)}">${escapeHtml(s)}</option>`)
      .join("");

    // Get enemy properties for OPA Hostil
    const enemySoloProperties = otherPlayers.flatMap((player) =>
      player.propertyIds.filter((tileId) => {
        const tile = getTile(view, tileId);
        return tile && tile.owners.length === 1;
      }).map((tileId) => {
        const tile = getTile(view, tileId);
        return { tileId, name: tile.name, price: tile.price, ownerName: player.name };
      })
    );

    const disabled = (reason) => ({ disabled: true, reason, fields: "" });
    const enabled = (fields) => ({ disabled: false, reason: "", fields });

    switch (card.id) {
      case "resource-optimization":
      case "rapid-expansion":
      case "premium-connection":
      case "business-subsidy":
      case "economic-crisis":
      case "market-boom":
      case "global-innovation":
      case "startup-boom":
      case "networking-event":
        return enabled("");
      case "outsourcing":
      case "strategic-alliance":
      case "exclusive-contract":
      case "cyberattack":
      case "financial-hack":
      case "extreme-audit":
      case "headhunting":
      case "data-breach":
        return otherPlayers.length
          ? enabled(`
              <label class="field">
                <span>Jugador objetivo</span>
                <select name="targetPlayerId">${playerOptions}</select>
              </label>
            `)
          : disabled("No hay otros jugadores disponibles para esta carta.");
      case "tech-innovation":
      case "franchise":
      case "smart-investment":
        return ownedProperties.length
          ? enabled(`
              <label class="field">
                <span>Propiedad objetivo</span>
                <select name="targetTileId">${ownedPropertyOptions}</select>
              </label>
            `)
          : disabled("Necesitas al menos una propiedad propia.");
      case "patente":
        return sectorOptions
          ? enabled(`
              <label class="field">
                <span>Sector a patentar</span>
                <select name="sectorName">${sectorOptions}</select>
              </label>
            `)
          : disabled("No hay sectores disponibles.");
      case "opa-hostil":
        return enemySoloProperties.length
          ? enabled(`
              <label class="field">
                <span>Propiedad objetivo (1.5x precio)</span>
                <select name="targetTileId">
                  ${enemySoloProperties.map((p) => `<option value="${escapeAttribute(p.tileId)}">${escapeHtml(p.ownerName)} - ${escapeHtml(p.name)} (${formatCredits(Math.ceil(p.price * 1.5))})</option>`).join("")}
                </select>
              </label>
            `)
          : disabled("No hay propiedades rivales disponibles para OPA Hostil.");
      case "joint-venture":
        return otherPlayers.length && freeProperties.length
          ? enabled(`
              <div class="field-inline">
                <div class="field">
                  <label>Socio</label>
                  <select name="partnerPlayerId">${playerOptions}</select>
                </div>
                <div class="field">
                  <label>Propiedad libre</label>
                  <select name="targetTileId">${freePropertyOptions}</select>
                </div>
              </div>
            `)
          : disabled("Joint Venture necesita un socio y una propiedad libre.");
      case "merge":
        return soloProperties.length && higherFreeOptions
          ? enabled(`
              <div class="field-inline">
                <div class="field">
                  <label>Propiedad actual</label>
                  <select name="sourceTileId">${soloPropertyOptions}</select>
                </div>
                <div class="field">
                  <label>Nueva propiedad</label>
                  <select name="targetUpgradeTileId">${higherFreeOptions}</select>
                </div>
              </div>
            `)
          : disabled("Fusion necesita una propiedad propia y otra libre de mayor valor.");
      default:
        return disabled("Esta carta aun no tiene configuracion en la interfaz.");
    }
  }

  function renderBoard(view, size) {
    const session = view.session;
    const currentPlayer = getPublicPlayer(view, session.currentPlayerId);
    const currentPoint = currentPlayer ? session.boardPoints[currentPlayer.position] : null;
    const tokens = buildTokenMarkup(session.players, session.boardPoints);
    return `
      <div class="board-frame ${size === "mini" ? "mini-board" : ""}">
        <img src="city-venture-board.svg" alt="Tablero City Venture" />
        ${
          currentPoint
            ? `<div class="tile-highlight" style="left:${currentPoint.x}%;top:${currentPoint.y}%"></div>`
            : ""
        }
        <div class="token-layer">${tokens}</div>
      </div>
    `;
  }

  function buildTokenMarkup(players, points) {
    const groups = points.map(() => []);
    players.forEach((player) => {
      groups[player.position].push(player);
    });
    return groups
      .map((group, index) =>
        group
          .map((player, tokenIndex) => {
            const offsets = [
              { x: 0, y: 0 },
              { x: -18, y: -16 },
              { x: 18, y: 16 },
              { x: -18, y: 16 },
              { x: 18, y: -16 },
              { x: 0, y: -24 },
            ];
            const offset = offsets[tokenIndex] || offsets[0];
            const point = points[index];
            return `
              <div
                class="player-token ${player.tokenImage ? "has-image" : ""}"
                style="left:${point.x}%;top:${point.y}%;transform:translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px));--token-color:${player.color}"
                title="${escapeAttribute(player.name)}"
              >
                ${player.tokenImage ? `<img src="${escapeAttribute(player.tokenImage)}" alt="${escapeAttribute(player.name)}" />` : escapeHtml(player.tokenBadge || initials(player.name))}
              </div>
            `;
          })
          .join(""),
      )
      .join("");
  }

  function renderToasts() {
    return `
      <div class="toast-stack">
        ${state.toasts
          .map(
            (toast) => `
              <article class="toast ${escapeAttribute(toast.type)}">
                <p>${escapeHtml(toast.message)}</p>
              </article>
            `,
          )
          .join("")}
      </div>
    `;
  }

  function getPublicPlayer(view, playerId) {
    return view.session.players.find((player) => player.id === playerId) || null;
  }

  function getTile(view, tileId) {
    return view.session.tiles.find((tile) => tile.id === tileId) || null;
  }

  function getTileByPosition(view, position) {
    return view.session.tiles.find((tile) => tile.index === position) || null;
  }

  function getFreeProperties(view) {
    return view.session.tiles.filter((tile) => tile.kind === "property" && tile.owners.length === 0);
  }

  function findRoleId(view, playerId) {
    return view.session.players.find((player) => player.id === playerId)?.roleId || "";
  }

  function renderHudDice() {
    const angles = getDiceAngles(state.dice.face);
    return `
      <div class="dice-orbit ${state.dice.spinning ? "spinning" : ""}" aria-hidden="true">
        <div class="dice-cube" style="--dice-rx:${angles.x}deg;--dice-ry:${angles.y}deg;--spin-seed:${state.dice.spinSeed};">
          ${renderDieFace(1, "front")}
          ${renderDieFace(2, "back")}
          ${renderDieFace(3, "right")}
          ${renderDieFace(4, "left")}
          ${renderDieFace(5, "top")}
          ${renderDieFace(6, "bottom")}
        </div>
      </div>
    `;
  }

  function renderDieFace(face, sideClass) {
    const pipLayout = {
      1: [[50, 50]],
      2: [[28, 28], [72, 72]],
      3: [[28, 28], [50, 50], [72, 72]],
      4: [[28, 28], [72, 28], [28, 72], [72, 72]],
      5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
      6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]],
    };
    return `
      <div class="die-face die-${sideClass}">
        ${pipLayout[face]
          .map(
            ([left, top]) =>
              `<span class="die-pip" style="left:${left}%;top:${top}%;"></span>`,
          )
          .join("")}
      </div>
    `;
  }

  function getDiceAngles(face) {
    switch (face) {
      case 1:
        return { x: -18, y: 22 };
      case 2:
        return { x: -18, y: 202 };
      case 3:
        return { x: -18, y: -68 };
      case 4:
        return { x: -18, y: 112 };
      case 5:
        return { x: -108, y: 22 };
      case 6:
        return { x: 72, y: 22 };
      default:
        return { x: -18, y: 22 };
    }
  }

  function startDiceSpin() {
    state.dice.spinning = true;
    state.dice.spinSeed += 1;
    state.dice.pendingFace = null;
    if (diceSpinTimer) {
      window.clearTimeout(diceSpinTimer);
    }
    scheduleRender();
    diceSpinTimer = window.setTimeout(() => {
      state.dice.spinning = false;
      if (Number.isInteger(state.dice.pendingFace)) {
        state.dice.face = state.dice.pendingFace;
      }
      state.dice.pendingFace = null;
      scheduleRender();
      diceSpinTimer = null;
    }, 1100);
  }

  function syncDiceFaceFromView(view) {
    const rawRoll = Number(view?.session?.turn?.lastRoll?.rawRoll);
    if (!Number.isInteger(rawRoll) || rawRoll < 1 || rawRoll > 6) {
      return;
    }
    if (state.dice.spinning) {
      state.dice.pendingFace = rawRoll;
      return;
    }
    state.dice.face = rawRoll;
  }

  function countJoinedPlayers(view) {
    return view.session.players.filter((player) => player.joined || player.connected).length;
  }

  function syncQueryState() {
    if (!state.view?.self?.joinToken) {
      return;
    }
    const query = new URLSearchParams(window.location.search);
    const hasJoinChange = query.get("join") !== state.view.self.joinToken;
    if (hasJoinChange) {
      query.set("join", state.view.self.joinToken);
      const nextQuery = query.toString();
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`,
      );
    }
  }

  function resolveBackendUrl() {
    const query = new URLSearchParams(window.location.search);
    const queryBackend = normalizeBaseUrl(query.get("backend"));
    if (queryBackend) {
      window.localStorage.setItem(BACKEND_URL_KEY, queryBackend);
      return queryBackend;
    }

    const configuredBackend = normalizeBaseUrl(window.CITY_VENTURE_BACKEND_URL);
    if (configuredBackend) {
      window.localStorage.setItem(BACKEND_URL_KEY, configuredBackend);
      return configuredBackend;
    }

    const savedBackend = normalizeBaseUrl(window.localStorage.getItem(BACKEND_URL_KEY));
    if (savedBackend) {
      return savedBackend;
    }

    return window.location.origin;
  }

  function normalizeBaseUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }
    return raw.replace(/\/+$/, "");
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const image = new Image();
        image.onload = () => {
          const size = 180;
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const context = canvas.getContext("2d");
          context.fillStyle = "#041018";
          context.fillRect(0, 0, size, size);
          const scale = Math.max(size / image.width, size / image.height);
          const width = image.width * scale;
          const height = image.height * scale;
          const x = (size - width) / 2;
          const y = (size - height) / 2;
          context.drawImage(image, x, y, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        };
        image.onerror = reject;
        image.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function formatCredits(amount) {
    return `${Number(amount || 0).toLocaleString("es-CO")} creditos`;
  }

  function getNegotiationSeconds(deadline) {
    if (!deadline) {
      return 0;
    }
    return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  }

  function formatCountdown(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safe / 60);
    const rest = safe % 60;
    return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value);
  }

  function initials(name) {
    return String(name || "")
      .split(" ")
      .slice(0, 2)
      .map((part) => part[0] || "")
      .join("")
      .toUpperCase();
  }

  function cryptoRandom() {
    return Math.random().toString(36).slice(2, 10);
  }

  window.addEventListener("beforeunload", () => {
    window.clearInterval(uiClock);
  });

  // ─── CARD UI MODAL ───────────────────────────────────────
  function renderHandModal(view) {
    const hand = view.self.hand || [];
    return `
      <div class="hand-modal-overlay" onclick="if(event.target === this) this.querySelector('.hand-modal-close').click()">
        <div class="hand-modal">
          <div class="hand-modal-header">
            <h2 class="hand-modal-title">🎴 Mano (${hand.length})</h2>
            <button data-action="close-hand" class="hand-modal-close" type="button">X CERRAR</button>
          </div>
          <div class="hand-modal-body">
            ${hand.length === 0 ? '<div class="empty-state" style="margin-top:20px;">No tienes cartas en la mano. Cae en una casilla Connect Card para obtenerlas.</div>' : `
              <div class="card-list-grid">
                ${hand.map(card => `
                  <article class="playing-card-item" data-category="${escapeAttribute(card.category)}">
                    <span class="playing-card-category">${escapeHtml(card.category)}</span>
                    <h3 class="playing-card-title">${escapeHtml(card.title)}</h3>
                    <p class="playing-card-text">${escapeHtml(card.text)}</p>
                    <form data-form="card-play" class="card-target-form">
                      <input type="hidden" name="instanceId" value="${escapeAttribute(card.instanceId)}" />
                      ${renderCardForm(card, view)}
                      <button type="submit">🃏 Jugar Carta</button>
                    </form>
                  </article>
                `).join('')}
              </div>
            `}
          </div>
        </div>
      </div>
    `;
  }

  function renderCardForm(card, view) {
    const target = card.target;
    if (target === "self" || target === "global") {
      return '';
    }
    
    const opponents = view.session.players.filter(p => p.id !== view.self.id);
    const selfProperties = view.self.properties || [];
    const availableProperties = getFreeProperties(view);

    let html = '';
    
    if (target === "player") {
      html += `
        <select name="targetPlayerId" required>
          <option value="">Apunta a un rival...</option>
          ${opponents.map(p => `<option value="${escapeAttribute(p.id)}">${escapeHtml(p.name)} (${escapeHtml(p.roleName)})</option>`).join('')}
        </select>
      `;
      if (card.id === "data-breach") {
         html += `
            <select name="discardIndex">
              <option value="0">Descartar 1ra carta de su mano</option>
              <option value="1">Descartar 2da carta</option>
              <option value="2">Descartar 3ra carta</option>
            </select>
         `;
      }
    } else if (target === "owned-property") {
      html += `
        <select name="targetTileId" required>
          <option value="">Tu propiedad objetivo...</option>
          ${selfProperties.map(p => `<option value="${escapeAttribute(p.id)}">${escapeHtml(p.name)}</option>`).join('')}
        </select>
      `;
    } else if (target === "joint-venture") {
      html += `
        <select name="partnerPlayerId" required>
          <option value="">Elige un socio...</option>
          ${opponents.map(p => `<option value="${escapeAttribute(p.id)}">${escapeHtml(p.name)}</option>`).join('')}
        </select>
        <select name="targetTileId" required>
          <option value="">Propiedad libre a comprar...</option>
          ${availableProperties.map(p => `<option value="${escapeAttribute(p.id)}">${escapeHtml(p.name)} - ${formatCredits(p.price)}</option>`).join('')}
        </select>
      `;
    } else if (target === "merge") {
      html += `
        <select name="sourceTileId" required>
          <option value="">Entregar propiedad tuya...</option>
          ${selfProperties.map(p => `<option value="${escapeAttribute(p.id)}">${escapeHtml(p.name)}</option>`).join('')}
        </select>
        <select name="targetUpgradeTileId" required>
          <option value="">Propiedad libre de MAYOR valor...</option>
          ${availableProperties.map(p => `<option value="${escapeAttribute(p.id)}">${escapeHtml(p.name)} - ${formatCredits(p.price)}</option>`).join('')}
        </select>
      `;
    } else if (target === "sector") {
      html += `
        <select name="sectorName" required>
          <option value="">Sector a patentar...</option>
          <option value="Energia">Energia</option>
          <option value="Logistica">Logistica</option>
          <option value="Software">Software</option>
          <option value="Creativo">Creativo</option>
        </select>
      `;
    } else if (target === "hostile-takeover") {
       const rivalProperties = [];
       view.session.players.forEach(p => {
         if (p.id !== view.self.id) {
            if (p.properties) {
               p.properties.forEach(t => rivalProperties.push({...t, ownerName: p.name}));
            }
         }
       });
       html += `
        <select name="targetTileId" required>
          <option value="">Propiedad rival a adquirir...</option>
          ${rivalProperties.map(p => `<option value="${escapeAttribute(p.id)}">${escapeHtml(p.name)} - de ${escapeHtml(p.ownerName)}</option>`).join('')}
        </select>
       `;
    }
    return html;
  }
})();
