import type { EmberGame, Command } from "../emberGame";
import {
  TREE,
  SKILLS,
  KEYSTONES,
  NPCS,
  MECHANICS,
  type SkillId,
} from "../content/emberdeep";
import { xpNeeded } from "../sim/progression";
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const make = (tag: string, cls: string, text = "") => {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
};
export class EmberUI {
  host = make("div", "ember-ui");
  panel = make("div", "ember-modal");
  private status = make("div", "ember-status");
  private location = make("div", "ember-location");
  private hint = make("div", "ember-hint");
  private skills = make("div", "ember-hotbar");
  private meters = make("div", "ember-meters");
  private notice = make("div", "ember-notice");
  private labels = make("div", "ember-labels");
  private eventSeq = 0;
  private noticeUntil = 0;
  private tab = "blade";
  private openPanel = "";
  touchMove = { x: 0, z: 0 };
  touchAttack = false;
  constructor(readonly game: EmberGame) {
    const styles = make("style", "");
    styles.textContent = CSS;
    document.head.append(styles);
    const top = make("header", "ember-top");
    const brand = make("div", "ember-brand");
    brand.innerHTML =
      '<span class="ember-mark">◆</span><div>EMBERDEEP<small>THE ENDLESS DESCENT</small></div>';
    top.append(brand, this.status);
    const nav = make("nav", "ember-nav");
    for (const [label, screen] of [
      ["Skills", "tree"],
      ["Loot", "inventory"],
      ["Pause", "pause"],
    ])
      nav.append(this.button(label, () => this.show(screen)));
    top.append(nav);
    this.host.append(top, this.location, this.labels, this.notice, this.hint);
    const bottom = make("footer", "ember-bottom");
    bottom.append(this.meters, this.skills);
    this.host.append(bottom);
    document.body.append(this.host, this.panel);
    this.panel.hidden = true;
    this.panel.addEventListener("click", (e) => {
      if (e.target === this.panel) this.hide();
    });
    this.createTouch();
    this.update();
  }
  private button(text: string, fn: () => void, cls = "") {
    const button = make(
      "button",
      `ember-button ${cls}`,
      text,
    ) as HTMLButtonElement;
    button.type = "button";
    button.onclick = fn;
    return button;
  }
  private act(c: Command) {
    const result = this.game.act(c);
    if (!result.ok) this.message(result.error ?? "Action failed.");
    else this.game.saveLocal();
    if (this.openPanel) this.show(this.openPanel);
  }
  message(text: string) {
    this.notice.textContent = text;
    this.noticeUntil = performance.now() + 3000;
  }
  hide() {
    this.panel.hidden = true;
    this.openPanel = "";
    this.game.paused = false;
    this.touchAttack = false;
  }
  show(name: string) {
    this.openPanel = name;
    this.game.paused = true;
    this.panel.hidden = false;
    this.panel.replaceChildren();
    const card = make("section", "ember-card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");
    const top = make("div", "ember-panel-top");
    const title =
      name === "tree"
        ? "Paths of power"
        : name === "inventory"
          ? "The spoils"
          : name === "pause"
            ? "Pause & tuning"
            : name === "smith"
              ? "Orin’s forge"
              : name === "merchant"
                ? "Mara’s supplies"
                : "Vela’s sanctuary";
    top.append(
      make("h2", "", title),
      this.button("×", () => this.hide(), "close"),
    );
    card.append(top);
    this.panel.append(card);
    if (name === "tree") this.tree(card);
    else if (name === "inventory") this.inventory(card);
    else if (name === "pause") this.pause(card);
    else this.town(card, name);
  }
  private tree(card: HTMLElement) {
    const p = this.game.run.profile;
    card.append(
      make(
        "p",
        "ember-muted",
        `${p.points} skill points · Level ${p.level} · 54 nodes, 3 paths, 3 keystones`,
      ),
    );
    const tabs = make("div", "ember-tabs");
    for (const branch of ["blade", "ward", "arcane"])
      tabs.append(
        this.button(
          branch.toUpperCase(),
          () => {
            this.tab = branch;
            this.show("tree");
          },
          this.tab === branch ? "active" : "",
        ),
      );
    card.append(tabs);
    const grid = make("div", "ember-tree");
    for (const node of TREE.filter((n) => n.branch === this.tab)) {
      const rank = p.ranks[node.id] ?? 0;
      const button = this.button(
        "",
        () => this.act({ type: "learn", id: node.id }),
        "node",
      );
      button.dataset.node = node.id;
      button.innerHTML = `<span class="node-tier">${node.tier + 1}</span><b>${node.label}</b><small>+${node.stat === "health" || node.stat === "mana" ? node.value : Math.round(node.value * 100) + "%"} ${node.stat}</small><span>${rank} / ${node.max}${node.unlock ? " · " + SKILLS[node.unlock].label : ""}</span>`;
      button.disabled =
        !p.points ||
        rank >= node.max ||
        (!!node.requires && !p.ranks[node.requires]);
      if (rank) button.classList.add("learned");
      grid.append(button);
    }
    card.append(grid);
    const keys = make("div", "ember-keystones");
    for (const k of KEYSTONES.filter((k) => k.branch === this.tab)) {
      const button = this.button(
        `${k.label} · ${k.tip}`,
        () => this.act({ type: "keystone", id: k.id }),
        p.keystone === k.id ? "active" : "",
      );
      button.disabled =
        TREE.filter((n) => n.branch === k.branch).reduce(
          (s, n) => s + (p.ranks[n.id] ?? 0),
          0,
        ) < 10;
      keys.append(button);
    }
    card.append(keys);
    const loadout = make("div", "ember-loadout");
    for (let i = 0; i < 4; i++) {
      const label = make("label", "", `Slot ${i + 1}`),
        select = document.createElement("select");
      for (const id of p.unlocked.filter((id) => id !== "cleave")) {
        const option = document.createElement("option");
        option.value = id;
        option.textContent = SKILLS[id].label;
        option.selected = p.slots[i] === id;
        select.append(option);
      }
      select.onchange = () =>
        this.act({ type: "slot", index: i, skill: select.value as SkillId });
      label.append(select);
      loadout.append(label);
    }
    card.append(make("h3", "", "Equipped abilities"), loadout);
    const mastery = make("div", "ember-tabs");
    for (const id of p.unlocked)
      mastery.append(
        this.button(
          `${SKILLS[id].label} mastery ${p.mastery[id] ?? 0} (+8%)`,
          () => this.act({ type: "master", skill: id }),
        ),
      );
    card.append(mastery);
    if (!this.game.run.encounter.depth)
      card.append(
        this.button("Refund all points · Free in town", () =>
          this.act({ type: "refund" }),
        ),
      );
  }
  private inventory(card: HTMLElement) {
    const p = this.game.run.profile;
    card.append(
      make(
        "p",
        "ember-muted",
        `${p.gold} gold · ${p.inventory.length} / 80 items · Walk near drops to collect them`,
      ),
    );
    const list = make("div", "ember-inventory");
    if (!p.inventory.length)
      list.append(
        make("p", "ember-muted", "The descent holds your first treasures."),
      );
    for (const item of p.inventory) {
      const row = make("article", `ember-item ${item.rarity}`);
      row.innerHTML = `<div class="item-symbol">${item.slot === "weapon" ? "⚔" : item.slot === "armor" ? "◇" : "✦"}</div><div><b>${escape(item.name)}</b><small>${item.rarity.toUpperCase()} · ${item.slot} · depth ${item.level}</small><p>${Object.entries(
        item.stats,
      )
        .map(([key, v]) => `${key} +${v! < 1 ? Math.round(v! * 100) + "%" : v}`)
        .join(
          " · ",
        )}</p>${item.power ? `<em>${item.power.toUpperCase()} · legendary power</em>` : ""}</div>`;
      const actions = make("div", "item-actions"),
        equipped = p.equipped[item.slot] === item.id;
      const button = this.button(
        equipped ? "Equipped" : "Equip",
        () => this.act({ type: "equip", id: item.id }),
        equipped ? "active" : "",
      );
      button.disabled = equipped;
      actions.append(
        button,
        this.button("Salvage", () =>
          this.act({ type: "salvage", id: item.id }),
        ),
      );
      row.append(actions);
      list.append(row);
    }
    card.append(list);
    if (!this.game.run.encounter.depth)
      card.append(
        this.button("Visit forge · Upgrade weapon for 60 gold", () =>
          this.show("smith"),
        ),
        this.button("Refill potions · 25 gold", () =>
          this.act({ type: "service", id: "merchant" }),
        ),
      );
  }
  private pause(card: HTMLElement) {
    card.append(
      make(
        "p",
        "ember-muted",
        "Adjust the fight. Each change takes effect at once.",
      ),
    );
    const difficulty = make("label", "ember-slider", "Difficulty"),
      d = document.createElement("input");
    d.type = "range";
    d.min = ".2";
    d.max = "4";
    d.step = ".1";
    d.value = String(this.game.run.tuning.enemyDamage);
    d.setAttribute("aria-label", "Difficulty");
    const value = make("output", "", `${d.value}×`);
    d.oninput = () => {
      const n = Number(d.value);
      this.game.act({
        type: "tune",
        values: {
          enemyDamage: n,
          enemyHealth: n,
          enemySpeed: Math.sqrt(n),
          playerDamage: 1 / Math.sqrt(n),
          playerHealth: 1 / Math.sqrt(n),
          playerSpeed: 1,
        },
      });
      value.textContent = `${d.value}×`;
    };
    difficulty.append(d, value);
    card.append(difficulty);
    for (const [key, n] of Object.entries(this.game.run.tuning)) {
      const label = make(
          "label",
          "ember-slider",
          key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()),
        ),
        input = document.createElement("input"),
        output = make("output", "", `${n.toFixed(1)}×`);
      input.type = "range";
      input.min = ".2";
      input.max = "4";
      input.step = ".1";
      input.value = String(n);
      input.setAttribute("aria-label", key);
      input.oninput = () => {
        this.game.act({ type: "tune", values: { [key]: Number(input.value) } });
        output.textContent = `${Number(input.value).toFixed(1)}×`;
      };
      label.append(input, output);
      card.append(label);
    }
    const views = make("div", "ember-tabs");
    for (const [mode, label] of [
      ["iso", "Isometric"],
      ["side", "Side"],
      ["top", "Top-down"],
    ] as const)
      views.append(
        this.button(
          label,
          () => this.act({ type: "camera", mode }),
          this.game.run.camera === mode ? "active" : "",
        ),
      );
    card.append(make("h3", "", "Perspective"), views);
    card.append(
      this.button(
        this.game.stage.pixelMode ? "Pixel art · On" : "Pixel art · Off",
        () => {
          this.game.stage.pixelMode = !this.game.stage.pixelMode;
          this.show("pause");
        },
      ),
      this.button(this.game.run.auto ? "Autoplay · On" : "Autoplay · Off", () =>
        this.act({ type: "auto", value: !this.game.run.auto }),
      ),
      this.button(
        this.game.run.invulnerable ? "Invulnerable · On" : "Invulnerable · Off",
        () =>
          this.act({
            type: "invulnerable",
            value: !this.game.run.invulnerable,
          }),
      ),
      this.button("Advance one frame", () => {
        this.game.step(1);
        this.update();
      }),
      this.button("Return to town", () => {
        this.act({ type: "town" });
        this.hide();
      }),
      this.button("Resume descent", () => this.hide(), "primary"),
    );
  }
  private town(card: HTMLElement, id: string) {
    if (id === "smith") {
      card.append(
        make(
          "p",
          "ember-muted",
          "Each forge upgrade adds 3 weapon damage. Bring an equipped weapon and 60 gold.",
        ),
        this.button("Temper equipped weapon · 60 gold", () =>
          this.act({ type: "service", id: "smith" }),
        ),
      );
    } else if (id === "merchant") {
      card.append(
        make(
          "p",
          "ember-muted",
          `${this.game.run.profile.potions} / 3 potions. Refill the belt for 25 gold.`,
        ),
        this.button("Refill belt · 25 gold", () =>
          this.act({ type: "service", id: "merchant" }),
        ),
      );
    } else {
      card.append(
        make(
          "p",
          "ember-muted",
          "Shape your next build. Refund all skill points here at no cost.",
        ),
        this.button("Open skill paths", () => this.show("tree")),
        this.button("Refund all skill points", () =>
          this.act({ type: "refund" }),
        ),
      );
    }
    card.append(
      this.button(
        "Begin descent",
        () => {
          this.act({ type: "enter", depth: this.game.run.profile.deepest });
          this.hide();
        },
        "primary",
      ),
    );
  }
  update() {
    const run = this.game.run,
      p = run.profile,
      ch = run.player;
    this.status.innerHTML = `<span>LV <b>${p.level}</b></span><span class="gold">◈ ${p.gold}</span>`;
    this.location.innerHTML = `<small>${run.encounter.depth ? "DEPTH " + String(run.encounter.depth).padStart(2, "0") : "THE TOWN BETWEEN RUNS"}</small><strong>${escape(run.encounter.name)}</strong><span>${run.encounter.mechanics.map((id) => MECHANICS.find((m) => m.id === id)!.tip).join(" ") || "Forge your edge. Shape your skills. Descend again."}</span>`;
    this.meters.innerHTML = `<div class="life"><span>LIFE <b>${Math.ceil(ch.hp)} / ${Math.ceil(ch.maxHp)}</b></span><i style="width:${(ch.hp / ch.maxHp) * 100}%"></i></div><div class="mana"><span>MANA <b>${Math.floor(run.mana)}</b></span><i style="width:${(run.mana / run.stats.mana) * 100}%"></i></div><div class="stamina"><span>STAMINA</span><i style="width:${run.stamina}%"></i></div><div class="xp"><i style="width:${(p.xp / xpNeeded(p.level)) * 100}%"></i><span>${p.xp} / ${xpNeeded(p.level)} XP · ${p.points} skill points</span></div>`;
    if (!this.skills.children.length)
      for (let i = 0; i < 4; i++)
        this.skills.append(
          this.button(
            "",
            () => {
              run.setIntent({ ...run.intent, skill: run.profile.slots[i] });
            },
            "skill",
          ),
        );
    [...this.skills.children].forEach((el, i) => {
      const id = p.slots[i],
        def = SKILLS[id],
        locked = !p.unlocked.includes(id),
        cool = (run.cooldowns[id] ?? 0) / 60;
      el.innerHTML = `<small>${i + 1}</small><b>${def.label}</b><span>${locked ? "Locked" : cool > 0 ? cool.toFixed(1) + "s" : def.cost + " mana"}</span>`;
      (el as HTMLButtonElement).disabled = locked;
    });
    this.hint.replaceChildren();
    const text = run.failed
      ? "The flame fades. Your progress remains."
      : !run.encounter.depth
        ? "WASD move · J / click strike · Space roll · 1–4 skills · Q potion"
        : run.clear
          ? "The gate is open. Collect the spoils and descend."
          : `${run.observe().enemies.length} enemies remain · Strike, roll, repeat`;
    this.hint.append(make("span", "", text));
    if (run.failed || !run.encounter.depth || run.clear)
      this.hint.append(
        this.button(
          run.failed
            ? "Return to town"
            : !run.encounter.depth
              ? "Begin descent"
              : "Next depth",
          () => {
            if (run.failed) this.act({ type: "town" });
            else
              this.act({
                type: "enter",
                depth: run.encounter.depth
                  ? run.encounter.depth + 1
                  : p.deepest,
              });
          },
          "primary",
        ),
      );
    this.labels.replaceChildren();
    if (!run.encounter.depth)
      for (const npc of NPCS) {
        const pt = this.game.stage.project(npc.x, 2.3, npc.z),
          label = this.button(npc.label, () => this.show(npc.id), "npc-label");
        label.style.left = `${Math.max(60, Math.min(innerWidth - 60, pt.x))}px`;
        label.style.top = `${Math.max(85, pt.y)}px`;
        if (
          pt.x > 0 &&
          pt.x < innerWidth &&
          pt.y > 75 &&
          pt.y < innerHeight - 150
        )
          this.labels.append(label);
      }
    this.notice.hidden = performance.now() > this.noticeUntil;
    for (const e of run.events.filter((e) => e.seq > this.eventSeq)) {
      if (e.type === "progress.level")
        this.message(`Level ${p.level} · Two new skill points`);
      if (e.type === "town.npc") this.show(String(e.id));
      if (e.type === "combat.perfect_dodge")
        this.message("Perfect dodge · Damage surge");
    }
    this.eventSeq = run.seq;
  }
  private createTouch() {
    const touch = make("div", "ember-touch"),
      stick = make("div", "ember-stick"),
      nub = make("div", "ember-nub");
    stick.append(nub);
    let pointer = -1;
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      const r = stick.getBoundingClientRect(),
        x = Math.max(-1, Math.min(1, (e.clientX - r.left - r.width / 2) / 40)),
        z = Math.max(-1, Math.min(1, (e.clientY - r.top - r.height / 2) / 40));
      this.touchMove = { x, z };
      nub.style.transform = `translate(${x * 30}px,${z * 30}px)`;
    };
    stick.onpointerdown = (e) => {
      pointer = e.pointerId;
      stick.setPointerCapture(pointer);
      move(e);
    };
    stick.onpointermove = move;
    const release = () => {
      pointer = -1;
      this.touchMove = { x: 0, z: 0 };
      nub.style.transform = "";
    };
    stick.onpointerup = stick.onpointercancel = release;
    touch.append(stick);
    const actions = make("div", "touch-actions"),
      attack = this.button("Strike", () => {}, "touch-strike");
    attack.onpointerdown = (e) => {
      attack.setPointerCapture(e.pointerId);
      this.touchAttack = true;
    };
    attack.onpointerup = attack.onpointercancel = () => {
      this.touchAttack = false;
    };
    actions.append(
      attack,
      this.button("Roll", () =>
        this.game.run.setIntent({ ...this.game.run.intent, dash: true }),
      ),
      this.button("Potion", () =>
        this.game.run.setIntent({ ...this.game.run.intent, potion: true }),
      ),
    );
    touch.append(actions);
    this.host.append(touch);
  }
}
const CSS = `
.ember-ui{position:fixed;inset:0;pointer-events:none;color:#eee4d0;font:13px/1.4 system-ui,sans-serif;user-select:none}.ember-ui *{box-sizing:border-box}.ember-top{position:absolute;top:max(20px,env(safe-area-inset-top));left:28px;right:28px;display:flex;align-items:center;gap:24px}.ember-brand{display:flex;gap:12px;align-items:center;font:700 22px Georgia,serif;letter-spacing:3px;text-shadow:0 2px 10px #000}.ember-mark{font-size:35px;color:#e8a668}.ember-brand small{display:block;font:9px system-ui;letter-spacing:3px;color:#bbae9e;margin-top:3px}.ember-status{display:flex;gap:20px;margin-left:auto;font:13px monospace}.gold{color:#efd091}.ember-nav{display:flex;gap:6px;pointer-events:auto}.ember-button{border:1px solid #8e756255;border-radius:3px;background:#211d26dd;font:12px system-ui;color:#e9ddc6;min-height:36px;padding:8px 14px;cursor:pointer;pointer-events:auto}.ember-button:hover{border-color:#dca16e;background:#3a2a2cee}.ember-button:disabled{opacity:.45;cursor:default}.ember-button.active,.ember-button.primary{color:#ffdfaf;border-color:#b88357;background:#493129e8}.ember-location{position:absolute;top:105px;left:28px;max-width:360px;display:flex;flex-direction:column;gap:7px;text-shadow:0 1px 8px #000}.ember-location small{font:10px monospace;letter-spacing:2px;color:#bba99a}.ember-location strong{font:28px Georgia,serif}.ember-location span{font-size:12px;color:#bdb3b0;max-width:290px}.ember-bottom{position:absolute;bottom:max(24px,env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);display:flex;gap:24px;align-items:end;width:min(820px,calc(100% - 40px));padding:14px 20px;background:linear-gradient(90deg,#1b182600,#1b1826e8 12%,#1b1826e8 88%,#1b182600);border-top:1px solid #b99b6f33}.ember-meters{width:280px;flex-shrink:0}.ember-meters>div{height:19px;background:#17141d;border:1px solid #7d706248;margin-bottom:5px;position:relative}.ember-meters i{display:block;height:100%;transition:width .08s linear}.ember-meters span{position:absolute;inset:0 6px;font:9px/17px monospace;color:#f0e7d3}.ember-meters b{float:right}.life i{background:linear-gradient(90deg,#693946,#b65b60)}.mana i{background:linear-gradient(90deg,#344566,#6d98b4)}.stamina i{background:#718461}.ember-meters .stamina{height:9px}.ember-meters .stamina span{display:none}.ember-meters .xp{height:3px;margin-top:9px;margin-bottom:12px;border:0}.xp i{background:#d2ae6f}.xp span{top:6px;font-size:9px;color:#c3b6a0;white-space:nowrap}.ember-hotbar{display:flex;gap:7px;flex:1}.ember-hotbar .skill{flex:1;min-width:0;height:73px;text-align:left;padding:7px 9px;background:#211e2ce8;border-bottom:2px solid #a77b52}.skill small{color:#bd9d79;font:10px monospace;display:block}.skill b{display:block;font:13px Georgia,serif;line-height:1.2;margin:4px 0}.skill span{font-size:9px;color:#a99fa8}.ember-hint{position:absolute;bottom:143px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:14px;text-align:center;width:max-content;max-width:calc(100% - 32px);font-size:11px;color:#d6c7b0;text-shadow:0 1px 4px #000}.ember-notice{position:absolute;top:24%;left:50%;transform:translateX(-50%);padding:12px 24px;border:1px solid #b78e5c;background:#251f2be8;font:20px Georgia,serif;text-align:center;max-width:90%}.ember-labels{position:absolute;inset:0}.npc-label{position:absolute;transform:translate(-50%,-100%);font:11px Georgia,serif;min-height:27px;padding:5px 10px;white-space:nowrap}.ember-modal[hidden]{display:none}.ember-modal{position:fixed;inset:0;background:#100e17b8;z-index:60;display:flex;align-items:center;justify-content:center;padding:20px;color:#ece0c7;font:13px system-ui;backdrop-filter:blur(3px)}.ember-card{width:min(720px,100%);max-height:90dvh;overflow:auto;background:linear-gradient(135deg,#28232f,#1c1925);border:1px solid #9f7b54;padding:24px;box-shadow:0 20px 100px #0008;border-radius:5px}.ember-panel-top{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:14px}.ember-panel-top h2{font:30px Georgia,serif;margin:0;color:#f0d7ad}.close{font-size:23px;min-width:42px;padding:0}.ember-muted{color:#aea3ad;font-size:12px;line-height:1.6}.ember-tabs{display:flex;gap:7px;flex-wrap:wrap;margin:12px 0}.ember-tree{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px 12px;padding:14px 0}.node{position:relative;text-align:left;min-height:88px;padding:10px 12px;display:flex;flex-direction:column;gap:4px}.node:after{content:'';position:absolute;bottom:-19px;left:50%;height:18px;width:1px;background:#85736366}.node:nth-last-child(-n+3):after{display:none}.node-tier{position:absolute;right:7px;top:5px;color:#97836c;font:10px monospace}.node small{font-size:10px;color:#bba790}.node>span:last-child{font:10px monospace;color:#b6a99f}.node.learned{border-color:#b89360;background:#403126}.ember-keystones .ember-button{width:100%;text-align:left}.ember-loadout{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.ember-loadout label{color:#b9aa94;font-size:11px}.ember-card select{display:block;width:100%;background:#211d28;color:#ebd7b6;border:1px solid #766754;padding:10px;margin-top:5px}.ember-card h3{font:18px Georgia,serif;margin-top:24px}.ember-slider{display:grid;grid-template-columns:160px 1fr 50px;gap:12px;align-items:center;margin:17px 0;font-size:12px}.ember-slider input{width:100%;accent-color:#cc9b64}.ember-slider output{font:12px monospace;color:#d6b584}.ember-card>.ember-button{margin:8px 5px 0 0}.ember-inventory{display:flex;flex-direction:column;gap:9px}.ember-item{display:flex;gap:14px;align-items:center;border:1px solid #716755;background:#191722;padding:12px;border-left:3px solid #ab9c81}.ember-item.magic{border-left-color:#83b9e1}.ember-item.rare{border-left-color:#e8c274}.ember-item.legendary{border-left-color:#ed9b58}.item-symbol{font-size:28px;color:#ddc499;width:30px}.ember-item>div:nth-child(2){flex:1;min-width:0}.ember-item b{font:16px Georgia,serif}.ember-item small{display:block;font-size:9px;color:#b4a38d;margin:4px 0}.ember-item p{font-size:11px;margin:4px 0;color:#cabca9}.ember-item em{font-size:10px;color:#ecb271}.item-actions{display:flex;gap:5px;flex-direction:column}.ember-touch{display:none;position:absolute;bottom:150px;left:22px;right:22px;justify-content:space-between;align-items:center;pointer-events:none}.ember-stick{width:100px;height:100px;border-radius:50%;border:1px solid #c7b99b66;background:#19151e44;pointer-events:auto;touch-action:none;display:flex;align-items:center;justify-content:center}.ember-nub{width:38px;height:38px;border:1px solid #b8a17b;border-radius:50%;background:#74604855}.touch-actions{display:grid;grid-template-columns:repeat(2,1fr);gap:7px}.touch-strike{grid-column:span 2;min-height:54px}.touch-actions button{min-height:40px;touch-action:none}.ember-ui button:focus-visible,.ember-modal button:focus-visible{outline:2px solid #ffc976;outline-offset:3px}
@media(pointer:coarse){.ember-touch{display:flex}.ember-hint{bottom:264px}.ember-hint>span{display:none}}
@media(max-width:650px){.ember-top{left:14px;right:14px;top:12px;gap:12px}.ember-brand{font-size:16px;letter-spacing:2px;gap:7px}.ember-mark{font-size:25px}.ember-brand small{font-size:7px;letter-spacing:1.5px}.ember-status{gap:10px;font-size:11px}.ember-nav{position:absolute;right:0;top:45px}.ember-nav button{font-size:10px;min-height:30px;padding:5px 10px}.ember-location{top:101px;left:14px;max-width:220px}.ember-location strong{font-size:22px}.ember-location span{font-size:10px;max-width:200px}.ember-bottom{bottom:12px;width:calc(100% - 24px);padding:10px 8px;gap:12px;flex-direction:column;align-items:stretch}.ember-meters{width:100%;display:grid;grid-template-columns:1fr 1fr;gap:4px}.ember-meters>div{margin:0}.ember-meters .stamina{grid-column:span 2}.ember-meters .xp{grid-column:span 2;margin-top:1px;margin-bottom:13px}.ember-hotbar{gap:5px}.ember-hotbar .skill{height:59px;padding:5px 7px}.skill b{font-size:10px;min-height:23px;margin:2px 0}.skill small{font-size:8px}.skill span{font-size:8px}.ember-hint{bottom:151px;font-size:10px;flex-direction:column;gap:5px}.ember-touch{bottom:175px;left:14px;right:14px}.ember-hint:has(.primary){bottom:286px}.ember-modal{padding:10px}.ember-card{padding:16px;max-height:94dvh}.ember-panel-top h2{font-size:25px}.ember-tree{gap:15px 6px}.node{padding:8px 6px;min-height:90px;font-size:11px}.node small,.node>span:last-child{font-size:8px}.node:after{height:15px;bottom:-16px}.ember-slider{grid-template-columns:110px 1fr 37px;gap:8px;font-size:10px}.ember-item{gap:8px;padding:9px}.ember-item b{font-size:13px}.item-actions button{font-size:10px;padding:5px 7px}.item-symbol{font-size:20px;width:20px}}
@media(max-height:500px){.ember-location{top:70px}.ember-location span{display:none}.ember-top{top:8px}.ember-bottom{bottom:8px;padding:8px 12px;gap:18px}.ember-meters{width:230px}.ember-hint{bottom:111px}.ember-touch{bottom:125px}.ember-location strong{font-size:20px}}
`;
