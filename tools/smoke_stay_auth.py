"""Production Stay-auth smoke with a synthetic JWT and mocked CleverVet GETs."""

from pathlib import Path
import base64
import json
import sys
import time

from playwright.sync_api import sync_playwright


BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4187/Test2/"
API = "https://backend.clevervet.tech/api/"
OUT = Path(__file__).resolve().parents[1] / "docs/screenshots/stay-auth"
OUT.mkdir(parents=True, exist_ok=True)


def encoded(value):
    return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")


TOKEN = f"{encoded({'alg': 'none'})}.{encoded({'exp': int(time.time()) + 3600})}.synthetic"
TRANSFER = {
    "version": 1,
    "token": TOKEN,
    "capturedAt": int(time.time() * 1000),
    "expiresAt": int(time.time() * 1000) + 3_600_000,
}


def run(browser, width):
    context = browser.new_context(
        viewport={"width": width, "height": 844},
        is_mobile=True,
        has_touch=True,
        device_scale_factor=2,
        locale="ru-RU",
        timezone_id="Europe/Moscow",
    )
    context.add_init_script(
        """
        window.__stayTransfers = 0;
        window.addEventListener('clevervet-mobile:stay-ready:v1', () => {
          if (window.__stayTransfers) return;
          window.__stayTransfers++;
          window.dispatchEvent(new CustomEvent('clevervet-mobile:stay-token:v1', {
            detail: %s
          }));
        });
        """
        % json.dumps(TRANSFER)
    )
    page = context.new_page()
    page.set_default_timeout(12000)
    errors = []
    calls = []
    page.on("pageerror", lambda error: errors.append(str(error)))

    def route(route):
        request = route.request
        if request.url.startswith(API):
            assert request.method == "GET", "Stay smoke must never write"
            path = request.url[len(API) :]
            calls.append(path)
            if path == "branches":
                data = [
                    {
                        "id": "branch",
                        "name": "ИВЦ Запад",
                        "workShiftStart": "08:00",
                        "departments": [
                            {"id": "department", "name": "Хирургический стационар"}
                        ],
                    }
                ]
            elif path == "branches/branch/departments/department/patients":
                data = []
            else:
                raise AssertionError(f"Unexpected mock API read: {path}")
            route.fulfill(status=200, json=data)
            return
        assert request.url.startswith(BASE), f"Unexpected external request: {request.url}"
        route.continue_()

    page.route("**/*", route)
    page.goto(BASE, wait_until="networkidle")
    page.get_by_role("button", name="Пациенты", exact=True).wait_for()
    assert page.evaluate("window.__stayTransfers") == 1
    assert TOKEN not in page.url and "importAuth" not in page.url
    assert page.get_by_role("button", name="Пациенты", exact=True).get_attribute(
        "aria-current"
    ) == "page"
    assert calls == [
        "branches",
        "branches/branch/departments/department/patients",
    ]
    page.reload(wait_until="networkidle")
    page.get_by_role("button", name="Пациенты", exact=True).wait_for()
    assert page.evaluate("window.__stayTransfers") == 0
    assert calls == [
        "branches",
        "branches/branch/departments/department/patients",
        "branches",
        "branches/branch/departments/department/patients",
    ]
    assert not errors
    assert not page.evaluate("document.documentElement.scrollWidth > innerWidth")
    if width == 390:
        page.screenshot(path=str(OUT / "stay-auto-login.png"), full_page=True)
    context.close()
    return {
        "width": width,
        "stay_transfers": 1,
        "restored_after_reload_without_stay": True,
        "patients_opened": True,
        "mock_get_requests": len(calls),
        "write_requests": 0,
        "uncaught_errors": len(errors),
        "horizontal_overflow": False,
    }


with sync_playwright() as playwright:
    chromium = playwright.chromium.launch(
        executable_path="/usr/bin/chromium", headless=True, args=["--no-sandbox"]
    )
    result = {
        "target": BASE,
        "browser": "Chromium mobile emulation, not physical Safari",
        "checks": [run(chromium, width) for width in (375, 390, 430)],
    }
    chromium.close()
    (OUT / "mobile-check.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(result, ensure_ascii=False))
