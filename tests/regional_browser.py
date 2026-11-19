"""Check the built regional explorer in Chromium."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
def run():
    directory = ROOT / 'browser-checks'
    directory.mkdir(exist_ok=True)
    with ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=ROOT/'dist')) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch()
                page = browser.new_page(viewport={'width': 1240, 'height': 900})
                errors = []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.route('https://tile.openstreetmap.org/**', lambda route: route.abort())
                page.goto(f'http://127.0.0.1:{server.server_port}/')
                page.locator('#results li').first.wait_for()
                assert page.locator('#province option').count() == 13
                page.locator('#nearby-city').select_option('nu')
                page.wait_for_function("document.getElementById('message').textContent.includes('nearest first')")
                assert page.locator('#province').input_value() == 'NU'
                page.locator('#kind').select_option('terrestrial')
                page.locator('#results li').first.wait_for()
                page.locator('#results button').first.click()
                assert 'NU · Terrestrial' in page.locator('#detail').inner_text()
                with page.expect_download() as download:
                    page.locator('#export').click()
                assert 'terrestrial-nu' in download.value.suggested_filename
                page.locator('#province').select_option('ON')
                page.wait_for_function("document.getElementById('message').textContent.includes('records in this extract')", timeout=90000)
                assert page.locator('#results li').count() == 20
                assert not page.locator('#nearby-coordinates').input_value()
                page.screenshot(path=directory/'desktop.png', full_page=True)
                page.set_viewport_size({'width': 390, 'height': 844})
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
                page.screenshot(path=directory/'mobile.png', full_page=True)
                assert not errors, errors
                browser.close()
        finally:
            server.shutdown()

if __name__ == '__main__':
    run()
