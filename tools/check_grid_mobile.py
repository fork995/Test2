from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 for w,h in [(375,812),(390,844),(430,932),(844,390)]:
  page=b.new_page(viewport={'width':w,'height':h},is_mobile=True,has_touch=True)
  page.goto('http://localhost:4187/',wait_until='networkidle');page.get_by_role('button',name='Открыть демо').click();page.get_by_role('button',name='Пациенты',exact=True).click();page.locator('.patient-card').first.click();page.get_by_role('button',name='Сетка',exact=True).click();grid=page.locator('.grid-scroll');grid.wait_for();page.wait_for_timeout(200)
  a=grid.evaluate('(e)=>({x:e.scrollLeft,w:e.clientWidth,max:e.scrollWidth-e.clientWidth,current:!!e.querySelector(".grid-head .current")})');print(w,h,'standard',a)
  gesture=grid.evaluate("""e=>{let r=e.getBoundingClientRect(),x=r.left+200,y=r.top+60;let t=(x,y)=>new Touch({identifier:1,target:e,clientX:x,clientY:y});e.dispatchEvent(new TouchEvent('touchstart',{touches:[t(x,y)],bubbles:true,cancelable:true}));let ev=new TouchEvent('touchmove',{touches:[t(x-40,y)],bubbles:true,cancelable:true});let before=e.scrollLeft;e.dispatchEvent(ev);let result={delta:e.scrollLeft-before,prevented:ev.defaultPrevented};e.scrollLeft=before;return result;}""");assert gesture['prevented'] and abs(gesture['delta']-28)<2,gesture
  page.screenshot(path=f'/tmp/test2-grid/{w}-normal.png');page.get_by_role('button',name='Расширить сетку').click();page.wait_for_timeout(150)
  z=grid.evaluate('(e)=>({x:e.scrollLeft,w:e.clientWidth})');print(w,'expanded',z);assert z['w']>=a['w'];assert abs(z['x']-a['x'])<2
  page.screenshot(path=f'/tmp/test2-grid/{w}-expanded.png');page.get_by_role('button',name='Свернуть сетку').click();assert abs(grid.evaluate('e=>e.scrollLeft')-a['x'])<2
  page.close()
 b.close()
