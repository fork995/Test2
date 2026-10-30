"""Check built patient cards in a mobile Chromium viewport with demo data."""
from pathlib import Path
from playwright.sync_api import sync_playwright

out = Path(__file__).resolve().parents[1] / 'screenshots'
out.mkdir(exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    for width in (375, 390, 430):
        page = browser.new_page(viewport={'width': width, 'height': 844})
        page.goto('http://localhost:4187/', wait_until='networkidle')
        page.get_by_role('button', name='Открыть демо').click()
        page.get_by_role('button', name='Пациенты', exact=True).click()
        counters = page.locator('.patient-card-counters')
        counters.first.wait_for()
        for counter in counters.all():
            assert len(counter.evaluate('(e) => getComputedStyle(e).gridTemplateColumns.trim().split(/\\s+/)')) == 1
            rects = counter.locator(':scope > span').evaluate_all('(els) => els.map(e => e.getBoundingClientRect().toJSON())')
            assert len(rects) == 2 and rects[1]['top'] >= rects[0]['bottom']
        page.screenshot(path=str(out / f'patients-{width}.png'), full_page=True)
        print(f'{width}: one column, counters vertically stacked')
        page.close()
    browser.close()
