"""Exercise the offline single-file game in Chromium, WebKit and Firefox (phone-sized, touch).

Flow: title screen -> new game -> town -> touch stick movement and release -> attack and dodge
buttons -> rebind dodge in Settings and use it from the keyboard -> touch layout editor -> bag,
tree and pause menu (difficulty sliders) -> talk to the merchant -> enter depth 1 -> fight ->
pixel / 3D toggle -> every model embedded. Fails on console errors or any network request.
"""
import asyncio, json
from pathlib import Path
from playwright.async_api import async_playwright

URL = (Path(__file__).resolve().parents[1] / 'standalone/3dpixel2d.html').as_uri()


async def main():
    async with async_playwright() as p:
        for engine in ['chromium', 'webkit', 'firefox']:
            browser = await getattr(p, engine).launch()
            opts = dict(viewport={'width': 375, 'height': 667}, has_touch=True, offline=engine != 'webkit')
            if engine != 'firefox':
                opts['is_mobile'] = True
            ctx = await browser.new_context(**opts)
            await ctx.route('http://**/*', lambda route: route.abort())
            await ctx.route('https://**/*', lambda route: route.abort())
            page = await ctx.new_page()
            errors = []
            external = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            page.on('request', lambda r: external.append(r.url) if r.url.startswith(('http:', 'https:')) else None)
            page.on('dialog', lambda d: asyncio.ensure_future(d.accept('Verifier')))
            await page.goto(URL)
            await page.wait_for_function('window.agent?.ready', timeout=120000)
            # Title -> creature workshop: live preview, edit, save to the bestiary, close back to the title.
            await page.locator('#gtitle button', has_text='Creature workshop').tap()
            await page.wait_for_selector('.workshop canvas.pv')
            await page.wait_for_timeout(400)
            drawn = await page.evaluate('(() => { const c = document.querySelector(".workshop canvas.pv"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; })()')
            assert drawn > 100, f'workshop preview is empty ({drawn} px)'
            await page.locator('.workshop .chip', has_text='Charger').first.tap()
            await page.locator('.workshop button', has_text='Save to bestiary').tap()
            assert await page.evaluate('JSON.parse(localStorage.getItem("3dpixel2d.save.v1")).bestiary.length') == 1
            await page.locator('.workshop button[aria-label="Close"]').tap()
            await page.wait_for_selector('#gtitle:not([hidden])')
            # Title -> new game -> town.
            await page.locator('#gtitle button', has_text='New game').first.tap()
            await page.wait_for_function('game.mode === "town" && !game.busy', timeout=60000)
            assert await page.evaluate('game.hero.name') == 'Verifier'
            # GPU resources stay flat across level reloads (character bone textures once leaked).
            mem = await page.evaluate('async () => { const c = []; for (let i = 0; i < 3; i++) { await game.enterTown(); game.render(1); const m = game.renderer.info.memory; c.push([m.textures, m.geometries]); } return c; }')
            assert mem[2][0] <= mem[0][0] + 2 and mem[2][1] <= mem[0][1] + 2, f'GPU resources grow across reloads: {mem}'
            # Touch movement (the game keeps running; measure while pressed).
            start = await page.evaluate('({...game.sim.characters.get("player").pos})')
            stick = page.locator('#touch [data-control="move"]')
            box = await stick.bounding_box()
            cx, cy = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
            await page.mouse.move(cx, cy)
            await page.mouse.down()
            await page.mouse.move(cx + 45, cy, steps=4)
            await page.wait_for_function('game.sim.characters.get("player").input.moveX !== 0')
            await page.wait_for_timeout(400)
            after = await page.evaluate('({...game.sim.characters.get("player").pos})')
            assert abs(after['x'] - start['x']) + abs(after['z'] - start['z']) > 0.1, 'stick moves the hero'
            await page.mouse.up()
            await page.wait_for_function('game.sim.characters.get("player").input.moveX === 0 && game.sim.characters.get("player").input.moveZ === 0')
            # Attack and dodge buttons.
            await page.locator('#touch [data-action="attack"]').tap()
            await page.wait_for_function('["slash1","slash2","slash3"].includes(game.sim.characters.get("player").action?.skill) || game.sim.events.some(e => e.type === "skill" && e.skill === "slash1")')
            await page.wait_for_timeout(700)
            await page.locator('#touch [data-action="dodge"]').tap()
            await page.wait_for_function('game.sim.events.some(e => e.type === "skill" && e.skill === "dodge")')
            # Settings: rebind dodge to U with the keyboard, then use it.
            await page.locator('#settings-open').tap()
            assert await page.evaluate('!document.getElementById("settings").hidden')
            await page.locator('#tab-keyboard').tap()
            await page.locator('[data-focus="add-keys-dodge"]').tap()
            await page.keyboard.press('KeyU')
            assert await page.evaluate('game.sim && JSON.parse(localStorage.getItem("3dpixel2d.settings.v1")).profiles[0].keys.dodge.includes("KeyU")')
            await page.locator('#tab-touch').tap()
            await page.locator('[data-focus="edit-live"]').tap()
            assert await page.evaluate('!document.getElementById("touch-edit-bar").hidden && document.getElementById("settings").hidden')
            await page.locator('#touch-edit-bar button', has_text='Done').tap()
            await page.keyboard.press('Escape')
            assert await page.evaluate('document.getElementById("settings").hidden')
            await page.wait_for_timeout(900)
            dodges = await page.evaluate('game.sim.events.filter(e => e.type === "skill" && e.skill === "dodge").length')
            await page.keyboard.press('KeyU')
            await page.wait_for_function(f'game.sim.events.filter(e => e.type === "skill" && e.skill === "dodge").length > {dodges}')
            # Panels and the pause menu.
            await page.locator('#bag').tap()
            assert await page.evaluate('!document.querySelector(".gp:not(.workshop)").hidden')
            await page.locator('.gp:not(.workshop) header button[aria-label="Close"]').tap()
            await page.locator('#treebtn').tap()
            assert await page.evaluate('document.querySelector(".treebox canvas") !== null')
            await page.locator('.gp:not(.workshop) header button[aria-label="Close"]').tap()
            await page.locator('#menu-open').tap()
            assert await page.evaluate('!document.getElementById("gmenu").hidden && document.querySelectorAll("#gmenu input[type=range]").length >= 6')
            await page.locator('#gmenu button', has_text='Resume').tap()
            # Talk to the merchant (walk up and interact).
            await page.evaluate('(() => { const m = game.sim.get("merchant"); game.sim.teleport("player", m.pos.x - 1.2, m.pos.z + 1.2); game.sim.get("player").input.interact = true; })()')
            await page.wait_for_function('!document.querySelector(".gp:not(.workshop)").hidden && document.querySelector(".gp:not(.workshop) h2").textContent.includes("Odessa")')
            await page.locator('.gp:not(.workshop) header button[aria-label="Close"]').tap()
            # Into the dungeon.
            await page.evaluate('game.enterStage(1)')
            await page.wait_for_function('game.mode === "dungeon" && !game.busy', timeout=60000)
            monsters = await page.evaluate('[...game.sim.characters.values()].filter(c => c.monster).length')
            assert monsters > 5, monsters
            await page.evaluate('(() => { const s = game.sim; const t = [...s.characters.values()].find(c => c.monster && !c.monster.boss); const p = s.nav.nearestFree({x: t.pos.x + 1.5, z: t.pos.z}); s.teleport("player", p.x, p.z); })()')
            # Keyboard use hid the touch controls; touching the screen brings them back.
            await page.locator('#view').tap(position={'x': 30, 'y': 300})
            await page.wait_for_function('!document.getElementById("touch").hidden')
            await page.locator('#touch [data-action="attack"]').tap()
            await page.wait_for_timeout(1500)
            hits = await page.evaluate('game.sim.events.filter(e => e.type === "hit").length')
            await page.locator('#mode').tap()
            await page.screenshot(path=f'/tmp/pixel-standalone-{engine}-plain.png')
            await page.locator('#mode').tap()
            await page.screenshot(path=f'/tmp/pixel-standalone-{engine}-pixel.png')
            models = await page.evaluate('async () => { await Promise.all(game.lib.manifest.models.map(m => game.lib.loadModel(m.id))); return game.lib.manifest.models.length; }')
            assert not external, external
            assert not errors, errors
            print(json.dumps({'engine': engine, 'offline': True, 'workshop': drawn, 'gpu_after_reloads': mem[2], 'title_new_game': True, 'movement': True, 'release': True, 'attack_dodge': True,
                              'settings_rebind_layout': True, 'panels_pause': True, 'merchant': True, 'dungeon_monsters': monsters, 'hits': hits,
                              'render_modes': True, 'models_loaded': models, 'external_requests': external, 'errors': errors}), flush=True)
            await browser.close()


asyncio.run(main())
