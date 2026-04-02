# Tool: Playwright

End-to-end testing with browser automation.

## Install

```bash
bun add -d @playwright/test
bunx playwright install
```

## Why Playwright

- **Cross-browser**: Chrome, Firefox, Safari (WebKit)
- **Auto-wait**: No flaky `sleep()` calls
- **Powerful selectors**: Text, role, test ID, CSS
- **Trace viewer**: Debug failures with screenshots and DOM snapshots
- **Parallel execution**: Fast test runs

## Configuration

### playwright.config.ts

```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { open: "never" }]],

  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],

  webServer: {
    command: "bun run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
  },
});
```

### package.json scripts

```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:debug": "playwright test --debug"
  }
}
```

## Key Patterns

### Basic Test

```typescript
// e2e/home.spec.ts
import { test, expect } from "@playwright/test";

test("homepage has title", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/My App/);
});

test("navigation works", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "About" }).click();
  await expect(page).toHaveURL("/about");
});
```

### Form Interaction

```typescript
test("login form", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel("Email").fill("test@example.com");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Login" }).click();

  await expect(page).toHaveURL("/dashboard");
  await expect(page.getByText("Welcome back")).toBeVisible();
});
```

### Testing with Authentication

```typescript
// e2e/auth.setup.ts
import { test as setup, expect } from "@playwright/test";

const authFile = "e2e/.auth/user.json";

setup("authenticate", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("test@example.com");
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Login" }).click();

  await expect(page.getByText("Dashboard")).toBeVisible();

  await page.context().storageState({ path: authFile });
});
```

```typescript
// playwright.config.ts
export default defineConfig({
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],
});
```

### Page Object Model

```typescript
// e2e/pages/login-page.ts
import { Page, Locator } from "@playwright/test";

export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByLabel("Email");
    this.passwordInput = page.getByLabel("Password");
    this.submitButton = page.getByRole("button", { name: "Login" });
  }

  async goto() {
    await this.page.goto("/login");
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }
}

// e2e/login.spec.ts
import { test, expect } from "@playwright/test";
import { LoginPage } from "./pages/login-page";

test("successful login", async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login("test@example.com", "password123");
  await expect(page).toHaveURL("/dashboard");
});
```

### API Mocking

```typescript
test("handles API error", async ({ page }) => {
  await page.route("/api/users", (route) =>
    route.fulfill({
      status: 500,
      body: JSON.stringify({ error: "Server error" }),
    })
  );

  await page.goto("/users");
  await expect(page.getByText("Failed to load users")).toBeVisible();
});
```

### Visual Regression

```typescript
test("homepage visual", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveScreenshot("homepage.png");
});
```

### Mobile Testing

```typescript
import { devices } from "@playwright/test";

test.use({ ...devices["iPhone 13"] });

test("mobile navigation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("navigation")).toBeVisible();
});
```

## Commands

```bash
bun run test:e2e           # Run all tests
bun run test:e2e:ui        # Run with UI mode
bun run test:e2e:debug     # Run with debugger
bunx playwright show-report # View HTML report
bunx playwright codegen    # Generate tests by recording
```

## Gotchas

- Always use `await` with Playwright methods
- Prefer role/label selectors over CSS for resilience
- Use `webServer` config to auto-start your app
- Add `e2e/.auth/` to `.gitignore`
- Trace files can be large - only enable on failure

## Pairs With

- [Next.js](./nextjs.md) or [Hono](./hono.md) apps
- CI/CD pipelines (GitHub Actions, etc.)
- Visual regression testing services
