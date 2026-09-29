import asyncio, json
from pathlib import Path
from playwright.async_api import async_playwright

URL=(Path(__file__).resolve().parents[1] / 'standalone/3dpixel2d.html').as_uri()
async def main():
 async with async_playwright() as p:
  for engine in ['chromium','webkit','firefox']:
   browser=await getattr(p,engine).launch()
   opts=dict(viewport={'width':375,'height':667},has_touch=True,offline=engine!="webkit")
   if engine!='firefox': opts['is_mobile']=True
   ctx=await browser.new_context(**opts)
   await ctx.route("http://**/*", lambda route: route.abort())
   await ctx.route("https://**/*", lambda route: route.abort())
   page=await ctx.new_page()
   errors=[]; external=[]
   page.on('pageerror',lambda e:errors.append(str(e)))
   page.on('console',lambda m: errors.append(m.text) if m.type=='error' else None)
   page.on('request',lambda r:external.append(r.url) if r.url.startswith(('http:','https:')) else None)
   await page.goto(URL)
   await page.wait_for_function('window.agent?.ready',timeout=90000)
   await page.locator('#pause').tap()
   assert await page.evaluate('game.paused')
   start=await page.evaluate('({...game.sim.characters.get("player").pos})')
   button=page.locator('[data-key="ArrowRight"]'); box=await button.bounding_box()
   await page.mouse.move(box['x']+22,box['y']+22); await page.mouse.down()
   await page.wait_for_function('game.sim.characters.get("player").input.moveX !== 0')
   await page.evaluate('game.step(20)')
   after=await page.evaluate('({...game.sim.characters.get("player").pos})')
   assert abs(after['x']-start['x'])+abs(after['z']-start['z'])>0.1
   await page.mouse.up()
   await page.wait_for_function('game.sim.characters.get("player").input.moveX === 0 && game.sim.characters.get("player").input.moveZ === 0')
   await page.locator('[data-key="Space"]').tap()
   await page.evaluate('game.step(5)')
   assert await page.evaluate('game.sim.characters.get("player").pos.y > 0')
   await page.evaluate('game.step(90)')
   await page.locator('[data-key="KeyJ"]').tap()
   await page.evaluate('game.step(1)')
   state=await page.evaluate('game.sim.characters.get("player").state')
   assert state.startswith('attack'),state
   await page.locator('#mode').tap()
   await page.screenshot(path=f'/tmp/pixel-standalone-{engine}-plain.png')
   await page.locator('#mode').tap()
   await page.locator('#reset').tap()
   await page.wait_for_function('game.sim.frame === 0')
   await page.locator('#pause').tap()
   await page.wait_for_function('game.sim.frame > 2')
   # Prove even models outside the initial scene are embedded.
   models=await page.evaluate('async () => { await Promise.all(game.lib.manifest.models.map(m=>game.lib.loadModel(m.id))); return game.lib.manifest.models.length; }')
   assert not external, external
   assert not errors, errors
   print(json.dumps({'engine':engine,'offline':True,'movement':True,'release':True,'jump':True,'attack':state,'pause_reset_resume':True,'render_modes':True,'models_loaded':models,'external_requests':external,'errors':errors}),flush=True)
   await browser.close()
asyncio.run(main())
